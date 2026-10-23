import * as THREE from 'three';
import { type City, GRID, HALF, ROAD, SIDEWALK } from '../../sim/city';
import { mulberry32, type Rect } from '../../sim/geometry';
import { AMBIENT, bakeLight, LightGrid } from './bake';
import { type BillboardItem, billboards, loadTexture } from './billboards';
import { buildFacadeAtlas, buildSignAtlas } from './facade';
import { buildHouses, QuadBuilder, type StreetLight } from './houses';
import { alongRoad, lampSpots } from './layout';
import { buildStreetLife } from './streetLife';
import { canvas, makeNoise, paint, radialTexture, toTexture } from './proc';
import * as S from './surfaces';

export const FOG_COLOR = new THREE.Color(0x07090e);
export const FOG_DENSITY = 0.012;
const CURB_H = 0.16;
const UP = new THREE.Vector3(0, 1, 0);
const SODIUM = new THREE.Color(1.0, 0.62, 0.3);

/** Asset proportions (metres) and where each cut-out touches the ground. */
const LAMP = { height: 8, width: 8 * (220 / 431), anchorX: 0.073, headU: 0.9, headV: 0.96 };
const TRAFFIC = { height: 4.6, width: 4.6 * (111 / 360), anchorX: 0.392 };
const BENCH = { width: 1.9, height: 1.9 / 1.471 };
const PLANTER = { width: 2.2, height: 2.2 * (202 / 416) };
const CONE = { height: 0.75, width: 0.75 * (227 / 313) };

export interface Lamp {
  base: THREE.Vector3;
  /** Horizontal direction from the pole towards the road. */
  out: THREE.Vector3;
}

export interface NightCity {
  group: THREE.Group;
  /** Headlight pool on the road; the game moves it with the scooter. */
  headlight: THREE.Mesh;
  /** Street furniture on the sidewalks the scooter bumps into (lamp posts, planters, benches, cones). */
  obstacles: Rect[];
  /** Light level at a point, roughly 0..1, used to dim the cockpit photo. */
  levelAt(x: number, z: number): number;
}

export function layoutLamps(city: City): Lamp[] {
  const lamps: Lamp[] = [];
  for (const r of city.roads) {
    for (const side of [-1, 1]) {
      for (const t of lampSpots(city, side)) {
        const across = r + side * (ROAD / 2 + 0.45);
        lamps.push({ base: new THREE.Vector3(across, CURB_H, t), out: new THREE.Vector3(-side, 0, 0) });
        lamps.push({ base: new THREE.Vector3(t, CURB_H, across), out: new THREE.Vector3(0, 0, -side) });
      }
    }
  }
  return lamps;
}

/** A flat grid (for smooth baked light) with world-scaled UVs. */
function groundGrid(x0: number, z0: number, x1: number, z1: number, y: number, step: number, uvScale: number): THREE.BufferGeometry {
  const w = x1 - x0;
  const d = z1 - z0;
  const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / step)), Math.max(1, Math.round(d / step)));
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / uvScale, -pos.getZ(i) / uvScale);
  return g;
}

function wearTexture(): THREE.Texture {
  const size = 128;
  const { fbm } = makeNoise(91);
  const [c, ctx] = canvas(size, size);
  paint(ctx, size, size, (x, y) => {
    const v = fbm(x / size, y / size, 8, 4) > 0.3 ? 255 : 0;
    return [v, v, v];
  });
  return toTexture(c, false);
}

function skyDome(): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = mix(vec3(0.045, 0.035, 0.035), vec3(0.012, 0.016, 0.03), smoothstep(0.0, 0.18, h));
        c = mix(c, vec3(0.004, 0.007, 0.018), smoothstep(0.18, 0.8, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

function basic(opts: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, ...opts });
}

export function buildNightCity(city: City, assetBase: string): NightCity {
  const group = new THREE.Group();
  group.add(skyDome());
  const rand = mulberry32(4242);
  const edge = HALF + ROAD / 2;
  const outer = edge + SIDEWALK + 16;

  // ---- Light sources (only used for baking) -------------------------------------------------
  const lamps = layoutLamps(city);
  const lights: StreetLight[] = lamps.map((l) => ({
    pos: l.base.clone().addScaledVector(l.out, 3).setY(7.6),
    color: SODIUM,
    strength: 3.4,
    radius: 6,
  }));
  const parkLamps: THREE.Vector3[] = [];
  for (const b of city.blocks) {
    if (b.kind === 'houses') continue;
    const r = b.inner.w / 2 - 2.2;
    const count = b.kind === 'lake' ? 6 : 4;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.PI / 4;
      parkLamps.push(new THREE.Vector3(b.inner.x + Math.cos(a) * r, CURB_H, b.inner.z + Math.sin(a) * r));
    }
  }
  for (const p of parkLamps) lights.push({ pos: p.clone().setY(5.5), color: SODIUM, strength: 2.4, radius: 4.5 });

  const atlas = buildFacadeAtlas(`${assetBase}props/`);
  const signs = buildSignAtlas();
  const lots = [...city.blocks.flatMap((b) => b.lots), ...city.outerLots];
  const houses = buildHouses(lots, atlas, signs.count);
  lights.push(...houses.lights);
  const grid = new LightGrid(lights);

  // ---- Ground -------------------------------------------------------------------------------
  // Photo asphalt (it repeats every 6 m), darkened from daylight to a night road.
  const asphalt = loadTexture(`${assetBase}props/asphalt.webp`);
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  const road = bakeLight(groundGrid(-outer, -outer, outer, outer, 0, 2.5, 6), grid);
  group.add(new THREE.Mesh(road, basic({ map: asphalt, color: new THREE.Color().setScalar(0.42) })));

  const tiles = S.sidewalkTiles(256);
  const walkGeos: THREE.BufferGeometry[] = [];
  for (const b of city.blocks) {
    const r = b.rect;
    walkGeos.push(groundGrid(r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2, CURB_H, 2.5, 2));
  }
  walkGeos.push(groundGrid(-outer, -outer, outer, -edge, CURB_H, 2.5, 2));
  walkGeos.push(groundGrid(-outer, edge, outer, outer, CURB_H, 2.5, 2));
  walkGeos.push(groundGrid(-outer, -edge, -edge, edge, CURB_H, 2.5, 2));
  walkGeos.push(groundGrid(edge, -edge, outer, edge, CURB_H, 2.5, 2));
  for (const g of walkGeos) {
    bakeLight(g, grid);
    group.add(new THREE.Mesh(g, basic({ map: tiles.map })));
  }

  // Curb faces around every block and along the outside of the ring road.
  const curb = new QuadBuilder();
  const white = new THREE.Color(1, 1, 1);
  const curbFace = (o: THREE.Vector3, along: THREE.Vector3, n: THREE.Vector3) =>
    curb.quad(o, along, new THREE.Vector3(0, CURB_H, 0), n, [0, 0, along.length() / 2, 1], white);
  for (const b of city.blocks) {
    const { x, z, w, d } = b.rect;
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    curbFace(new THREE.Vector3(x1, 0, z0), new THREE.Vector3(-w, 0, 0), new THREE.Vector3(0, 0, -1));
    curbFace(new THREE.Vector3(x0, 0, z1), new THREE.Vector3(w, 0, 0), new THREE.Vector3(0, 0, 1));
    curbFace(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(0, 0, d), new THREE.Vector3(-1, 0, 0));
    curbFace(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(0, 0, -d), new THREE.Vector3(1, 0, 0));
  }
  curbFace(new THREE.Vector3(-edge, 0, -edge), new THREE.Vector3(edge * 2, 0, 0), new THREE.Vector3(0, 0, 1));
  curbFace(new THREE.Vector3(edge, 0, edge), new THREE.Vector3(-edge * 2, 0, 0), new THREE.Vector3(0, 0, -1));
  curbFace(new THREE.Vector3(-edge, 0, edge), new THREE.Vector3(0, 0, -edge * 2), new THREE.Vector3(1, 0, 0));
  curbFace(new THREE.Vector3(edge, 0, -edge), new THREE.Vector3(0, 0, edge * 2), new THREE.Vector3(-1, 0, 0));
  group.add(new THREE.Mesh(bakeLight(curb.build(), grid), basic({ map: S.curbStone().map })));

  // Road markings.
  const paintQ = new QuadBuilder();
  const flat = (cx: number, cz: number, w: number, d: number) =>
    paintQ.quad(new THREE.Vector3(cx - w / 2, 0.015, cz + d / 2), new THREE.Vector3(w, 0, 0), new THREE.Vector3(0, 0, -d), UP, [cx / 3, cz / 3, (cx + w) / 3, (cz + d) / 3], white);
  for (const r of city.roads) {
    for (let k = 0; k < GRID; k++) {
      const a = city.roads[k] + ROAD / 2 + 4.2;
      const b = city.roads[k + 1] - ROAD / 2 - 4.2;
      for (let t = a; t + 3 <= b; t += 7) {
        flat(r, t + 1.5, 0.14, 3);
        flat(t + 1.5, r, 3, 0.14);
      }
      for (const s of [-1, 1]) {
        const off = r + s * (ROAD / 2 - 0.5);
        flat(off, (a + b) / 2, 0.12, b - a);
        flat((a + b) / 2, off, b - a, 0.12);
      }
    }
  }
  for (const rx of city.roads) {
    for (const rz of city.roads) {
      for (const dir of [-1, 1]) {
        const zc = rz + dir * (ROAD / 2 + 2.2);
        if (Math.abs(zc) < edge) for (let s = -ROAD / 2 + 0.8; s < ROAD / 2 - 0.5; s += 1.1) flat(rx + s + 0.25, zc, 0.5, 3);
        const xc = rx + dir * (ROAD / 2 + 2.2);
        if (Math.abs(xc) < edge) for (let s = -ROAD / 2 + 0.8; s < ROAD / 2 - 0.5; s += 1.1) flat(xc, rz + s + 0.25, 3, 0.5);
      }
    }
  }
  const paintGeo = bakeLight(paintQ.build(), grid);
  const paintCol = paintGeo.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < paintCol.count; i++) paintCol.setXYZ(i, paintCol.getX(i) * 0.32, paintCol.getY(i) * 0.31, paintCol.getZ(i) * 0.29);
  group.add(
    new THREE.Mesh(
      paintGeo,
      basic({ alphaMap: wearTexture(), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    ),
  );

  // ---- Houses -------------------------------------------------------------------------------
  // Walls take less of the street light than the ground, which keeps upper floors dark like the references.
  const wallTone = new THREE.Color(0.62, 0.6, 0.58);
  group.add(new THREE.Mesh(bakeLight(houses.facades, grid, 0.5), basic({ map: atlas.map, color: wallTone })));
  group.add(new THREE.Mesh(bakeLight(houses.trim, grid, 0.5), basic({ map: atlas.map, color: wallTone })));
  group.add(new THREE.Mesh(bakeLight(houses.railings, grid), basic({ map: S.railing(), alphaTest: 0.5, side: THREE.DoubleSide })));
  const awningTex = loadTexture(`${assetBase}props/awnings.webp`);
  awningTex.wrapS = THREE.RepeatWrapping;
  group.add(new THREE.Mesh(bakeLight(houses.awnings, grid), basic({ map: awningTex, alphaTest: 0.5, side: THREE.DoubleSide })));
  group.add(new THREE.Mesh(houses.signs, new THREE.MeshBasicMaterial({ map: signs.map, color: new THREE.Color(0.85, 0.85, 0.85) })));
  group.add(
    new THREE.Mesh(
      houses.glowPanels,
      new THREE.MeshBasicMaterial({
        map: atlas.emissiveMap,
        color: new THREE.Color(1.1, 1.1, 1.1),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    ),
  );

  // Street-light level at a point, for the cut-out photos that are not baked per vertex.
  const lightAt = (p: THREE.Vector3) => {
    const c = grid.shade(p.clone().setY(p.y + 1), UP, new THREE.Color());
    const lum = AMBIENT.g + c.g * 0.6 + c.r * 0.4;
    return THREE.MathUtils.clamp(0.25 + lum * 0.7, 0.3, 1.25);
  };

  // ---- Landmarks (kept simple) ----------------------------------------------------------------
  // Low railings round the parks and the lake, with a gap in the middle of each side to walk in.
  const fences = new QuadBuilder();
  const FENCE_W = 2.4;
  const FENCE_H = 1.15;
  for (const b of city.blocks) {
    if (b.kind !== 'park' && b.kind !== 'lake') continue;
    const i = b.inner;
    const sides: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(i.x - i.w / 2, CURB_H, i.z - i.d / 2), new THREE.Vector3(1, 0, 0)],
      [new THREE.Vector3(i.x + i.w / 2, CURB_H, i.z - i.d / 2), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(i.x + i.w / 2, CURB_H, i.z + i.d / 2), new THREE.Vector3(-1, 0, 0)],
      [new THREE.Vector3(i.x - i.w / 2, CURB_H, i.z + i.d / 2), new THREE.Vector3(0, 0, -1)],
    ];
    for (const [corner, dir] of sides) {
      const len = i.w;
      const panels = Math.floor(len / FENCE_W);
      for (let k = 0; k < panels; k++) {
        const mid = (k + 0.5) * FENCE_W;
        if (Math.abs(mid - len / 2) < FENCE_W) continue;
        const o = corner.clone().addScaledVector(dir, k * FENCE_W);
        const shade = lightAt(o.clone().setY(1)) * 0.8;
        fences.quad(o, dir.clone().multiplyScalar(FENCE_W), new THREE.Vector3(0, FENCE_H, 0), new THREE.Vector3(-dir.z, 0, dir.x), [0, 0, 1, 1], new THREE.Color().setScalar(shade));
      }
    }
  }
  group.add(new THREE.Mesh(fences.build(), basic({ map: loadTexture(`${assetBase}props/fence.webp`), alphaTest: 0.5, side: THREE.DoubleSide })));

  for (const b of city.blocks) {
    if (b.kind === 'houses') continue;
    const i = b.inner;
    const top = groundGrid(i.x - i.w / 2, i.z - i.d / 2, i.x + i.w / 2, i.z + i.d / 2, CURB_H + 0.01, 2.5, 2);
    bakeLight(top, grid);
    if (b.kind === 'plaza') {
      group.add(new THREE.Mesh(top, basic({ map: tiles.map })));
      const basin = new THREE.CylinderGeometry(5, 5.3, 0.6, 32);
      basin.translate(i.x, CURB_H + 0.3, i.z);
      group.add(new THREE.Mesh(bakeLight(basin, grid), basic({ map: S.curbStone().map })));
      const water = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), new THREE.MeshBasicMaterial({ color: 0x0a1a26 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(i.x, CURB_H + 0.55, i.z);
      group.add(water);
    } else {
      const grassCol = top.getAttribute('color') as THREE.BufferAttribute;
      for (let k = 0; k < grassCol.count; k++) grassCol.setXYZ(k, grassCol.getX(k) * 0.16, grassCol.getY(k) * 0.24, grassCol.getZ(k) * 0.12);
      group.add(new THREE.Mesh(top, basic({})));
      if (b.kind === 'lake') {
        const water = new THREE.Mesh(new THREE.CircleGeometry(i.w / 2 - 3.5, 48), new THREE.MeshBasicMaterial({ color: 0x050b12 }));
        water.rotation.x = -Math.PI / 2;
        water.position.set(i.x, CURB_H + 0.03, i.z);
        group.add(water);
      }
    }
  }

  // ---- Cut-out street furniture from the photo assets ----------------------------------------

  const lampTex = loadTexture(`${assetBase}lamp.png`);
  group.add(
    billboards(lampTex, lamps.map((l) => ({ pos: l.base, out: l.out })), { ...LAMP, brightness: 0.6 }),
  );
  group.add(
    billboards(lampTex, parkLamps.map((p) => ({ pos: p, out: new THREE.Vector3(1, 0, 0) })), {
      height: LAMP.height * 0.7,
      width: LAMP.width * 0.7,
      anchorX: LAMP.anchorX,
      brightness: 0.6,
    }),
  );
  // Warm halo around each lamp head, placed where the head is in the photo.
  const glowTex = radialTexture(128, [
    [0, 'rgba(255,220,170,1)'],
    [0.12, 'rgba(255,190,120,0.7)'],
    [0.4, 'rgba(255,150,70,0.15)'],
    [1, 'rgba(255,140,60,0)'],
  ]);
  const halo = (items: BillboardItem[], scale: number) =>
    billboards(glowTex, items, {
      width: 3 * scale,
      height: 3 * scale,
      anchorX: 0.5,
      offset: new THREE.Vector2((LAMP.headU - LAMP.anchorX) * LAMP.width * scale, LAMP.headV * LAMP.height * scale - 1.5 * scale),
      additive: true,
      brightness: 0.9,
    });
  group.add(halo(lamps.map((l) => ({ pos: l.base, out: l.out })), 1));
  group.add(halo(parkLamps.map((p) => ({ pos: p, out: new THREE.Vector3(1, 0, 0) })), 0.7));

  // Traffic lights on two corners of every inner junction.
  const traffic: BillboardItem[] = [];
  for (let i = 1; i < GRID; i++) {
    for (let j = 1; j < GRID; j++) {
      const rx = city.roads[i];
      const rz = city.roads[j];
      for (const [sx, sz] of [
        [1, -1],
        [-1, 1],
      ]) {
        const p = new THREE.Vector3(rx + sx * (ROAD / 2 + 0.7), CURB_H, rz + sz * (ROAD / 2 + 0.7));
        traffic.push({ pos: p, out: new THREE.Vector3(-sx, 0, 0), light: lightAt(p) });
      }
    }
  }
  group.add(billboards(loadTexture(`${assetBase}traffic-light.png`), traffic, { ...TRAFFIC, brightness: 0.75 }));

  // Planters (and now and then a bench) along the sidewalks, between the lamps.
  const planters: BillboardItem[] = [];
  const benches: BillboardItem[] = [];
  for (const r of city.roads) {
    for (const side of [-1, 1]) {
      const lampsHere = lampSpots(city, side);
      for (const t of alongRoad(city, 13, side < 0 ? 12.5 : 25.5, 3)) {
        for (const axis of ['x', 'z'] as const) {
          const roll = rand();
          if (roll < 0.3 || lampsHere.some((l) => Math.abs(l - t) < 2.4)) continue;
          const across = r + side * (ROAD / 2 + 1.4);
          const p = axis === 'x' ? new THREE.Vector3(across, CURB_H, t) : new THREE.Vector3(t, CURB_H, across);
          (roll < 0.42 ? benches : planters).push({ pos: p, light: lightAt(p) });
        }
      }
    }
  }
  for (const b of city.blocks) {
    if (b.kind === 'houses') continue;
    const r = b.inner.w / 2 - 5;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const p = new THREE.Vector3(b.inner.x + Math.cos(a) * r, CURB_H, b.inner.z + Math.sin(a) * r);
      (k % 2 === 0 ? benches : planters).push({ pos: p, light: lightAt(p) });
    }
  }
  group.add(billboards(loadTexture(`${assetBase}planter.png`), planters, { ...PLANTER, anchorX: 0.5, brightness: 0.8 }));
  group.add(billboards(loadTexture(`${assetBase}props/concrete-bench.webp`), benches, { ...BENCH, anchorX: 0.5, brightness: 0.8 }));

  // A few clusters of traffic cones on sidewalk corners.
  const cones: BillboardItem[] = [];
  for (let k = 0; k < 14; k++) {
    const rx = city.roads[1 + Math.floor(rand() * (GRID - 1))];
    const rz = city.roads[1 + Math.floor(rand() * (GRID - 1))];
    const sx = rand() < 0.5 ? -1 : 1;
    const sz = rand() < 0.5 ? -1 : 1;
    for (let c = 0; c < 3; c++) {
      const p = new THREE.Vector3(rx + sx * (ROAD / 2 + 1.2 + c * 1.1), CURB_H, rz + sz * (ROAD / 2 + 2.5));
      cones.push({ pos: p, light: lightAt(p) });
    }
  }
  group.add(billboards(loadTexture(`${assetBase}cone.png`), cones, { ...CONE, anchorX: 0.5, brightness: 0.8 }));

  // ---- Everyday street life from the photo props ----------------------------------------------------
  const life = buildStreetLife(city, lots, assetBase, lightAt, mulberry32(777));
  group.add(life.group);

  // ---- Headlight pool ---------------------------------------------------------------------------
  const [hc, hctx] = canvas(128, 256);
  const grad = hctx.createRadialGradient(64, 250, 4, 64, 200, 210);
  grad.addColorStop(0, 'rgba(255,240,215,0.9)');
  grad.addColorStop(0.4, 'rgba(255,225,190,0.35)');
  grad.addColorStop(1, 'rgba(255,220,180,0)');
  hctx.fillStyle = grad;
  hctx.fillRect(0, 0, 128, 256);
  const headTex = new THREE.CanvasTexture(hc);
  headTex.colorSpace = THREE.SRGBColorSpace;
  const headGeo = new THREE.PlaneGeometry(4.5, 13);
  headGeo.rotateX(-Math.PI / 2);
  // Local −z is forward; shift so the near edge sits just ahead of the bike.
  headGeo.translate(0, 0, -7);
  const headlight = new THREE.Mesh(
    headGeo,
    new THREE.MeshBasicMaterial({
      map: headTex,
      color: new THREE.Color(0.26, 0.24, 0.2),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  headlight.renderOrder = 2;
  group.add(headlight);

  // Footprints of the sidewalk furniture, so riding on the sidewalk means weaving around it.
  const box = (p: THREE.Vector3, size: number): Rect => ({ x: p.x, z: p.z, w: size, d: size });
  const obstacles: Rect[] = [
    ...lamps.map((l) => box(l.base, 0.3)),
    ...parkLamps.map((p) => box(p, 0.3)),
    ...traffic.map((t) => box(t.pos, 0.3)),
    ...planters.map((p) => box(p.pos, 1.2)),
    ...benches.map((p) => box(p.pos, 1.0)),
    ...cones.map((p) => box(p.pos, 0.35)),
    ...life.obstacles,
  ];

  return {
    group,
    headlight,
    obstacles,
    levelAt(x, z) {
      const c = grid.shade(new THREE.Vector3(x, 1.2, z), UP, new THREE.Color());
      return Math.min(1, (c.r + c.g) * 0.35);
    },
  };
}
