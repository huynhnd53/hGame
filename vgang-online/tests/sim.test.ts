import { describe, expect, it } from 'vitest';
import { CURB_H, generateCity, groundHeight, ROAD } from '../src/sim/city';
import { circleHitsRect, pointInRect, rectsOverlapForTest } from './helpers';
import { segmentEntersRect } from '../src/sim/geometry';
import { CRUISE_SPEED, type ScooterState, SCOOTER_RADIUS, stepScooter } from '../src/sim/scooter';

const city = generateCity();
const open = { x: 0, z: 0, w: 1e4, d: 1e4 };

function run(s: ScooterState, c: { throttle: number; brake: number; steer: number }, seconds: number, colliders = city.colliders, bounds = city.bounds) {
  for (let t = 0; t < seconds; t += 1 / 60) s = stepScooter(s, c, 1 / 60, true, colliders, bounds).state;
  return s;
}

const start = (): ScooterState => ({ x: 0, z: 0, heading: 0, speed: 0, steer: 0 });

describe('scooter', () => {
  it('has no top speed: keeps accelerating while the throttle is held', () => {
    const at10 = run(start(), { throttle: 1, brake: 0, steer: 0 }, 10, [], open);
    const s = run(start(), { throttle: 1, brake: 0, steer: 0 }, 30, [], open);
    expect(at10.speed).toBeGreaterThan(CRUISE_SPEED);
    expect(s.speed).toBeGreaterThan(at10.speed + 5);
    expect(s.z).toBeLessThan(0);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
  });

  it('does not move with the engine off', () => {
    let s = start();
    for (let k = 0; k < 120; k++) s = stepScooter(s, { throttle: 1, brake: 0, steer: 0 }, 1 / 60, false, [], open).state;
    expect(s.speed).toBe(0);
  });

  it('brakes to a stop', () => {
    let s = run(start(), { throttle: 1, brake: 0, steer: 0 }, 8, [], open);
    s = run(s, { throttle: 0, brake: 1, steer: 0 }, 3, [], open);
    expect(s.speed).toBeLessThanOrEqual(0);
    expect(s.speed).toBeGreaterThan(-1.3);
  });

  it('turns right when steering right', () => {
    const s = run(start(), { throttle: 0.6, brake: 0, steer: 1 }, 3, [], open);
    expect(s.heading).toBeLessThan(0);
    expect(s.x).toBeGreaterThan(0);
  });

  it('stops at a wall instead of passing through it', () => {
    const wall = { x: 0, z: -20, w: 40, d: 1 };
    const s = run(start(), { throttle: 1, brake: 0, steer: 0 }, 10, [wall], open);
    expect(s.z).toBeGreaterThan(-20 + 0.5);
    expect(circleHitsRect(s.x, s.z, SCOOTER_RADIUS, wall)).toBe(false);
  });
});

describe('city', () => {
  it('is deterministic', () => {
    expect(generateCity()).toEqual(generateCity());
  });

  it('spawns on a road, clear of every block', () => {
    const { spawn } = city;
    for (const c of city.colliders) expect(circleHitsRect(spawn.x, spawn.z, SCOOTER_RADIUS + 1, c)).toBe(false);
    expect(pointInRect(spawn.x, spawn.z, city.bounds)).toBe(true);
    expect(city.roads.some((r) => Math.abs(spawn.x - r) <= ROAD / 2)).toBe(true);
  });

  it('keeps houses inside their block and apart from each other', () => {
    for (const b of city.blocks) {
      for (const lot of b.lots) {
        expect(Math.abs(lot.rect.x - b.inner.x) + lot.rect.w / 2).toBeLessThanOrEqual(b.inner.w / 2 + 1e-6);
        expect(Math.abs(lot.rect.z - b.inner.z) + lot.rect.d / 2).toBeLessThanOrEqual(b.inner.d / 2 + 1e-6);
      }
      for (let a = 0; a < b.lots.length; a++)
        for (let c = a + 1; c < b.lots.length; c++) expect(rectsOverlapForTest(b.lots[a].rect, b.lots[c].rect)).toBe(false);
    }
  });

  it('lets the scooter ride a full lap of the outer ring road', () => {
    const { roads, bounds } = city;
    const lo = roads[0];
    const hi = roads[roads.length - 1];
    // Drive the four sides of the ring by teleporting between corners along straight roads.
    const corners = [
      [lo, hi],
      [lo, lo],
      [hi, lo],
      [hi, hi],
    ];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k];
      const [bx, bz] = corners[(k + 1) % 4];
      for (let t = 0; t <= 1; t += 0.01) {
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        expect(city.colliders.some((c) => circleHitsRect(x, z, SCOOTER_RADIUS, c))).toBe(false);
        expect(pointInRect(x, z, bounds)).toBe(true);
      }
    }
  });
});

describe('sidewalks', () => {
  it('lets the scooter ride up onto a sidewalk but not into the houses behind it', () => {
    const b = city.blocks.find((k) => k.kind === 'houses')!;
    // Start on the road west of the block, heading east (-π/2) straight at its middle.
    let s: ScooterState = { x: b.rect.x - b.rect.w / 2 - 4, z: b.rect.z, heading: -Math.PI / 2, speed: 0, steer: 0 };
    s = run(s, { throttle: 0.5, brake: 0, steer: 0 }, 6);
    expect(groundHeight(city, s.x, s.z)).toBe(CURB_H);
    expect(s.x).toBeGreaterThan(b.rect.x - b.rect.w / 2);
    expect(s.x).toBeLessThan(b.inner.x - b.inner.w / 2);
  });

  it('reports road height on roads and curb height on sidewalks and outside the ring road', () => {
    const b = city.blocks[0];
    expect(groundHeight(city, city.spawn.x, city.spawn.z)).toBe(0);
    expect(groundHeight(city, b.rect.x - b.rect.w / 2 + 1, b.rect.z)).toBe(CURB_H);
    expect(groundHeight(city, city.bounds.w / 2 - 0.5, 0)).toBe(CURB_H);
  });
});

describe('segmentEntersRect', () => {
  const wall = { x: 10, z: 0, w: 4, d: 4 };
  it('finds where a segment first reaches a (padded) rectangle', () => {
    expect(segmentEntersRect(0, 0, 20, 0, wall, 0)).toBeCloseTo(8 / 20);
    expect(segmentEntersRect(0, 0, 20, 0, wall, 1)).toBeCloseTo(7 / 20);
  });
  it('returns null when the segment misses, stops short, or starts inside', () => {
    expect(segmentEntersRect(0, 5, 20, 0, wall, 0)).toBeNull();
    expect(segmentEntersRect(0, 0, 5, 0, wall, 0)).toBeNull();
    expect(segmentEntersRect(10, 0, 20, 0, wall, 0)).toBeNull();
  });
});
