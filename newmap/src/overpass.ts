import { type LonLat, openRing, signedArea } from './geo';

export const OVERPASS_PRIMARY = 'https://overpass-api.de/api/interpreter';
export const OVERPASS_FALLBACKS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
/** How long the main server gets before the others are asked too. */
export const FALLBACK_AFTER_MS = 7000;

export type Tags = Record<string, string>;

export type AreaKind = 'building' | 'water' | 'park' | 'worship' | 'heritage' | 'road';
export type LineKind = 'road' | 'waterway' | 'barrier';
export type PoiKind = 'worship' | 'heritage';

export interface Area {
  id: string;
  kind: AreaKind;
  /** Counter-clockwise outer ring (in lon/lat), stored open. */
  outer: LonLat[];
  holes: LonLat[][];
  tags: Tags;
}

export interface Line {
  id: string;
  kind: LineKind;
  points: LonLat[];
  tags: Tags;
}

export interface Poi {
  id: string;
  kind: PoiKind;
  at: LonLat;
  tags: Tags;
}

export interface OsmData {
  areas: Area[];
  lines: Line[];
  pois: Poi[];
}

interface GeomPoint {
  lat: number;
  lon: number;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Tags;
  geometry?: (GeomPoint | null)[];
  members?: { type: string; role: string; geometry?: (GeomPoint | null)[] }[];
}

export interface OverpassJson {
  elements: OverpassElement[];
  remark?: string;
}

/** Overpass QL for everything the scene needs inside a lon/lat polygon. */
export function buildQuery(polygon: LonLat[], timeoutS = 60): string {
  const poly = polygon.map(([lon, lat]) => `${lat.toFixed(7)} ${lon.toFixed(7)}`).join(' ');
  const p = `(poly:"${poly}")`;
  return [
    `[out:json][timeout:${timeoutS}];`,
    '(',
    `  way["building"]${p};`,
    `  relation["building"]["type"="multipolygon"]${p};`,
    `  way["highway"]${p};`,
    `  way["waterway"]${p};`,
    `  way["natural"="water"]${p};`,
    `  relation["natural"="water"]${p};`,
    `  way["water"]${p};`,
    `  way["landuse"~"^(reservoir|basin|grass|recreation_ground|village_green|forest|meadow|cemetery)$"]${p};`,
    `  way["leisure"~"^(park|garden|playground|pitch|nature_reserve)$"]${p};`,
    `  relation["leisure"~"^(park|garden)$"]${p};`,
    `  way["natural"~"^(wood|scrub|grassland)$"]${p};`,
    `  node["amenity"="place_of_worship"]${p};`,
    `  way["amenity"="place_of_worship"]${p};`,
    `  relation["amenity"="place_of_worship"]${p};`,
    `  node["historic"]${p};`,
    `  way["historic"]${p};`,
    `  way["barrier"~"^(wall|fence|city_wall|retaining_wall|hedge)$"]${p};`,
    ');',
    'out geom;',
  ].join('\n');
}

/** Which kind of area a closed way or multipolygon is, or null if the scene does not draw it as an area. */
export function areaKind(t: Tags): AreaKind | null {
  if (t.building && t.building !== 'no') return 'building';
  if (t.natural === 'water' || t.water || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') {
    return 'water';
  }
  if (t.amenity === 'place_of_worship') return 'worship';
  if (t.historic) return 'heritage';
  if (
    /^(park|garden|playground|pitch|nature_reserve)$/.test(t.leisure ?? '') ||
    /^(grass|recreation_ground|village_green|forest|meadow|cemetery)$/.test(t.landuse ?? '') ||
    /^(wood|scrub|grassland)$/.test(t.natural ?? '')
  ) {
    return 'park';
  }
  if (t.highway && t.area === 'yes') return 'road';
  return null;
}

export function lineKind(t: Tags): LineKind | null {
  if (t.highway && t.area !== 'yes') return 'road';
  if (t.waterway && t.waterway !== 'riverbank') return 'waterway';
  if (t.barrier) return 'barrier';
  return null;
}

const toLonLat = (g: (GeomPoint | null)[] | undefined): LonLat[] =>
  (g ?? []).filter((q): q is GeomPoint => !!q).map((q) => [q.lon, q.lat]);

const same = (a: LonLat, b: LonLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const isClosed = (pts: LonLat[]) => pts.length >= 4 && same(pts[0], pts[pts.length - 1]);

function ccw(ring: LonLat[]): LonLat[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/** Joins the member ways of a multipolygon into closed rings; open leftovers are dropped. */
export function assembleRings(parts: LonLat[][]): LonLat[][] {
  const pool = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: LonLat[][] = [];
  while (pool.length) {
    const ring = pool.shift()!;
    let grew = true;
    while (!isClosed(ring) && grew) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i];
        if (same(seg[0], end)) ring.push(...seg.slice(1));
        else if (same(seg[seg.length - 1], end)) ring.push(...seg.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (isClosed(ring)) rings.push(openRing(ring));
  }
  return rings;
}

/** Turns an Overpass `out geom` answer into areas, lines and points of interest. */
export function parseOverpass(json: OverpassJson): OsmData {
  const out: OsmData = { areas: [], lines: [], pois: [] };
  for (const el of json.elements) {
    const tags = el.tags ?? {};
    const id = `${el.type}/${el.id}`;
    if (el.type === 'node') {
      if (el.lon === undefined || el.lat === undefined) continue;
      const kind: PoiKind | null = tags.amenity === 'place_of_worship' ? 'worship' : tags.historic ? 'heritage' : null;
      if (kind) out.pois.push({ id, kind, at: [el.lon, el.lat], tags });
    } else if (el.type === 'way') {
      const pts = toLonLat(el.geometry);
      if (pts.length < 2) continue;
      const area = isClosed(pts) ? areaKind(tags) : null;
      if (area) {
        out.areas.push({ id, kind: area, outer: ccw(openRing(pts)), holes: [], tags });
        // A closed wall or fence is still drawn as a wall.
        if (tags.barrier && area !== 'building') out.lines.push({ id, kind: 'barrier', points: pts, tags });
        continue;
      }
      const line = lineKind(tags);
      if (line) out.lines.push({ id, kind: line, points: pts, tags });
    } else {
      const kind = areaKind(tags);
      if (!kind || !el.members) continue;
      const outer = assembleRings(el.members.filter((m) => m.role !== 'inner').map((m) => toLonLat(m.geometry)));
      const inner = assembleRings(el.members.filter((m) => m.role === 'inner').map((m) => toLonLat(m.geometry)));
      for (const [k, ring] of outer.entries()) {
        const holes = inner.filter((h) => pointInLonLatRing(h[0], ring));
        out.areas.push({ id: outer.length > 1 ? `${id}#${k}` : id, kind, outer: ccw(ring), holes, tags });
      }
    }
  }
  return out;
}

function pointInLonLatRing([x, y]: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface RaceOptions {
  fetch?: typeof fetch;
  primary?: string;
  fallbacks?: string[];
  fallbackAfterMs?: number;
  signal?: AbortSignal;
  /** Progress messages for the UI. */
  log?: (msg: string) => void;
}

export interface RaceResult {
  server: string;
  json: OverpassJson;
}

const host = (url: string) => new URL(url).host;

async function askOne(url: string, query: string, f: typeof fetch, signal: AbortSignal): Promise<OverpassJson> {
  // A form body keeps this a "simple" CORS request, so there is no preflight.
  const res = await f(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as OverpassJson;
  if (!Array.isArray(json.elements)) throw new Error('không phải dữ liệu Overpass');
  // Overpass reports timeouts and memory limits as a 200 with a remark and partial data.
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
  return json;
}

/**
 * Asks the main Overpass server; if it has not answered after `fallbackAfterMs` (or fails sooner), also asks the
 * fallbacks. The first good answer wins and the other requests are cancelled.
 */
export function raceOverpass(query: string, opts: RaceOptions = {}): Promise<RaceResult> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const primary = opts.primary ?? OVERPASS_PRIMARY;
  const fallbacks = opts.fallbacks ?? OVERPASS_FALLBACKS;
  const delay = opts.fallbackAfterMs ?? FALLBACK_AFTER_MS;
  const log = opts.log ?? (() => {});

  return new Promise<RaceResult>((resolve, reject) => {
    const controllers: AbortController[] = [];
    const errors: string[] = [];
    let pending = 0;
    let fallbacksStarted = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (winner?: AbortController) => {
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      for (const c of controllers) if (c !== winner) c.abort();
    };
    const onAbort = () => {
      if (done) return;
      finish();
      reject(new DOMException('Đã huỷ', 'AbortError'));
    };
    const start = (url: string) => {
      const c = new AbortController();
      controllers.push(c);
      pending++;
      log(`Hỏi ${host(url)}…`);
      askOne(url, query, f, c.signal).then(
        (json) => {
          if (done) return;
          finish(c);
          resolve({ server: host(url), json });
        },
        (err: unknown) => {
          pending--;
          if (done) return;
          const msg = `${host(url)}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          log(`${msg}`);
          if (!fallbacksStarted) startFallbacks();
          else if (pending === 0) {
            finish();
            reject(new Error(`Không máy Overpass nào trả lời được (${errors.join('; ')})`));
          }
        },
      );
    };
    const startFallbacks = () => {
      if (fallbacksStarted || done) return;
      fallbacksStarted = true;
      clearTimeout(timer);
      for (const url of fallbacks) start(url);
      if (pending === 0) {
        finish();
        reject(new Error(`Không máy Overpass nào trả lời được (${errors.join('; ')})`));
      }
    };

    if (opts.signal?.aborted) {
      reject(new DOMException('Đã huỷ', 'AbortError'));
      return;
    }
    opts.signal?.addEventListener('abort', onAbort);
    timer = setTimeout(() => {
      if (!done) log(`Sau ${delay / 1000} s chưa có trả lời, hỏi thêm máy dự phòng.`);
      startFallbacks();
    }, delay);
    start(primary);
  });
}
