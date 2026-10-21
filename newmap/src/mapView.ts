import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { areaM2, boxFromCorners, type LonLat } from './geo';

/** Bigger areas make Overpass slow and the scene heavy. */
export const MAX_AREA_M2 = 1_500_000;
export const MIN_AREA_M2 = 500;

/** Khương Thượng, Đống Đa, Hà Nội. */
const START: L.LatLngTuple = [21.0042, 105.8262];

/** Square of `side` metres around a point, as a lon/lat ring. */
export function squareAround(lon: number, lat: number, side: number): LonLat[] {
  const dLat = side / 2 / 110_574;
  const dLon = side / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
  ];
}

/** How close (in screen pixels) a press must be to a corner to grab it. */
const GRAB_PX = 16;

type Drag = { kind: 'box'; from: LonLat; x: number; y: number } | { kind: 'corner'; index: number };

/**
 * The slippy map with two ways to outline an area: drag a box ("Kéo khung"), or click corners one by one ("Vẽ khu",
 * click the first corner or "Xong" to close). The corners of a finished outline can be dragged to adjust it.
 */
export class MapView {
  readonly map: L.Map;
  private points: LonLat[] = [];
  private closed = false;
  private mode: 'idle' | 'polygon' | 'box' = 'idle';
  /** The outline is a box, so dragging a corner keeps it a rectangle. */
  private isBox = false;
  private drag: Drag | null = null;
  private readonly el: HTMLElement;
  private readonly shape: L.Polygon;
  private readonly corners = L.layerGroup();
  onChange: () => void = () => {};

  constructor(el: HTMLElement) {
    this.el = el;
    // Shift-drag is ours (a box), not Leaflet's box zoom.
    this.map = L.map(el, { zoomControl: true, boxZoom: false }).setView(START, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.shape = L.polygon([], { color: '#d2562b', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(this.map);
    this.corners.addTo(this.map);
    // Keep Leaflet's idea of the map size right when the layout changes (styles arriving, phone rotation).
    new ResizeObserver(() => this.map.invalidateSize()).observe(el);
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.mode !== 'polygon') return;
      this.points.push([e.latlng.lng, e.latlng.lat]);
      this.redraw();
    });
    // Capture phase, so a press that starts a box or grabs a corner never reaches Leaflet's panning.
    el.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  private lonLatOf(e: PointerEvent): LonLat {
    const ll = this.map.mouseEventToLatLng(e as unknown as MouseEvent);
    return [ll.lng, ll.lat];
  }

  /** Index of the corner of the finished outline under the pointer, or -1. */
  private cornerAt(e: PointerEvent): number {
    if (!this.closed) return -1;
    const p = this.map.mouseEventToContainerPoint(e as unknown as MouseEvent);
    let best = -1;
    let bestD = GRAB_PX;
    this.points.forEach(([lon, lat], i) => {
      const d = this.map.latLngToContainerPoint([lat, lon]).distanceTo(p);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  private onDown(e: PointerEvent): void {
    if (!e.isPrimary || e.button !== 0 || (e.target as Element).closest('.leaflet-control')) return;
    if (this.mode === 'box' || (this.mode === 'idle' && e.shiftKey)) {
      const from = this.lonLatOf(e);
      this.drag = { kind: 'box', from, x: e.clientX, y: e.clientY };
      this.points = [from, from, from, from];
      this.closed = false;
      this.isBox = true;
    } else if (this.mode === 'idle') {
      const index = this.cornerAt(e);
      if (index < 0) return;
      this.drag = { kind: 'corner', index };
    } else {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    this.map.dragging.disable();
    this.el.setPointerCapture(e.pointerId);
    this.redraw();
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag) {
      // Show that corners can be grabbed.
      this.el.style.cursor = this.mode === 'idle' && this.cornerAt(e) >= 0 ? 'move' : '';
      return;
    }
    const at = this.lonLatOf(e);
    if (this.drag.kind === 'box') {
      this.points = boxFromCorners(this.drag.from, at);
    } else if (this.isBox) {
      // Keep the opposite corner where it is; the grabbed one may now be a different corner of the new box.
      this.points = boxFromCorners(this.points[(this.drag.index + 2) % 4], at);
      this.drag.index = this.points.findIndex((q) => q[0] === at[0] && q[1] === at[1]);
    } else {
      this.points[this.drag.index] = at;
    }
    this.redraw();
  }

  private onUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (this.mode !== 'box') this.map.dragging.enable();
    if (drag.kind === 'box') {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) {
        // A tap, not a drag: stay in box mode.
        this.points = [];
      } else {
        this.closed = true;
        this.setMode('idle');
      }
    }
    this.redraw();
  }

  private setMode(mode: MapView['mode']): void {
    this.mode = mode;
    const c = this.el.classList;
    c.toggle('drawing', mode === 'polygon');
    c.toggle('boxing', mode === 'box');
    if (mode === 'polygon') this.map.doubleClickZoom.disable();
    else this.map.doubleClickZoom.enable();
    if (mode === 'box') this.map.dragging.disable();
    else this.map.dragging.enable();
  }

  /** Starts a new outline, clicking corner by corner. */
  startDrawing(): void {
    this.points = [];
    this.closed = false;
    this.isBox = false;
    this.setMode('polygon');
    this.redraw();
  }

  /** Waits for a drag on the map that draws a box. */
  startBox(): void {
    this.points = [];
    this.closed = false;
    this.setMode('box');
    this.redraw();
  }

  finishDrawing(): void {
    if (this.points.length < 3) return;
    this.closed = true;
    this.setMode('idle');
    this.redraw();
  }

  /** Uses a square of `side` metres around the middle of the current view. */
  squareHere(side: number): void {
    const c = this.map.getCenter();
    this.points = squareAround(c.lng, c.lat, side);
    this.isBox = true;
    this.finishDrawing();
  }

  clear(): void {
    this.points = [];
    this.closed = false;
    this.setMode('idle');
    this.redraw();
  }

  get isDrawing(): boolean {
    return this.mode === 'polygon';
  }

  get isBoxing(): boolean {
    return this.mode === 'box';
  }

  /** The finished outline, or null while drawing or empty. */
  get polygon(): LonLat[] | null {
    return this.closed && this.points.length >= 3 ? this.points : null;
  }

  get pointCount(): number {
    return this.points.length;
  }

  get area(): number {
    return areaM2(this.points);
  }

  private redraw(): void {
    this.shape.setLatLngs(this.points.map(([lon, lat]) => [lat, lon] as L.LatLngTuple));
    this.shape.setStyle({ dashArray: this.closed ? undefined : '6 6' });
    this.corners.clearLayers();
    const handles = this.mode === 'polygon' || (this.closed && !this.drag) || this.drag?.kind === 'corner';
    if (handles) {
      this.points.forEach(([lon, lat], i) => {
        const first = this.mode === 'polygon' && i === 0;
        const m = L.circleMarker([lat, lon], {
          radius: first || this.closed ? 7 : 4,
          color: '#d2562b',
          fillColor: first || this.closed ? '#fff' : '#d2562b',
          fillOpacity: 1,
          weight: 2,
          // Corners of a finished outline are moved by the pointer handlers above, not by Leaflet.
          interactive: first,
          bubblingMouseEvents: false,
        });
        if (first) {
          m.bindTooltip('Bấm để khép khu', { direction: 'top' });
          m.on('click', () => this.finishDrawing());
        }
        m.addTo(this.corners);
      });
    }
    this.onChange();
  }
}
