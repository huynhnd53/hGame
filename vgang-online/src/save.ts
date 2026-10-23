export interface RideSave {
  odometerKm: number;
  x: number;
  z: number;
  heading: number;
  headlight: boolean;
  muted: boolean;
}

const KEY = 'vgang-online/ride/v1';

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function loadRide(fallback: RideSave): RideSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const d = JSON.parse(raw) as Record<string, unknown>;
    return {
      odometerKm: Math.max(0, num(d.odometerKm, fallback.odometerKm)),
      x: num(d.x, fallback.x),
      z: num(d.z, fallback.z),
      heading: num(d.heading, fallback.heading),
      headlight: d.headlight === true,
      muted: d.muted === true,
    };
  } catch {
    return fallback;
  }
}

export function saveRide(data: RideSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* Storage blocked: the ride simply starts fresh next time. */
  }
}

export function getString(key: string): string | null {
  try {
    return localStorage.getItem(`vgang-online/${key}`);
  } catch {
    return null;
  }
}

export function setString(key: string, value: string): void {
  try {
    localStorage.setItem(`vgang-online/${key}`, value);
  } catch {
    /* ignore */
  }
}

export function getFlag(key: string): boolean {
  try {
    return localStorage.getItem(`vgang-online/${key}`) === '1';
  } catch {
    return false;
  }
}

export function setFlag(key: string): void {
  try {
    localStorage.setItem(`vgang-online/${key}`, '1');
  } catch {
    /* ignore */
  }
}
