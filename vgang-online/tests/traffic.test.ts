import { describe, expect, it } from 'vitest';
import { generateCity, ROAD, SIDEWALK } from '../src/sim/city';
import { Traffic } from '../src/sim/traffic';

const city = generateCity();
const onRoad = (x: number, z: number) => city.roads.some((r) => Math.abs(x - r) <= ROAD / 2) || city.roads.some((r) => Math.abs(z - r) <= ROAD / 2);
const insideBlock = (x: number, z: number, inset = 0) =>
  city.blocks.some((b) => Math.abs(x - b.rect.x) < b.rect.w / 2 - inset && Math.abs(z - b.rect.z) < b.rect.d / 2 - inset);

describe('traffic', () => {
  it('keeps vehicles on the roads and walkers on the sidewalks', () => {
    const t = new Traffic(city, 60, 60);
    const far = { x: 1e4, z: 1e4 };
    for (let k = 0; k < 60 * 60; k++) {
      t.update(1 / 60, far);
      if (k % 30) continue;
      for (const v of t.vehicles) {
        expect(onRoad(v.x, v.z)).toBe(true);
        expect(insideBlock(v.x, v.z)).toBe(false);
      }
      for (const p of t.pedestrians) {
        expect(insideBlock(p.x, p.z)).toBe(true);
        // Outside the houses, which start one sidewalk width in from the curb.
        expect(insideBlock(p.x, p.z, SIDEWALK)).toBe(false);
      }
    }
  });

  it('keeps traffic flowing without gridlock', () => {
    const t = new Traffic(city, 80, 0);
    const start = t.vehicles.map((v) => [v.x, v.z]);
    for (let k = 0; k < 60 * 90; k++) t.update(1 / 60, { x: 1e4, z: 1e4 });
    const moved = t.vehicles.filter((v, i) => Math.hypot(v.x - start[i][0], v.z - start[i][1]) > 30).length;
    expect(moved).toBeGreaterThan(t.vehicles.length * 0.9);
  });

  it('stops for the player standing in its lane', () => {
    const t = new Traffic(city, 1, 0, 3);
    const v = t.vehicles[0];
    const fx = -Math.sin(v.heading);
    const fz = -Math.cos(v.heading);
    const player = { x: v.x + fx * 10, z: v.z + fz * 10 };
    for (let k = 0; k < 60 * 5; k++) {
      t.update(1 / 60, player);
      expect(Math.hypot(v.x - player.x, v.z - player.z)).toBeGreaterThan(v.length / 2 + 0.5);
    }
    expect(v.speed).toBeLessThan(0.5);
  });
});
