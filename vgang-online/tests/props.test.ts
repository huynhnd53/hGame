import { describe, expect, it } from 'vitest';
import { WALKERS } from '../src/world/night/npcs';
import { PROPS } from '../src/world/night/streetLife';

// Vite lists the files at build time, so this works without Node's fs types.
const shipped = new Set(Object.keys(import.meta.glob('../public/assets/props/*.webp')).map((p) => p.split('/').pop()));

describe('street props', () => {
  it('ships an image for every prop, wall piece and person the city uses', () => {
    const names = [...Object.keys(PROPS), ...WALKERS.map((w) => w.name), 'aircon', 'flag', 'round-sign', 'overhead-wires', 'asphalt',
      'awnings', 'facade-gate', 'facade-door', 'facade-window', 'concrete-bench', 'drain-grate', 'utility-boxes', 'fence',
      'seated-man', 'bike-white', 'bike-mint', 'bike-red', 'bike-white-modern', 'bike-dark-blue'];
    for (const n of names) expect(shipped.has(`${n}.webp`), n).toBe(true);
  });

  it('keeps people at believable heights', () => {
    for (const w of WALKERS) expect(w.height).toBeGreaterThan(1);
    for (const w of WALKERS) expect(w.height).toBeLessThan(1.9);
  });
});
