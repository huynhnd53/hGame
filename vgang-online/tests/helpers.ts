import type { Rect } from '../src/sim/geometry';
export { circleHitsRect, pointInRect } from '../src/sim/geometry';

export function rectsOverlapForTest(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-6 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-6;
}
