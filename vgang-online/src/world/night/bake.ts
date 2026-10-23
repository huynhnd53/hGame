import * as THREE from 'three';
import type { StreetLight } from './houses';

/** Faint blue night fill so unlit surfaces are not pure black. */
export const AMBIENT = new THREE.Color(0.055, 0.06, 0.085);

/** Buckets lights on a coarse grid so each vertex only looks at nearby ones. */
export class LightGrid {
  private cells = new Map<string, StreetLight[]>();
  constructor(
    private lights: StreetLight[],
    private cell = 16,
  ) {
    for (const l of lights) {
      const k = this.key(Math.floor(l.pos.x / cell), Math.floor(l.pos.z / cell));
      const list = this.cells.get(k) ?? [];
      list.push(l);
      this.cells.set(k, list);
    }
  }

  private key(i: number, j: number) {
    return `${i},${j}`;
  }

  near(x: number, z: number): StreetLight[] {
    const i = Math.floor(x / this.cell);
    const j = Math.floor(z / this.cell);
    const out: StreetLight[] = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(...(this.cells.get(this.key(i + a, j + b)) ?? []));
    return out;
  }

  /** Light arriving at a point with the given normal (not including ambient). */
  shade(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): THREE.Color {
    out.setRGB(0, 0, 0);
    for (const l of this.near(p.x, p.z)) {
      const dx = l.pos.x - p.x;
      const dy = l.pos.y - p.y;
      const dz = l.pos.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(d2) || 1;
      const ndl = Math.max(0, (n.x * dx + n.y * dy + n.z * dz) / d);
      // Pool under the light: mostly horizontal distance, with height counting a little.
      const q = 1 + (dx * dx + dz * dz + 0.3 * dy * dy) / (l.radius * l.radius);
      const fall = 1 / (q * q) - 0.01;
      if (fall <= 0) continue;
      const k = l.strength * fall * (0.35 + 0.65 * ndl);
      out.r += l.color.r * k;
      out.g += l.color.g * k;
      out.b += l.color.b * k;
    }
    return out;
  }

  get all(): StreetLight[] {
    return this.lights;
  }
}

/**
 * Multiplies the geometry's vertex colours (or white) by ambient + baked street light.
 * Runs once at load, so the materials need no lighting at runtime.
 */
export function bakeLight(g: THREE.BufferGeometry, grid: LightGrid, gain = 1): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  let col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col) {
    col = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
    g.setAttribute('color', col);
  }
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (nor) n.fromBufferAttribute(nor, i);
    else n.set(0, 1, 0);
    grid.shade(p, n, c);
    const r = Math.min(2.4, AMBIENT.r + c.r * gain);
    const gg = Math.min(2.4, AMBIENT.g + c.g * gain);
    const b = Math.min(2.4, AMBIENT.b + c.b * gain);
    col.setXYZ(i, col.getX(i) * r, col.getY(i) * gg, col.getZ(i) * b);
  }
  col.needsUpdate = true;
  return g;
}
