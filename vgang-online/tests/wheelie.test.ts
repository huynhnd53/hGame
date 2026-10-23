import { describe, expect, it } from 'vitest';
import { balanceAngle, newWheelie, stepWheelie, type WheelieInput, type WheelieProfile } from '../src/sim/wheelie';

const SCOOTER: WheelieProfile = { balanceDeg: 46, pop: 18 };
const NAKED: WheelieProfile = { balanceDeg: 52, pop: 36 };
const DT = 1 / 60;

function ride(p: WheelieProfile, seconds: number, input: (t: number, pitch: number) => Partial<WheelieInput>) {
  const s = newWheelie();
  let speed = 0;
  let maxPitch = 0;
  let crashed = false;
  let landed: number | null = null;
  // The rider reacts to what they saw a moment ago.
  const seen: number[] = [];
  for (let t = 0; t < seconds && !crashed; t += DT) {
    seen.push(s.pitch);
    const delayed = seen[Math.max(0, seen.length - 1 - Math.round(0.15 / DT))];
    const i = { throttle: 0, brake: 0, lift: false, speed, ...input(t, delayed) };
    speed += i.throttle * 3.4 * DT / (1 + speed / 30);
    const e = stepWheelie(s, { ...i, speed }, p, DT);
    maxPitch = Math.max(maxPitch, s.pitch);
    if (e.crashed) crashed = true;
    if (e.landed) landed = e.landed.distance;
  }
  return { s, speed, maxPitch, crashed, landed };
}

describe('wheelies', () => {
  it('keeps the front down on plain throttle', () => {
    expect(ride(NAKED, 3, () => ({ throttle: 1 })).maxPitch).toBe(0);
  });

  it('pops the front up when the rider leans back and snaps the throttle', () => {
    for (const p of [SCOOTER, NAKED]) expect(ride(p, 1, () => ({ throttle: 1, lift: true })).maxPitch).toBeGreaterThan(0.2);
  });

  it('only lifts from walking pace on a scooter, but a naked bike still pops at over 20 km/h', () => {
    const at = (p: WheelieProfile, v: number) => {
      const s = newWheelie();
      let max = 0;
      for (let t = 0; t < 1; t += DT) {
        stepWheelie(s, { throttle: 1, brake: 0, lift: true, speed: v }, p, DT);
        max = Math.max(max, s.pitch);
      }
      return max;
    };
    expect(at(SCOOTER, 6.5)).toBe(0);
    expect(at(NAKED, 6)).toBeGreaterThan(0.1);
  });

  it('loops out when the throttle stays pinned', () => {
    expect(ride(NAKED, 5, () => ({ throttle: 1, lift: true })).crashed).toBe(true);
  });

  it('can be held for a long time by a rider who balances with throttle and rear brake', () => {
    for (const p of [SCOOTER, NAKED]) {
      const bal = balanceAngle(p);
      let last = 0;
      const r = ride(p, 10, (_t, pitch) => {
        // Watches the angle and how fast it is changing, like a rider feeling the bike.
        const rate = (pitch - last) / DT;
        last = pitch;
        if (pitch < bal - 0.3) return { throttle: 1, lift: true };
        if (pitch > bal + 0.05 && rate > -0.3) return { brake: 1 };
        return { throttle: pitch < bal - 0.05 && rate < 0.4 ? 1 : 0 };
      });
      expect(r.crashed).toBe(false);
      expect(r.landed).toBeNull();
      expect(r.s.pitch).toBeGreaterThan(0.3);
    }
  });

  it('brings the front down and reports the distance when the throttle is closed', () => {
    const r = ride(NAKED, 4, (t) => (t < 0.6 ? { throttle: 1, lift: true } : {}));
    expect(r.crashed).toBe(false);
    expect(r.s.pitch).toBe(0);
    expect(r.landed).toBeGreaterThan(0);
  });
});
