import * as THREE from 'three';
import { mulberry32 } from '../../sim/geometry';
import { canvas, makeNoise, toTexture } from './proc';

/** Atlas layout: 8 columns × 3 rows of square cells. */
export const CELL = 256;
export const COLS = 8;
export const ROWS = 3;
export const ROW_GROUND = 0;
export const ROW_UPPER = 1;
export const ROW_PLAIN = 2;
export const PLAIN_PARAPET = 4;
export const PLAIN_ROOF = 5;

export interface FacadeAtlas {
  map: THREE.Texture;
  emissiveMap: THREE.Texture;
  /** UV rectangle [u0, v0, u1, v1] of a cell, inset slightly to avoid bleeding. */
  uv(col: number, row: number): [number, number, number, number];
}

type Ctx = CanvasRenderingContext2D;

const GUTTER = 24;
const PITCH = CELL + GUTTER * 2;

/**
 * Re-packs the atlas with a gutter around each cell. Albedo gutters repeat the cell edge; emissive gutters stay
 * black so samples that stray past a quad edge (grazing angles, MSAA edge pixels) never pick up a lit neighbour.
 */
function withGutters(src: HTMLCanvasElement, w: number, h: number, extend: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  const G = GUTTER;
  for (let r = 0; r < ROWS; r++) {
    for (let k = 0; k < COLS; k++) {
      const sx = k * CELL;
      const sy = r * CELL;
      const dx = k * PITCH + G;
      const dy = r * PITCH + G;
      ctx.drawImage(src, sx, sy, CELL, CELL, dx, dy, CELL, CELL);
      if (!extend) continue;
      // Edges stretched outwards, then corners.
      ctx.drawImage(src, sx, sy, CELL, 1, dx, dy - G, CELL, G);
      ctx.drawImage(src, sx, sy + CELL - 1, CELL, 1, dx, dy + CELL, CELL, G);
      ctx.drawImage(src, sx, sy, 1, CELL, dx - G, dy, G, CELL);
      ctx.drawImage(src, sx + CELL - 1, sy, 1, CELL, dx + CELL, dy, G, CELL);
      ctx.drawImage(src, sx, sy, 1, 1, dx - G, dy - G, G, G);
      ctx.drawImage(src, sx + CELL - 1, sy, 1, 1, dx + CELL, dy - G, G, G);
      ctx.drawImage(src, sx, sy + CELL - 1, 1, 1, dx - G, dy + CELL, G, G);
      ctx.drawImage(src, sx + CELL - 1, sy + CELL - 1, 1, 1, dx + CELL, dy + CELL, G, G);
    }
  }
  return c;
}

function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

/** Weathered stucco with mottling, rain streaks and grime at the base. Drawn near-white to be tinted per house. */
function stucco(ctx: Ctx, x0: number, y0: number, seed: number, ledge = true): void {
  const { fbm } = makeNoise(seed);
  const rand = mulberry32(seed * 7 + 3);
  const img = ctx.getImageData(x0, y0, CELL, CELL);
  const d = img.data;
  const streakCols: number[] = [];
  for (let k = 0; k < 9; k++) streakCols.push(rand() * CELL);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const u = x / CELL;
      const v = y / CELL;
      let m = 0.78 + fbm(u, v, 6, 5) * 0.32;
      // Rain streaks: dark vertical smears fading downwards from the ledge.
      for (const sc of streakCols) {
        const dist = Math.abs(x - sc);
        if (dist < 6) m -= (1 - dist / 6) * 0.13 * (1 - v * 0.6) * (0.5 + fbm(u * 3, 0.3, 4, 2));
      }
      // Grime near the bottom.
      m -= Math.max(0, v - 0.75) * 0.5 * fbm(u, v, 16, 3);
      // Fine plaster grain.
      m += (fbm(u, v, 64, 2) - 0.5) * 0.08;
      const i = (y * CELL + x) * 4;
      d[i] = 236 * m;
      d[i + 1] = 230 * m;
      d[i + 2] = 218 * m;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
  if (ledge) {
    // Floor slab edge at the top with a soft shadow below it.
    ctx.fillStyle = rgb(205, 198, 186);
    ctx.fillRect(x0, y0, CELL, 12);
    const g = ctx.createLinearGradient(0, y0 + 12, 0, y0 + 30);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0 + 12, CELL, 18);
  }
}

function recess(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = rgb(120, 112, 100);
  ctx.fillRect(x - 6, y + h + 2, w + 12, 6);
}

function rollerShutter(ctx: Ctx, x: number, y: number, w: number, h: number, tone: [number, number, number], rand: () => number) {
  for (let yy = 0; yy < h; yy += 5) {
    const k = 0.8 + rand() * 0.12 + (yy % 10 === 0 ? 0.08 : 0);
    ctx.fillStyle = rgb(tone[0] * k, tone[1] * k, tone[2] * k);
    ctx.fillRect(x, y + yy, w, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y + yy + 4, w, 1);
  }
  // Rust and dirt.
  for (let k = 0; k < 40; k++) {
    ctx.fillStyle = `rgba(90,55,30,${0.05 + rand() * 0.12})`;
    ctx.fillRect(x + rand() * w, y + h * (0.5 + rand() * 0.5), 2 + rand() * 10, 1 + rand() * 6);
  }
  // Housing box and side rails.
  ctx.fillStyle = rgb(tone[0] * 0.7, tone[1] * 0.7, tone[2] * 0.7);
  ctx.fillRect(x - 3, y - 12, w + 6, 12);
  ctx.fillStyle = 'rgba(30,30,30,0.8)';
  ctx.fillRect(x - 4, y, 4, h);
  ctx.fillRect(x + w, y, 4, h);
  ctx.fillStyle = 'rgba(40,40,40,0.9)';
  ctx.fillRect(x + w / 2 - 8, y + h - 10, 16, 4);
}

function shopInterior(ctx: Ctx, x: number, y: number, w: number, h: number, kind: 'grocery' | 'pharmacy' | 'cafe', rand: () => number) {
  const back = kind === 'pharmacy' ? [235, 245, 240] : kind === 'cafe' ? [240, 200, 140] : [232, 238, 240];
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgb(back[0], back[1], back[2]));
  g.addColorStop(1, rgb(back[0] * 0.75, back[1] * 0.75, back[2] * 0.7));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (kind === 'cafe') {
    // Tables, stools and a counter in warm light.
    ctx.fillStyle = rgb(120, 70, 35);
    ctx.fillRect(x + 10, y + h - 50, w - 20, 12);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = rgb(90, 50, 25);
      ctx.fillRect(x + 20 + k * 50, y + h - 30, 22, 30);
    }
    ctx.fillStyle = rgb(255, 230, 170);
    for (let k = 0; k < 3; k++) ctx.fillRect(x + 30 + k * 70, y + 10, 18, 8);
  } else {
    // Shelves packed with goods.
    for (let s = 0; s < 4; s++) {
      const sy = y + 22 + s * ((h - 40) / 4);
      ctx.fillStyle = rgb(150, 150, 150);
      ctx.fillRect(x + 6, sy + 26, w - 12, 3);
      for (let px = x + 8; px < x + w - 10; ) {
        const pw = 5 + rand() * 9;
        const ph = 12 + rand() * 13;
        const hue = rand();
        const col =
          kind === 'pharmacy'
            ? [210 + rand() * 40, 220 + rand() * 30, 230]
            : [120 + hue * 130, 80 + rand() * 150, 60 + rand() * 140];
        ctx.fillStyle = rgb(col[0], col[1], col[2]);
        ctx.fillRect(px, sy + 26 - ph, pw, ph);
        px += pw + 1;
      }
    }
    // Fluorescent tube.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 20, y + 6, w - 40, 5);
  }
}

function windowGlass(ctx: Ctx, x: number, y: number, w: number, h: number, lit: 'warm' | 'cool' | null) {
  if (lit) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (lit === 'warm') {
      g.addColorStop(0, rgb(255, 196, 120));
      g.addColorStop(1, rgb(200, 120, 60));
    } else {
      g.addColorStop(0, rgb(190, 215, 255));
      g.addColorStop(1, rgb(110, 140, 190));
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // Curtain folds.
    for (let k = 0; k < w; k += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x + k, y, 3, h);
    }
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, rgb(40, 48, 58));
    g.addColorStop(0.5, rgb(18, 22, 28));
    g.addColorStop(1, rgb(30, 34, 40));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  // Frame mullions.
  ctx.fillStyle = 'rgba(70,60,50,0.9)';
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  ctx.fillRect(x, y + h * 0.35, w, 3);
}

function bars(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(25,25,25,0.95)';
  for (let k = 6; k < w; k += 11) ctx.fillRect(x + k, y, 2.5, h);
  ctx.fillRect(x, y + h * 0.5, w, 2.5);
}

function louvres(ctx: Ctx, x: number, y: number, w: number, h: number, col: [number, number, number]) {
  ctx.fillStyle = rgb(col[0], col[1], col[2]);
  ctx.fillRect(x, y, w, h);
  for (let k = 4; k < h; k += 7) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 3, y + k, w - 6, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 3, y + k + 2, w - 6, 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
}

/**
 * Draws the facade atlas. With `photoBase`, the folding gate, the house door and the plain and lit windows are
 * swapped for the photo props once they have loaded (the drawn versions show until then).
 */
export function buildFacadeAtlas(photoBase?: string): FacadeAtlas {
  const W = CELL * COLS;
  const H = CELL * ROWS;
  const [albedo, a] = canvas(W, H);
  const [emissive, e] = canvas(W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const rand = mulberry32(1234);

  const cell = (col: number, row: number) => [col * CELL, row * CELL] as const;

  // Row 0: ground floors. Opening spans most of the cell.
  for (let k = 0; k < COLS; k++) {
    const [x0, y0] = cell(k, ROW_GROUND);
    stucco(a, x0, y0, 100 + k);
    const ox = x0 + 18;
    const oy = y0 + 40;
    const ow = CELL - 36;
    const oh = CELL - 40;
    recess(a, ox, oy, ow, oh);
    switch (k) {
      case 0:
        rollerShutter(a, ox, oy, ow, oh, [150, 146, 136], rand);
        break;
      case 1:
        rollerShutter(a, ox, oy, ow, oh, [110, 125, 140], rand);
        break;
      case 2: {
        // Folding steel gate over a dark interior.
        a.fillStyle = rgb(16, 14, 12);
        a.fillRect(ox, oy, ow, oh);
        a.strokeStyle = rgb(95, 100, 105);
        a.lineWidth = 2;
        for (let gx = 0; gx < ow; gx += 18) {
          a.beginPath();
          for (let gy = 0; gy <= oh; gy += 18) {
            a.lineTo(ox + gx + ((gy / 18) % 2 === 0 ? 0 : 9), oy + gy);
          }
          a.stroke();
          a.fillStyle = rgb(120, 125, 130);
          a.fillRect(ox + gx, oy, 3, oh);
        }
        break;
      }
      case 3:
      case 4:
      case 5: {
        const kind = k === 3 ? 'grocery' : k === 4 ? 'pharmacy' : 'cafe';
        shopInterior(a, ox, oy, ow, oh, kind, mulberry32(k * 31));
        shopInterior(e, ox, oy, ow, oh, kind, mulberry32(k * 31));
        // Glass door frame.
        for (const c of [a, e]) {
          c.fillStyle = 'rgba(40,40,40,0.9)';
          c.fillRect(ox + ow / 2 - 2, oy, 4, oh);
          c.fillRect(ox, oy, 4, oh);
          c.fillRect(ox + ow - 4, oy, 4, oh);
        }
        if (k === 4) {
          // Green cross sign beside the door.
          for (const c of [a, e]) {
            c.fillStyle = '#19c26b';
            c.fillRect(x0 + CELL - 30, y0 + 50, 18, 6);
            c.fillRect(x0 + CELL - 24, y0 + 44, 6, 18);
          }
        }
        break;
      }
      case 6: {
        // House door with a wall lamp; the lamp also spills light onto the wall (emissive).
        a.fillStyle = rgb(70, 50, 36);
        a.fillRect(ox + 40, oy + 20, ow - 80, oh - 20);
        a.fillStyle = 'rgba(0,0,0,0.3)';
        a.fillRect(ox + ow / 2 - 1, oy + 20, 2, oh - 20);
        for (let p = 0; p < 2; p++) {
          a.strokeStyle = 'rgba(0,0,0,0.25)';
          a.strokeRect(ox + 52 + p * ((ow - 80) / 2), oy + 34, (ow - 80) / 2 - 24, oh - 60);
        }
        rollerShutter(a, ox, oy, 34, oh, [120, 118, 112], rand);
        rollerShutter(a, ox + ow - 34, oy, 34, oh, [120, 118, 112], rand);
        const lx = x0 + CELL / 2;
        const ly = y0 + 26;
        const spill = e.createRadialGradient(lx, ly, 2, lx, ly + 40, 120);
        spill.addColorStop(0, 'rgba(255,190,110,0.9)');
        spill.addColorStop(0.35, 'rgba(160,100,50,0.35)');
        spill.addColorStop(1, 'rgba(0,0,0,0)');
        e.fillStyle = spill;
        e.fillRect(x0, y0, CELL, CELL);
        for (const c of [a, e]) {
          c.fillStyle = '#ffe2b0';
          c.fillRect(lx - 7, ly - 4, 14, 9);
        }
        break;
      }
      case 7: {
        // Shutter mostly down with light escaping from the open bottom.
        const open = oh * 0.32;
        shopInterior(a, ox, oy + oh - open, ow, open, 'grocery', mulberry32(77));
        shopInterior(e, ox, oy + oh - open, ow, open, 'grocery', mulberry32(77));
        rollerShutter(a, ox, oy, ow, oh - open, [140, 136, 128], rand);
        break;
      }
    }
  }

  // Row 1: upper floors.
  for (let k = 0; k < COLS; k++) {
    const [x0, y0] = cell(k, ROW_UPPER);
    stucco(a, x0, y0, 200 + k);
    const windowPair = (draw: (x: number, y: number, w: number, h: number) => void) => {
      for (const wx of [x0 + 34, x0 + 140]) {
        recess(a, wx, y0 + 62, 82, 128);
        draw(wx, y0 + 62, 82, 128);
      }
    };
    switch (k) {
      case 0:
        windowPair((x, y, w, h) => louvres(a, x, y, w, h, [70, 120, 95]));
        break;
      case 1:
        windowPair((x, y, w, h) => louvres(a, x, y, w, h, [120, 82, 55]));
        break;
      case 2:
        windowPair((x, y, w, h) => {
          windowGlass(a, x, y, w, h, null);
          bars(a, x, y, w, h);
        });
        break;
      case 3:
        windowPair((x, y, w, h) => {
          windowGlass(a, x, y, w, h, 'warm');
          windowGlass(e, x, y, w, h, 'warm');
          bars(a, x, y, w, h);
          bars(e, x, y, w, h);
        });
        break;
      case 4:
      case 5: {
        // Tall balcony door.
        const dx = x0 + 60;
        const dy = y0 + 40;
        const dw = CELL - 120;
        const dh = CELL - 40;
        recess(a, dx, dy, dw, dh);
        windowGlass(a, dx, dy, dw, dh, k === 5 ? 'warm' : null);
        if (k === 5) windowGlass(e, dx, dy, dw, dh, 'warm');
        louvres(a, dx - 34, dy, 30, dh, [70, 110, 90]);
        louvres(a, dx + dw + 4, dy, 30, dh, [70, 110, 90]);
        break;
      }
      case 6:
        windowPair((x, y, w, h) => {
          windowGlass(a, x, y, w, h, 'cool');
          windowGlass(e, x, y, w, h, 'cool');
        });
        break;
      case 7:
        for (const wx of [x0 + 50, x0 + 160]) {
          recess(a, wx, y0 + 80, 46, 46);
          windowGlass(a, wx, y0 + 80, 46, 46, null);
          bars(a, wx, y0 + 80, 46, 46);
        }
        break;
    }
  }

  // Row 2: plain walls, parapet band, roof.
  for (let k = 0; k < 4; k++) {
    const [x0, y0] = cell(k, ROW_PLAIN);
    stucco(a, x0, y0, 300 + k, false);
  }
  {
    const [x0, y0] = cell(PLAIN_PARAPET, ROW_PLAIN);
    stucco(a, x0, y0, 310, false);
    a.fillStyle = 'rgba(0,0,0,0.25)';
    a.fillRect(x0, y0 + CELL - 30, CELL, 30);
    a.fillStyle = rgb(210, 204, 192);
    a.fillRect(x0, y0, CELL, 20);
  }
  {
    const [x0, y0] = cell(PLAIN_ROOF, ROW_PLAIN);
    const { fbm } = makeNoise(320);
    const img = a.getImageData(x0, y0, CELL, CELL);
    for (let i = 0; i < CELL * CELL; i++) {
      const v = 70 + fbm((i % CELL) / CELL, Math.floor(i / CELL) / CELL, 8, 4) * 50;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v * 0.96;
      img.data[i * 4 + 2] = v * 0.9;
      img.data[i * 4 + 3] = 255;
    }
    a.putImageData(img, x0, y0);
  }

  // Re-pack with gutters that repeat each cell's edge, so mipmapped and grazing-angle samples
  // never pick up a neighbouring cell (lit shop interiors used to bleed onto the floor above).
  const PW = COLS * PITCH;
  const PH = ROWS * PITCH;
  const map = toTexture(withGutters(albedo, PW, PH, true), true, false);
  const emissiveMap = toTexture(withGutters(emissive, PW, PH, false), true, false);
  if (photoBase && typeof Image !== 'undefined') {
    const load = (name: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `${photoBase}${name}.webp`;
      });
    Promise.all([load('facade-gate'), load('facade-door'), load('facade-window')])
      .then(([gate, door, win]) => {
        const opening = (k: number) => {
          const [x0, y0] = cell(k, ROW_GROUND);
          return [x0 + 18, y0 + 40, CELL - 36, CELL - 40] as const;
        };
        // Ground floor: the folding steel gate, and the wooden double door between its side shutters.
        a.drawImage(gate, ...opening(2));
        const [dx, dy, dw, dh] = opening(6);
        a.drawImage(door, dx + 40, dy + 20, dw - 80, dh - 20);
        // Upper floors: one wide window, behind security bars (unlit) or glowing warm (lit).
        for (const k of [2, 3]) {
          const [x0, y0] = cell(k, ROW_UPPER);
          stucco(a, x0, y0, 200 + k);
          e.fillStyle = '#000';
          e.fillRect(x0, y0, CELL, CELL);
          const ww = 184;
          const wh = 132;
          const wx = x0 + (CELL - ww) / 2;
          const wy = y0 + 66;
          recess(a, wx - 4, wy - 4, ww + 8, wh + 8);
          a.drawImage(win, wx, wy, ww, wh);
          if (k === 2) bars(a, wx + 10, wy + 10, ww - 20, wh - 20);
          else for (const px of [0.07, 0.53]) windowGlass(e, wx + px * ww, wy + 0.09 * wh, 0.4 * ww, 0.82 * wh, 'warm');
        }
        for (const [tex, src, extend] of [
          [map, albedo, true],
          [emissiveMap, emissive, false],
        ] as const) {
          (tex.image as HTMLCanvasElement).getContext('2d')!.drawImage(withGutters(src, PW, PH, extend), 0, 0);
          tex.needsUpdate = true;
        }
      })
      .catch(() => {});
  }
  const inset = 0.5;
  return {
    map,
    emissiveMap,
    uv(col, row) {
      const x0 = col * PITCH + GUTTER;
      const y0 = row * PITCH + GUTTER;
      const u0 = (x0 + inset) / PW;
      const u1 = (x0 + CELL - inset) / PW;
      // Canvas y grows downward; texture v grows upward (flipY).
      const v1 = 1 - (y0 + inset) / PH;
      const v0 = 1 - (y0 + CELL - inset) / PH;
      return [u0, v0, u1, v1];
    },
  };
}

const SIGN_NAMES = ['TẠP HÓA', 'NHÀ THUỐC', 'CÀ PHÊ', 'SỬA XE', 'ĐIỆN THOẠI', 'PHỞ BÒ', 'BÁNH MÌ', 'TIỆM VÀNG'];
const SIGN_COLORS = ['#b3261e', '#1f6f43', '#5a3a22', '#1d4f91', '#c45a10', '#8e1b1b', '#a1781a', '#7a1414'];

/** Eight shop signs stacked vertically (512 × 64 each); backlit, so the same canvas serves as emissive. */
export function buildSignAtlas(): { map: THREE.Texture; count: number } {
  const W = 512;
  const H = 64 * SIGN_NAMES.length;
  const [c, ctx] = canvas(W, H);
  SIGN_NAMES.forEach((name, i) => {
    const y = i * 64;
    ctx.fillStyle = SIGN_COLORS[i];
    ctx.fillRect(0, y, W, 64);
    ctx.strokeStyle = 'rgba(255,240,200,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(5, y + 5, W - 10, 54);
    ctx.fillStyle = i === 1 ? '#ffffff' : '#ffe9a8';
    ctx.font = 'bold 38px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, W / 2, y + 34);
  });
  return { map: toTexture(c, true, false), count: SIGN_NAMES.length };
}
