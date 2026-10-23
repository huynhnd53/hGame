import { type BikeDef, bikeDef, DEFAULT_BIKE } from './bikes';
import { drawClassicGauge } from './classicGauge';

export type CockpitAction = 'horn-down' | 'horn-up' | 'light' | 'signal-left' | 'signal-right' | 'engine';

export interface CockpitView {
  speedKmh: number;
  steer: number;
  leftLamp: boolean;
  rightLamp: boolean;
  headlight: boolean;
  engineOn: boolean;
  odometerKm: number;
}

export class Cockpit {
  readonly root = document.createElement('div');
  private readonly turn = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly img = document.createElement('img');
  private hotspots: HTMLButtonElement[] = [];
  private bike: BikeDef = bikeDef(DEFAULT_BIKE);
  private assetBase: string;
  private scale = 1;
  private vw = 0;
  private vh = 0;
  private lastKey = '';
  onAction: (action: CockpitAction) => void = () => {};

  constructor(assetBase: string) {
    this.assetBase = assetBase;
    this.root.id = 'cockpit';
    this.turn.className = 'cockpit-turn';
    this.img.alt = '';
    this.img.draggable = false;
    this.canvas.className = 'cockpit-gauge';
    this.turn.append(this.img, this.canvas);
    this.root.append(this.turn);
    this.setBike(this.bike.id);
  }

  get bikeId(): string {
    return this.bike.id;
  }

  /** Swaps the whole front end: photo, instrument position and switch hotspots. */
  setBike(id: string): void {
    const b = bikeDef(id);
    this.bike = b;
    this.img.src = `${this.assetBase}${b.image}`;
    this.img.width = b.width;
    this.img.height = b.height;
    for (const el of [this.root, this.turn]) {
      el.style.width = `${b.width}px`;
      el.style.height = `${b.height}px`;
    }
    Object.assign(this.img.style, { width: `${b.width}px`, height: `${b.height}px` });
    Object.assign(this.canvas.style, {
      left: `${b.gauge.x}px`,
      top: `${b.gauge.y}px`,
      width: `${b.gauge.w}px`,
      height: `${b.gauge.h}px`,
    });
    this.turn.style.transformOrigin = `${b.pivot.x}px ${b.pivot.y}px`;

    for (const h of this.hotspots) h.remove();
    this.hotspots = b.hotspots.map((h) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hotspot';
      btn.setAttribute('aria-label', h.label);
      btn.title = h.label;
      Object.assign(btn.style, { left: `${h.x}px`, top: `${h.y}px`, width: `${h.w}px`, height: `${h.h}px` });
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('pressed');
        this.onAction(h.down);
      });
      const release = () => {
        if (!btn.classList.contains('pressed')) return;
        btn.classList.remove('pressed');
        if (h.up) this.onAction(h.up);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
      this.turn.append(btn);
      return btn;
    });
    if (this.vw) this.layout(this.vw, this.vh);
    this.lastKey = '';
  }

  /** Fits the bars to the bottom of the screen: arms always reach past both edges. */
  layout(vw: number, vh: number): void {
    this.vw = vw;
    this.vh = vh;
    const b = this.bike;
    const scale = Math.max(vw / (b.width * (b.fit ?? 0.95)), 0.05);
    // Show the bar, dial and grips; let the lower column fall off-screen on short screens.
    const [lo, hi] = b.visibleBottom;
    const visibleBottom = Math.max(lo, Math.min(hi, b.barTop + (vh * 0.44) / scale));
    const left = (vw - b.width * scale) / 2;
    const top = vh - (visibleBottom - (b.offsetY ?? 0)) * scale;
    this.scale = scale;
    this.root.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(b.gauge.w * scale * dpr));
    const h = Math.max(1, Math.round(b.gauge.h * scale * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.lastKey = '';
    }
  }

  /** Darkens and warms the photo to match the light around the rider (0 = dark, 1 = under a lamp). */
  setLighting(level: number): void {
    const b = Math.max(0.15, Math.min(1, level));
    this.img.style.filter = `brightness(${b.toFixed(2)}) sepia(0.35) saturate(1.15) hue-rotate(-8deg)`;
  }

  /** Screen-space height covered by the bars, so other UI can sit above them. */
  get coveredHeight(): number {
    const rect = this.root.getBoundingClientRect();
    return window.innerHeight - (rect.top + this.bike.barTop * this.scale);
  }

  render(v: CockpitView): void {
    this.turn.style.transform = `rotate(${(v.steer * 7).toFixed(2)}deg)`;
    const key = [
      v.speedKmh.toFixed(1),
      v.leftLamp,
      v.rightLamp,
      v.headlight,
      v.engineOn,
      v.odometerKm.toFixed(1),
      this.canvas.width,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.drawGauge(v);
  }

  private drawGauge(v: CockpitView): void {
    drawClassicGauge(this.canvas, v, { clip: this.bike.gaugeClip, textScale: this.bike.textScale });
  }
}
