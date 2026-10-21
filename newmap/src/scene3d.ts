import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
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

/** The 3D view of a built area: drag to pan, right-drag or two fingers to orbit, wheel or pinch to zoom. */
export class AreaView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 8000);
  private readonly controls: MapControls;
  private content: THREE.Group | null = null;
  private model: SceneModel | null = null;
  private frame = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xcfe3ef);
    this.scene.fog = new THREE.Fog(0xcfe3ef, 1500, 4000);
    this.scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x8a8170, 1.6));
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.8);
    sun.position.set(-300, 600, 200);
    this.scene.add(sun);
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 3000;
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
    if (fresh) this.frameArea(model.boundary);
    if (!this.frame) this.loop();
  }

  private frameArea(boundary: Ring): void {
    const [x0, z0, x1, z1] = ringBounds(boundary);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = Math.max(x1 - x0, z1 - z0, 80);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx + r * 0.35, r * 0.75, cz + r * 0.85);
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

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.canvas.offsetParent) return; // hidden behind the map
    this.controls.update();
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
