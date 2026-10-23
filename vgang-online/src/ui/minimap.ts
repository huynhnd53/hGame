import type { City } from '../sim/city';

const SIZE = 150;

const KIND_COLORS: Record<string, string> = {
  houses: '#4a4036',
  park: '#2f4a2a',
  lake: '#1d3f5c',
  plaza: '#6b604f',
};

/** North-up map of the whole city with the rider as an arrow. */
export class Minimap {
  private base = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private scale: number;

  constructor(canvas: HTMLCanvasElement, city: City) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = SIZE * dpr;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.scale = (SIZE - 12) / city.bounds.w;
    this.base.width = this.base.height = SIZE * dpr;
    const b = this.base.getContext('2d')!;
    b.scale(dpr, dpr);
    b.fillStyle = '#16181c';
    b.fillRect(0, 0, SIZE, SIZE);
    for (const block of city.blocks) {
      const [x, y] = this.toMap(block.rect.x - block.rect.w / 2, block.rect.z - block.rect.d / 2);
      b.fillStyle = KIND_COLORS[block.kind];
      b.fillRect(x, y, block.rect.w * this.scale, block.rect.d * this.scale);
      if (block.kind === 'lake') {
        const [cx, cy] = this.toMap(block.inner.x, block.inner.z);
        b.fillStyle = KIND_COLORS.park;
        b.fillRect(cx - (block.inner.w / 2) * this.scale, cy - (block.inner.d / 2) * this.scale, block.inner.w * this.scale, block.inner.d * this.scale);
        b.fillStyle = KIND_COLORS.lake;
        b.beginPath();
        b.arc(cx, cy, (block.inner.w / 2 - 3) * this.scale, 0, Math.PI * 2);
        b.fill();
      }
    }
  }

  private toMap(x: number, z: number): [number, number] {
    return [SIZE / 2 + x * this.scale, SIZE / 2 + z * this.scale];
  }

  draw(x: number, z: number, heading: number, others: { x: number; z: number }[] = []): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.base, 0, 0, SIZE, SIZE);
    ctx.fillStyle = 'rgba(255,240,200,0.7)';
    for (const o of others) {
      const [ox, oy] = this.toMap(o.x, o.z);
      ctx.fillRect(ox - 0.75, oy - 0.75, 1.5, 1.5);
    }
    const [px, py] = this.toMap(x, z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading);
    ctx.fillStyle = '#ffb347';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
