export type Action =
  | 'horn-down'
  | 'horn-up'
  | 'signal-left'
  | 'signal-right'
  | 'light'
  | 'engine'
  | 'mute'
  | 'view';

const JOYSTICK_RADIUS = 60;
const LOOK_SENSITIVITY = 0.005;

/** Keyboard, mouse-drag look, and a touch joystick (x steers, up = throttle, down = brake). */
export class Input {
  private keys = new Set<string>();
  private actions: Action[] = [];
  private stick = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  /** Head turn while dragging; springs back to centre when released. */
  look = { yaw: 0, pitch: 0 };
  touchMode: boolean;
  /** The on-screen wheelie button is held. */
  liftButton = false;
  onFirstInput: () => void = () => {};
  onTouchModeChange: (touch: boolean) => void = () => {};

  constructor(
    surface: HTMLElement,
    private joystickBase: HTMLElement,
    private joystickKnob: HTMLElement,
  ) {
    this.touchMode = window.matchMedia('(pointer: coarse)').matches;
    window.addEventListener('keydown', (e) => {
      this.onFirstInput();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyH') this.push('horn-down');
      else if (e.code === 'KeyQ') this.push('signal-left');
      else if (e.code === 'KeyE') this.push('signal-right');
      else if (e.code === 'KeyL') this.push('light');
      else if (e.code === 'KeyK' || e.code === 'Enter') this.push('engine');
      else if (e.code === 'KeyM') this.push('mute');
      else if (e.code === 'KeyV' || e.code === 'KeyC') this.push('view');
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyH') this.push('horn-up');
    });
    window.addEventListener('blur', () => this.reset());

    surface.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  private setTouchMode(touch: boolean) {
    if (this.touchMode === touch) return;
    this.touchMode = touch;
    this.onTouchModeChange(touch);
  }

  private onDown(e: PointerEvent) {
    this.onFirstInput();
    this.setTouchMode(e.pointerType === 'touch');
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45 && this.stickPointer === null) {
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick = { x: 0, y: 0 };
      this.joystickBase.style.left = `${e.clientX}px`;
      this.joystickBase.style.top = `${e.clientY}px`;
      this.joystickBase.classList.add('active');
      this.joystickKnob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    if (this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId === this.stickPointer) {
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) {
        dx = (dx / len) * JOYSTICK_RADIUS;
        dy = (dy / len) * JOYSTICK_RADIUS;
      }
      this.stick = { x: dx / JOYSTICK_RADIUS, y: -dy / JOYSTICK_RADIUS };
      this.joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === this.lookPointer) {
      this.look.yaw = Math.max(-1.3, Math.min(1.3, this.look.yaw - (e.clientX - this.lookLast.x) * LOOK_SENSITIVITY));
      this.look.pitch = Math.max(-0.45, Math.min(0.35, this.look.pitch - (e.clientY - this.lookLast.y) * LOOK_SENSITIVITY));
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.stick = { x: 0, y: 0 };
      this.joystickBase.classList.remove('active');
    } else if (e.pointerId === this.lookPointer) {
      this.lookPointer = null;
    }
  }

  get looking(): boolean {
    return this.lookPointer !== null;
  }

  push(action: Action): void {
    this.actions.push(action);
  }

  consumeActions(): Action[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  controls(): { throttle: number; brake: number; steer: number; lift: boolean } {
    const k = this.keys;
    const kThrottle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kBrake = k.has('KeyS') || k.has('ArrowDown') || k.has('Space') ? 1 : 0;
    const kSteer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sy = this.stick.y;
    const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    return {
      throttle: Math.max(kThrottle, dead(Math.max(0, sy))),
      brake: Math.max(kBrake, dead(Math.max(0, -sy))),
      steer: Math.max(-1, Math.min(1, kSteer + dead(this.stick.x))),
      // Lean back and snap the throttle: Shift or B, or the touch button.
      lift: this.liftButton || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyB'),
    };
  }

  /** Eases the head back to centre when nobody is dragging. */
  relaxLook(dt: number): void {
    if (this.looking) return;
    const k = Math.min(1, dt * 3);
    this.look.yaw -= this.look.yaw * k;
    this.look.pitch -= this.look.pitch * k;
  }

  reset(): void {
    this.keys.clear();
    this.liftButton = false;
    if (this.actions.length === 0 || this.actions[this.actions.length - 1] !== 'horn-up') this.push('horn-up');
    this.stick = { x: 0, y: 0 };
    this.stickPointer = null;
    this.lookPointer = null;
    this.joystickBase.classList.remove('active');
  }
}
