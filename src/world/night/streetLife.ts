import * as THREE from 'three';
import { BALCONY_UPPER, type City, GROUND_FLOOR_H, LIT_GROUND, type Lot, ROAD, UPPER_FLOOR_H } from '../../sim/city';
import type { Rect } from '../../sim/geometry';
import { type BillboardItem, billboards, loadTexture } from './billboards';
import { QuadBuilder } from './houses';
import { alongRoad, lampSpots, poleSpots } from './layout';
import { canvas } from './proc';

const CURB_H = 0.16;
const UP = new THREE.Vector3(0, 1, 0);
const NORMALS: Record<Lot['facing'], THREE.Vector3> = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
};

/**
 * Cut-out props from public/assets/props: width / height of the cropped image, real height in metres, and
 * where along the image's width the object stands (0.5 = centred).
 */
export const PROPS = {
  'food-cart': { aspect: 0.83, height: 1.55 },
  'blue-stool': { aspect: 1.032, height: 0.45 },
  'red-stool': { aspect: 1.094, height: 0.45 },
  'low-table': { aspect: 1.41, height: 0.62 },
  'cafe-table': { aspect: 1.148, height: 0.75 },
  'cafe-chair': { aspect: 0.75, height: 0.88 },
  'metal-chair': { aspect: 0.82, height: 0.9 },
  'water-jug': { aspect: 0.576, height: 0.5 },
  'snack-rack': { aspect: 0.441, height: 1.6 },
  'food-sign': { aspect: 0.609, height: 1.15 },
  'vendor-counter': { aspect: 1.842, height: 0.9 },
  vendor: { aspect: 0.9, height: 0.85 },
  'seated-man': { aspect: 0.5, height: 1.3 },
  'potted-plant': { aspect: 1.243, height: 0.75 },
  'long-planter': { aspect: 3.261, height: 0.6 },
  'bike-white': { aspect: 1.542, height: 1.18 },
  'bike-mint': { aspect: 1.407, height: 1.25 },
  'bike-red': { aspect: 1.459, height: 1.2 },
  'bike-white-modern': { aspect: 1.533, height: 1.2 },
  'bike-dark-blue': { aspect: 1.484, height: 1.22 },
  'street-tree': { aspect: 0.665, height: 6.5 },
  'utility-pole': { aspect: 0.171, height: 7.8 },
  'water-tank': { aspect: 0.715, height: 1.8 },
} as const;
type PropName = keyof typeof PROPS;

const BIKES: PropName[] = ['bike-white', 'bike-mint', 'bike-red', 'bike-white-modern', 'bike-dark-blue'];
const SHOP_SIGNS = ['CÀ PHÊ', 'CẮT TÓC', 'SỬA XE', 'TẠP HÓA', 'BÚN CHẢ', 'TRÀ ĐÁ'];

export interface StreetLife {
  group: THREE.Group;
  /** Trunks and poles the scooter bumps into (frontage props sit inside the wall margin already). */
  obstacles: Rect[];
}

interface Frame {
  /** Ground point at the left end of the front wall, seen from the street. */
  left: THREE.Vector3;
  right: THREE.Vector3;
  n: THREE.Vector3;
  width: number;
}

function frontOf(lot: Lot): Frame {
  const n = NORMALS[lot.facing];
  const right = new THREE.Vector3().crossVectors(UP, n);
  const sideways = lot.facing === 'px' || lot.facing === 'nx';
  const width = sideways ? lot.rect.d : lot.rect.w;
  const depth = sideways ? lot.rect.w : lot.rect.d;
  const left = new THREE.Vector3(lot.rect.x, CURB_H, lot.rect.z).addScaledVector(n, depth / 2).addScaledVector(right, -width / 2);
  return { left, right, n, width };
}

/** A point in front of a house: `s` metres along the front, `d` out from the wall, `y` above the road. */
const at = (f: Frame, s: number, d: number, y = CURB_H) =>
  f.left.clone().addScaledVector(f.right, s).addScaledVector(f.n, d).setY(y);

/**
 * A projecting shop sign: the blank round face from the photo with a shop name painted on. The back of the
 * sign uses the photo mirrored (bracket on the other side) so its lettering still reads the right way.
 */
function signTexture(url: string, text: string, back: boolean): THREE.Texture {
  const [c, ctx] = canvas(512, 417);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    c.width = img.width;
    c.height = img.height;
    if (back) {
      ctx.translate(img.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The face is the dark disc beside the bracket.
    const cx = img.width * (back ? 0.335 : 0.665);
    const cy = img.height * 0.53;
    const r = img.height * 0.36;
    ctx.fillStyle = '#f3e7c8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const words = text.split(' ');
    const size = r * (words.length > 1 ? 0.5 : 0.62);
    ctx.font = `bold ${Math.round(size)}px system-ui, sans-serif`;
    words.forEach((w, i) => ctx.fillText(w, cx, cy + (i - (words.length - 1) / 2) * size * 1.05, r * 1.7));
    tex.needsUpdate = true;
  };
  img.src = url;
  return tex;
}

/**
 * Everyday street life from the photo props: little eateries, carts and parked motorbikes in front of the
 * houses, street trees, utility poles with wires across the road, and air-con units, flags, signs and water
 * tanks on the buildings.
 */
export function buildStreetLife(
  city: City,
  lots: Lot[],
  assetBase: string,
  lightAt: (p: THREE.Vector3) => number,
  rand: () => number,
): StreetLife {
  const group = new THREE.Group();
  const url = (name: string) => `${assetBase}props/${name}.webp`;
  const sprites = new Map<PropName, BillboardItem[]>();
  const put = (name: PropName, pos: THREE.Vector3, out?: THREE.Vector3) => {
    const list = sprites.get(name) ?? [];
    list.push({ pos, out, light: lightAt(pos) });
    sprites.set(name, list);
  };
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

  // Wall-mounted pieces are flat quads fixed to the buildings (they must not turn with the camera).
  const wall = new Map<string, QuadBuilder>();
  const quad = (key: string, o: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, light: number, uv = [0, 0, 1, 1]) => {
    const b = wall.get(key) ?? new QuadBuilder();
    const n = new THREE.Vector3().crossVectors(right, up).normalize();
    b.quad(o, right, up, n, uv, new THREE.Color().setScalar(light));
    wall.set(key, b);
  };

  for (const lot of lots) {
    const f = frontOf(lot);
    if (f.width < 2.5) continue;
    const shop = LIT_GROUND.has(lot.ground);
    const s = 1 + rand() * (f.width - 2);
    const roll = rand();

    // ---- On the sidewalk, right in front of the house ------------------------------------------
    if (shop) {
      if (roll < 0.35) {
        // Plastic stools round a low table: a street eatery.
        put('low-table', at(f, s, 0.55));
        for (const [ds, dd] of [
          [-0.75, 0.5],
          [0.75, 0.5],
          [0, 0.95],
          [-0.4, 0.15],
        ]) {
          if (rand() < 0.75) put(rand() < 0.6 ? 'red-stool' : 'blue-stool', at(f, s + ds, dd));
        }
        if (rand() < 0.6) put('seated-man', at(f, s + 0.75, 0.56), f.right.clone().negate());
      } else if (roll < 0.55) {
        put('food-cart', at(f, s, 0.5));
        put('food-sign', at(f, Math.min(f.width - 0.3, s + 1.1), 0.6));
      } else if (roll < 0.7) {
        put('vendor-counter', at(f, s, 0.55));
        put('vendor', at(f, s + 0.1, 0.3, CURB_H + 0.62));
      } else if (roll < 0.85) {
        put('snack-rack', at(f, s, 0.35));
        put('water-jug', at(f, s + 0.55, 0.45));
        if (rand() < 0.5) put('water-jug', at(f, s + 0.85, 0.4));
      } else {
        put('cafe-table', at(f, s, 0.6));
        put(rand() < 0.5 ? 'cafe-chair' : 'metal-chair', at(f, s - 0.6, 0.55));
        put(rand() < 0.5 ? 'cafe-chair' : 'metal-chair', at(f, s + 0.6, 0.55));
      }
    } else if (roll < 0.45) {
      // Motorbikes parked on the sidewalk, a row of one to three.
      const count = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const p = s + (k - (count - 1) / 2) * 0.8;
        if (p > 0.6 && p < f.width - 0.6) put(pick(BIKES), at(f, p, 0.55 + (k % 2) * 0.08), f.right);
      }
    } else if (roll < 0.65) {
      put('potted-plant', at(f, s, 0.35));
      if (rand() < 0.5) put('potted-plant', at(f, Math.min(f.width - 0.4, s + 0.9), 0.35));
    } else if (roll < 0.75) {
      put('long-planter', at(f, s, 0.3));
    }

    // ---- On the building -----------------------------------------------------------------------
    const bw = f.width / lot.bays;
    for (let fl = 1; fl < lot.floors; fl++) {
      for (let b = 0; b < lot.bays; b++) {
        if (BALCONY_UPPER.has(lot.upper[(fl - 1) * lot.bays + b]) || rand() > 0.22) continue;
        // Air-con unit beside the window, on a bracket.
        const w = 0.85;
        const h = w / 1.403;
        const x = b * bw + (rand() < 0.5 ? 0.15 : bw - 0.15 - w);
        const o = at(f, x, 0.3, CURB_H + GROUND_FLOOR_H + (fl - 1) * UPPER_FLOOR_H + 0.25);
        quad('aircon', o, f.right.clone().multiplyScalar(w), UP.clone().multiplyScalar(h), lightAt(o) * 0.9);
      }
    }
    if (lot.floors >= 2 && rand() < 0.3) {
      // A national flag on a short pole, sticking out from the first floor.
      const h = 1.5;
      const o = at(f, rand() < 0.5 ? 0.25 : f.width - 0.25, 0.05, CURB_H + GROUND_FLOOR_H + UPPER_FLOOR_H * 0.85 - h);
      quad('flag', o, f.n.clone().multiplyScalar(h * 0.449), UP.clone().multiplyScalar(h), lightAt(o) * 0.95);
    }
    if (shop && rand() < 0.4) {
      // Projecting round sign above the awning, readable from both directions along the street.
      const w = 1.05;
      const h = w / 1.228;
      const o = at(f, rand() < 0.5 ? 0.2 : f.width - 0.2, 0, CURB_H + GROUND_FLOOR_H + 0.25);
      const light = lightAt(o);
      const text = pick(SHOP_SIGNS);
      quad(`sign:${text}`, o, f.n.clone().multiplyScalar(w), UP.clone().multiplyScalar(h), light);
      const tip = o.clone().addScaledVector(f.n, w);
      quad(`signback:${text}`, tip, f.n.clone().multiplyScalar(-w), UP.clone().multiplyScalar(h), light);
    }
    if (rand() < 0.3) put('water-tank', at(f, 1 + rand() * (f.width - 2), -1.4, CURB_H + lot.height));
    if (!shop && rand() < 0.15) {
      // Grey electricity meter boxes on the wall beside the door.
      const w = 0.95;
      const o = at(f, rand() < 0.5 ? 0.15 : f.width - 0.15 - w, 0.08, CURB_H + 0.9);
      quad('utility-boxes', o, f.right.clone().multiplyScalar(w), UP.clone().multiplyScalar(w / 1.199), lightAt(o) * 0.85);
    }
  }

  // ---- Drain grates in the gutter along every curb ---------------------------------------------
  for (const r of city.roads) {
    for (const side of [-1, 1]) {
      for (const t of alongRoad(city, 22, side < 0 ? 4 : 15, 1)) {
        for (const axis of ['x', 'z'] as const) {
          const across = r + side * (ROAD / 2 - 0.45);
          // Lying flat: 0.5 m along the curb, 0.66 m across.
          const along = axis === 'x' ? new THREE.Vector3(0, 0, 0.5) : new THREE.Vector3(0.5, 0, 0);
          const out = axis === 'x' ? new THREE.Vector3(0.66 * side, 0, 0) : new THREE.Vector3(0, 0, 0.66 * side);
          const c = axis === 'x' ? new THREE.Vector3(across, 0.012, t) : new THREE.Vector3(t, 0.012, across);
          const o = c.clone().addScaledVector(along, -0.5).addScaledVector(out, -0.5);
          quad('drain-grate', o, along, out, lightAt(c) * 0.7);
        }
      }
    }
  }

  // ---- Street trees on the planter line, between the planters and clear of lamps and poles -------
  const obstacles: Rect[] = [];
  const poles = poleSpots(city);
  for (const r of city.roads) {
    for (const side of [-1, 1]) {
      const lamps = lampSpots(city, side);
      for (const t of alongRoad(city, 13, side < 0 ? 6 : 19, 3)) {
        if (lamps.some((l) => Math.abs(l - t) < 2.5) || poles.some((p) => Math.abs(p - t) < 3)) continue;
        for (const axis of ['x', 'z'] as const) {
          if (rand() > 0.3) continue;
          const across = r + side * (ROAD / 2 + 1.4);
          const p = axis === 'x' ? new THREE.Vector3(across, CURB_H, t) : new THREE.Vector3(t, CURB_H, across);
          put('street-tree', p);
          obstacles.push({ x: p.x, z: p.z, w: 0.45, d: 0.45 });
        }
      }
    }
  }

  // ---- Utility poles on alternate blocks, with sagging wires across the road ----------------------
  city.roads.forEach((r, i) => {
    poles.forEach((t, j) => {
      if ((i + j) % 2) return;
      for (const axis of ['x', 'z'] as const) {
        const ends = [-1, 1].map((side) => {
          const across = r + side * (ROAD / 2 + 0.75);
          return axis === 'x' ? new THREE.Vector3(across, CURB_H, t) : new THREE.Vector3(t, CURB_H, across);
        });
        for (const p of ends) {
          put('utility-pole', p);
          obstacles.push({ x: p.x, z: p.z, w: 0.35, d: 0.35 });
        }
        const span = ends[1].clone().sub(ends[0]);
        const o = ends[0].clone().setY(CURB_H + 5.6);
        quad('wires', o, span, UP.clone().multiplyScalar(1.5), 0.5);
      }
    });
  });

  // ---- Build one instanced draw per prop and one merged mesh per wall decal ----------------------
  for (const [name, items] of sprites) {
    const p = PROPS[name];
    group.add(
      billboards(loadTexture(url(name)), items, {
        height: p.height,
        width: p.height * p.aspect,
        anchorX: 0.5,
        brightness: name === 'street-tree' ? 0.7 : 0.8,
      }),
    );
  }
  for (const [key, b] of wall) {
    const [kind, text] = key.split(':');
    const tex =
      kind === 'sign' || kind === 'signback'
        ? signTexture(url('round-sign'), text, kind === 'signback')
        : loadTexture(url(key === 'wires' ? 'overhead-wires' : key));
    const doubleSided = key === 'flag' || key === 'wires' || key === 'drain-grate';
    group.add(
      new THREE.Mesh(
        b.build(),
        new THREE.MeshBasicMaterial({
          map: tex,
          vertexColors: true,
          alphaTest: 0.5,
          side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
          color: new THREE.Color().setScalar(0.8),
        }),
      ),
    );
  }
  return { group, obstacles };
}
