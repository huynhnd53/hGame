import { describe, expect, it } from 'vitest';
import { BIKES, bikeDef, DEFAULT_BIKE } from '../src/cockpit/bikes';

const inside = (r: { x: number; y: number; w: number; h: number }, w: number, h: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

describe('bikes', () => {
  it('have unique ids, the original red scooter first', () => {
    expect(new Set(BIKES.map((b) => b.id)).size).toBe(BIKES.length);
    expect(BIKES[0].id).toBe(DEFAULT_BIKE);
    expect(BIKES.length).toBe(6);
  });

  it('give polygon gauge outlines in 0..1 instrument coordinates', () => {
    for (const b of BIKES) {
      if (!Array.isArray(b.gaugeClip)) continue;
      for (const [x, y] of b.gaugeClip) expect(Math.min(x, y) >= 0 && Math.max(x, y) <= 1).toBe(true);
    }
  });

  it('keep the gauge and every switch hotspot inside the photo', () => {
    for (const b of BIKES) {
      expect(inside(b.gauge, b.width, b.height)).toBe(true);
      for (const h of b.hotspots) expect(inside(h, b.width, b.height)).toBe(true);
      expect(b.barTop).toBeLessThan(b.visibleBottom[0]);
      expect(b.visibleBottom[0]).toBeLessThanOrEqual(b.visibleBottom[1]);
    }
  });

  it('give every bike an engine switch so the ride can start by tapping the bars', () => {
    for (const b of BIKES) expect(b.hotspots.some((h) => h.down === 'engine')).toBe(true);
  });

  it('fall back to the default bike for unknown saved ids', () => {
    expect(bikeDef('gone').id).toBe(DEFAULT_BIKE);
    expect(bikeDef(null).id).toBe(DEFAULT_BIKE);
  });
});
