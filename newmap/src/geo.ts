/** Longitude/latitude pair in degrees, in that order (GeoJSON order). */
export type LonLat = [number, number];
/** Point on the local ground plane in metres: x east, z south (three.js: -z is north). */
export type XZ = [number, number];
export type Ring = XZ[];

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;

/** Equirectangular projection around an origin; accurate to a few cm over a couple of km. */
export class LocalProjection {
  private readonly kx: number;
  constructor(
    readonly lon0: number,
    readonly lat0: number,
  ) {
    this.kx = M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180);
  }

  toXZ([lon, lat]: LonLat): XZ {
    return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * M_PER_DEG_LAT];
  }

  toLonLat([x, z]: XZ): LonLat {
    return [this.lon0 + x / this.kx, this.lat0 - z / M_PER_DEG_LAT];
  }
}

/** Axis-aligned rectangle with two opposite corners, as a ring going SW, SE, NE, NW. */
export function boxFromCorners(a: LonLat, b: LonLat): LonLat[] {
  const [w, e] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
  const [s, n] = a[1] < b[1] ? [a[1], b[1]] : [b[1], a[1]];
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ];
}

export function bboxOf(points: LonLat[]): BBox {
  const b = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const [lon, lat] of points) {
    b.minLon = Math.min(b.minLon, lon);
    b.maxLon = Math.max(b.maxLon, lon);
    b.minLat = Math.min(b.minLat, lat);
    b.maxLat = Math.max(b.maxLat, lat);
  }
  return b;
}

export function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

/** Signed area (positive when counter-clockwise in x/y; works the same for any 2D pair). */
export function signedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

export function ringArea(ring: [number, number][]): number {
  return Math.abs(signedArea(ring));
}

/** Area of a lon/lat polygon in square metres. */
export function areaM2(polygon: LonLat[]): number {
  if (polygon.length < 3) return 0;
  const p = new LocalProjection(polygon[0][0], polygon[0][1]);
  return ringArea(polygon.map((q) => p.toXZ(q)));
}

export function centroid(ring: [number, number][]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate (a line or a point): fall back to the vertex average.
    const n = ring.length || 1;
    return [ring.reduce((s, q) => s + q[0], 0) / n, ring.reduce((s, q) => s + q[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Even-odd point in polygon; the ring may or may not repeat its first point. */
export function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point inside an outer ring and outside all of its holes. */
export function pointInPolygon(x: number, y: number, outer: [number, number][], holes: [number, number][][] = []): boolean {
  return pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h));
}

/** Squared distance from a point to a segment. */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

function segmentsCross(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  const o = (p: XZ, q: XZ, r: XZ) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Whether a polyline has a point inside the ring or crosses its edge anywhere. */
export function polylineTouchesRing(pts: XZ[], ring: Ring): boolean {
  if (pts.some(([x, z]) => pointInRing(x, z, ring))) return true;
  for (let i = 1; i < pts.length; i++) {
    for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
      if (segmentsCross(pts[i - 1], pts[i], ring[k], ring[j])) return true;
    }
  }
  return false;
}

/**
 * The parts of a polyline inside a ring (any shape): each segment is split where it crosses the ring's edges and
 * the pieces whose middle is inside are kept, joined into runs.
 */
export function clipPolyline(pts: XZ[], ring: Ring): XZ[][] {
  const runs: XZ[][] = [];
  let run: XZ[] | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const ts = [0, 1];
    for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
      const [cx, cz] = ring[k];
      const [dx, dz] = ring[j];
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      if (Math.abs(den) < 1e-12) continue;
      const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
      const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let n = 1; n < ts.length; n++) {
      const t0 = ts[n - 1];
      const t1 = ts[n];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      const p0: XZ = [ax + (bx - ax) * t0, az + (bz - az) * t0];
      const p1: XZ = [ax + (bx - ax) * t1, az + (bz - az) * t1];
      if (pointInRing(ax + (bx - ax) * tm, az + (bz - az) * tm, ring)) {
        if (!run) {
          run = [p0];
          runs.push(run);
        }
        run.push(p1);
      } else {
        run = null;
      }
    }
  }
  return runs;
}

/** Drops a repeated closing point so rings are stored open. */
export function openRing<T extends [number, number]>(ring: T[]): T[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

/**
 * Sample points spread over a polygon: its centroid (when inside) plus a grid over its bounding box clipped to the
 * polygon. Used to estimate what fraction of a footprint lies over something else.
 */
export function samplePoints(ring: XZ[], grid = 5): XZ[] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const out: XZ[] = [];
  const c = centroid(ring);
  if (pointInRing(c[0], c[1], ring)) out.push(c);
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = minX + ((i + 0.5) / grid) * (maxX - minX);
      const z = minZ + ((j + 0.5) / grid) * (maxZ - minZ);
      if (pointInRing(x, z, ring)) out.push([x, z]);
    }
  }
  return out.length ? out : [c];
}

/** Uniform grid over the ground plane for quick "what is near here" lookups. */
export class GridIndex<T> {
  private readonly cells = new Map<string, T[]>();
  constructor(private readonly size = 25) {}

  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    for (let i = Math.floor(minX / this.size); i <= Math.floor(maxX / this.size); i++) {
      for (let j = Math.floor(minZ / this.size); j <= Math.floor(maxZ / this.size); j++) {
        const k = `${i},${j}`;
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }

  /** Items whose boxes touch the cell of (x, z); may contain duplicates across calls but not within one. */
  at(x: number, z: number): T[] {
    return this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`) ?? [];
  }
}

export function ringBounds(ring: XZ[]): [number, number, number, number] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return [minX, minZ, maxX, maxZ];
}
