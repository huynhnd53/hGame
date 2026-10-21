/**
 * Just enough of the S2 cell system to tell which Open Buildings tile file covers a point: the files of a country
 * are named after S2 cells (as signed 64-bit integers), and a cell contains a point when the point's leaf cell id
 * falls in the cell's id range.
 */

const MAX_LEVEL = 30;
const MAX_SIZE = 1 << MAX_LEVEL;
const SWAP = 1;
const INVERT = 2;
/** Hilbert curve position of each (i, j) child quadrant, per orientation; index is (iBit << 1) | jBit. */
const IJ_TO_POS = [
  [0, 1, 3, 2],
  [0, 3, 1, 2],
  [2, 3, 1, 0],
  [2, 1, 3, 0],
];
const POS_TO_ORIENTATION = [SWAP, 0, 0, INVERT | SWAP];

function faceUV(x: number, y: number, z: number): [number, number, number] {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face = ax > ay ? (ax > az ? 0 : 2) : ay > az ? 1 : 2;
  if ([x, y, z][face] < 0) face += 3;
  switch (face) {
    case 0:
      return [0, y / x, z / x];
    case 1:
      return [1, -x / y, z / y];
    case 2:
      return [2, -x / z, -y / z];
    case 3:
      return [3, z / x, y / x];
    case 4:
      return [4, z / y, -x / y];
    default:
      return [5, -y / z, -x / z];
  }
}

/** The quadratic projection S2 uses to even out cell sizes. */
const uvToST = (u: number) => (u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u));
const stToIJ = (s: number) => Math.max(0, Math.min(MAX_SIZE - 1, Math.floor(MAX_SIZE * s)));

/** Leaf (level 30) cell id of a point, as an unsigned 64-bit value. */
export function leafCellId(lon: number, lat: number): bigint {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  const c = Math.cos(phi);
  const [face, u, v] = faceUV(c * Math.cos(theta), c * Math.sin(theta), Math.sin(phi));
  const i = stToIJ(uvToST(u));
  const j = stToIJ(uvToST(v));
  let orientation = face & SWAP;
  let pos = 0n;
  for (let k = MAX_LEVEL - 1; k >= 0; k--) {
    const ij = (((i >> k) & 1) << 1) | ((j >> k) & 1);
    const p = IJ_TO_POS[orientation][ij];
    pos = (pos << 2n) | BigInt(p);
    orientation ^= POS_TO_ORIENTATION[p];
  }
  return (BigInt(face) << 61n) | (pos << 1n) | 1n;
}

/** Parses a cell id written as a signed or unsigned 64-bit decimal (as in the file names) into unsigned form. */
export function parseCellId(text: string): bigint {
  return BigInt.asUintN(64, BigInt(text));
}

export function cellLevel(id: bigint): number {
  let lsb = id & -id;
  let level = MAX_LEVEL;
  while (lsb > 1n) {
    lsb >>= 2n;
    level--;
  }
  return level;
}

/** Whether `cell` contains the leaf cell `leaf`. */
export function cellContains(cell: bigint, leaf: bigint): boolean {
  const lsb = cell & -cell;
  return leaf >= cell - (lsb - 1n) && leaf <= cell + (lsb - 1n);
}
