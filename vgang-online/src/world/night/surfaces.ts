import * as THREE from 'three';
import { mulberry32 } from '../../sim/geometry';
import { canvas, makeNoise, normalFromHeight, paint, toTexture } from './proc';

const clamp255 = (v: number) => Math.max(0, Math.min(255, v));

export interface SurfaceSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

/** Asphalt tile (≈6 m): fine aggregate albedo and bumps. */
export function asphalt(size = 512): SurfaceSet {
  const { fbm, noise } = makeNoise(11);
  const rand = mulberry32(5);
  const height = new Float32Array(size * size);
  const albedo = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const fine = fbm(u, v, 96, 3);
      const mid = fbm(u, v, 12, 4);
      const i = y * size + x;
      height[i] = fine * 0.7 + noise(u * 256, v * 256, 256) * 0.3;
      albedo[i] = 0.85 + (mid - 0.5) * 0.35 + (fine - 0.5) * 0.4;
    }
  }
  // Light grey aggregate stones.
  for (let k = 0; k < size * size * 0.012; k++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const i = y * size + x;
    albedo[i] += 0.35 + rand() * 0.4;
    height[i] += 0.5;
  }
  const [c, ctx] = canvas(size, size);
  paint(ctx, size, size, (x, y) => {
    const a = albedo[y * size + x];
    return [clamp255(56 * a), clamp255(54 * a), clamp255(53 * a)];
  });
  return {
    map: toTexture(c, true),
    normalMap: toTexture(normalFromHeight(size, size, height, 2.2), false),
  };
}

/** Large-scale wet/dry patches for road roughness (sampled on a coarse UV set). */
export function wetness(size = 256): THREE.Texture {
  const { fbm } = makeNoise(23);
  const [c, ctx] = canvas(size, size);
  paint(ctx, size, size, (x, y) => {
    const n = fbm(x / size, y / size, 3, 5);
    const wet = Math.max(0, Math.min(1, (n - 0.36) * 2.6));
    const r = 0.72 - wet * 0.52;
    return [0, clamp255(r * 255), 0];
  });
  return toTexture(c, false);
}

/** Terracotta sidewalk tiles (texture covers 2 m × 2 m, 5 × 5 tiles). */
export function sidewalkTiles(size = 512): SurfaceSet {
  const { fbm } = makeNoise(31);
  const rand = mulberry32(9);
  const tiles = 5;
  const cell = size / tiles;
  const tint: number[][] = [];
  for (let k = 0; k < tiles * tiles; k++) {
    const t = 0.82 + rand() * 0.3;
    tint.push([128 * t, 84 * t * (0.92 + rand() * 0.12), 62 * t]);
  }
  const height = new Float32Array(size * size);
  const [c, ctx] = canvas(size, size);
  paint(ctx, size, size, (x, y) => {
    const tx = Math.floor(x / cell);
    const ty = Math.floor(y / cell);
    const gx = Math.min(x % cell, cell - (x % cell));
    const gy = Math.min(y % cell, cell - (y % cell));
    const grout = Math.min(gx, gy) < 2.2;
    const n = fbm(x / size, y / size, 16, 5);
    const dirt = 0.72 + n * 0.5;
    height[y * size + x] = grout ? 0 : 0.6 + n * 0.3;
    if (grout) return [52 * dirt, 42 * dirt, 34 * dirt];
    const t = tint[ty * tiles + tx];
    return [clamp255(t[0] * dirt), clamp255(t[1] * dirt), clamp255(t[2] * dirt)];
  });
  return { map: toTexture(c, true), normalMap: toTexture(normalFromHeight(size, size, height, 3), false) };
}

/** Grey curb stones with joints every metre (texture spans 2 m). */
export function curbStone(): SurfaceSet {
  const w = 256;
  const h = 64;
  const { fbm } = makeNoise(41);
  const height = new Float32Array(w * h);
  const [c, ctx] = canvas(w, h);
  paint(ctx, w, h, (x, y) => {
    const joint = x % 128 < 3;
    const n = fbm(x / w, y / h, 8, 5);
    const v = joint ? 60 : 150 + (n - 0.5) * 70;
    height[y * w + x] = joint ? 0 : 0.5 + n * 0.4;
    return [v * 1.02, v, v * 0.94];
  });
  return { map: toTexture(c, true), normalMap: toTexture(normalFromHeight(w, h, height, 2), false) };
}

export function concrete(): THREE.Texture {
  const size = 256;
  const { fbm } = makeNoise(51);
  const [c, ctx] = canvas(size, size);
  paint(ctx, size, size, (x, y) => {
    const v = 70 + fbm(x / size, y / size, 8, 5) * 60;
    return [v, v * 0.97, v * 0.93];
  });
  return toTexture(c, true);
}

/** Bark: vertical fissures. */
export function bark(): THREE.Texture {
  const w = 128;
  const h = 256;
  const { fbm } = makeNoise(61);
  const [c, ctx] = canvas(w, h);
  paint(ctx, w, h, (x, y) => {
    const n = fbm(x / w, (y / h) * 0.25, 16, 4);
    const v = 45 + n * 70;
    return [v * 1.05, v * 0.92, v * 0.78];
  });
  return toTexture(c, true);
}

/** Leaf cluster card with alpha: many small leaves of varied greens. */
export function leaves(): THREE.Texture {
  const size = 512;
  const rand = mulberry32(71);
  const [c, ctx] = canvas(size, size);
  ctx.clearRect(0, 0, size, size);
  for (let k = 0; k < 1400; k++) {
    // Denser towards the middle so the card edge breaks up naturally.
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * size * 0.47;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const len = 9 + rand() * 12;
    const g = 70 + rand() * 70;
    ctx.fillStyle = `rgb(${Math.floor(g * 0.55)},${Math.floor(g)},${Math.floor(g * 0.3)})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, len, len * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // A few twigs.
  ctx.strokeStyle = 'rgba(60,45,30,0.9)';
  ctx.lineWidth = 2;
  for (let k = 0; k < 14; k++) {
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    const a = rand() * Math.PI * 2;
    ctx.lineTo(size / 2 + Math.cos(a) * size * 0.4, size / 2 + Math.sin(a) * size * 0.4);
    ctx.stroke();
  }
  const t = toTexture(c, true, false);
  return t;
}

/** Overhead wire / railing style texture with alpha: wrought-iron balcony railing. */
export function railing(): THREE.Texture {
  const w = 256;
  const h = 64;
  const [c, ctx] = canvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 4, w - 4, h - 6);
  ctx.lineWidth = 2.5;
  for (let x = 10; x < w; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, h - 4);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (let x = 16; x < w; x += 48) {
    ctx.beginPath();
    ctx.arc(x + 8, h / 2, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  return toTexture(c, true, true);
}

/** Striped canvas awnings, four variants stacked vertically. */
export function awnings(): THREE.Texture {
  const w = 256;
  const h = 256;
  const { fbm } = makeNoise(81);
  const palettes = [
    ['#2f5f8f', '#d9d6cc'],
    ['#3d6b4a', '#d6d1c2'],
    ['#8a3a2e', '#d8cfbf'],
    ['#4b5f78', '#4b5f78'],
  ];
  const [c, ctx] = canvas(w, h);
  palettes.forEach(([a, b], row) => {
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = (x / 16) % 2 === 0 ? a : b;
      ctx.fillRect(x, row * 64, 16, 64);
    }
  });
  // Grime and sun-fade.
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = 0.7 + fbm(x / w, y / h, 8, 4) * 0.45 - ((y % 64) / 64) * 0.15;
      img.data[i] *= n;
      img.data[i + 1] *= n;
      img.data[i + 2] *= n;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, true, false);
}
