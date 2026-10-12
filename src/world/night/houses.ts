import * as THREE from 'three';
import {
  BALCONY_UPPER,
  DOOR_LAMP_GROUND,
  GROUND_FLOOR_H,
  LIT_GROUND,
  LIT_UPPER,
  type Lot,
  UPPER_FLOOR_H,
} from '../../sim/city';
import { type FacadeAtlas, PLAIN_PARAPET, PLAIN_ROOF, ROW_GROUND, ROW_PLAIN, ROW_UPPER } from './facade';

/** A light source used when baking light into vertex colours. */
export interface StreetLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  /** Brightness at the light's foot. */
  strength: number;
  /** Falloff radius in metres. */
  radius: number;
}

const CURB_H = 0.16;
const PARAPET_H = 0.9;
/**
 * props/awnings.webp: one 128 px row per awning style (blue-white, green tin, red-white, plain), each with the
 * sloping cover in its top 84 px and the hanging lip in px 88–128. A row repeats every AWNING_ROW_M metres.
 */
const AWNING_ROW_M = 3.2;
const awningV = (y: number) => 1 - y / 512;
const UP = new THREE.Vector3(0, 1, 0);

/** Accumulates quads into flat arrays for one merged BufferGeometry. */
export class QuadBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  /** Quad from bottom-left `o`, along `right` (width) and `up` (height). */
  quad(o: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, normal: THREE.Vector3, uv: number[], color: THREE.Color) {
    const p = [
      o,
      o.clone().add(right),
      o.clone().add(right).add(up),
      o.clone().add(up),
    ];
    const uvs = [
      [uv[0], uv[1]],
      [uv[2], uv[1]],
      [uv[2], uv[3]],
      [uv[0], uv[3]],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(p[k].x, p[k].y, p[k].z);
      this.nor.push(normal.x, normal.y, normal.z);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Axis-aligned box as six quads (used for ledges and slabs). */
function boxQuads(b: QuadBuilder, min: THREE.Vector3, max: THREE.Vector3, color: THREE.Color, uv: number[]) {
  const s = max.clone().sub(min);
  const X = new THREE.Vector3(s.x, 0, 0);
  const Y = new THREE.Vector3(0, s.y, 0);
  const Z = new THREE.Vector3(0, 0, s.z);
  b.quad(new THREE.Vector3(min.x, min.y, max.z), X, Y, new THREE.Vector3(0, 0, 1), uv, color);
  b.quad(new THREE.Vector3(max.x, min.y, min.z), X.clone().negate(), Y, new THREE.Vector3(0, 0, -1), uv, color);
  b.quad(new THREE.Vector3(max.x, min.y, max.z), Z.clone().negate(), Y, new THREE.Vector3(1, 0, 0), uv, color);
  b.quad(new THREE.Vector3(min.x, min.y, min.z), Z, Y, new THREE.Vector3(-1, 0, 0), uv, color);
  b.quad(new THREE.Vector3(min.x, max.y, max.z), X, Z.clone().negate(), new THREE.Vector3(0, 1, 0), uv, color);
  b.quad(new THREE.Vector3(min.x, min.y, min.z), X, Z, new THREE.Vector3(0, -1, 0), uv, color);
}

const NORMALS: Record<Lot['facing'], THREE.Vector3> = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
};

export interface HouseMeshes {
  facades: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  railings: THREE.BufferGeometry;
  awnings: THREE.BufferGeometry;
  signs: THREE.BufferGeometry;
  /** Lit windows and shop interiors, drawn additively just in front of the facade. */
  glowPanels: THREE.BufferGeometry;
  lights: StreetLight[];
  glows: { pos: THREE.Vector3; color: THREE.Color }[];
  pots: THREE.Vector3[];
}

export function buildHouses(lots: Lot[], atlas: FacadeAtlas, signCount: number, seed = 7): HouseMeshes {
  const facades = new QuadBuilder();
  const trim = new QuadBuilder();
  const railings = new QuadBuilder();
  const awnings = new QuadBuilder();
  const signs = new QuadBuilder();
  const glowPanels = new QuadBuilder();
  const panel = (o: THREE.Vector3, r: THREE.Vector3, u: THREE.Vector3, normal: THREE.Vector3, uv: number[]) =>
    glowPanels.quad(o.clone().addScaledVector(normal, 0.02), r, u, normal, uv, white);
  const lights: StreetLight[] = [];
  const glows: { pos: THREE.Vector3; color: THREE.Color }[] = [];
  const pots: THREE.Vector3[] = [];
  const white = new THREE.Color(1, 1, 1);
  const trimUv = atlas.uv(0, ROW_PLAIN);
  const shopCool = new THREE.Color(0.75, 0.88, 1.0);
  const shopWarm = new THREE.Color(1.0, 0.78, 0.5);
  const lampWarm = new THREE.Color(1.0, 0.62, 0.32);
  let hash = seed;
  const rnd = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };

  // A side wall is exposed when the space just beyond it is not another house.
  const exposed = (p: THREE.Vector3) =>
    !lots.some((o) => Math.abs(p.x - o.rect.x) < o.rect.w / 2 - 0.01 && Math.abs(p.z - o.rect.z) < o.rect.d / 2 - 0.01);
  const UPPER_PLAIN = [0, 1, 2, 2, 7];

  for (const lot of lots) {
    const n = NORMALS[lot.facing];
    const right = new THREE.Vector3().crossVectors(UP, n);
    const sideways = lot.facing === 'px' || lot.facing === 'nx';
    const fw = sideways ? lot.rect.d : lot.rect.w;
    const depth = sideways ? lot.rect.w : lot.rect.d;
    const center = new THREE.Vector3(lot.rect.x, 0, lot.rect.z);
    const frontCenter = center.clone().addScaledVector(n, depth / 2);
    const frontLeft = frontCenter.clone().addScaledVector(right, -fw / 2);
    const tint = new THREE.Color(lot.color);
    const top = CURB_H + lot.height;
    const bw = fw / lot.bays;
    const R = (len: number) => right.clone().multiplyScalar(len);
    const Uv = (len: number) => new THREE.Vector3(0, len, 0);

    // Front facade, bay by bay and floor by floor.
    for (let f = 0; f < lot.floors; f++) {
      const y0 = CURB_H + (f === 0 ? 0 : GROUND_FLOOR_H + (f - 1) * UPPER_FLOOR_H);
      const h = f === 0 ? GROUND_FLOOR_H : UPPER_FLOOR_H;
      for (let b = 0; b < lot.bays; b++) {
        const o = frontLeft.clone().addScaledVector(right, b * bw).setY(y0);
        const uv =
          f === 0 ? atlas.uv(lot.ground, ROW_GROUND) : atlas.uv(lot.upper[(f - 1) * lot.bays + b], ROW_UPPER);
        facades.quad(o, R(bw), Uv(h), n, uv, tint);
        const kind = f === 0 ? lot.ground : lot.upper[(f - 1) * lot.bays + b];
        const lit = f === 0 ? LIT_GROUND.has(kind) || kind === DOOR_LAMP_GROUND : LIT_UPPER.has(kind);
        if (lit) panel(o, R(bw), Uv(h), n, uv);
      }
    }
    for (let b = 0; b < lot.bays; b++) {
      const o = frontLeft.clone().addScaledVector(right, b * bw).setY(top);
      facades.quad(o, R(bw), Uv(PARAPET_H), n, atlas.uv(PLAIN_PARAPET, ROW_PLAIN), tint);
    }

    // Sides, back and roof with plain stucco.
    const plain = atlas.uv(Math.floor(rnd() * 4), ROW_PLAIN);
    const backLeft = frontLeft.clone().addScaledVector(n, -depth);
    const full = top + PARAPET_H;
    const dirIn = n.clone().negate();
    // Side walls: plain party walls, or a full facade where the side faces a street (corner houses).
    const sideWall = (o: THREE.Vector3, along: THREE.Vector3, normal: THREE.Vector3) => {
      const mid = o.clone().addScaledVector(along, depth / 2).addScaledVector(normal, 0.6);
      if (!exposed(mid)) {
        facades.quad(o, along.clone().multiplyScalar(depth), Uv(full), normal, plain, tint);
        return;
      }
      const bays = Math.max(1, Math.round(depth / 4.2));
      const w = depth / bays;
      for (let f = 0; f < lot.floors; f++) {
        const y0 = CURB_H + (f === 0 ? 0 : GROUND_FLOOR_H + (f - 1) * UPPER_FLOOR_H);
        const h = f === 0 ? GROUND_FLOOR_H : UPPER_FLOOR_H;
        for (let b = 0; b < bays; b++) {
          const cell = f === 0 ? atlas.uv(Math.floor(rnd() * 3), ROW_GROUND) : atlas.uv(UPPER_PLAIN[Math.floor(rnd() * 5)], ROW_UPPER);
          const lit = f > 0 && rnd() < 0.12;
          const corner = o.clone().addScaledVector(along, b * w).setY(y0);
          const span = along.clone().multiplyScalar(w);
          facades.quad(corner, span, Uv(h), normal, lit ? atlas.uv(3, ROW_UPPER) : cell, tint);
          if (lit) panel(corner, span, Uv(h), normal, atlas.uv(3, ROW_UPPER));
        }
      }
      facades.quad(o.clone().setY(top), along.clone().multiplyScalar(depth), Uv(PARAPET_H), normal, atlas.uv(PLAIN_PARAPET, ROW_PLAIN), tint);
    };
    // Left side (faces −right) runs back to front; right side (faces +right) runs front to back.
    sideWall(backLeft.clone(), n.clone(), right.clone().negate());
    sideWall(frontLeft.clone().addScaledVector(right, fw), dirIn.clone(), right.clone());
    facades.quad(backLeft.clone().addScaledVector(right, fw), R(-fw), Uv(full), dirIn, plain, tint);
    facades.quad(
      frontLeft.clone().setY(top),
      R(fw),
      dirIn.clone().multiplyScalar(depth),
      UP,
      atlas.uv(PLAIN_ROOF, ROW_PLAIN),
      white,
    );
    // right × back points up for every facing (right = up × n, back = −n), so the roof faces the sky.

    // Ledges at each floor line and a coping on the parapet.
    const ledgeColor = tint.clone().multiplyScalar(0.92);
    const ledge = (y: number, out: number, h: number) => {
      const a = frontLeft.clone().addScaledVector(n, -0.05).setY(y);
      const bpt = frontLeft.clone().addScaledVector(right, fw).addScaledVector(n, out).setY(y + h);
      boxQuads(trim, a.clone().min(bpt), a.clone().max(bpt), ledgeColor, trimUv);
    };
    for (let f = 1; f < lot.floors; f++) ledge(CURB_H + GROUND_FLOOR_H + (f - 1) * UPPER_FLOOR_H - 0.08, 0.22, 0.16);
    ledge(top + PARAPET_H - 0.02, 0.12, 0.12);

    // Balconies.
    for (let f = 1; f < lot.floors; f++) {
      const cells = lot.upper.slice((f - 1) * lot.bays, f * lot.bays);
      if (!cells.some((c) => BALCONY_UPPER.has(c))) continue;
      const y = CURB_H + GROUND_FLOOR_H + (f - 1) * UPPER_FLOOR_H;
      const out = 0.95;
      const a = frontLeft.clone().addScaledVector(right, 0.1).setY(y - 0.14);
      const bpt = frontLeft.clone().addScaledVector(right, fw - 0.1).addScaledVector(n, out).setY(y + 0.02);
      boxQuads(trim, a.clone().min(bpt), a.clone().max(bpt), ledgeColor, trimUv);
      const edge = frontLeft.clone().addScaledVector(right, 0.1).addScaledVector(n, out).setY(y + 0.02);
      const railH = 1.0;
      const len = fw - 0.2;
      railings.quad(edge, R(len), Uv(railH), n, [0, 0, len / 1.2, 1], white);
      railings.quad(edge.clone().addScaledVector(n, -out), n.clone().multiplyScalar(out), Uv(railH), right.clone().negate(), [0, 0, out / 1.2, 1], white);
      railings.quad(edge.clone().addScaledVector(right, len), n.clone().multiplyScalar(-out), Uv(railH), right, [0, 0, out / 1.2, 1], white);
    }

    // Awning over the ground floor.
    if (lot.awning !== null) {
      const row = lot.awning * 128;
      const yTop = CURB_H + GROUND_FLOOR_H - 0.15;
      const out = 1.35;
      const drop = 0.5;
      const start = frontLeft.clone().addScaledVector(right, 0.2).setY(yTop);
      const along = R(fw - 0.4);
      const slope = n.clone().multiplyScalar(out).setY(-drop);
      // Built right-to-left so the winding faces up; the stripes run down the slope.
      const slopeNormal = new THREE.Vector3().crossVectors(along.clone().negate(), slope).normalize();
      const rep = (fw - 0.4) / AWNING_ROW_M;
      awnings.quad(start.clone().add(along), along.clone().negate(), slope, slopeNormal, [0, awningV(row + 2), rep, awningV(row + 82)], white);
      const lip = start.clone().add(slope);
      const lipH = 0.32;
      awnings.quad(lip.clone().setY(lip.y - lipH), along, Uv(lipH), n, [0, awningV(row + 126), rep, awningV(row + 89)], white);
    }

    // Lit shop sign above the opening.
    if (lot.sign !== null) {
      const sw = Math.min(fw - 0.4, 6);
      const o = frontCenter.clone().addScaledVector(right, -sw / 2).addScaledVector(n, 0.1).setY(CURB_H + GROUND_FLOOR_H + 0.05);
      const v0 = 1 - (lot.sign + 1) / signCount;
      const v1 = 1 - lot.sign / signCount;
      signs.quad(o, R(sw), Uv(0.75), n, [0, v0, 1, v1], white);
    }

    // Light spilling out of open shops and door lamps.
    if (LIT_GROUND.has(lot.ground)) {
      const cafe = lot.ground === 5;
      lights.push({
        pos: frontCenter.clone().addScaledVector(n, 1.5).setY(CURB_H + 2.4),
        color: cafe ? shopWarm : shopCool,
        strength: 1.6,
        radius: 3,
      });
    } else if (lot.ground === DOOR_LAMP_GROUND) {
      const p = frontCenter.clone().addScaledVector(n, 0.15).setY(CURB_H + GROUND_FLOOR_H * (1 - 26 / 256));
      lights.push({ pos: p.clone().addScaledVector(n, 0.6), color: lampWarm, strength: 1.0, radius: 2 });
      glows.push({ pos: p.clone().addScaledVector(n, 0.05), color: new THREE.Color(1, 0.7, 0.4).multiplyScalar(0.55) });
    }

    // Potted plants by the door.
    if (rnd() < 0.55) {
      const k = rnd() < 0.5 ? 0.15 : 0.85;
      pots.push(frontLeft.clone().addScaledVector(right, fw * k).addScaledVector(n, 0.45).setY(CURB_H));
    }
  }

  return {
    facades: facades.build(),
    trim: trim.build(),
    railings: railings.build(),
    awnings: awnings.build(),
    signs: signs.build(),
    glowPanels: glowPanels.build(),
    lights,
    glows,
    pots,
  };
}
