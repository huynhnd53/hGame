import { pointInPolygon, pointInRing, ringBounds, type XZ } from './geo';
import { Occupancy } from './merge';
import { hash01, type SceneModel } from './model';

/** Roads cars drive on. */
const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;

export const MAX_TREES = 3000;
export const MAX_CARS = 600;

export interface Tree {
  at: XZ;
  /** Crown radius, metres. */
  crown: number;
  /** Height of the crown's middle, metres. */
  height: number;
  /** 0–1, picks a shade of green. */
  shade: number;
}

/** A car going round and round along one side of a road. */
export interface CarTrack {
  points: XZ[];
  /** Distance from the start to each point. */
  cum: number[];
  length: number;
  /** Sideways shift to the right of the direction of travel, metres. */
  offset: number;
  /** Metres per second. */
  speed: number;
  /** Where along the track the car is at time 0. */
  start: number;
  /** 0–1, picks a body colour. */
  color: number;
}

export interface Decor {
  trees: Tree[];
  cars: CarTrack[];
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

function track(points: XZ[], offset: number, key: string): CarTrack {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const length = cum[cum.length - 1];
  return { points, cum, length, offset, speed: 5 + hash01(`${key}v`) * 6, start: hash01(`${key}s`) * length, color: hash01(`${key}c`) };
}

/** Cars on the drivable roads, about one every 40 m per direction, keeping to the right (as in Vietnam). */
export function makeCars(m: SceneModel, max = MAX_CARS): CarTrack[] {
  const out: CarTrack[] = [];
  for (const r of m.roads) {
    if (r.hidden || !DRIVABLE.test(r.kind)) continue;
    const ways = r.oneway ? [r.points] : [r.points, [...r.points].reverse()];
    ways.forEach((pts, dir) => {
      const base = track(pts, r.oneway ? 0 : r.width / 4, `${r.id}:${dir}`);
      if (base.length < 10) return;
      const n = Math.floor(base.length / 40 + hash01(`${r.id}:${dir}:n`));
      for (let k = 0; k < n; k++) {
        const key = `${r.id}:${dir}:${k}`;
        // Spread the cars of one road evenly, each with its own speed.
        const start = ((k + hash01(`${key}j`) * 0.5) / n) * base.length;
        out.push({ ...track(pts, base.offset, key), start });
      }
    });
  }
  return out.slice(0, max);
}

/** Position and heading (radians, 0 = towards +x) of a car `t` seconds in. */
export function carAt(c: CarTrack, t: number): { x: number; z: number; angle: number } {
  let d = (c.start + c.speed * t) % c.length;
  if (d < 0) d += c.length;
  let lo = 1;
  let hi = c.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.cum[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const [ax, az] = c.points[lo - 1];
  const [bx, bz] = c.points[lo];
  const seg = c.cum[lo] - c.cum[lo - 1] || 1;
  const f = (d - c.cum[lo - 1]) / seg;
  const dx = (bx - ax) / seg;
  const dz = (bz - az) / seg;
  return { x: ax + (bx - ax) * f - dz * c.offset, z: az + (bz - az) * f + dx * c.offset, angle: Math.atan2(dz, dx) };
}

export function makeDecor(m: SceneModel): Decor {
  return { trees: makeTrees(m), cars: makeCars(m) };
}

