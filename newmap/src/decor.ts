import { pointInPolygon, pointInRing, ringBounds, type XZ } from './geo';
import { Occupancy } from './merge';
import { hash01, type SceneModel } from './model';

/** Roads for vehicles (the bigger ones get rows of trees). */
const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;

export const MAX_TREES = 3000;

export interface Tree {
  at: XZ;
  /** Crown radius, metres. */
  crown: number;
  /** Height of the crown's middle, metres. */
  height: number;
  /** 0–1, picks a shade of green. */
  shade: number;
}

export interface Decor {
  trees: Tree[];
}

/** Points every `step` metres along a polyline, shifted `side` metres to its right. */
export function offsetPointsAlong(pts: XZ[], step: number, side: number): XZ[] {
  const out: XZ[] = [];
  let next = step / 2;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    // Right of the direction of travel, with x east and z south.
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    while (next <= walked + len) {
      const t = (next - walked) / len;
      out.push([ax + (bx - ax) * t + nx * side, az + (bz - az) * t + nz * side]);
      next += step;
    }
    walked += len;
  }
  return out;
}

function tree(at: XZ, key: string): Tree {
  const r = hash01(key);
  return { at, crown: 1.6 + r * 1.3, height: 3.4 + r * 2, shade: hash01(`${key}g`) };
}

/**
 * Trees: those mapped in OSM, plus rows along the bigger streets and scattered trees in parks, wherever the ground
 * is free (not a building, a road or water). Always the same for the same area.
 */
export function makeTrees(m: SceneModel, occ = new Occupancy(m), max = MAX_TREES): Tree[] {
  const free = ([x, z]: XZ) => pointInRing(x, z, m.boundary) && !occ.inBuilding(x, z) && !occ.onRoad(x, z) && !occ.onWater(x, z);
  const out: Tree[] = m.trees.map((at, i) => tree(at, `osm${i}`));
  for (const r of m.roads) {
    if (r.hidden || r.width < 6 || !DRIVABLE.test(r.kind)) continue;
    for (const side of [-1, 1]) {
      offsetPointsAlong(r.points, 14, side * (r.width / 2 + 1.6)).forEach((at, k) => {
        const key = `${r.id}:${side}:${k}`;
        if (hash01(key) < 0.55 && free(at)) out.push(tree(at, key));
      });
    }
  }
  for (const p of m.parks) {
    const [x0, z0, x1, z1] = ringBounds(p.outer);
    let n = 0;
    for (let x = x0 + 5; x < x1 && n < 400; x += 10) {
      for (let z = z0 + 5; z < z1 && n < 400; z += 10) {
        const key = `${p.id}:${Math.round(x)}:${Math.round(z)}`;
        const at: XZ = [x + (hash01(`${key}x`) - 0.5) * 7, z + (hash01(`${key}z`) - 0.5) * 7];
        if (hash01(key) < 0.5 && pointInPolygon(at[0], at[1], p.outer, p.holes) && free(at)) {
          out.push(tree(at, key));
          n++;
        }
      }
    }
  }
  return out.slice(0, max);
}

export function makeDecor(m: SceneModel): Decor {
  return { trees: makeTrees(m) };
}

