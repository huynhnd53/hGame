import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BikeModel } from '../../cockpit/bikes';
import { box } from './npcs';
import { radialTexture } from './proc';

// Local space: forward is −z, up is +y, origin on the ground midway between the wheels.
const FRONT_PIVOT_Z = -0.45;
/** Where the rear tyre touches the road: wheelies pivot here. */
export const REAR_CONTACT_Z = 0.62;
const DARK = 0x1a1a1c;
const METAL = 0x7d8085;
const CHROME = 0x9a9da2;
const ENGINE = 0x2d2f33;
const SEAT = 0x121214;
const JACKET = 0x3b4a5c;
const JEANS = 0x2b3442;
const GLOVE = 0x26282b;

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const cols = new Float32Array(geo.getAttribute('position').count * 3);
  for (let i = 0; i < cols.length; i += 3) c.toArray(cols, i);
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** A box stretched between two points, for arms and legs. */
function limb(a: THREE.Vector3, b: THREE.Vector3, thick: number, color: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(thick, thick, len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return colored(g, color);
}

/** A tyre with a light hub and two spokes so it visibly turns; axle along x. */
function wheel(r: number): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(r, r, 0.11, 18);
  tyre.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.115, 18);
  rim.rotateZ(Math.PI / 2);
  return mergeGeometries([
    colored(tyre, 0x161616),
    colored(rim, 0x55585c),
    box(0.12, r * 1.2, 0.05, 0, 0, 0, 0xa8abb0),
    box(0.12, 0.05, r * 1.2, 0, 0, 0, 0xa8abb0),
  ]);
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Layout {
  r: number;
  body: THREE.BufferGeometry[];
  /** Parts that turn with the bars, relative to the steering pivot. */
  front: THREE.BufferGeometry[];
  frontWheelZ: number;
  headlight: [number, number, number];
  tail: [number, number, number];
  blinkersFront: [number, number, number];
  blinkersRear: [number, number, number];
  grips: [number, number, number];
  seat: [number, number];
  /** Feet: on the floorboard (scooters) or the pegs. */
  foot: [number, number, number];
  knee: [number, number, number];
}

function layout(m: BikeModel): Layout {
  const P = m.paint;
  const T = m.trim;
  if (m.kind === 'naked') {
    const r = 0.3;
    return {
      r,
      body: [
        box(0.34, 0.24, 0.5, 0, 0.92, -0.18, P),
        box(0.35, 0.06, 0.3, 0, 0.84, -0.16, T),
        box(0.28, 0.1, 0.55, 0, 0.88, 0.3, SEAT),
        box(0.18, 0.12, 0.35, 0, 0.95, 0.68, P),
        box(0.3, 0.36, 0.42, 0, 0.48, -0.08, ENGINE),
        box(0.26, 0.18, 0.2, 0, 0.72, -0.22, METAL),
        box(0.06, 0.06, 0.62, 0.14, 0.78, 0.05, METAL),
        box(0.06, 0.06, 0.62, -0.14, 0.78, 0.05, METAL),
        box(0.06, 0.07, 0.6, 0.12, 0.32, 0.36, DARK),
        box(0.06, 0.07, 0.6, -0.12, 0.32, 0.36, DARK),
        box(0.11, 0.11, 0.55, 0.19, 0.38, 0.42, CHROME),
        box(0.14, 0.05, 0.3, 0, 0.66, 0.62, DARK),
        box(0.5, 0.03, 0.04, 0, 0.42, 0.12, DARK),
      ],
      front: [
        box(0.05, 0.66, 0.05, 0.09, 0.62, -0.1, METAL),
        box(0.05, 0.66, 0.05, -0.09, 0.62, -0.1, METAL),
        box(0.24, 0.2, 0.16, 0, 0.98, -0.12, DARK),
        box(0.78, 0.04, 0.04, 0, 1.08, 0.06, DARK),
        box(0.14, 0.05, 0.36, 0, 2 * r + 0.04, -0.2, P),
        box(0.02, 0.18, 0.02, 0.3, 1.17, 0.06, DARK),
        box(0.02, 0.18, 0.02, -0.3, 1.17, 0.06, DARK),
        box(0.12, 0.07, 0.02, 0.32, 1.27, 0.06, DARK),
        box(0.12, 0.07, 0.02, -0.32, 1.27, 0.06, DARK),
      ],
      frontWheelZ: -0.2,
      headlight: [0, 0.98, -0.21],
      tail: [0, 0.95, 0.87],
      blinkersFront: [0.16, 0.95, -0.62],
      blinkersRear: [0.12, 0.9, 0.85],
      grips: [0.37, 1.08, -0.39],
      seat: [0.93, 0.32],
      foot: [0.19, 0.42, 0.14],
      knee: [0.18, 0.86, -0.1],
    };
  }
  if (m.kind === 'underbone') {
    const r = 0.3;
    return {
      r,
      body: [
        box(0.36, 0.42, 0.08, 0, 0.62, -0.33, P),
        box(0.1, 0.1, 0.6, 0, 0.56, -0.05, P),
        box(0.26, 0.28, 0.38, 0, 0.36, 0.02, ENGINE),
        box(0.34, 0.28, 0.66, 0, 0.66, 0.4, P),
        box(0.35, 0.05, 0.5, 0, 0.6, 0.42, T),
        box(0.3, 0.1, 0.66, 0, 0.84, 0.32, SEAT),
        box(0.1, 0.1, 0.6, 0.17, 0.3, 0.38, CHROME),
        box(0.5, 0.03, 0.04, 0, 0.3, 0.05, DARK),
        box(0.22, 0.1, 0.15, 0, 0.7, 0.78, T),
      ],
      front: [
        box(0.05, 0.6, 0.05, 0.08, 0.52, -0.14, METAL),
        box(0.05, 0.6, 0.05, -0.08, 0.52, -0.14, METAL),
        box(0.42, 0.16, 0.22, 0, 1.0, -0.02, P),
        box(0.43, 0.04, 0.15, 0, 0.95, -0.02, T),
        box(0.68, 0.04, 0.04, 0, 1.0, 0.07, DARK),
        box(0.13, 0.05, 0.4, 0, 2 * r + 0.04, -0.2, P),
        box(0.02, 0.18, 0.02, 0.24, 1.12, 0.02, DARK),
        box(0.02, 0.18, 0.02, -0.24, 1.12, 0.02, DARK),
        box(0.12, 0.07, 0.02, 0.27, 1.22, 0.02, DARK),
        box(0.12, 0.07, 0.02, -0.27, 1.22, 0.02, DARK),
      ],
      frontWheelZ: -0.2,
      headlight: [0, 1.0, -0.14],
      tail: [0, 0.7, 0.86],
      blinkersFront: [0.2, 1.0, -0.58],
      blinkersRear: [0.12, 0.7, 0.86],
      grips: [0.34, 1.0, -0.38],
      seat: [0.89, 0.32],
      foot: [0.2, 0.33, 0.06],
      knee: [0.19, 0.8, -0.16],
    };
  }
  const r = 0.27;
  return {
    r,
    body: [
      box(0.34, 0.07, 0.55, 0, 0.3, -0.02, DARK),
      box(0.44, 0.62, 0.1, 0, 0.62, -0.36, P),
      box(0.3, 0.2, 0.18, 0, 0.42, -0.42, P),
      box(0.42, 0.34, 0.78, 0, 0.6, 0.36, P),
      box(0.43, 0.05, 0.6, 0, 0.5, 0.38, T),
      box(0.32, 0.11, 0.7, 0, 0.83, 0.3, SEAT),
      box(0.3, 0.12, 0.18, 0, 0.66, 0.8, T),
      box(0.18, 0.2, 0.55, 0.06, 0.3, 0.42, ENGINE),
      box(0.12, 0.12, 0.5, 0.2, 0.32, 0.55, CHROME),
    ],
    front: [
      box(0.08, 0.5, 0.08, 0, 0.82, 0, DARK),
      box(0.05, 0.45, 0.05, 0.08, 0.42, -0.12, METAL),
      box(0.05, 0.45, 0.05, -0.08, 0.42, -0.12, METAL),
      box(0.5, 0.14, 0.2, 0, 1.08, 0.02, P),
      box(0.72, 0.04, 0.04, 0, 1.06, 0.07, DARK),
      box(0.16, 0.05, 0.42, 0, 2 * r + 0.04, -0.2, P),
      box(0.02, 0.18, 0.02, 0.26, 1.2, 0.02, DARK),
      box(0.02, 0.18, 0.02, -0.26, 1.2, 0.02, DARK),
      box(0.12, 0.07, 0.02, 0.29, 1.3, 0.02, DARK),
      box(0.12, 0.07, 0.02, -0.29, 1.3, 0.02, DARK),
    ],
    frontWheelZ: -0.2,
    headlight: [0, 1.07, -0.09],
    tail: [0, 0.68, 0.9],
    blinkersFront: [0.22, 0.8, -0.42],
    blinkersRear: [0.13, 0.68, 0.9],
    grips: [0.37, 1.06, -0.38],
    seat: [0.89, 0.3],
    foot: [0.13, 0.38, -0.12],
    knee: [0.17, 0.98, -0.18],
  };
}

function riderGeometry(l: Layout, helmet: number): THREE.BufferGeometry {
  const [seatY, seatZ] = l.seat;
  const hipY = seatY + 0.08;
  const sh = v(0.21, seatY + 0.6, seatZ - 0.08);
  const [gx, gy, gz] = l.grips;
  const hand = (s: number) => v(s * gx, gy, gz);
  const elbow = (s: number) => v(s * (gx - 0.02), (sh.y + gy) / 2 - 0.04, (sh.z + gz) / 2 + 0.06);
  const parts = [
    box(0.34, 0.16, 0.26, 0, hipY, seatZ, JEANS),
    // Torso leaning a little forward towards the bars.
    colored(new THREE.BoxGeometry(0.4, 0.56, 0.26).rotateX(-0.22).translate(0, seatY + 0.38, seatZ - 0.05), JACKET),
    box(0.27, 0.29, 0.3, 0, seatY + 0.83, seatZ - 0.12, helmet),
    // White band over the crown, like the orange-and-white helmet photo.
    box(0.09, 0.3, 0.31, 0, seatY + 0.835, seatZ - 0.12, 0xece8de),
    box(0.22, 0.1, 0.02, 0, seatY + 0.83, seatZ - 0.275, 0x0c0c0e),
  ];
  for (const s of [-1, 1]) {
    const shoulder = v(s * sh.x, sh.y, sh.z);
    parts.push(limb(shoulder, elbow(s), 0.11, JACKET), limb(elbow(s), hand(s), 0.09, JACKET));
    parts.push(box(0.08, 0.08, 0.1, hand(s).x, hand(s).y, hand(s).z, GLOVE));
    const hip = v(s * 0.11, hipY, seatZ - 0.02);
    const knee = v(s * l.knee[0], l.knee[1], l.knee[2]);
    const foot = v(s * l.foot[0], l.foot[1], l.foot[2]);
    parts.push(limb(hip, knee, 0.15, JEANS), limb(knee, foot.clone().setY(foot.y + 0.05), 0.12, JEANS));
    parts.push(box(0.11, 0.08, 0.25, foot.x, foot.y, foot.z - 0.05, 0x1b1b1b));
  }
  return mergeGeometries(parts);
}

/** The player's bike and rider for the third-person view, built from coloured boxes like the NPCs. */
export class PlayerBike {
  readonly group = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly pitch = new THREE.Group();
  private readonly frontPivot = new THREE.Group();
  private readonly frontWheel: THREE.Mesh;
  private readonly rearWheel: THREE.Mesh;
  private readonly bodyMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly headMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  private readonly tailMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  private readonly leftMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  private readonly rightMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  private readonly r: number;

  constructor(model: BikeModel) {
    const l = layout(model);
    this.r = l.r;
    this.group.rotation.order = 'YXZ';
    // yaw (group) → pitch about the rear contact patch → lean about the bike's own length.
    this.pitch.position.z = REAR_CONTACT_Z;
    this.group.add(this.pitch);
    const back = new THREE.Group();
    back.position.z = -REAR_CONTACT_Z;
    this.pitch.add(back);
    back.add(this.lean);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: radialTexture(64, [
          [0, 'rgba(0,0,0,0.6)'],
          [0.6, 'rgba(0,0,0,0.3)'],
          [1, 'rgba(0,0,0,0)'],
        ]),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.scale.set(1.1, 1, 2.2);
    shadow.position.y = 0.02;
    this.group.add(shadow);

    const helmet = 0xe8742a;
    this.lean.add(new THREE.Mesh(mergeGeometries([...l.body, riderGeometry(l, helmet)]), this.bodyMat));
    const wheelGeo = wheel(l.r);
    this.rearWheel = new THREE.Mesh(wheelGeo, this.bodyMat);
    this.rearWheel.position.set(0, l.r, REAR_CONTACT_Z);
    this.lean.add(this.rearWheel);

    this.frontPivot.position.z = FRONT_PIVOT_Z;
    this.lean.add(this.frontPivot);
    this.frontPivot.add(new THREE.Mesh(mergeGeometries(l.front), this.bodyMat));
    this.frontWheel = new THREE.Mesh(wheelGeo, this.bodyMat);
    this.frontWheel.position.set(0, l.r, l.frontWheelZ);
    this.frontPivot.add(this.frontWheel);

    const lamp = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => parent.add(new THREE.Mesh(geo, mat));
    const [hx, hy, hz] = l.headlight;
    lamp(new THREE.BoxGeometry(0.2, 0.08, 0.03).translate(hx, hy, hz), this.headMat, this.frontPivot);
    const [tx, ty, tz] = l.tail;
    lamp(new THREE.BoxGeometry(0.18, 0.06, 0.03).translate(tx, ty, tz), this.tailMat, this.lean);
    const [fx, fy, fz] = l.blinkersFront;
    const [rx, ry, rz] = l.blinkersRear;
    for (const [s, mat] of [
      [-1, this.leftMat],
      [1, this.rightMat],
    ] as const) {
      lamp(
        mergeGeometries([
          new THREE.BoxGeometry(0.07, 0.045, 0.06).translate(s * fx, fy, fz),
          new THREE.BoxGeometry(0.06, 0.04, 0.05).translate(s * rx, ry, rz),
        ]),
        mat,
        this.lean,
      );
    }
  }

  /**
   * Places the bike and animates wheels, steering, lean and lamps.
   * `light` is the street-light level at the bike (0 dark … 1 under a lamp); `pitch` lifts the front
   * (wheelie) and `fallen` lays the bike on its side after a crash.
   */
  update(
    dt: number,
    s: { x: number; z: number; heading: number; speed: number; steer: number },
    ground: number,
    light: number,
    lamps: { head: boolean; brake: boolean; left: boolean; right: boolean },
    pitch = 0,
    fallen = false,
  ): void {
    this.group.position.set(s.x, ground, s.z);
    this.group.rotation.y = s.heading;
    const speedRatio = Math.min(1.6, Math.abs(s.speed) / 16.7);
    this.lean.rotation.z = fallen ? 1.35 : -s.steer * speedRatio * 0.38;
    this.pitch.rotation.x = fallen ? 0 : pitch;
    this.frontPivot.rotation.y = (-s.steer * 0.5) / (1 + Math.abs(s.speed) * 0.12);
    const spin = (s.speed / this.r) * dt;
    this.frontWheel.rotation.x -= spin;
    this.rearWheel.rotation.x -= spin;

    this.bodyMat.color.setScalar(0.22 + Math.min(1, light) * 0.85);
    this.headMat.color.setHex(lamps.head ? 0xfff2d0 : 0x4a4740);
    this.tailMat.color.setHex(lamps.brake ? 0xff3a2a : 0x8a1810);
    this.leftMat.color.setHex(lamps.left ? 0xffa531 : 0x4a3010);
    this.rightMat.color.setHex(lamps.right ? 0xffa531 : 0x4a3010);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
