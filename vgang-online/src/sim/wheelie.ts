/**
 * Wheelies as a pendulum pivoting on the rear tyre's contact patch.
 *
 * Accelerating pushes the front up (the bike's mass resists being pushed forward from below its centre),
 * gravity pulls it down until the centre of mass is right above the rear tyre (the balance point), and past
 * that point gravity keeps pulling the bike over backwards unless the rider closes the throttle or uses the
 * rear brake. The rider can also lean back and snap the throttle (clutch pop) to get the front up at all.
 */

export interface WheelieProfile {
  /** Angle at which the bike balances on its rear wheel, in degrees. */
  balanceDeg: number;
  /** Extra lift (m/s²) from leaning back and snapping the throttle; higher pops up more easily. */
  pop: number;
}

export interface WheelieState {
  /** Front-wheel lift in radians (0 = both wheels down). */
  pitch: number;
  /** Pitch rate, rad/s. */
  rate: number;
  /** Throttle as it actually reaches the rear wheel (the engine responds with a short lag). */
  drive: number;
  /** Metres covered on the back wheel in the current wheelie. */
  distance: number;
}

export interface WheelieInput {
  throttle: number;
  brake: number;
  /** Rider leaning back / popping the clutch. */
  lift: boolean;
  /** Road speed, m/s. */
  speed: number;
}

export interface WheelieEvents {
  /** The front wheel came back down this step; how hard (rad/s) and how far the wheelie went. */
  landed?: { impact: number; distance: number };
  /** Went past the point of no return and flipped over backwards. */
  crashed?: { distance: number };
}

const G = 9.8;
/** Height of the centre of mass above the road (bike plus rider). */
const COM_HEIGHT = 0.55;
/** Effective rotational inertia over mass (m²): bigger is slower and easier to balance. */
const INERTIA = 2.4;
/** The rider's body soaks up some of the swing. */
const DAMPING = 3;
const ENGINE_ACCEL = 3.4;
/** Deceleration from the rear brake alone (the front is in the air). */
const REAR_BRAKE = 9;
/** Beyond the balance point by this much, the rider cannot save it any more. */
const LOOP_MARGIN = 0.42;
/** Lift below this counts as both wheels down (for the distance count). */
const UP = 0.06;

export const newWheelie = (): WheelieState => ({ pitch: 0, rate: 0, drive: 0, distance: 0 });

export function balanceAngle(p: WheelieProfile): number {
  return (p.balanceDeg * Math.PI) / 180;
}

export function loopAngle(p: WheelieProfile): number {
  return balanceAngle(p) + LOOP_MARGIN;
}

/** Engine pull fades with speed (the same curve as the scooter's acceleration)... */
const powerAt = (speed: number) => 1 / (1 + Math.max(0, speed) / 30);
/** ...and a clutch pop or throttle snap only really works when riding slowly. */
const popAt = (speed: number) => 1 / (1 + (Math.max(0, speed) / 5) ** 2);

export function stepWheelie(s: WheelieState, input: WheelieInput, p: WheelieProfile, dt: number): WheelieEvents {
  const events: WheelieEvents = {};
  s.drive += (input.throttle - s.drive) * (1 - Math.exp(-dt * 6));
  const power = powerAt(input.speed);
  const moving = input.speed > 0.3;
  const accel = s.drive * ENGINE_ACCEL * power - (moving ? input.brake * REAR_BRAKE : 0);
  // Leaning back helps most to get the front off the ground and fades out towards the balance point.
  const pull = input.lift ? p.pop * s.drive * popAt(input.speed) * Math.max(0, 1 - s.pitch / balanceAngle(p)) : 0;
  const h = COM_HEIGHT;
  const b = h * Math.tan(balanceAngle(p));
  const th = s.pitch;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const alpha = ((accel + pull) * (h * cos + b * sin) - G * (b * cos - h * sin)) / INERTIA - DAMPING * s.rate;
  // The road holds the front wheel up, but not down.
  if (th <= 0 && alpha <= 0 && s.rate <= 0) {
    s.pitch = 0;
    s.rate = 0;
    s.distance = 0;
    return events;
  }
  s.rate += alpha * dt;
  s.pitch += s.rate * dt;
  if (s.pitch > UP) s.distance += Math.max(0, input.speed) * dt;
  if (s.pitch <= 0) {
    if (s.distance > 0 || s.rate < -0.8) events.landed = { impact: -s.rate, distance: s.distance };
    s.pitch = 0;
    s.rate = 0;
    s.distance = 0;
  } else if (s.pitch > loopAngle(p)) {
    events.crashed = { distance: s.distance };
  }
  return events;
}

/** Whether the bike is up on its back wheel (for steering, effects and the HUD). */
export const isWheelie = (s: WheelieState) => s.pitch > UP;
