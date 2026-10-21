import { centroid, pointInRing, type Ring, ringArea, type XZ } from './geo';
import { pointsAlong, type SceneModel } from './model';

/** Groups in the places list, in display order. */
export const PLACE_GROUPS = [
  'Đình, chùa, nhà thờ',
  'Di tích',
  'Trường học',
  'Bệnh viện',
  'Chợ',
  'Cơ quan, công trình',
  'Công viên',
  'Hồ, sông',
  'Toà nhà',
  'Đường phố',
] as const;

export type PlaceGroup = (typeof PLACE_GROUPS)[number];

/** A named spot in the built area the camera can fly to. */
export interface Place {
  id: string;
  name: string;
  group: PlaceGroup;
  at: XZ;
  /** Rough size in metres, to pick how far away the camera stays. */
  size: number;
  /** Height to hang the label at, metres. */
  top: number;
}

/** Group of a public place by its OSM amenity, tourism or historic value. */
export function groupOf(category: string | null): PlaceGroup {
  if (!category) return 'Toà nhà';
  if (/^(school|university|college|kindergarten)$/.test(category)) return 'Trường học';
  if (/^(hospital|clinic)$/.test(category)) return 'Bệnh viện';
  if (category === 'marketplace') return 'Chợ';
  if (category === 'place_of_worship') return 'Đình, chùa, nhà thờ';
  if (/^(monument|memorial|archaeological_site|ruins|castle|citywalls|heritage|building|temple|tomb|wayside_shrine)$/.test(category)) {
    return 'Di tích';
  }
  return 'Cơ quan, công trình';
}

const sizeOf = (ring: Ring) => Math.sqrt(ringArea(ring));

/** Where to put a place inside an area: its centroid, or (for odd shapes) a vertex average that is inside. */
function middle(ring: Ring): XZ {
  const c = centroid(ring);
  if (pointInRing(c[0], c[1], ring)) return c;
  const n = ring.length;
  const avg: XZ = [ring.reduce((s, q) => s + q[0], 0) / n, ring.reduce((s, q) => s + q[1], 0) / n];
  return pointInRing(avg[0], avg[1], ring) ? avg : ring[0];
}

/**
 * The named places of a built area, grouped and sorted, with no two of the same name close together (a temple
 * mapped as both a building and a yard is listed once).
 */
export function listPlaces(m: SceneModel, max = 300): Place[] {
  // Buildings first, then points, areas and lines: of two twins, the building keeps the label over its roof.
  const all: (Place & { rank: number })[] = [];
  let rank = 0;
  const add = (p: Place) => {
    const name = p.name.trim();
    if (name) all.push({ ...p, name, rank });
  };
  for (const b of m.buildings) {
    if (!b.name) continue;
    const group = b.role === 'worship' ? 'Đình, chùa, nhà thờ' : b.role === 'heritage' ? 'Di tích' : groupOf(b.category);
    add({ id: b.id, name: b.name, group, at: middle(b.outer), size: sizeOf(b.outer), top: b.height + 4 });
  }
  rank = 1;
  for (const p of m.pois) {
    if (!p.name) continue;
    const group = p.kind === 'worship' ? 'Đình, chùa, nhà thờ' : p.kind === 'heritage' ? 'Di tích' : groupOf(p.category);
    add({ id: p.id, name: p.name, group, at: p.at, size: 20, top: 8 });
  }
  rank = 2;
  for (const s of m.yards) {
    if (!s.name) continue;
    const group = s.kind === 'worship' ? 'Đình, chùa, nhà thờ' : s.kind === 'heritage' ? 'Di tích' : groupOf(s.kind);
    add({ id: s.id, name: s.name, group, at: middle(s.outer), size: sizeOf(s.outer), top: 6 });
  }
  for (const s of m.parks) if (s.name) add({ id: s.id, name: s.name, group: 'Công viên', at: middle(s.outer), size: sizeOf(s.outer), top: 6 });
  for (const s of m.water) if (s.name) add({ id: s.id, name: s.name, group: 'Hồ, sông', at: middle(s.outer), size: sizeOf(s.outer), top: 4 });

  // A street or river is listed once, at the middle of its longest stretch inside the area.
  const lines = new Map<string, { id: string; group: PlaceGroup; points: XZ[]; length: number }>();
  for (const [list, group] of [
    [m.roads, 'Đường phố'],
    [m.waterways, 'Hồ, sông'],
  ] as const) {
    for (const r of list) {
      if (!r.name) continue;
      let length = 0;
      for (let i = 1; i < r.points.length; i++) length += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
      const key = `${group}|${r.name}`;
      const best = lines.get(key);
      if (!best || length > best.length) lines.set(key, { id: r.id, group, points: r.points, length });
    }
  }
  rank = 3;
  for (const [key, l] of lines) {
    const at = pointsAlong(l.points, l.length, l.length / 2)[0] ?? l.points[0];
    add({ id: l.id, name: key.split('|')[1], group: l.group, at, size: Math.min(l.length / 2, 150), top: 4 });
  }

  // Keep the first of each name within 150 m, in group order.
  const order = (g: PlaceGroup) => PLACE_GROUPS.indexOf(g);
  all.sort((a, b) => order(a.group) - order(b.group) || a.rank - b.rank || b.size - a.size);
  const kept: Place[] = [];
  for (const { rank: _, ...p } of all) {
    const twin = kept.some((k) => k.name.toLocaleLowerCase('vi') === p.name.toLocaleLowerCase('vi') && Math.hypot(k.at[0] - p.at[0], k.at[1] - p.at[1]) < 150);
    if (!twin) kept.push(p);
  }
  kept.sort((a, b) => order(a.group) - order(b.group) || a.name.localeCompare(b.name, 'vi'));
  return kept.slice(0, max);
}

/** Places whose name contains the text, ignoring case and Vietnamese accents. */
export function filterPlaces(places: Place[], text: string): Place[] {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  const q = fold(text.trim());
  return q ? places.filter((p) => fold(p.name).includes(q)) : places;
}
