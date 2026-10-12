import { type City, ROAD } from '../../sim/city';

/** Positions along a road where furniture may go (away from junctions). */
export function alongRoad(city: City, spacing: number, offset: number, margin: number): number[] {
  const out: number[] = [];
  const lo = city.roads[0];
  const hi = city.roads[city.roads.length - 1];
  for (let t = lo + offset; t <= hi; t += spacing) {
    if (city.roads.some((r) => Math.abs(t - r) < ROAD / 2 + margin)) continue;
    out.push(t);
  }
  return out;
}

/** Street lamps every LAMP_SPACING metres along each curb, staggered between the two sides of a road. */
export const LAMP_SPACING = 18;
export const lampSpots = (city: City, side: number) => alongRoad(city, LAMP_SPACING, side < 0 ? 6 : 6 + LAMP_SPACING / 2, 2.5);

/** Utility poles stand mid-block on both sides of a road, well clear of the lamps; wires span the road. */
export const poleSpots = (city: City) => alongRoad(city, 60, 28.5, 2.5);
