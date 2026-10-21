import {
  centroid,
  distToSegmentSq,
  GridIndex,
  type LocalProjection,
  pointInPolygon,
  pointInRing,
  type Ring,
  ringArea,
  ringBounds,
  samplePoints,
  type XZ,
} from './geo';
import { guessLevels, LEVEL_H, type SceneBuilding, type SceneModel } from './model';
import type { Footprint } from './openBuildings';

/** Open Buildings footprints below this confidence are dropped. */
export const MIN_CONFIDENCE = 0.7;
/** Share of a footprint that may lie over an OSM building, a road or water before it is dropped. */
export const MAX_OVERLAP = 0.3;

export type DropReason = 'lowConfidence' | 'outside' | 'overlapsOsm' | 'onRoad' | 'onWater';

export interface MergeStats {
  osm: number;
  openBuildings: number;
  kept: number;
  dropped: Record<DropReason, number>;
}

interface Poly {
  outer: Ring;
  holes: Ring[];
}

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/** Spatial lookups over what the OSM layer already occupies. */
export class Occupancy {
  private readonly buildings = new GridIndex<Poly>();
  private readonly water = new GridIndex<Poly>();
  private readonly roadAreas = new GridIndex<Poly>();
  private readonly roads = new GridIndex<Seg>();
  private readonly rivers = new GridIndex<Seg>();
  private readonly buildingCentroids = new GridIndex<XZ>();

  constructor(m: SceneModel) {
    for (const b of m.buildings) {
      this.addPoly(this.buildings, b);
      const c = centroid(b.outer);
      this.buildingCentroids.insert(c, c[0], c[1], c[0], c[1]);
    }
    for (const w of m.water) this.addPoly(this.water, w);
    for (const r of m.roadAreas) this.addPoly(this.roadAreas, r);
    for (const r of m.roads) if (!r.hidden) this.addLine(this.roads, r.points, r.width / 2);
    for (const r of m.waterways) if (!r.hidden) this.addLine(this.rivers, r.points, r.width / 2);
  }

  private addPoly(index: GridIndex<Poly>, p: Poly): void {
    const [x0, z0, x1, z1] = ringBounds(p.outer);
    index.insert(p, x0, z0, x1, z1);
  }

  private addLine(index: GridIndex<Seg>, pts: XZ[], half: number): void {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      index.insert({ ax, az, bx, bz, half }, Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half);
    }
  }

  private inPoly(index: GridIndex<Poly>, x: number, z: number): boolean {
    return index.at(x, z).some((p) => pointInPolygon(x, z, p.outer, p.holes));
  }

  private nearLine(index: GridIndex<Seg>, x: number, z: number): boolean {
    return index.at(x, z).some((s) => distToSegmentSq(x, z, s.ax, s.az, s.bx, s.bz) <= s.half * s.half);
  }

  inBuilding(x: number, z: number): boolean {
    return this.inPoly(this.buildings, x, z);
  }

  onRoad(x: number, z: number): boolean {
    return this.nearLine(this.roads, x, z) || this.inPoly(this.roadAreas, x, z);
  }

  onWater(x: number, z: number): boolean {
    return this.inPoly(this.water, x, z) || this.nearLine(this.rivers, x, z);
  }

  /** Whether an OSM building's middle lies inside this ring (a big footprint swallowing a small mapped house). */
  coversOsmBuilding(ring: Ring): boolean {
    const [x0, z0, x1, z1] = ringBounds(ring);
    const seen = new Set<XZ>();
    for (let x = Math.floor(x0 / 25) * 25; x <= x1 + 25; x += 25) {
      for (let z = Math.floor(z0 / 25) * 25; z <= z1 + 25; z += 25) {
        for (const c of this.buildingCentroids.at(x, z)) {
          if (seen.has(c)) continue;
          seen.add(c);
          if (pointInRing(c[0], c[1], ring)) return true;
        }
      }
    }
    return false;
  }
}

const share = (pts: XZ[], test: (x: number, z: number) => boolean) => pts.filter(([x, z]) => test(x, z)).length / pts.length;

/** Why an Open Buildings footprint is not used, or null when it is kept. */
export function dropReason(fp: Footprint, ring: Ring, boundary: Ring, occ: Occupancy): DropReason | null {
  if (fp.confidence !== null && fp.confidence < MIN_CONFIDENCE) return 'lowConfidence';
  const c = centroid(ring);
  if (!pointInRing(c[0], c[1], boundary)) return 'outside';
  const pts = samplePoints(ring);
  if (share(pts, (x, z) => occ.inBuilding(x, z)) >= MAX_OVERLAP || occ.coversOsmBuilding(ring)) return 'overlapsOsm';
  if (share(pts, (x, z) => occ.onRoad(x, z)) >= MAX_OVERLAP) return 'onRoad';
  if (share(pts, (x, z) => occ.onWater(x, z)) >= MAX_OVERLAP) return 'onWater';
  return null;
}

export function footprintBuilding(id: string, fp: Footprint, outer: Ring, holes: Ring[]): SceneBuilding {
  const levels = guessLevels(id, ringArea(outer));
  return {
    id,
    source: fp.source === 'google' || fp.source === 'microsoft' ? fp.source : 'open-buildings',
    outer,
    holes,
    height: levels * LEVEL_H,
    minHeight: 0,
    levels: null,
    color: null,
    roofColor: null,
    roofShape: '',
    roofHeight: 0,
    role: 'house',
    confidence: fp.confidence,
    name: null,
  };
}

/**
 * Adds Open Buildings footprints to a scene built from OSM. OSM buildings always win; a footprint is dropped if its
 * confidence is under 0.7, or it sits on an OSM building, on a road or on water. Footprints without a confidence
 * value (the source gave none) are judged on position alone.
 */
export function mergeFootprints(m: SceneModel, footprints: Footprint[], p: LocalProjection): MergeStats {
  const stats: MergeStats = {
    osm: m.buildings.length,
    openBuildings: footprints.length,
    kept: 0,
    dropped: { lowConfidence: 0, outside: 0, overlapsOsm: 0, onRoad: 0, onWater: 0 },
  };
  const occ = new Occupancy(m);
  const added: SceneBuilding[] = [];
  for (const fp of footprints) {
    const outer = fp.outer.map((q) => p.toXZ(q));
    const reason = dropReason(fp, outer, m.boundary, occ);
    if (reason) {
      stats.dropped[reason]++;
      continue;
    }
    // Named by position so the guessed height stays the same however the file is ordered.
    const id = `ob/${fp.outer[0][0].toFixed(6)},${fp.outer[0][1].toFixed(6)}`;
    added.push(footprintBuilding(id, fp, outer, fp.holes.map((h) => h.map((q) => p.toXZ(q)))));
  }
  stats.kept = added.length;
  m.buildings.push(...added);
  return stats;
}
