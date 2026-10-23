import { describe, expect, it } from 'vitest';
import { EngineModel, EXHAUST, exhaustFor } from '../src/audio/exhaust';
import { BIKES } from '../src/cockpit/bikes';

const run = (e: EngineModel, seconds: number, speed: (t: number) => number, throttle: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) e.step(1 / 60, speed(t), throttle);
};

describe('exhaust', () => {
  it('gives every bike its own exhaust note', () => {
    for (const b of BIKES) expect(EXHAUST[b.id]).toBeDefined();
    expect(new Set(BIKES.map((b) => EXHAUST[b.id])).size).toBe(BIKES.length);
    expect(exhaustFor('unknown')).toBe(EXHAUST['scooter-red']);
  });

  it('cranks on the starter, then settles to idle, and winds down when switched off', () => {
    const p = EXHAUST['scooter-red'];
    const e = new EngineModel(p);
    e.setRunning(true);
    expect(e.cranking).toBe(true);
    run(e, 0.3, () => 0, 0);
    expect(e.rpm).toBeLessThan(500);
    run(e, 3, () => 0, 0);
    expect(e.cranking).toBe(false);
    expect(Math.abs(e.rpm - p.idleRpm)).toBeLessThan(p.idleRpm * 0.08);
    e.setRunning(false);
    run(e, 3, () => 0, 0);
    expect(e.rpm).toBe(0);
  });

  it('holds a scooter near the top of its rev range while speed builds', () => {
    const p = EXHAUST['scooter-white-lcd'];
    const e = new EngineModel(p);
    e.setRunning(true);
    run(e, 2, () => 0, 0);
    run(e, 3, (t) => t * 3, 1);
    expect(e.rpm).toBeGreaterThan(p.maxRpm * 0.75);
    expect(e.rpm).toBeLessThanOrEqual(p.maxRpm);
    expect(e.gear).toBe(0);
  });

  it('changes up through the gears on a geared bike and back down when slowing', () => {
    const p = EXHAUST['naked-black'];
    const e = new EngineModel(p);
    e.setRunning(true);
    run(e, 2, () => 0, 0);
    let rpmDrops = 0;
    let last = e.rpm;
    for (let t = 0; t < 6; t += 1 / 60) {
      e.step(1 / 60, t * 5, 1);
      if (e.rpm < last - 300) rpmDrops++;
      last = e.rpm;
      expect(e.rpm).toBeLessThanOrEqual(p.maxRpm + 1);
    }
    expect(e.gear).toBeGreaterThanOrEqual(2);
    expect(rpmDrops).toBeGreaterThan(0);
    const top = e.gear;
    run(e, 4, () => 4, 0);
    expect(e.gear).toBeLessThan(top);
  });
});
