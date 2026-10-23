import { type Rect, circleHitsRect } from './geometry';

/** Reference speed for handling and camera effects; there is no top speed. */
export const CRUISE_SPEED = 60 / 3.6;
export const SCOOTER_RADIUS = 0.45;
const ACCEL = 3.4;
const BRAKE = 9;
const REVERSE_SPEED = 1.2;
const WHEELBASE = 1.25;
const STEER_RATE = 4;

export interface ScooterState {
  x: number;
  z: number;
  /** Radians; 0 faces -z, positive turns left. */
  heading: number;
  /** m/s along the heading; negative while pushing backwards. */
  speed: number;
  /** Smoothed handlebar position, -1 (left) .. 1 (right). */
  steer: number;
}

export interface Controls {
  throttle: number;
  brake: number;
  steer: number;
}

export interface StepResult {
  state: ScooterState;
  /** Speed lost to a collision this step, in m/s. */
  impact: number;
}

/** Steering lock narrows with speed so high-speed turns stay stable. */
export function maxSteerAngle(speed: number): number {
  const t = Math.min(1, Math.abs(speed) / CRUISE_SPEED);
  return 0.55 + (0.14 - 0.55) * t;
}

function blocked(x: number, z: number, colliders: Rect[], bounds: Rect): boolean {
  const r = SCOOTER_RADIUS;
  if (
    x - r < bounds.x - bounds.w / 2 ||
    x + r > bounds.x + bounds.w / 2 ||
    z - r < bounds.z - bounds.d / 2 ||
    z + r > bounds.z + bounds.d / 2
  ) {
    return true;
  }
  for (const c of colliders) if (circleHitsRect(x, z, r, c)) return true;
  return false;
}

export function stepScooter(
  s: ScooterState,
  c: Controls,
  dt: number,
  engineOn: boolean,
  colliders: Rect[],
  bounds: Rect,
): StepResult {
  const throttle = engineOn ? Math.max(0, Math.min(1, c.throttle)) : 0;
  const brake = Math.max(0, Math.min(1, c.brake));
  const steerTarget = Math.max(-1, Math.min(1, c.steer));
  const steer = s.steer + Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, steerTarget - s.steer));

  let speed = s.speed;
  if (speed >= 0) {
    // No top speed: holding the throttle keeps accelerating, a little more gently the faster you go.
    speed += (throttle * ACCEL * dt) / (1 + speed / 30);
    // Rolling resistance plus air drag slow the scooter only while coasting.
    const drag = (0.25 + 0.01 * speed * speed) * (1 - throttle);
    speed -= (brake * BRAKE + drag) * dt;
    if (speed < 0) {
      // Holding the brake at a standstill walks the scooter backwards slowly.
      speed = brake > 0.5 && throttle === 0 ? Math.max(-REVERSE_SPEED, speed) : 0;
    }
  } else {
    speed = brake > 0.5 && throttle === 0 ? Math.max(-REVERSE_SPEED, speed - 2 * dt) : Math.min(0, speed + 4 * dt);
  }

  const angle = -steer * maxSteerAngle(speed);
  const heading = s.heading + ((speed * Math.tan(angle)) / WHEELBASE) * dt;

  // Move in small sub-steps, sliding along whatever we touch.
  const dist = speed * dt;
  const steps = Math.max(1, Math.ceil(Math.abs(dist) / 0.2));
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  let x = s.x;
  let z = s.z;
  let moved = 0;
  for (let k = 0; k < steps; k++) {
    const dx = (fx * dist) / steps;
    const dz = (fz * dist) / steps;
    if (!blocked(x + dx, z + dz, colliders, bounds)) {
      x += dx;
      z += dz;
      moved += Math.abs(dist) / steps;
    } else if (!blocked(x + dx, z, colliders, bounds)) {
      x += dx;
      moved += Math.abs(dx * fx);
    } else if (!blocked(x, z + dz, colliders, bounds)) {
      z += dz;
      moved += Math.abs(dz * fz);
    }
  }
  let impact = 0;
  if (Math.abs(dist) > 1e-6) {
    const ratio = moved / Math.abs(dist);
    if (ratio < 0.999) {
      const kept = speed * ratio * 0.9;
      impact = Math.abs(speed - kept);
      speed = kept;
    }
  }
  return { state: { x, z, heading, speed, steer }, impact };
}
