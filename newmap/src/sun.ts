/**
 * Where the sun is in the sky, from the usual low-precision astronomical formulas (good to a fraction of a degree,
 * plenty for shadows).
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = 23.4397 * RAD;

export interface SunPosition {
  /** Height above the horizon, degrees (negative at night). */
  altitude: number;
  /** Compass direction, degrees clockwise from north. */
  azimuth: number;
}

export function sunPosition(utcMs: number, lat: number, lon: number): SunPosition {
  const d = utcMs / DAY_MS - 0.5 + J1970 - J2000;
  const m = RAD * (357.5291 + 0.98560028 * d);
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const l = m + c + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(l) * Math.sin(OBLIQUITY));
  const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
  const hourAngle = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
  const phi = RAD * lat;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle));
  // Measured from south towards west, then turned to a compass bearing.
  const fromSouth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const azimuth = (fromSouth / RAD + 180 + 360) % 360;
  return { altitude: altitude / RAD, azimuth };
}

/** Whole-hour offset of local solar time from UTC, from the longitude (UTC+7 for Vietnam). */
export function zoneOffsetHours(lon: number): number {
  return Math.round(lon / 15) || 0;
}

/** UTC time of a local date ("2026-10-21") and minutes after local midnight. */
export function localToUtc(date: string, minutes: number, offsetHours: number): number {
  const [y, mo, d] = date.split('-').map(Number);
  return Date.UTC(y, mo - 1, d) + minutes * 60_000 - offsetHours * 3_600_000;
}

const DIRECTIONS = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];

/** "Tây Nam" for a bearing of 225°. */
export function compassName(bearing: number): string {
  return DIRECTIONS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

/** Short form for the compass card: "20° B", "135° ĐN". */
export function compassShort(bearing: number): string {
  const b = Math.round(((bearing % 360) + 360) % 360) % 360;
  const short = compassName(b)
    .split(' ')
    .map((w) => (w === 'Đông' ? 'Đ' : w[0]))
    .join('');
  return `${b}° ${short}`;
}
