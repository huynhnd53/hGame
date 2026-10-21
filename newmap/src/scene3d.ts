import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { carAt, type Decor } from './decor';
import { type Ring, ringArea, ringBounds, type XZ } from './geo';
import { hash01, LEVEL_H, type SceneBuilding, type SceneModel } from './model';
import type { SunPosition } from './sun';

/** Pale facade colours, as on the streets of Hà Nội. */
const WALLS = ['#f6f1e7', '#fbf8f2', '#f3dfdd', '#f3e8c4', '#e2e8ec', '#efe1cd', '#e8efe0', '#f7e3cf'];
/** Bright pitched roofs. */
const ROOFS = ['#d6453a', '#e3713a', '#3f6fc4', '#3d9958', '#9a5a3a', '#b8392e', '#e0a33a', '#d6453a'];
const FLAT_ROOF = '#d7d5d1';
const WORSHIP_WALL = '#f0d58a';
const WORSHIP_ROOF = '#a8382a';
const HERITAGE_WALL = '#e3cf9f';
const HERITAGE_ROOF = '#7a4b3a';
const CAR_COLORS = ['#f4f4f2', '#c9ccd0', '#d63c35', '#f2c230', '#3a64b8', '#26292c', '#6d7378', '#f4f4f2'];

/** Size of one window bay on a facade, metres. */
const BAY_W = 3;
/** The facade texture holds 4 × 4 bays, so lit windows do not repeat too visibly. */
const TEX_BAYS = 4;

/** Colours used when buildings are coloured by where they came from. */
export const SOURCE_COLORS: Record<SceneBuilding['source'], number> = {
  osm: 0xe07a3f,
  google: 0x3f9b5a,
  microsoft: 0x3f74c9,
  'open-buildings': 0x8a62c4,
};

/** An OSM colour value ("#ffcc00", "fc0", "white") as a hex number, or null when it is not a colour. */
export function parseOsmColour(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  const hex = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return parseInt(h, 16);
  }
  const named = (THREE.Color.NAMES as Record<string, number>)[s.replace(/[\s_-]/g, '')];
  return named ?? null;
}

/** Smallest rectangle around a footprint, aligned with one of its edges. */
export interface OrientedBox {
  cx: number;
  cz: number;
  /** Unit vector along the long side. */
  ux: number;
  uz: number;
  halfLong: number;
  halfShort: number;
}

export function orientedBox(ring: Ring): OrientedBox {
  let best: OrientedBox | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, z] of ring) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area >= bestArea) continue;
    bestArea = area;
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const cx = cu * ux - cv * uz;
    const cz = cu * uz + cv * ux;
    // Keep the axis along the long side.
    best =
      u1 - u0 >= v1 - v0
        ? { cx, cz, ux, uz, halfLong: (u1 - u0) / 2, halfShort: (v1 - v0) / 2 }
        : { cx, cz, ux: -uz, uz: ux, halfLong: (v1 - v0) / 2, halfShort: (u1 - u0) / 2 };
  }
  return best ?? { cx: 0, cz: 0, ux: 1, uz: 0, halfLong: 0, halfShort: 0 };
}

export type RoofStyle = 'flat' | 'gabled' | 'hipped';

/**
 * The roof to draw. A mapped roof:shape wins; otherwise small houses (as most tube houses and villas are) get a
 * pitched roof most of the time, and big or tall buildings a flat one.
 */
export function roofStyle(b: SceneBuilding): RoofStyle {
  const s = b.roofShape;
  if (/^(gabled|saltbox|gambrel|side_hipped)$/.test(s)) return 'gabled';
  if (/^(hipped|half-hipped|pyramidal|mansard|dome|onion|round|cone)$/.test(s)) return 'hipped';
  if (s) return 'flat';
  if (ringArea(b.outer) > 250 || b.height > 22) return 'flat';
  const r = hash01(`${b.id}roof`);
  return r < 0.45 ? 'gabled' : r < 0.7 ? 'hipped' : 'flat';
}

/** Triangles with per-vertex colour (and texture coordinates for facades), merged into one mesh per layer. */
class Soup {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];

  tri(a: XYZ, b: XYZ, c: XYZ, color: THREE.Color, uv?: [number, number][]): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
    if (uv) for (const [u, v] of uv) this.uv.push(u, v);
    else this.uv.push(0, 0, 0, 0, 0, 0);
  }

  quad(a: XYZ, b: XYZ, c: XYZ, d: XYZ, color: THREE.Color, uv?: [number, number][]): void {
    this.tri(a, b, c, color, uv && [uv[0], uv[1], uv[2]]);
    this.tri(a, c, d, color, uv && [uv[0], uv[2], uv[3]]);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

type XYZ = [number, number, number];

/** Flat polygon (with holes) at height y. */
function flat(soup: Soup, outer: Ring, holes: Ring[], y: number, color: THREE.Color): void {
  if (outer.length < 3) return;
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = holes.filter((h) => h.length >= 3).map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const all = [...contour, ...hs.flat()];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, hs)) {
    soup.tri([all[a].x, y, all[a].y], [all[b].x, y, all[b].y], [all[c].x, y, all[c].y], color);
  }
}

/** Walls of a ring from y0 to y1, with facade texture coordinates in bays and floors. */
function walls(soup: Soup, ring: Ring, y0: number, y1: number, color: THREE.Color): void {
  let u = 0;
  const v0 = y0 / (LEVEL_H * TEX_BAYS);
  const v1 = y1 / (LEVEL_H * TEX_BAYS);
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    // Whole bays per wall, so windows are not cut at corners.
    const du = Math.max(1, Math.round(len / BAY_W)) / TEX_BAYS;
    soup.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], color, [
      [u, v0],
      [u + du, v0],
      [u + du, v1],
      [u, v1],
    ]);
    u += du;
  }
}

/** Gabled or hipped roof over the footprint's oriented box, with a small overhang. */
function pitchedRoof(roofs: Soup, b: SceneBuilding, style: 'gabled' | 'hipped', wall: THREE.Color, roof: THREE.Color): void {
  const o = orientedBox(b.outer);
  const L = o.halfLong + 0.35;
  const S = o.halfShort + 0.35;
  const rise = b.roofShape ? b.roofHeight || S * 0.7 : S * 0.7;
  const top = b.height;
  const at = (a: number, c: number, y: number): XYZ => [o.cx + o.ux * a - o.uz * c, y, o.cz + o.uz * a + o.ux * c];
  const ridge = style === 'gabled' ? L : Math.max(0, L - S);
  const r1 = at(-ridge, 0, top + rise);
  const r2 = at(ridge, 0, top + rise);
  const c00 = at(-L, -S, top);
  const c10 = at(L, -S, top);
  const c11 = at(L, S, top);
  const c01 = at(-L, S, top);
  roofs.quad(c00, c10, r2, r1, roof);
  roofs.quad(c01, c11, r2, r1, roof);
  // Gable ends are wall; hip ends are roof.
  roofs.tri(c00, c01, r1, style === 'gabled' ? wall : roof);
  roofs.tri(c10, c11, r2, style === 'gabled' ? wall : roof);
}

const colorOf = (css: string) => new THREE.Color(css);

function wallColor(b: SceneBuilding, bySource: boolean): THREE.Color {
  if (bySource) return new THREE.Color(SOURCE_COLORS[b.source]);
  const mapped = parseOsmColour(b.color);
  if (mapped !== null) return new THREE.Color(mapped);
  if (b.role === 'worship') return colorOf(WORSHIP_WALL);
  if (b.role === 'heritage') return colorOf(HERITAGE_WALL);
  return colorOf(WALLS[Math.floor(hash01(b.id) * WALLS.length)]);
}

function roofColor(b: SceneBuilding, style: RoofStyle, bySource: boolean): THREE.Color {
  if (bySource) return new THREE.Color(SOURCE_COLORS[b.source]).multiplyScalar(0.8);
  const mapped = parseOsmColour(b.roofColor);
  if (mapped !== null) return new THREE.Color(mapped);
  if (b.role === 'worship') return colorOf(WORSHIP_ROOF);
  if (b.role === 'heritage') return colorOf(HERITAGE_ROOF);
  if (style === 'flat') return colorOf(FLAT_ROOF).offsetHSL(0, 0, (hash01(`${b.id}r`) - 0.5) * 0.08);
  return colorOf(ROOFS[Math.floor(hash01(`${b.id}c`) * ROOFS.length)]);
}

function addBuilding(facades: Soup, roofs: Soup, b: SceneBuilding, bySource: boolean): void {
  if (b.outer.length < 3) return;
  let style = roofStyle(b);
  // A pitched roof over a footprint that is far from a rectangle would hang in the air.
  if (style !== 'flat') {
    const o = orientedBox(b.outer);
    if (b.holes.length || o.halfShort > 9 || ringArea(b.outer) < 0.75 * 4 * o.halfLong * o.halfShort) style = 'flat';
  }
  const wall = wallColor(b, bySource);
  const roof = roofColor(b, style, bySource);
  const y0 = b.minHeight;
  const y1 = Math.max(b.height, y0 + 0.5);
  walls(facades, b.outer, y0, y1, wall);
  for (const h of b.holes) walls(facades, h, y0, y1, wall);
  if (style === 'flat') flat(roofs, b.outer, b.holes, y1, roof);
  else pitchedRoof(roofs, { ...b, height: y1 }, style, wall, roof);
}

/** Ribbon along a polyline with round joints, for roads, rivers and paint. */
function ribbon(soup: Soup, pts: XZ[], width: number, y: number, color: THREE.Color, round = true): void {
  const h = width / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const nx = (-(bz - az) / len) * h;
    const nz = ((bx - ax) / len) * h;
    soup.quad([ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz], color);
  }
  if (!round) return;
  const n = 10;
  for (const [cx, cz] of pts) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      soup.tri([cx, y, cz], [cx + Math.cos(a0) * h, y, cz + Math.sin(a0) * h], [cx + Math.cos(a1) * h, y, cz + Math.sin(a1) * h], color);
    }
  }
}

/** Dashes along a polyline, shifted `side` metres to its right. */
function dashes(soup: Soup, pts: XZ[], side: number, dash: number, gap: number, width: number, y: number, color: THREE.Color): void {
  let phase = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const ox = -dz * side;
    const oz = dx * side;
    for (let t = phase; t < len; t += dash + gap) {
      const t1 = Math.min(len, t + dash);
      const p: XZ[] = [
        [ax + dx * t + ox, az + dz * t + oz],
        [ax + dx * t1 + ox, az + dz * t1 + oz],
      ];
      ribbon(soup, p, width, y, color, false);
    }
    phase = (((phase - len) % (dash + gap)) + dash + gap) % (dash + gap);
  }
}

const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;

/** Facade textures: walls with a grid of windows, and which of them light up at night. */
function facadeTextures(): { map: THREE.Texture; glow: THREE.Texture } {
  const cell = 64;
  const size = cell * TEX_BAYS;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d')!] as const;
  };
  const [wallCanvas, w] = mk();
  const [glowCanvas, g] = mk();
  w.fillStyle = '#ffffff';
  w.fillRect(0, 0, size, size);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < TEX_BAYS; i++) {
    for (let j = 0; j < TEX_BAYS; j++) {
      const x = i * cell;
      const y = j * cell;
      // A light sill under each window, then the dark glass.
      w.fillStyle = '#d9d4ca';
      w.fillRect(x + 14, y + 44, 36, 4);
      w.fillStyle = '#4a5866';
      w.fillRect(x + 17, y + 14, 30, 30);
      w.fillStyle = '#6f8191';
      w.fillRect(x + 17, y + 14, 30, 4);
      if (rand() < 0.45) {
        g.fillStyle = rand() < 0.7 ? '#ffd27a' : '#fff1c9';
        g.fillRect(x + 17, y + 14, 30, 30);
      }
    }
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(wallCanvas), glow: tex(glowCanvas) };
}

export interface ViewOptions {
  /** Colour buildings by source (OSM / Google / Microsoft) instead of by their look. */
  bySource: boolean;
}

/** Lowest and highest the camera may look from: never under the ground, at most straight down. */
export const MIN_POLAR = 0.05;
export const MAX_POLAR = Math.PI * 0.47;
export const MIN_DISTANCE = 8;
export const MAX_DISTANCE = 3000;

export interface Turn {
  /** Turn around the vertical axis, radians (positive turns the scene to the left). */
  yaw?: number;
  /** Tilt, radians (positive looks more from above). */
  pitch?: number;
  /** Distance factor (below 1 moves closer). */
  zoom?: number;
}

/** Where the camera ends up after turning around `target`, kept within the view limits. */
export function turnCamera(position: THREE.Vector3, target: THREE.Vector3, t: Turn): THREE.Vector3 {
  const s = new THREE.Spherical().setFromVector3(position.clone().sub(target));
  s.theta += t.yaw ?? 0;
  s.phi = THREE.MathUtils.clamp(s.phi - (t.pitch ?? 0), MIN_POLAR, MAX_POLAR);
  s.radius = THREE.MathUtils.clamp(s.radius * (t.zoom ?? 1), MIN_DISTANCE, MAX_DISTANCE);
  return new THREE.Vector3().setFromSpherical(s).add(target);
}

/** Compass bearing the camera looks towards (0 = north), and its tilt from straight down, in degrees. */
export function viewAngles(position: THREE.Vector3, target: THREE.Vector3): { heading: number; tilt: number } {
  const d = target.clone().sub(position);
  const heading = ((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360;
  const tilt = (Math.acos(Math.min(1, -d.y / d.length())) * 180) / Math.PI;
  return { heading, tilt };
}

interface Glide {
  from: THREE.Spherical;
  to: THREE.Spherical;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  duration: number;
}

export interface ViewState {
  target: XZ;
  heading: number;
  tilt: number;
}

const DAY_SKY = new THREE.Color('#bfdcf2');
const DUSK_SKY = new THREE.Color('#f0b98a');
const NIGHT_SKY = new THREE.Color('#0d1626');

/**
 * The 3D view of a built area: facades with windows, pitched roofs, roads with markings, trees, moving cars, and a
 * sun that casts shadows for any time of day. Drag to turn, right-drag or two fingers to move, wheel or pinch to
 * zoom; it spins slowly when first shown, until touched.
 */
export class AreaView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 9000);
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight(0xfff3dc, 2.4);
  private readonly sky = new THREE.HemisphereLight(0xeaf3ff, 0x8f8676, 1.3);
  private readonly fog = new THREE.Fog(DAY_SKY.clone(), 2500, 7000);
  private readonly textures = facadeTextures();
  private readonly facadeMaterial: THREE.MeshLambertMaterial;
  private content: THREE.Group | null = null;
  private cars: { mesh: THREE.InstancedMesh; decor: Decor } | null = null;
  private model: SceneModel | null = null;
  private home: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private glide: Glide | null = null;
  private radius = 300;
  private frame = 0;
  private last = 0;
  private clock = 0;
  private lastState = '';
  /** Called when spinning starts or stops, to update the button. */
  onSpinChange: (spinning: boolean) => void = () => {};
  /** Called when the camera has moved: where it looks and from which direction. */
  onViewChange: (v: ViewState) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = DAY_SKY.clone();
    this.scene.fog = this.fog;
    this.scene.add(this.sky);
    const small = Math.min(screen.width, screen.height) < 700;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target);
    this.facadeMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: this.textures.map,
      emissiveMap: this.textures.glow,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    });

    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.minPolarAngle = MIN_POLAR;
    c.maxPolarAngle = MAX_POLAR;
    c.minDistance = MIN_DISTANCE;
    c.maxDistance = MAX_DISTANCE;
    // Move along the ground, not up into the sky.
    c.screenSpacePanning = false;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.autoRotateSpeed = 1.2;
    // Any drag, pinch or wheel takes over from spinning and gliding.
    c.addEventListener('start', () => {
      this.glide = null;
      this.setSpin(false);
    });
    this.controls = c;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  show(model: SceneModel, decor: Decor, opts: ViewOptions): void {
    const fresh = model !== this.model;
    this.model = model;
    this.clear();
    this.content = this.build(model, decor, opts);
    this.scene.add(this.content);
    if (fresh) {
      this.frameArea(model.boundary);
      this.setSpin(true);
    }
    if (!this.frame) this.loop(performance.now());
  }

  /** Places the sun; below the horizon the city lights up. */
  setSun(p: SunPosition): void {
    const day = THREE.MathUtils.smoothstep(p.altitude, -6, 10);
    const low = 1 - THREE.MathUtils.smoothstep(p.altitude, 5, 25);
    const alt = THREE.MathUtils.degToRad(Math.max(p.altitude, 2));
    const az = THREE.MathUtils.degToRad(p.azimuth);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    const t = this.controls.target;
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(dir, 2000);
    this.sun.intensity = 2.6 * day;
    this.sun.color.set(0xfff6e6).lerp(new THREE.Color(0xffb36b), low * 0.8);
    this.sun.castShadow = p.altitude > -2;
    this.sky.intensity = 0.2 + 1.15 * day;
    this.sky.color.set(0x8296c2).lerp(new THREE.Color(0xeaf3ff), day);
    const sky = NIGHT_SKY.clone().lerp(DUSK_SKY, Math.min(1, day * 2)).lerp(DAY_SKY, Math.max(0, day * 2 - 1) * (1 - low * 0.6));
    (this.scene.background as THREE.Color).copy(sky);
    this.fog.color.copy(sky);
    this.facadeMaterial.emissiveIntensity = 1.1 * (1 - day);
  }

  get spinning(): boolean {
    return this.controls.autoRotate;
  }

  setSpin(on: boolean): void {
    if (this.controls.autoRotate === on) return;
    this.controls.autoRotate = on;
    this.onSpinChange(on);
  }

  /** Turns, tilts or zooms in a short glide. */
  turn(t: Turn): void {
    this.setSpin(false);
    const target = this.controls.target.clone();
    this.glideTo(turnCamera(this.camera.position, target, t), target);
  }

  /** Turns to look north. */
  faceNorth(): void {
    const { heading } = viewAngles(this.camera.position, this.controls.target);
    const yaw = THREE.MathUtils.degToRad(heading > 180 ? heading - 360 : heading);
    this.turn({ yaw });
  }

  /** Back to the view the area was first shown from. */
  reset(): void {
    if (!this.home) return;
    this.setSpin(false);
    this.glideTo(this.home.position, this.home.target);
  }

  private glideTo(position: THREE.Vector3, target: THREE.Vector3): void {
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const to = new THREE.Spherical().setFromVector3(position.clone().sub(target));
    // Turn the short way round.
    while (to.theta - from.theta > Math.PI) to.theta -= 2 * Math.PI;
    while (to.theta - from.theta < -Math.PI) to.theta += 2 * Math.PI;
    this.glide = { from, to, fromTarget: this.controls.target.clone(), toTarget: target.clone(), start: performance.now(), duration: 350 };
  }

  private frameArea(boundary: Ring): void {
    const [x0, z0, x1, z1] = ringBounds(boundary);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.radius = Math.max(x1 - x0, z1 - z0, 80) / 2;
    const r = this.radius * 2;
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx + r * 0.3, r * 0.55, cz + r * 0.7);
    this.home = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.glide = null;
    // Shadows over the whole area.
    const cam = this.sun.shadow.camera;
    const s = this.radius * 1.25;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 10;
    cam.far = 4000;
    cam.updateProjectionMatrix();
    this.controls.update();
  }

  private build(m: SceneModel, decor: Decor, opts: ViewOptions): THREE.Group {
    const group = new THREE.Group();
    const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const add = (soup: Soup, mat: THREE.Material, cast: boolean) => {
      if (soup.empty) return;
      const mesh = new THREE.Mesh(soup.geometry(), mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
    };

    // Ground layers, each a little above the last.
    const ground = new Soup();
    flat(ground, m.boundary, [], 0, colorOf('#e7e4de'));
    for (const s of m.yards) flat(ground, s.outer, s.holes, 0.04, colorOf('#ece0c4'));
    for (const s of m.parks) flat(ground, s.outer, s.holes, 0.08, colorOf('#a9cf8c'));
    for (const s of m.water) flat(ground, s.outer, s.holes, 0.12, colorOf('#74acd9'));
    for (const w of m.waterways) if (!w.hidden) ribbon(ground, w.points, w.width, 0.13, colorOf('#74acd9'));
    const roads = m.roads.filter((r) => !r.hidden).sort((a, b) => a.width - b.width);
    const sidewalk = colorOf('#d3cfc7');
    for (const r of roads) if (DRIVABLE.test(r.kind)) ribbon(ground, r.points, r.width + 3.2, 0.16, sidewalk);
    for (const s of m.roadAreas) flat(ground, s.outer, s.holes, 0.2, colorOf('#575b5f'));
    const asphalt = colorOf('#4a4e52');
    const paving = colorOf('#dcd5c8');
    roads.forEach((r, i) => {
      const foot = !DRIVABLE.test(r.kind);
      ribbon(ground, r.points, r.width, 0.24 + i * 1e-5, foot ? paving : asphalt);
    });
    // Paint: dashed centre lines, and lane lines on wide roads.
    const paint = colorOf('#f1f1ec');
    for (const r of roads) {
      if (!DRIVABLE.test(r.kind) || r.width < 6) continue;
      if (r.width >= 12) {
        if (!r.oneway) {
          dashes(ground, r.points, 0.2, 1e9, 0, 0.15, 0.3, paint);
          dashes(ground, r.points, -0.2, 1e9, 0, 0.15, 0.3, paint);
        }
        for (const side of r.oneway ? [0] : [-r.width / 4, r.width / 4]) dashes(ground, r.points, side, 3, 6, 0.15, 0.3, paint);
      } else if (!r.oneway) {
        dashes(ground, r.points, 0, 3, 6, 0.15, 0.3, paint);
      }
    }
    add(ground, flatMat, false);

    const facades = new Soup();
    const roofs = new Soup();
    for (const b of m.buildings) addBuilding(facades, roofs, b, opts.bySource);
    add(facades, this.facadeMaterial, true);
    add(roofs, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), true);

    const fences = new Soup();
    for (const b of m.barriers) {
      const color = colorOf(b.kind === 'hedge' ? '#4f7d3a' : b.kind === 'fence' ? '#5c6064' : '#c9c1b4');
      for (let i = 1; i < b.points.length; i++) {
        const [ax, az] = b.points[i - 1];
        const [bx, bz] = b.points[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const nx = (-(bz - az) / len) * (b.thickness / 2);
        const nz = ((bx - ax) / len) * (b.thickness / 2);
        for (const s of [1, -1]) {
          fences.quad([ax + nx * s, 0, az + nz * s], [bx + nx * s, 0, bz + nz * s], [bx + nx * s, b.height, bz + nz * s], [ax + nx * s, b.height, az + nz * s], color);
        }
        fences.quad([ax + nx, b.height, az + nz], [bx + nx, b.height, bz + nz], [bx - nx, b.height, bz - nz], [ax - nx, b.height, az - nz], color);
      }
    }
    add(fences, flatMat, true);

    // Temples and monuments mapped as a single point get a small marker.
    const pins = new Soup();
    for (const p of m.pois) {
      const c = colorOf(p.kind === 'worship' ? WORSHIP_ROOF : HERITAGE_ROOF);
      const [x, z] = p.at;
      const r = 1.6;
      for (let k = 0; k < 4; k++) {
        const a0 = (k / 4) * Math.PI * 2;
        const a1 = ((k + 1) / 4) * Math.PI * 2;
        pins.tri([x, 1, z], [x + Math.cos(a0) * r, 6, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, 6, z + Math.sin(a1) * r], c);
      }
    }
    add(pins, flatMat, true);

    for (const t of this.trees(decor)) group.add(t);
    this.cars = decor.cars.length ? { mesh: this.carMesh(decor), decor } : null;
    if (this.cars) group.add(this.cars.mesh);
    return group;
  }

  private trees(decor: Decor): THREE.Object3D[] {
    const n = decor.trees.length;
    if (!n) return [];
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.24, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshLambertMaterial({ color: '#7a5a3c' }),
      n,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      n,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const greens = ['#4f9a3c', '#5aa847', '#3f8a37', '#6db152', '#478f3f'].map(colorOf);
    decor.trees.forEach((t, i) => {
      const [x, z] = t.at;
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, t.height - t.crown * 0.6, 1));
      trunk.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.shade * 6);
      m.compose(new THREE.Vector3(x, t.height, z), q, new THREE.Vector3(t.crown, t.crown * 1.05, t.crown));
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, greens[Math.floor(t.shade * greens.length)]);
      q.identity();
    });
    for (const mesh of [trunk, crown]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    return [trunk, crown];
  }

  private carMesh(decor: Decor): THREE.InstancedMesh {
    // A body and a darker glass cabin, coloured per car.
    const body = new THREE.BoxGeometry(4.2, 1.0, 1.8).translate(0, 0.7, 0);
    const cabin = new THREE.BoxGeometry(2.3, 0.75, 1.6).translate(-0.25, 1.55, 0);
    const shade = (g: THREE.BufferGeometry, k: number) => {
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(k), 3));
      return g;
    };
    const parts = [shade(body, 1), shade(cabin, 0.32)];
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color'] as const) {
      const arrays = parts.map((p) => (p.index ? p.toNonIndexed() : p).getAttribute(name).array as Float32Array);
      const merged = new Float32Array(arrays.reduce((s, a) => s + a.length, 0));
      let o = 0;
      for (const a of arrays) {
        merged.set(a, o);
        o += a.length;
      }
      g.setAttribute(name, new THREE.BufferAttribute(merged, 3));
    }
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), decor.cars.length);
    decor.cars.forEach((c, i) => mesh.setColorAt(i, colorOf(CAR_COLORS[Math.floor(c.color * CAR_COLORS.length)])));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private moveCars(): void {
    if (!this.cars) return;
    const { mesh, decor } = this.cars;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const at = new THREE.Vector3();
    decor.cars.forEach((c, i) => {
      const p = carAt(c, this.clock);
      q.setFromAxisAngle(up, -p.angle);
      m.compose(at.set(p.x, 0.25, p.z), q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  private clear(): void {
    if (!this.content) return;
    this.scene.remove(this.content);
    this.content.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material;
        if (mat !== this.facadeMaterial) mat.dispose();
      }
    });
    this.content = null;
    this.cars = null;
  }

  private loop = (now: number): void => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.canvas.offsetParent) return; // hidden
    this.clock += dt;
    const g = this.glide;
    if (g) {
      const k = Math.min(1, (now - g.start) / g.duration);
      const e = k * k * (3 - 2 * k);
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(g.from.radius, g.to.radius, e),
        THREE.MathUtils.lerp(g.from.phi, g.to.phi, e),
        THREE.MathUtils.lerp(g.from.theta, g.to.theta, e),
      );
      this.controls.target.lerpVectors(g.fromTarget, g.toTarget, e);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      if (k >= 1) this.glide = null;
    }
    this.controls.update(dt);
    this.moveCars();
    // Keep the sun's shadow box over where the camera looks.
    const t = this.controls.target;
    const off = this.sun.position.clone().sub(this.sun.target.position);
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).add(off);
    this.renderer.render(this.scene, this.camera);
    const v = viewAngles(this.camera.position, t);
    const state = `${t.x.toFixed(1)},${t.z.toFixed(1)},${v.heading.toFixed(0)},${v.tilt.toFixed(0)}`;
    if (state !== this.lastState) {
      this.lastState = state;
      this.onViewChange({ target: [t.x, t.z], ...v });
    }
  };
}

