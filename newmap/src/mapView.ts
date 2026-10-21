import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { areaM2, type LonLat } from './geo';

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

/** The slippy map with polygon drawing: click to add corners, click the first corner (or "Xong") to close. */
export class MapView {
  readonly map: L.Map;
  private points: LonLat[] = [];
  private closed = false;
  private drawing = false;
  private readonly shape: L.Polygon;
  private readonly corners = L.layerGroup();
  onChange: () => void = () => {};

  constructor(el: HTMLElement) {
    this.map = L.map(el, { zoomControl: true }).setView(START, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.shape = L.polygon([], { color: '#d2562b', weight: 2, fillOpacity: 0.12 }).addTo(this.map);
    this.corners.addTo(this.map);
    // Keep Leaflet's idea of the map size right when the layout changes (styles arriving, phone rotation).
    new ResizeObserver(() => this.map.invalidateSize()).observe(el);
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (!this.drawing) return;
      this.points.push([e.latlng.lng, e.latlng.lat]);
      this.redraw();
    });
  }

  /** Starts a new outline. */
  startDrawing(): void {
    this.points = [];
    this.closed = false;
    this.drawing = true;
    this.map.doubleClickZoom.disable();
    this.map.getContainer().classList.add('drawing');
    this.redraw();
  }

  finishDrawing(): void {
    if (this.points.length < 3) return;
    this.closed = true;
    this.drawing = false;
    this.map.doubleClickZoom.enable();
    this.map.getContainer().classList.remove('drawing');
    this.redraw();
  }

  /** Uses a square of `side` metres around the middle of the current view. */
  squareHere(side: number): void {
    const c = this.map.getCenter();
    this.points = squareAround(c.lng, c.lat, side);
    this.drawing = false;
    this.finishDrawing();
  }

  clear(): void {
    this.points = [];
    this.closed = false;
    this.drawing = false;
    this.map.doubleClickZoom.enable();
    this.map.getContainer().classList.remove('drawing');
    this.redraw();
  }

  get isDrawing(): boolean {
    return this.drawing;
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
    if (!this.closed) {
      this.points.forEach(([lon, lat], i) => {
        const m = L.circleMarker([lat, lon], {
          radius: i === 0 ? 7 : 4,
          color: '#d2562b',
          fillColor: i === 0 ? '#fff' : '#d2562b',
          fillOpacity: 1,
          weight: 2,
          bubblingMouseEvents: false,
        });
        if (i === 0) {
          m.bindTooltip('Bấm để khép khu', { direction: 'top' });
          m.on('click', () => this.finishDrawing());
        }
        m.addTo(this.corners);
      });
    }
    this.onChange();
  }
}
