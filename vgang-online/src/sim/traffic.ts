import { type City, GRID, ROAD, SIDEWALK } from './city';
import { mulberry32, type Rect } from './geometry';

/** E, S, W, N as unit steps on the (x, z) grid. */
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const LANE = ROAD / 4;
const JUNCTION = ROAD / 2;

export type VehicleKind = 'car' | 'bike';

export interface Vehicle {
  kind: VehicleKind;
  /** Body colour index chosen by the renderer. */
  paint: number;
  x: number;
  z: number;
  /** Radians, same convention as the scooter (0 faces −z). */
  heading: number;
  speed: number;
  cruise: number;
  length: number;
  width: number;
  /** Intersection the vehicle is heading to, and its travel direction index into DIRS. */
  ti: number;
  tj: number;
  dir: number;
  /** Current path: a quadratic curve p0 → p2 with control p1 (straight legs use the midpoint). */
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  t: number;
  len: number;
  inJunction: boolean;
  /** Seconds spent (nearly) stopped behind other traffic; used to break rare junction stand-offs. */
  waited: number;
}

export interface Pedestrian {
  paint: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Loop around one block's sidewalk: rectangle and distance travelled along its perimeter. */
  loop: Rect;
  s: number;
  dirSign: 1 | -1;
  /** Walking cycle phase for a little bob. */
  phase: number;
}

const right = (d: number) => DIRS[(d + 1) % 4];

function bezier(p0: number[], p1: number[], p2: number[], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

function curveLength(p0: number[], p1: number[], p2: number[]): number {
  let len = 0;
  let prev = p0;
  for (let k = 1; k <= 8; k++) {
    const p = bezier(p0, p1, p2, k / 8);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return Math.max(0.01, len);
}

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  readonly pedestrians: Pedestrian[] = [];
  private rand: () => number;

  constructor(
    private city: City,
    vehicleCount: number,
    pedestrianCount: number,
    seed = 77,
  ) {
    this.rand = mulberry32(seed);
    for (let k = 0; k < vehicleCount; k++) this.vehicles.push(this.spawnVehicle());
    const blocks = city.blocks;
    for (let k = 0; k < pedestrianCount; k++) {
      const b = blocks[Math.floor(this.rand() * blocks.length)];
      // Walk in the middle of the sidewalk, clear of lamps (curb side) and shopfronts.
      const inset = SIDEWALK * 0.62;
      const loop = { x: b.rect.x, z: b.rect.z, w: b.rect.w - inset * 2, d: b.rect.d - inset * 2 };
      const p: Pedestrian = {
        paint: Math.floor(this.rand() * 8),
        x: 0,
        z: 0,
        heading: 0,
        speed: 1 + this.rand() * 0.6,
        loop,
        s: this.rand() * 2 * (loop.w + loop.d),
        dirSign: this.rand() < 0.5 ? 1 : -1,
        phase: this.rand() * 10,
      };
      this.placePedestrian(p, 0);
      this.pedestrians.push(p);
    }
  }

  private centre(i: number, j: number): [number, number] {
    return [this.city.roads[i], this.city.roads[j]];
  }

  private inGrid(i: number, j: number) {
    return i >= 0 && j >= 0 && i <= GRID && j <= GRID;
  }

  /** Straight leg in the right-hand lane from the junction behind to the stop line of (ti, tj). */
  private setLeg(v: Vehicle, fromI: number, fromJ: number) {
    const d = DIRS[v.dir];
    const r = right(v.dir);
    const [ax, az] = this.centre(fromI, fromJ);
    const [bx, bz] = this.centre(v.ti, v.tj);
    v.p0 = [ax + d[0] * JUNCTION + r[0] * LANE, az + d[1] * JUNCTION + r[1] * LANE];
    v.p2 = [bx - d[0] * JUNCTION + r[0] * LANE, bz - d[1] * JUNCTION + r[1] * LANE];
    v.p1 = [(v.p0[0] + v.p2[0]) / 2, (v.p0[1] + v.p2[1]) / 2];
    v.len = curveLength(v.p0, v.p1, v.p2);
    v.inJunction = false;
  }

  /** Picks the next direction at (ti, tj) and builds the curve through the junction. */
  private enterJunction(v: Vehicle) {
    const options: number[] = [];
    for (const turn of [0, 0, 0, 1, 3]) {
      const nd = (v.dir + turn) % 4;
      const [dx, dz] = DIRS[nd];
      if (this.inGrid(v.ti + dx, v.tj + dz)) options.push(nd);
    }
    // Dead ends only happen at the outer ring corners; there a U-turn is the only way out.
    const nd = options.length ? options[Math.floor(this.rand() * options.length)] : (v.dir + 2) % 4;
    const [cx, cz] = this.centre(v.ti, v.tj);
    const d = DIRS[v.dir];
    const r = right(v.dir);
    const d2 = DIRS[nd];
    const r2 = right(nd);
    v.p0 = [cx - d[0] * JUNCTION + r[0] * LANE, cz - d[1] * JUNCTION + r[1] * LANE];
    v.p2 = [cx + d2[0] * JUNCTION + r2[0] * LANE, cz + d2[1] * JUNCTION + r2[1] * LANE];
    v.p1 =
      nd === v.dir || nd === (v.dir + 2) % 4
        ? [(v.p0[0] + v.p2[0]) / 2, (v.p0[1] + v.p2[1]) / 2]
        : [cx + r[0] * LANE + r2[0] * LANE, cz + r[1] * LANE + r2[1] * LANE];
    v.len = curveLength(v.p0, v.p1, v.p2);
    v.inJunction = true;
    v.dir = nd;
  }

  private spawnVehicle(): Vehicle {
    const rand = this.rand;
    const kind: VehicleKind = rand() < 0.6 ? 'bike' : 'car';
    let dir = Math.floor(rand() * 4);
    let ti = 0;
    let tj = 0;
    let fi = 0;
    let fj = 0;
    for (let tries = 0; tries < 20; tries++) {
      fi = Math.floor(rand() * (GRID + 1));
      fj = Math.floor(rand() * (GRID + 1));
      dir = Math.floor(rand() * 4);
      ti = fi + DIRS[dir][0];
      tj = fj + DIRS[dir][1];
      if (this.inGrid(ti, tj)) break;
    }
    const cruise = kind === 'bike' ? 8 + rand() * 5 : 9 + rand() * 5;
    const v: Vehicle = {
      kind,
      paint: Math.floor(rand() * 8),
      x: 0,
      z: 0,
      heading: 0,
      speed: cruise,
      cruise,
      length: kind === 'car' ? 4.2 : 1.9,
      width: kind === 'car' ? 1.8 : 0.7,
      ti,
      tj,
      dir,
      p0: [0, 0],
      p1: [0, 0],
      p2: [0, 0],
      t: rand(),
      len: 1,
      inJunction: false,
      waited: 0,
    };
    this.setLeg(v, fi, fj);
    this.place(v);
    return v;
  }

  private place(v: Vehicle) {
    const [x, z] = bezier(v.p0, v.p1, v.p2, v.t);
    const [x2, z2] = bezier(v.p0, v.p1, v.p2, Math.min(1, v.t + 0.02));
    const [x0, z0] = bezier(v.p0, v.p1, v.p2, Math.max(0, v.t - 0.02));
    v.x = x;
    v.z = z;
    v.heading = Math.atan2(-(x2 - x0), -(z2 - z0));
  }

  private placePedestrian(p: Pedestrian, dt: number) {
    const { loop } = p;
    const per = 2 * (loop.w + loop.d);
    p.s = (((p.s + p.dirSign * p.speed * dt) % per) + per) % per;
    const x0 = loop.x - loop.w / 2;
    const z0 = loop.z - loop.d / 2;
    let s = p.s;
    let x: number;
    let z: number;
    let hx: number;
    let hz: number;
    if (s < loop.w) [x, z, hx, hz] = [x0 + s, z0, 1, 0];
    else if ((s -= loop.w) < loop.d) [x, z, hx, hz] = [x0 + loop.w, z0 + s, 0, 1];
    else if ((s -= loop.d) < loop.w) [x, z, hx, hz] = [x0 + loop.w - s, z0 + loop.d, -1, 0];
    else {
      s -= loop.w;
      [x, z, hx, hz] = [x0, z0 + loop.d - s, 0, -1];
    }
    p.x = x;
    p.z = z;
    p.heading = Math.atan2(-hx * p.dirSign, -hz * p.dirSign);
    p.phase += dt * p.speed * 5;
  }

  /**
   * Advances everyone. Vehicles slow down behind traffic in their lane and stop for the player,
   * so they never drive through the rider.
   */
  update(dt: number, player: { x: number; z: number }): void {
    const vs = this.vehicles;
    for (const v of vs) {
      const fx = -Math.sin(v.heading);
      const fz = -Math.cos(v.heading);
      let gap = Infinity;
      let blockedByPlayer = false;
      const consider = (ox: number, oz: number, extra: number) => {
        const dx = ox - v.x;
        const dz = oz - v.z;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0 || ahead > 18) return;
        const side = Math.abs(dx * fz - dz * fx);
        if (side < 1.6) gap = Math.min(gap, ahead - extra);
      };
      // After waiting a while, creep past other vehicles (never past the player).
      if (v.waited < 4) for (const o of vs) if (o !== v) consider(o.x, o.z, (v.length + o.length) / 2);
      const before = gap;
      consider(player.x, player.z, v.length / 2 + 0.8);
      blockedByPlayer = gap < before;
      // Ease towards cruising speed, or towards a stop that leaves a safe gap.
      const target = gap === Infinity ? v.cruise : Math.max(0, Math.min(v.cruise, (gap - 2) * 1.2));
      const rate = target < v.speed ? 8 : 2.5;
      v.speed += Math.max(-rate * dt, Math.min(rate * dt, target - v.speed));
      if (v.inJunction) v.speed = Math.min(v.speed, Math.max(5, v.cruise * 0.6), target);
      if (v.speed < 0.3 && !blockedByPlayer) v.waited += dt;
      else if (v.speed > 2 || v.waited >= 6) v.waited = 0;

      v.t += (v.speed * dt) / v.len;
      while (v.t >= 1) {
        const over = (v.t - 1) * v.len;
        if (v.inJunction) {
          const fi = v.ti;
          const fj = v.tj;
          v.ti += DIRS[v.dir][0];
          v.tj += DIRS[v.dir][1];
          this.setLeg(v, fi, fj);
        } else {
          this.enterJunction(v);
        }
        v.t = over / v.len;
      }
      this.place(v);
    }
    for (const p of this.pedestrians) this.placePedestrian(p, dt);
  }

  /** Axis-aligned boxes around the vehicles and walkers near a point, for the scooter's collisions. */
  collidersNear(x: number, z: number, radius: number): Rect[] {
    const out: Rect[] = [];
    for (const v of this.vehicles) {
      if (Math.abs(v.x - x) > radius || Math.abs(v.z - z) > radius) continue;
      const along = Math.abs(Math.sin(v.heading)) > 0.7;
      out.push({ x: v.x, z: v.z, w: along ? v.length : v.width, d: along ? v.width : v.length });
    }
    for (const p of this.pedestrians) {
      if (Math.abs(p.x - x) > radius || Math.abs(p.z - z) > radius) continue;
      out.push({ x: p.x, z: p.z, w: 0.5, d: 0.5 });
    }
    return out;
  }
}
