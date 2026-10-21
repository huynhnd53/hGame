import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { centroid, type Ring, ringBounds, type XZ } from './geo';
import { hash01, type SceneBuilding, type SceneModel } from './model';

/** Facade colours common on Vietnamese streets, for buildings whose colour is not mapped. */
const WALLS = [0xf1e6c8, 0xf3dc9b, 0xe9ede6, 0xcfe0e3, 0xf2d4c4, 0xe4e0d6, 0xdfe8c9, 0xf6efe2];
const ROOF = 0xb9b2a6;
const WORSHIP_WALL = 0xe8bf5a;
const WORSHIP_ROOF = 0x9c3a26;
const HERITAGE_WALL = 0xd8b88a;
const HERITAGE_ROOF = 0x76493a;
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

/** Non-indexed triangle soup with per-vertex colour, merged into one mesh per layer. */
class Soup {
  readonly pos: number[] = [];
  readonly col: number[] = [];

  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, color: THREE.Color): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  addGeometry(g: THREE.BufferGeometry, colorOf: (vertex: number) => THREE.Color): void {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      const c = colorOf(i);
      this.col.push(c.r, c.g, c.b);
    }
    if (ng !== g) ng.dispose();
  }

  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

/** Shape on the x/y plane that, after `rotateX(-PI/2)`, lies on the ground with world z = ring z. */
function shapeOf(outer: Ring, holes: Ring[]): THREE.Shape {
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  return shape;
}

function flatSurface(soup: Soup, outer: Ring, holes: Ring[], y: number, color: THREE.Color): void {
  if (outer.length < 3) return;
  const g = new THREE.ShapeGeometry(shapeOf(outer, holes));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  soup.addGeometry(g, () => color);
  g.dispose();
}

/** Ribbon along a polyline with round joints, for roads and rivers. */
function ribbon(soup: Soup, pts: XZ[], width: number, y: number, color: THREE.Color): void {
  const h = width / 2;
  const v = (x: number, z: number) => ({ x, y, z });
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const nx = (-(bz - az) / len) * h;
    const nz = ((bx - ax) / len) * h;
    soup.tri(v(ax + nx, az + nz), v(bx - nx, bz - nz), v(bx + nx, bz + nz), color);
    soup.tri(v(ax + nx, az + nz), v(ax - nx, az - nz), v(bx - nx, bz - nz), color);
  }
  // Fill the wedges at bends and round the ends.
  const n = 10;
  for (const [cx, cz] of pts) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      soup.tri(v(cx, cz), v(cx + Math.cos(a1) * h, cz + Math.sin(a1) * h), v(cx + Math.cos(a0) * h, cz + Math.sin(a0) * h), color);
    }
  }
}

function wallColor(b: SceneBuilding, bySource: boolean): THREE.Color {
  if (bySource) return new THREE.Color(SOURCE_COLORS[b.source]);
  const mapped = parseOsmColour(b.color);
  if (mapped !== null) return new THREE.Color(mapped);
  if (b.role === 'worship') return new THREE.Color(WORSHIP_WALL);
  if (b.role === 'heritage') return new THREE.Color(HERITAGE_WALL);
  return new THREE.Color(WALLS[Math.floor(hash01(b.id) * WALLS.length)]);
}

function roofColor(b: SceneBuilding, bySource: boolean): THREE.Color {
  if (bySource) return new THREE.Color(SOURCE_COLORS[b.source]).multiplyScalar(0.8);
  const mapped = parseOsmColour(b.roofColor);
  if (mapped !== null) return new THREE.Color(mapped);
  if (b.role === 'worship') return new THREE.Color(WORSHIP_ROOF);
  if (b.role === 'heritage') return new THREE.Color(HERITAGE_ROOF);
  return new THREE.Color(ROOF).offsetHSL(0, 0, (hash01(`${b.id}r`) - 0.5) * 0.12);
}

/** Pitched roofs are drawn as a pyramid over the footprint; very ragged footprints keep a flat top. */
const PITCHED = /^(gabled|hipped|pyramidal|half-hipped|gambrel|mansard|saltbox|side_hipped|round|dome|onion|cone)$/;

function addBuilding(walls: Soup, b: SceneBuilding, bySource: boolean): void {
  if (b.outer.length < 3) return;
  const depth = Math.max(0.5, b.height - b.minHeight);
  const g = new THREE.ExtrudeGeometry(shapeOf(b.outer, b.holes), { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b.minHeight, 0);
  const wall = wallColor(b, bySource);
  const roof = roofColor(b, bySource);
  // Group 0 is the caps (top and bottom faces), group 1 the walls.
  const caps = g.groups[0];
  const isCap = (i: number) => !!caps && i >= caps.start && i < caps.start + caps.count;
  walls.addGeometry(g, (i) => (isCap(i) ? roof : wall));
  g.dispose();

  if (PITCHED.test(b.roofShape) && b.roofHeight > 0 && b.outer.length <= 12 && !b.holes.length) {
    const [cx, cz] = centroid(b.outer);
    const top = b.height;
    const apex = { x: cx, y: top + b.roofHeight, z: cz };
    for (let i = 0; i < b.outer.length; i++) {
      const [ax, az] = b.outer[i];
      const [bx, bz] = b.outer[(i + 1) % b.outer.length];
      walls.tri({ x: ax, y: top, z: az }, { x: bx, y: top, z: bz }, apex, roof);
    }
  }
}

function addBarrier(soup: Soup, pts: XZ[], height: number, thickness: number, color: THREE.Color): void {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const g = new THREE.BoxGeometry(len, height, thickness);
    g.rotateY(-Math.atan2(bz - az, bx - ax));
    g.translate((ax + bx) / 2, height / 2, (az + bz) / 2);
    soup.addGeometry(g, () => color);
    g.dispose();
  }
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

interface Glide {
  from: THREE.Spherical;
  to: THREE.Spherical;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  duration: number;
}

/**
 * The 3D view of a built area. Drag to turn it, right-drag or two fingers to move it, wheel or pinch to zoom; the
 * buttons turn, tilt and zoom in steps. It spins slowly when first shown, until it is touched.
 */
export class AreaView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 8000);
  private readonly controls: OrbitControls;
  private content: THREE.Group | null = null;
  private model: SceneModel | null = null;
  private home: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private glide: Glide | null = null;
  private frame = 0;
  private last = 0;
  /** Called when spinning starts or stops, to update the button. */
  onSpinChange: (spinning: boolean) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xcfe3ef);
    this.scene.fog = new THREE.Fog(0xcfe3ef, 1500, 4000);
    this.scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x8a8170, 1.6));
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.8);
    sun.position.set(-300, 600, 200);
    this.scene.add(sun);
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

  show(model: SceneModel, opts: ViewOptions): void {
    const fresh = model !== this.model;
    this.model = model;
    this.clear();
    this.content = buildGroup(model, opts);
    this.scene.add(this.content);
    if (fresh) {
      this.frameArea(model.boundary);
      this.setSpin(true);
    }
    if (!this.frame) this.loop(performance.now());
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
    const r = Math.max(x1 - x0, z1 - z0, 80);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx + r * 0.35, r * 0.75, cz + r * 0.85);
    this.home = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.glide = null;
    this.controls.update();
  }

  private clear(): void {
    if (!this.content) return;
    this.scene.remove(this.content);
    this.content.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.content = null;
  }

  private loop = (now: number): void => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.canvas.offsetParent) return; // hidden behind the map
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
    this.renderer.render(this.scene, this.camera);
  };
}

export function buildGroup(m: SceneModel, opts: ViewOptions): THREE.Group {
  const group = new THREE.Group();
  const flatMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  // Ground layers, each a little above the last so they do not flicker.
  const ground = new Soup();
  flatSurface(ground, m.boundary, [], 0, new THREE.Color(0xd9d3c3));
  for (const s of m.yards) flatSurface(ground, s.outer, s.holes, 0.03, new THREE.Color(0xe6d6b0));
  for (const s of m.parks) flatSurface(ground, s.outer, s.holes, 0.06, new THREE.Color(0x8fbf6a));
  for (const s of m.water) flatSurface(ground, s.outer, s.holes, 0.09, new THREE.Color(0x5b9fd1));
  for (const w of m.waterways) if (!w.hidden) ribbon(ground, w.points, w.width, 0.1, new THREE.Color(0x5b9fd1));
  for (const s of m.roadAreas) flatSurface(ground, s.outer, s.holes, 0.12, new THREE.Color(0x8d8f91));
  const asphalt = new THREE.Color(0x6f7275);
  const path = new THREE.Color(0xb7ada0);
  // Small paths first so that bigger roads draw over them where they meet.
  const roads = [...m.roads].filter((r) => !r.hidden).sort((a, b) => a.width - b.width);
  roads.forEach((r, i) => {
    const foot = /^(footway|path|steps|cycleway|bridleway|pedestrian)$/.test(r.kind);
    ribbon(ground, r.points, r.width, 0.15 + i * 1e-5, foot ? path : asphalt);
  });
  const groundMesh = ground.mesh(flatMat());
  if (groundMesh) group.add(groundMesh);

  const walls = new Soup();
  for (const b of m.buildings) addBuilding(walls, b, opts.bySource);
  const wallMesh = walls.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }));
  if (wallMesh) group.add(wallMesh);

  const fences = new Soup();
  for (const b of m.barriers) {
    const color = new THREE.Color(b.kind === 'hedge' ? 0x4f7d3a : b.kind === 'fence' ? 0x55585a : 0xa9a196);
    addBarrier(fences, b.points, b.height, b.thickness, color);
  }
  const fenceMesh = fences.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }));
  if (fenceMesh) group.add(fenceMesh);

  // Temples and monuments mapped as a single point get a small marker.
  const pins = new Soup();
  for (const p of m.pois) {
    const g = new THREE.ConeGeometry(1.6, 5, 4);
    g.rotateX(Math.PI);
    g.translate(p.at[0], 6, p.at[1]);
    const c = new THREE.Color(p.kind === 'worship' ? WORSHIP_ROOF : HERITAGE_ROOF);
    pins.addGeometry(g, () => c);
    g.dispose();
  }
  const pinMesh = pins.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }));
  if (pinMesh) group.add(pinMesh);
  return group;
}
