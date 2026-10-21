import { centroid, clipPolyline, type LocalProjection, pointInRing, polylineTouchesRing, type Ring, ringArea, type XZ } from './geo';
import type { Area, Line, OsmData, Poi, Tags } from './overpass';

/** Everything the 3D scene is built from, on the local ground plane in metres. */
export interface SceneModel {
  /** The drawn area. */
  boundary: Ring;
  buildings: SceneBuilding[];
  roads: Corridor[];
  roadAreas: Surface[];
  waterways: Corridor[];
  water: Surface[];
  parks: Surface[];
  yards: Surface[];
  barriers: Barrier[];
  pois: ScenePoi[];
}

export type BuildingSource = 'osm' | 'google' | 'microsoft' | 'open-buildings';

export interface SceneBuilding {
  id: string;
  source: BuildingSource;
  outer: Ring;
  holes: Ring[];
  /** Wall height above the ground, in metres (to the eaves). */
  height: number;
  /** Height where the walls start (raised parts such as an overhang). */
  minHeight: number;
  levels: number | null;
  color: string | null;
  roofColor: string | null;
  roofShape: string;
  roofHeight: number;
  /** Temples, pagodas, churches and listed monuments are drawn in their own colours. */
  role: 'house' | 'worship' | 'heritage';
  confidence: number | null;
  name: string | null;
}

/** A line with a width: a road or a river. */
export interface Corridor {
  id: string;
  points: XZ[];
  width: number;
  kind: string;
  /** Under ground or under a roof: drawn but not counted as open road surface. */
  hidden: boolean;
}

export interface Surface {
  id: string;
  outer: Ring;
  holes: Ring[];
  kind: string;
}

export interface Barrier {
  id: string;
  points: XZ[];
  height: number;
  thickness: number;
  kind: string;
}

export interface ScenePoi {
  id: string;
  at: XZ;
  kind: 'worship' | 'heritage';
  name: string | null;
}

export const LEVEL_H = 3.2;

/** "12", "12 m", "12.5m", "40'" → metres. */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*(m|ft|')?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] && m[2] !== 'm' && m[2] !== 'M' ? n * 0.3048 : n;
}

const parseCount = (v: string | undefined): number | null => {
  const n = v ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const ROAD_WIDTH: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  pedestrian: 5,
  service: 4,
  track: 3,
  cycleway: 2,
  footway: 2,
  path: 1.5,
  steps: 2,
  bridleway: 2,
};

export function roadWidth(t: Tags): number {
  const w = parseLength(t.width ?? t['est_width']);
  if (w && w > 0.5 && w < 60) return w;
  const kind = (t.highway ?? '').replace(/_link$/, '');
  const lanes = parseCount(t.lanes);
  if (lanes && lanes >= 1 && lanes <= 10 && kind !== 'footway') return Math.max(lanes * 3.2, ROAD_WIDTH[kind] ?? 0);
  return ROAD_WIDTH[kind] ?? 4;
}

const WATERWAY_WIDTH: Record<string, number> = { river: 25, canal: 12, stream: 4, drain: 3, ditch: 2 };

export function waterwayWidth(t: Tags): number {
  const w = parseLength(t.width);
  if (w && w > 0.3 && w < 500) return w;
  return WATERWAY_WIDTH[t.waterway ?? ''] ?? 3;
}

/** Roads and rivers that pass under buildings (tunnels, culverts, covered passages) or over them (bridges). */
export function isOffGround(t: Tags): boolean {
  const layer = Number(t.layer ?? 0);
  return (
    (!!t.tunnel && t.tunnel !== 'no') ||
    t.covered === 'yes' ||
    (!!t.bridge && t.bridge !== 'no') ||
    t.location === 'underground' ||
    (Number.isFinite(layer) && layer !== 0)
  );
}

const BARRIER: Record<string, { height: number; thickness: number }> = {
  wall: { height: 2.2, thickness: 0.25 },
  fence: { height: 1.6, thickness: 0.08 },
  city_wall: { height: 6, thickness: 1.5 },
  retaining_wall: { height: 1.2, thickness: 0.4 },
  hedge: { height: 1.2, thickness: 0.6 },
};

/** Stable pseudo-random number in [0, 1) from a string, so unknown heights stay the same between builds. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Number of floors to guess for a footprint with no height: narrow tube houses are 3–5 floors, sheds 1. */
export function guessLevels(id: string, footprintM2: number): number {
  const r = hash01(id);
  if (footprintM2 < 12) return 1;
  if (footprintM2 < 150) return 3 + Math.floor(r * 3);
  if (footprintM2 < 600) return 2 + Math.floor(r * 4);
  return 1 + Math.floor(r * 3);
}

function role(t: Tags): SceneBuilding['role'] {
  if (t.amenity === 'place_of_worship' || /^(temple|pagoda|church|cathedral|chapel|mosque|shrine)$/.test(t.building ?? '')) {
    return 'worship';
  }
  if (t.historic || t.heritage) return 'heritage';
  return 'house';
}

/** Turns the tags of an OSM building into what the scene needs, guessing what is missing. */
export function osmBuilding(id: string, outer: Ring, holes: Ring[], t: Tags, footprintM2: number): SceneBuilding {
  const levels = parseCount(t['building:levels']);
  const minLevel = parseCount(t['building:min_level']);
  const roofLevels = parseCount(t['roof:levels']) ?? 0;
  const roofShape = t['roof:shape'] ?? (role(t) === 'worship' ? 'hipped' : 'flat');
  const roofHeight = parseLength(t['roof:height']) ?? (roofShape === 'flat' ? 0 : roofLevels ? roofLevels * LEVEL_H : 2.5);
  let height = parseLength(t.height ?? t['building:height']);
  if (height !== null) height = Math.max(1, height - (roofShape === 'flat' ? 0 : roofHeight));
  else if (levels !== null) height = Math.max(1, levels * LEVEL_H);
  else height = guessLevels(id, footprintM2) * LEVEL_H;
  const minHeight = parseLength(t.min_height) ?? (minLevel !== null ? minLevel * LEVEL_H : 0);
  return {
    id,
    source: 'osm',
    outer,
    holes,
    height: Math.max(height, minHeight + 0.5),
    minHeight,
    levels,
    color: t['building:colour'] ?? t.colour ?? null,
    roofColor: t['roof:colour'] ?? null,
    roofShape,
    roofHeight,
    role: role(t),
    confidence: null,
    name: t.name ?? null,
  };
}

function project(p: LocalProjection, a: Area): { outer: Ring; holes: Ring[] } {
  return { outer: a.outer.map((q) => p.toXZ(q)), holes: a.holes.map((h) => h.map((q) => p.toXZ(q))) };
}


/** Projects the OSM answer and keeps what lies inside the drawn area. */
export function osmToScene(osm: OsmData, boundary: Ring, p: LocalProjection): SceneModel {
  const m: SceneModel = {
    boundary,
    buildings: [],
    roads: [],
    roadAreas: [],
    waterways: [],
    water: [],
    parks: [],
    yards: [],
    barriers: [],
    pois: [],
  };
  for (const a of osm.areas) {
    const { outer, holes } = project(p, a);
    if (a.kind === 'building') {
      const c = centroid(outer);
      if (!pointInRing(c[0], c[1], boundary)) continue;
      m.buildings.push(osmBuilding(a.id, outer, holes, a.tags, ringArea(outer)));
      continue;
    }
    // Keep areas that reach into the drawn area or contain it whole (a big lake or park).
    if (!polylineTouchesRing([...outer, outer[0]], boundary) && !pointInRing(boundary[0][0], boundary[0][1], outer)) continue;
    const s: Surface = { id: a.id, outer, holes, kind: a.tags.leisure ?? a.tags.landuse ?? a.tags.natural ?? a.kind };
    if (a.kind === 'water') m.water.push(s);
    else if (a.kind === 'park') m.parks.push(s);
    else if (a.kind === 'road') m.roadAreas.push(s);
    else m.yards.push({ ...s, kind: a.kind });
  }
  for (const l of osm.lines) addLine(m, l, p, boundary);
  for (const poi of osm.pois) addPoi(m, poi, p, boundary);
  return m;
}

/** Adds a road, river or wall, cut to the drawn area. */
function addLine(m: SceneModel, l: Line, p: LocalProjection, boundary: Ring): void {
  const pieces = clipPolyline(
    l.points.map((q) => p.toXZ(q)),
    boundary,
  );
  pieces.forEach((points, i) => {
    const id = pieces.length > 1 ? `${l.id}#${i}` : l.id;
    if (l.kind === 'road') {
      m.roads.push({ id, points, width: roadWidth(l.tags), kind: l.tags.highway, hidden: isOffGround(l.tags) });
    } else if (l.kind === 'waterway') {
      m.waterways.push({ id, points, width: waterwayWidth(l.tags), kind: l.tags.waterway, hidden: isOffGround(l.tags) });
    } else {
      const b = BARRIER[l.tags.barrier] ?? BARRIER.wall;
      const h = parseLength(l.tags.height);
      m.barriers.push({ id, points, height: h && h > 0 && h < 30 ? h : b.height, thickness: b.thickness, kind: l.tags.barrier });
    }
  });
}

function addPoi(m: SceneModel, poi: Poi, p: LocalProjection, boundary: Ring): void {
  const at = p.toXZ(poi.at);
  if (pointInRing(at[0], at[1], boundary)) m.pois.push({ id: poi.id, at, kind: poi.kind, name: poi.tags.name ?? null });
}
