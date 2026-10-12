import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pedestrian, Traffic, Vehicle } from '../../sim/traffic';
import { billboards, loadTexture } from './billboards';
import { radialTexture } from './proc';

const CURB_H = 0.16;
const CAR_PAINT = [0x8b1e1e, 0xd8d8d2, 0x1f3b66, 0x2a2a2c, 0x6d6f73, 0x8a6a2c, 0x274d3a, 0xb8b0a0];
const BIKE_PAINT = [0xb3261e, 0x1d4f91, 0xe8e6df, 0x202022, 0x6d6f73, 0x2f6f3a, 0xa1781a, 0x7a1414];
/**
 * People on the sidewalks are photo cut-outs: image proportions, height in metres, and whether the person in
 * the photo faces the image's right side (so they can be mirrored to face where they walk).
 */
export const WALKERS = [
  { name: 'walker-man', aspect: 0.275, height: 1.72, facesRight: true },
  { name: 'walker-woman', aspect: 0.27, height: 1.62, facesRight: true },
  { name: 'walker-green', aspect: 0.246, height: 1.7, facesRight: false },
  { name: 'walker-orange', aspect: 0.305, height: 1.7, facesRight: false },
  { name: 'walker-pink', aspect: 0.285, height: 1.6, facesRight: false },
  { name: 'walker-child', aspect: 0.355, height: 1.15, facesRight: true },
];

/** Box with a single colour baked into vertex colours (white means "use the instance colour"). */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, color = 0xffffff): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const cols = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < cols.length; i += 3) c.toArray(cols, i);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  return g;
}

// Local space: forward is −z, up is +y, origin on the ground at the vehicle's centre.
function carBody() {
  return mergeGeometries([
    box(1.8, 0.62, 4.2, 0, 0.55, 0),
    box(1.6, 0.5, 2.1, 0, 1.1, 0.25),
    box(1.5, 0.42, 1.9, 0, 1.12, 0.25, 0x0d1014), // dark windows, slightly inset
    box(1.85, 0.2, 4.0, 0, 0.18, 0, 0x111111),
  ]);
}

function bikeBody() {
  return mergeGeometries([
    box(0.32, 0.5, 1.75, 0, 0.45, 0),
    box(0.5, 0.25, 0.7, 0, 0.75, 0.35, 0x161616), // seat
    box(0.2, 0.55, 0.2, 0, 0.32, -0.75, 0x161616), // front fork
    box(0.4, 0.62, 0.3, 0, 1.15, 0.3, 0x2b3440), // rider torso
    box(0.26, 0.26, 0.28, 0, 1.6, 0.25, 0xd8d8d8), // helmet
  ]);
}

/** Head- and tail-lamps as small bright boxes; unlit so they read at night. */
function lamps(kind: Vehicle['kind']) {
  if (kind === 'car') {
    return mergeGeometries([
      box(0.32, 0.14, 0.04, -0.6, 0.62, -2.11, 0xfff2d0),
      box(0.32, 0.14, 0.04, 0.6, 0.62, -2.11, 0xfff2d0),
      box(0.3, 0.12, 0.04, -0.62, 0.66, 2.11, 0xff2a1a),
      box(0.3, 0.12, 0.04, 0.62, 0.66, 2.11, 0xff2a1a),
    ]);
  }
  return mergeGeometries([box(0.16, 0.12, 0.04, 0, 0.82, -0.9, 0xfff2d0), box(0.14, 0.08, 0.04, 0, 0.72, 0.9, 0xff2a1a)]);
}

interface Group<T> {
  items: T[];
  body: THREE.InstancedMesh;
  lights?: THREE.InstancedMesh;
  paint: number[];
}

/** Draws every NPC as instanced boxes, tinted by the street light where they are. */
export class NpcView {
  readonly group = new THREE.Group();
  private cars: Group<Vehicle>;
  private bikes: Group<Vehicle>;
  /** One instanced cut-out per kind of person, positions rewritten every frame. */
  private walkers: { mesh: THREE.Mesh; people: Pedestrian[]; facesRight: boolean }[];
  private glow: THREE.Points;
  private glowPos: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private lightTimer = 0;

  constructor(
    private traffic: Traffic,
    private levelAt: (x: number, z: number) => number,
    assetBase: string,
  ) {
    const body = new THREE.MeshBasicMaterial({ vertexColors: true });
    const lit = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const make = <T>(items: T[], geo: THREE.BufferGeometry, paint: number[], lampGeo?: THREE.BufferGeometry): Group<T> => {
      const n = Math.max(1, items.length);
      const b = new THREE.InstancedMesh(geo, body, n);
      b.count = items.length;
      b.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      b.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      b.frustumCulled = false;
      this.group.add(b);
      let l: THREE.InstancedMesh | undefined;
      if (lampGeo) {
        l = new THREE.InstancedMesh(lampGeo, lit, n);
        l.count = items.length;
        l.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        l.frustumCulled = false;
        this.group.add(l);
      }
      return { items, body: b, lights: l, paint };
    };
    const vs = traffic.vehicles;
    this.cars = make(vs.filter((v) => v.kind === 'car'), carBody(), CAR_PAINT, lamps('car'));
    this.bikes = make(vs.filter((v) => v.kind === 'bike'), bikeBody(), BIKE_PAINT, lamps('bike'));
    this.walkers = WALKERS.map((w, k) => {
      const people = traffic.pedestrians.filter((_, i) => i % WALKERS.length === k);
      const mesh = billboards(
        loadTexture(`${assetBase}props/${w.name}.webp`),
        people.map((p) => ({ pos: new THREE.Vector3(p.x, CURB_H, p.z) })),
        { width: w.height * w.aspect, height: w.height, anchorX: 0.5, brightness: 0.85, dynamic: true },
      );
      this.group.add(mesh);
      return { mesh, people, facesRight: w.facesRight };
    });

    // Soft glow in front of every headlight.
    this.glowPos = new Float32Array(vs.length * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 1.6,
        map: radialTexture(64, [
          [0, 'rgba(255,240,210,0.9)'],
          [0.3, 'rgba(255,220,170,0.25)'],
          [1, 'rgba(255,220,170,0)'],
        ]),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.frustumCulled = false;
    this.group.add(this.glow);
    this.refreshColors();
  }

  /** Street light changes slowly along a route, so colours are refreshed a few times a second. */
  private refreshColors() {
    const tint = <T extends { x: number; z: number; paint: number }>(grp: Group<T>) => {
      grp.items.forEach((it, i) => {
        const level = 0.22 + Math.min(1, this.levelAt(it.x, it.z)) * 0.85;
        this.c.setHex(grp.paint[it.paint % grp.paint.length]).multiplyScalar(level);
        grp.body.setColorAt(i, this.c);
      });
      grp.body.instanceColor!.needsUpdate = true;
    };
    tint(this.cars);
    tint(this.bikes);
    for (const w of this.walkers) {
      const light = w.mesh.geometry.getAttribute('aLight') as THREE.BufferAttribute;
      w.people.forEach((p, i) => light.setX(i, 0.25 + Math.min(1, this.levelAt(p.x, p.z)) * 0.85));
      light.needsUpdate = true;
    }
  }

  update(dt: number): void {
    const place = <T extends { x: number; z: number; heading: number }>(grp: Group<T>, bob?: (it: T) => number) => {
      grp.items.forEach((it, i) => {
        this.q.setFromAxisAngle(this.up, it.heading);
        this.p.set(it.x, (bob ? bob(it) : 0) + (onSidewalk(it) ? CURB_H : 0), it.z);
        this.m.compose(this.p, this.q, this.one);
        grp.body.setMatrixAt(i, this.m);
        grp.lights?.setMatrixAt(i, this.m);
      });
      grp.body.instanceMatrix.needsUpdate = true;
      if (grp.lights) grp.lights.instanceMatrix.needsUpdate = true;
    };
    const onSidewalk = (it: object) => 'loop' in it;
    place(this.cars);
    place(this.bikes);
    for (const w of this.walkers) {
      const pos = w.mesh.geometry.getAttribute('aPos') as THREE.BufferAttribute;
      const out = w.mesh.geometry.getAttribute('aOut') as THREE.BufferAttribute;
      const sign = w.facesRight ? 1 : -1;
      w.people.forEach((p, i) => {
        // A small bounce in step; the photo is mirrored so the person faces the way they walk.
        pos.setXYZ(i, p.x, CURB_H + Math.abs(Math.sin(p.phase)) * 0.03, p.z);
        out.setXY(i, -Math.sin(p.heading) * sign, -Math.cos(p.heading) * sign);
      });
      pos.needsUpdate = true;
      out.needsUpdate = true;
    }

    this.traffic.vehicles.forEach((v, i) => {
      const ahead = v.length / 2 + 0.6;
      this.glowPos[i * 3] = v.x - Math.sin(v.heading) * ahead;
      this.glowPos[i * 3 + 1] = v.kind === 'car' ? 0.62 : 0.82;
      this.glowPos[i * 3 + 2] = v.z - Math.cos(v.heading) * ahead;
    });
    this.glow.geometry.getAttribute('position').needsUpdate = true;

    this.lightTimer += dt;
    if (this.lightTimer > 0.25) {
      this.lightTimer = 0;
      this.refreshColors();
    }
  }
}
