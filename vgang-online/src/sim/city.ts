import { type Rect, mulberry32 } from './geometry';

/** City grid dimensions in metres. Roads run along x and z between square blocks. */
export const GRID = 10;
export const BLOCK = 46;
export const ROAD = 14;
export const SIDEWALK = 3.5;
export const PITCH = BLOCK + ROAD;
/** Distance from the city centre to the middle of the outermost road. */
export const HALF = (GRID * PITCH) / 2;

export type BlockKind = 'houses' | 'park' | 'lake' | 'plaza';

/** Ground-floor look, indexes row 0 of the facade atlas. */
export const GROUND_KINDS = 8;
/** Upper-floor look, indexes row 1 of the facade atlas. */
export const UPPER_KINDS = 8;
export const GROUND_FLOOR_H = 3.8;
export const UPPER_FLOOR_H = 3.4;

export interface Lot {
  rect: Rect;
  /** Number of storeys including the ground floor. */
  floors: number;
  height: number;
  /** Wall tint (multiplies the facade texture). */
  color: number;
  /** Side of the block the front faces: +x, -x, +z or -z. */
  facing: 'px' | 'nx' | 'pz' | 'nz';
  /** Ground floor variant; see LIT_GROUND for which ones are open shops. */
  ground: number;
  /** One variant per upper floor and bay, row-major from the first floor up. */
  upper: number[];
  bays: number;
  /** Awning variant, or null. */
  awning: number | null;
  /** Shop sign variant, or null. */
  sign: number | null;
}

/** Ground variants that are lit, open shops (they light the sidewalk). */
export const LIT_GROUND = new Set([3, 4, 5, 7]);
/** Ground variant with a warm lamp over a house door. */
export const DOOR_LAMP_GROUND = 6;
/** Upper variants with lit windows. */
export const LIT_UPPER = new Set([3, 5, 6]);
/** Upper variants with a balcony slab and railing. */
export const BALCONY_UPPER = new Set([4, 5]);

export interface Block {
  i: number;
  j: number;
  kind: BlockKind;
  /** Whole block including sidewalk (the curb outline). */
  rect: Rect;
  /** Area inside the sidewalk. */
  inner: Rect;
  lots: Lot[];
}

export interface City {
  blocks: Block[];
  /** Houses lining the outside of the ring road, facing inwards. */
  outerLots: Lot[];
  /** Road centre lines (same values for x and z). */
  roads: number[];
  /** Solid areas the scooter cannot enter: the built-up part of each block, inside its sidewalk. */
  colliders: Rect[];
  /** Ridable extent: the outer ring road plus the sidewalk beyond it. */
  bounds: Rect;
  spawn: { x: number; z: number; heading: number };
}

/** Weathered stucco tints seen on old street houses at night. */
const HOUSE_COLORS = [0xf2e8d5, 0xe9dcc0, 0xdfe3d6, 0xd9d4c8, 0xeadbb8, 0xd6dccf, 0xe6d3c3, 0xcfd6d8, 0xf0e2c6];

/** Special blocks give the city a few landmarks to ride to. */
function kindFor(i: number, j: number): BlockKind {
  if ((i === 2 && j === 2) || (i === 7 && j === 6)) return 'lake';
  if ((i === 6 && j === 1) || (i === 1 && j === 6) || (i === 4 && j === 8) || (i === 8 && j === 3)) return 'park';
  if ((i === 4 && j === 4) || (i === 6 && j === 8)) return 'plaza';
  return 'houses';
}

function lotMaker(rand: () => number) {
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];

  return (rect: Rect, facing: Lot['facing']): Lot => {
    const r = rand();
    const floors = r < 0.15 ? 2 : r < 0.6 ? 3 : r < 0.9 ? 4 : 5;
    const front = facing === 'px' || facing === 'nx' ? rect.d : rect.w;
    const bays = Math.max(1, Math.round(front / 4.2));
    // Most shops are shuttered at night; a few stay open.
    const g = rand();
    const ground = g < 0.42 ? Math.floor(rand() * 2) : g < 0.6 ? 2 : g < 0.78 ? 6 : [3, 4, 5, 7][Math.floor(rand() * 4)];
    const upper: number[] = [];
    for (let f = 1; f < floors; f++) {
      const balconyFloor = rand() < 0.35;
      for (let b = 0; b < bays; b++) {
        const lit = rand() < 0.16;
        if (balconyFloor) upper.push(lit ? 5 : 4);
        else upper.push(lit ? (rand() < 0.7 ? 3 : 6) : pick([0, 1, 2, 2, 7]));
      }
    }
    const shop = LIT_GROUND.has(ground);
    return {
      rect,
      facing,
      floors,
      height: GROUND_FLOOR_H + (floors - 1) * UPPER_FLOOR_H,
      color: pick(HOUSE_COLORS),
      ground,
      upper,
      bays,
      awning: shop || rand() < 0.25 ? Math.floor(rand() * 4) : null,
      sign: shop ? Math.floor(rand() * 8) : null,
    };
  };
}

/** Lays narrow lots side by side from `from` to `to`, each at least 3.5 m wide. */
function row(rand: () => number, from: number, to: number, place: (a: number, b: number) => Lot, out: Lot[]) {
  let a = from;
  while (to - a > 3.5) {
    let w = 4 + rand() * 4;
    if (to - a - w < 3.5) w = to - a;
    out.push(place(a, a + w));
    a += w;
  }
}

function buildHouses(inner: Rect, rand: () => number): Lot[] {
  const lots: Lot[] = [];
  const make = lotMaker(rand);
  const x0 = inner.x - inner.w / 2;
  const x1 = inner.x + inner.w / 2;
  const z0 = inner.z - inner.d / 2;
  const z1 = inner.z + inner.d / 2;

  // Narrow "nhà ống" tube houses along each street front; corners are owned by the x-facing rows.
  const depth = 14;
  row(rand, x0, x1, (a, b) => make({ x: (a + b) / 2, z: z0 + depth / 2, w: b - a, d: depth }, 'nz'), lots);
  row(rand, x0, x1, (a, b) => make({ x: (a + b) / 2, z: z1 - depth / 2, w: b - a, d: depth }, 'pz'), lots);
  row(rand, z0 + depth, z1 - depth, (a, b) => make({ x: x0 + depth / 2, z: (a + b) / 2, w: depth, d: b - a }, 'nx'), lots);
  row(rand, z0 + depth, z1 - depth, (a, b) => make({ x: x1 - depth / 2, z: (a + b) / 2, w: depth, d: b - a }, 'px'), lots);
  return lots;
}

export function generateCity(seed = 20261005): City {
  const rand = mulberry32(seed);
  const roads: number[] = [];
  for (let k = 0; k <= GRID; k++) roads.push(-HALF + k * PITCH);

  const blocks: Block[] = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const cx = roads[i] + PITCH / 2;
      const cz = roads[j] + PITCH / 2;
      const rect: Rect = { x: cx, z: cz, w: BLOCK, d: BLOCK };
      const inner: Rect = { x: cx, z: cz, w: BLOCK - SIDEWALK * 2, d: BLOCK - SIDEWALK * 2 };
      const kind = kindFor(i, j);
      blocks.push({ i, j, kind, rect, inner, lots: kind === 'houses' ? buildHouses(inner, rand) : [] });
    }
  }

  const edge = HALF + ROAD / 2;
  // Outer houses stand behind a sidewalk on the far side of the ring road.
  const outerLots: Lot[] = [];
  const make = lotMaker(rand);
  const d = 14;
  const near = edge + SIDEWALK;
  const span = edge + SIDEWALK + d;
  row(rand, -span, span, (a, b) => make({ x: (a + b) / 2, z: -near - d / 2, w: b - a, d }, 'pz'), outerLots);
  row(rand, -span, span, (a, b) => make({ x: (a + b) / 2, z: near + d / 2, w: b - a, d }, 'nz'), outerLots);
  row(rand, -near, near, (a, b) => make({ x: -near - d / 2, z: (a + b) / 2, w: d, d: b - a }, 'px'), outerLots);
  row(rand, -near, near, (a, b) => make({ x: near + d / 2, z: (a + b) / 2, w: d, d: b - a }, 'nx'), outerLots);
  return {
    blocks,
    outerLots,
    roads,
    // Sidewalks are rideable; walls stop the scooter a little short so the view never ends up inside a shopfront.
    colliders: blocks.map((b) => ({ ...b.inner, w: b.inner.w + WALL_GAP * 2, d: b.inner.d + WALL_GAP * 2 })),
    bounds: { x: 0, z: 0, w: (near - WALL_GAP) * 2, d: (near - WALL_GAP) * 2 },
    // Middle of the road just south of the centre, heading north (-z), in the right-hand lane.
    spawn: { x: roads[GRID / 2] + ROAD / 4, z: roads[GRID / 2] + PITCH / 2, heading: 0 },
  };
}

/** How far short of a house front the scooter's edge stops, in metres. */
const WALL_GAP = 0.8;

/** Height of the sidewalk above the road, in metres. */
export const CURB_H = 0.16;

/** Ground height under a point: raised on sidewalks (inside a block's curb or beyond the outer ring road). */
export function groundHeight(city: City, x: number, z: number): number {
  const edge = HALF + ROAD / 2;
  if (Math.abs(x) > edge || Math.abs(z) > edge) return CURB_H;
  // Blocks sit on a regular grid, so the block under a point is found directly.
  const i = Math.floor((x + HALF) / PITCH);
  const j = Math.floor((z + HALF) / PITCH);
  const b = city.blocks[i * GRID + j];
  if (!b) return 0;
  return Math.abs(x - b.rect.x) <= b.rect.w / 2 && Math.abs(z - b.rect.z) <= b.rect.d / 2 ? CURB_H : 0;
}
