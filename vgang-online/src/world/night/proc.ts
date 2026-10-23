import * as THREE from 'three';
import { mulberry32 } from '../../sim/geometry';

/** Tileable 2D value noise with a fixed lattice period. */
export function makeNoise(seed: number) {
  const rand = mulberry32(seed);
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rand();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const lattice = (x: number, y: number, period: number) => {
    const xi = ((x % period) + period) % period;
    const yi = ((y % period) + period) % period;
    return vals[perm[perm[xi & 255] + (yi & 255)]];
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, period: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const a = lattice(x0, y0, period);
    const b = lattice(x0 + 1, y0, period);
    const c = lattice(x0, y0 + 1, period);
    const d = lattice(x0 + 1, y0 + 1, period);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  /** Fractal noise in [0, 1]; u, v in [0, 1) tile seamlessly. */
  const fbm = (u: number, v: number, baseFreq: number, octaves = 5) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = baseFreq;
    for (let o = 0; o < octaves; o++) {
      sum += noise(u * f, v * f, f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
  return { noise, fbm };
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Fills a canvas pixel by pixel; fn returns [r, g, b] or [r, g, b, a] in 0..255. */
export function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fn: (x: number, y: number) => number[],
): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Tangent-space normal map from a height function sampled on a w×h tileable grid. */
export function normalFromHeight(w: number, h: number, height: Float32Array, strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  paint(ctx, w, h, (x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [(-dx / len) * 127.5 + 127.5, (dy / len) * 127.5 + 127.5, (1 / len) * 127.5 + 127.5];
  });
  return c;
}

export function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Soft radial falloff used for glows and light pools. */
export function radialTexture(size: number, stops: [number, string][]): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, true, false);
}
