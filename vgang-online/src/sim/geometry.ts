/** Axis-aligned rectangle on the ground plane, centred at (x, z). */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export function circleHitsRect(x: number, z: number, r: number, rect: Rect): boolean {
  const cx = Math.max(rect.x - rect.w / 2, Math.min(x, rect.x + rect.w / 2));
  const cz = Math.max(rect.z - rect.d / 2, Math.min(z, rect.z + rect.d / 2));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function pointInRect(x: number, z: number, rect: Rect): boolean {
  return Math.abs(x - rect.x) <= rect.w / 2 && Math.abs(z - rect.z) <= rect.d / 2;
}

/** Small deterministic PRNG so the city is the same on every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where a segment from (px, pz) along (ex, ez) first enters a rectangle grown by `pad`, as a fraction of its
 * length, or null if it misses (or starts inside).
 */
export function segmentEntersRect(px: number, pz: number, ex: number, ez: number, r: Rect, pad: number): number | null {
  let t0 = 0;
  let t1 = 1;
  for (const [p, e, c, half] of [
    [px, ex, r.x, r.w / 2 + pad],
    [pz, ez, r.z, r.d / 2 + pad],
  ]) {
    if (Math.abs(e) < 1e-9) {
      if (Math.abs(p - c) > half) return null;
      continue;
    }
    let a = (c - half - p) / e;
    let b = (c + half - p) / e;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0 > 0 ? t0 : null;
}
