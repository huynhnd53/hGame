/**
 * The red scooter's speedometer: dark face, white ticks, red needle, odometer and warning lamps.
 * Designed in a 480 × 220 space and fitted into any instrument shape on a bike photo.
 */
export const GAUGE_W = 480;
export const GAUGE_H = 220;

export interface GaugeView {
  speedKmh: number;
  leftLamp: boolean;
  rightLamp: boolean;
  headlight: boolean;
  engineOn: boolean;
  odometerKm: number;
}

/**
 * Outline the face is clipped to: the oval dial glass, a rounded rectangle (LCD screens), or a polygon
 * given in 0..1 coordinates of the instrument rectangle (e.g. a trapezoid screen).
 */
export type GaugeClip = 'ellipse' | 'rect' | [number, number][];

export interface GaugeOptions {
  clip: GaugeClip;
  /** Enlarges numbers, lamps and odometer on small screens so they stay readable. */
  textScale?: number;
}

const MAX = 200;
const SWEEP = (96 * Math.PI) / 180;

export function drawClassicGauge(canvas: HTMLCanvasElement, v: GaugeView, opts: GaugeOptions): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Clip to the instrument outline so the bezel from the photo stays visible.
  ctx.save();
  ctx.beginPath();
  // The oval sits just inside the instrument rectangle, matching the red scooter's dial glass.
  if (opts.clip === 'ellipse') ctx.ellipse(W * 0.5, H * (108 / 220), W * (222 / 480), H * (95 / 220), 0, 0, Math.PI * 2);
  else if (opts.clip === 'rect') ctx.roundRect(0, 0, W, H, Math.min(W, H) * 0.12);
  else {
    opts.clip.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    ctx.closePath();
  }
  ctx.clip();
  // Fit the 480 × 220 design without distortion, centred in the instrument.
  const k = Math.min(W / GAUGE_W, H / GAUGE_H);
  ctx.translate((W - GAUGE_W * k) / 2, (H - GAUGE_H * k) / 2);
  ctx.scale(k, k);
  const bg = ctx.createRadialGradient(238, 150, 20, 238, 130, 240);
  bg.addColorStop(0, '#20262b');
  bg.addColorStop(1, '#0c0f11');
  ctx.fillStyle = bg;
  ctx.fillRect(-GAUGE_W, -GAUGE_H, GAUGE_W * 3, GAUGE_H * 3);
  const ts = opts.textScale ?? 1;

  const cx = 238;
  const cy = 158;
  const R = 98;
  const angleFor = (kmh: number) => -SWEEP + (kmh / MAX) * SWEEP * 2;
  const polar = (a: number, r: number) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r] as const;

  // Outer ring.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2 * Math.sqrt(ts);
  ctx.beginPath();
  ctx.arc(cx, cy, R + 4, -Math.PI / 2 - SWEEP, -Math.PI / 2 + SWEEP);
  ctx.stroke();

  // Ticks and numbers.
  ctx.fillStyle = '#f4f4f4';
  ctx.font = `bold ${Math.round(17 * ts)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Small instruments get fewer, larger numbers so they do not run together.
  const labelStep = ts > 1.2 ? 60 : 40;
  for (let s = 0; s <= MAX; s += 10) {
    const a = angleFor(s);
    const major = s % 20 === 0;
    const [x0, y0] = polar(a, R);
    const [x1, y1] = polar(a, R - (major ? 13 : 7) * Math.sqrt(ts));
    ctx.strokeStyle = s >= 160 ? '#ff5a4f' : '#f4f4f4';
    ctx.lineWidth = (major ? 3 : 1.5) * Math.sqrt(ts);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (s % labelStep === 0) {
      const [tx, ty] = polar(a, R - 30 - (ts - 1) * 12);
      ctx.fillText(String(s), tx, ty);
    }
  }
  if (ts <= 1.2) {
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('km/h', cx, cy - 34);
  }

  // Odometer.
  const ow = 72 * Math.min(ts, 1.5);
  const oh = 15 * Math.min(ts, 1.5);
  ctx.fillStyle = '#9fb59a';
  ctx.fillRect(cx - ow / 2, cy + 19, ow, oh);
  ctx.fillStyle = '#1f2a1d';
  ctx.font = `bold ${Math.round(11 * Math.min(ts, 1.5))}px ui-monospace, monospace`;
  ctx.fillText(`${v.odometerKm.toFixed(1).padStart(6, '0')} km`, cx, cy + 19 + oh / 2 + 0.5);

  // Needle.
  const a = angleFor(Math.min(MAX, Math.max(0, v.speedKmh)));
  const [nx, ny] = polar(a, R - 6);
  const [tx, ty] = polar(a + Math.PI, 14);
  ctx.strokeStyle = '#ef3b2d';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4 * Math.sqrt(ts);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(nx, ny);
  ctx.stroke();
  ctx.fillStyle = '#d2271c';
  ctx.beginPath();
  ctx.arc(cx, cy, 11 * Math.sqrt(ts), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(cx, cy, 4 * Math.sqrt(ts), 0, Math.PI * 2);
  ctx.fill();

  // Warning lamps.
  const ls = Math.min(ts, 1.6);
  const arrow = (x: number, dir: -1 | 1, lit: boolean) => {
    ctx.save();
    ctx.translate(x, 92);
    ctx.scale(ls, ls);
    ctx.fillStyle = lit ? '#3ee86f' : '#1f3526';
    ctx.beginPath();
    ctx.moveTo(dir * 14, 0);
    ctx.lineTo(-dir * 2, -12);
    ctx.lineTo(-dir * 2, -6);
    ctx.lineTo(-dir * 14, -6);
    ctx.lineTo(-dir * 14, 6);
    ctx.lineTo(-dir * 2, 6);
    ctx.lineTo(-dir * 2, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  arrow(82, -1, v.leftLamp);
  arrow(398, 1, v.rightLamp);
  ctx.fillStyle = v.headlight ? '#3d8bff' : '#1a2840';
  ctx.beginPath();
  ctx.arc(370, 140, 7 * ls, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = v.engineOn ? '#3ee86f' : '#ffa531';
  ctx.beginPath();
  ctx.arc(108, 140, 7 * ls, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Glass reflection over the whole instrument.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const gloss = ctx.createLinearGradient(0, 0, 0, H);
  gloss.addColorStop(0, 'rgba(255,255,255,0.14)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
