import { type AsyncBuffer, type FileMetaData, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { type BBox, bboxesOverlap, bboxOf, centroid, type LonLat, openRing } from './geo';
import { cellContains, leafCellId, parseCellId } from './s2';

/** Google + Microsoft footprints, merged by VIDA, on Source Cooperative. */
export const OB_HOST = 'https://data.source.coop';
export const OB_ACCOUNT = 'vida';
export const OB_REPO = 'google-microsoft-open-buildings';
export const OB_PREFIX = `${OB_HOST}/${OB_ACCOUNT}/${OB_REPO}/geoparquet`;

/** Never pull more than this for one area, whatever the file layout turns out to be. */
export const MAX_READ_BYTES = 120 * 1024 * 1024;

export interface Footprint {
  outer: LonLat[];
  holes: LonLat[][];
  /** 0–1, or null when the source gives none. */
  confidence: number | null;
  /** "google" or "microsoft". */
  source: string | null;
}

export interface ReadStats {
  file: string;
  bytesRead: number;
  fileBytes: number;
  rowGroupsRead: number;
  rowGroupsTotal: number;
}

type Log = (msg: string) => void;

/** Path of the per-tile files of a country inside the dataset. */
export const tilesPrefix = (iso3: string) => `${OB_REPO}/geoparquet/by_country_s2/country_iso=${iso3}/`;
export const countryFileUrl = (iso3: string) => `${OB_PREFIX}/by_country/country_iso=${iso3}/${iso3}.parquet`;

/** Pulls `<Key>` entries (and the continuation token) out of an S3 ListObjectsV2 answer. */
export function parseListing(xml: string): { keys: string[]; next: string | null } {
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => decodeXml(m[1]));
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = truncated ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null) : null;
  return { keys, next: next && decodeXml(next) };
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Lists the tile files of a country. The data proxy speaks the S3 API; the account is the bucket. Returns full
 * file URLs, or an empty list when the country is not split into tiles.
 */
export async function listTiles(iso3: string, f: typeof fetch = fetch, signal?: AbortSignal): Promise<string[]> {
  const prefix = tilesPrefix(iso3);
  const urls: string[] = [];
  let token: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ 'list-type': '2', prefix });
    if (token) q.set('continuation-token', token);
    const res = await f(`${OB_HOST}/${OB_ACCOUNT}?${q}`, { signal });
    if (!res.ok) throw new Error(`liệt kê ô HTTP ${res.status}`);
    const { keys, next } = parseListing(await res.text());
    for (const k of keys) if (k.endsWith('.parquet')) urls.push(`${OB_HOST}/${OB_ACCOUNT}/${k}`);
    if (!next) break;
    token = next;
  }
  return urls;
}

/** S2 cell of a tile file, from its name (`…/3170534137668829184.parquet`). */
export function tileCell(url: string): bigint | null {
  const m = url.match(/\/(-?\d+)\.parquet$/);
  return m ? parseCellId(m[1]) : null;
}

/** The tile files that cover any corner or the middle of the area. */
export function tilesForArea(tiles: string[], polygon: LonLat[]): string[] {
  const probes = [...polygon, centroid(polygon)].map(([lon, lat]) => leafCellId(lon, lat));
  return tiles.filter((url) => {
    const cell = tileCell(url);
    return cell !== null && probes.some((p) => cellContains(cell, p));
  });
}

/**
 * A file that is only ever read in ranges. If the server ignores the Range header and starts sending the whole
 * (multi-GB) file, the request is cancelled instead.
 */
export async function rangeOnlyFile(
  url: string,
  f: typeof fetch,
  stats: { bytesRead: number },
  signal?: AbortSignal,
): Promise<AsyncBuffer> {
  const head = await f(url, { method: 'HEAD', signal });
  if (!head.ok) throw new Error(`HTTP ${head.status}`);
  const byteLength = Number(head.headers.get('content-length'));
  if (!(byteLength > 0)) throw new Error('không biết cỡ file');
  // Ranges already fetched (the footer read usually covers the end of the file), so no byte is fetched twice.
  const have: { start: number; buf: ArrayBuffer }[] = [];
  return {
    byteLength,
    async slice(start: number, end?: number) {
      const stop = Math.min(end ?? byteLength, byteLength);
      const hit = have.find((h) => start >= h.start && stop <= h.start + h.buf.byteLength);
      if (hit) return hit.buf.slice(start - hit.start, stop - hit.start);
      const ctrl = new AbortController();
      const abort = () => ctrl.abort();
      signal?.addEventListener('abort', abort);
      try {
        const res = await f(url, { headers: { Range: `bytes=${start}-${stop - 1}` }, signal: ctrl.signal });
        if (res.status !== 206) {
          ctrl.abort();
          throw new Error(res.ok ? 'máy chủ không cho đọc từng đoạn' : `HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        stats.bytesRead += buf.byteLength;
        have.push({ start, buf });
        return buf;
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

interface Columns {
  geometry: string;
  confidence: string | null;
  source: string | null;
  /** Column paths holding each footprint's bounding box, for pruning row groups. */
  bbox: { xmin: string[]; ymin: string[]; xmax: string[]; ymax: string[] } | null;
}

/** Finds the geometry, confidence, source and bounding box columns, from the GeoParquet metadata where possible. */
export function findColumns(meta: FileMetaData): Columns {
  const names = new Set(meta.row_groups[0]?.columns.map((c) => c.meta_data?.path_in_schema.join('.') ?? '') ?? []);
  const top = new Set(meta.schema.slice(1).map((s) => s.name));
  let geometry = 'geometry';
  let bbox: Columns['bbox'] = null;
  const geo = meta.key_value_metadata?.find((kv) => kv.key === 'geo')?.value;
  if (geo) {
    try {
      const g = JSON.parse(geo) as {
        primary_column?: string;
        columns?: Record<string, { covering?: { bbox?: Record<'xmin' | 'ymin' | 'xmax' | 'ymax', string[]> } }>;
      };
      geometry = g.primary_column ?? geometry;
      const cov = g.columns?.[geometry]?.covering?.bbox;
      if (cov?.xmin && cov.ymin && cov.xmax && cov.ymax) bbox = { xmin: cov.xmin, ymin: cov.ymin, xmax: cov.xmax, ymax: cov.ymax };
    } catch {
      // Unreadable metadata: fall through to guessing by name.
    }
  }
  if (!bbox) {
    for (const [x0, y0, x1, y1] of [
      ['bbox.xmin', 'bbox.ymin', 'bbox.xmax', 'bbox.ymax'],
      ['bbox.minx', 'bbox.miny', 'bbox.maxx', 'bbox.maxy'],
      ['xmin', 'ymin', 'xmax', 'ymax'],
      ['minx', 'miny', 'maxx', 'maxy'],
    ]) {
      if (names.has(x0) && names.has(y0) && names.has(x1) && names.has(y1)) {
        bbox = { xmin: x0.split('.'), ymin: y0.split('.'), xmax: x1.split('.'), ymax: y1.split('.') };
        break;
      }
    }
  }
  return {
    geometry,
    confidence: top.has('confidence') ? 'confidence' : null,
    source: top.has('bf_source') ? 'bf_source' : null,
    bbox,
  };
}

const toNumber = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null;

/**
 * Row groups whose footprints may touch `area`, by the min/max statistics of the bbox columns. A row group without
 * statistics is kept, since nothing proves it is elsewhere.
 */
export function rowGroupsFor(meta: FileMetaData, cols: Columns, area: BBox): number[] {
  if (!cols.bbox) return [];
  const { xmin, ymin, xmax, ymax } = cols.bbox;
  const out: number[] = [];
  meta.row_groups.forEach((rg, i) => {
    const stat = (path: string[], which: 'min' | 'max') => {
      const c = rg.columns.find((cc) => cc.meta_data?.path_in_schema.join('.') === path.join('.'));
      const s = c?.meta_data?.statistics;
      return toNumber(which === 'min' ? (s?.min_value ?? s?.min) : (s?.max_value ?? s?.max));
    };
    const box = { minLon: stat(xmin, 'min'), minLat: stat(ymin, 'min'), maxLon: stat(xmax, 'max'), maxLat: stat(ymax, 'max') };
    if (box.minLon === null || box.minLat === null || box.maxLon === null || box.maxLat === null) out.push(i);
    else if (bboxesOverlap(box as BBox, area)) out.push(i);
  });
  return out;
}

/** Compressed bytes of the given columns in a row group. */
export function rowGroupBytes(meta: FileMetaData, rg: number, columns: string[]): number {
  return meta.row_groups[rg].columns
    .filter((c) => c.meta_data && columns.includes(c.meta_data.path_in_schema[0]))
    .reduce((s, c) => s + Number(c.meta_data!.total_compressed_size), 0);
}

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

/** Polygons (outer ring + holes) of a decoded GeoJSON geometry. */
export function polygonsOf(g: GeoJsonGeometry | null | undefined): { outer: LonLat[]; holes: LonLat[][] }[] {
  if (!g) return [];
  const one = (rings: number[][][]) => {
    const [outer, ...holes] = rings.map((r) => openRing(r.map((p) => [p[0], p[1]] as LonLat)));
    return outer && outer.length >= 3 ? [{ outer, holes }] : [];
  };
  if (g.type === 'Polygon') return one(g.coordinates as number[][][]);
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).flatMap(one);
  return [];
}

export interface FetchOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  log?: Log;
  maxBytes?: number;
  /** Size of the first read from the end of the file, which should hold the whole footer (default 512 KB). */
  footerBytes?: number;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Whether every column chunk of these top-level columns in a row group has an offset (page) index. */
export function hasOffsetIndex(meta: FileMetaData, rg: number, columns: string[]): boolean {
  const chunks = meta.row_groups[rg].columns.filter((c) => c.meta_data && columns.includes(c.meta_data.path_in_schema[0]));
  return chunks.length > 0 && chunks.every((c) => !!c.offset_index_offset && !!c.offset_index_length);
}

/** Merges sorted row numbers into [start, end) runs, joining runs separated by fewer than `gap` rows. */
export function rowRuns(rows: number[], gap = 256): [number, number][] {
  const runs: [number, number][] = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && r - last[1] < gap) last[1] = r + 1;
    else runs.push([r, r + 1]);
  }
  return runs;
}

const at = (row: Record<string, unknown>, path: string[]): number | null => {
  let v: unknown = row;
  for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return toNumber(v);
};

/**
 * Reads the footprints of one file that touch `area`. Only byte ranges are fetched: the footer, then for the row
 * groups whose statistics overlap the area the small bounding-box column, then the geometry of just the rows inside
 * the area (only their pages, when the file has a page index).
 */
export async function readFootprints(url: string, area: BBox, opts: FetchOptions = {}): Promise<{ footprints: Footprint[]; stats: ReadStats }> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const log = opts.log ?? (() => {});
  const counter = { bytesRead: 0 };
  const file = await rangeOnlyFile(url, f, counter, opts.signal);
  const meta = await parquetMetadataAsync(file, { initialFetchSize: opts.footerBytes });
  const cols = findColumns(meta);
  if (!cols.bbox) throw new Error('file không có cột khung bao, không đọc riêng được khu này');
  const box = cols.bbox;
  const groups = rowGroupsFor(meta, cols, area);
  const boxCols = [...new Set([box.xmin[0], box.ymin[0], box.xmax[0], box.ymax[0]])];
  const wanted = [cols.geometry, cols.confidence, cols.source].filter((c): c is string => !!c);
  const budget = opts.maxBytes ?? MAX_READ_BYTES;
  const name = url.split('/').pop() ?? url;
  const boxBytes = groups.reduce((s, g) => s + rowGroupBytes(meta, g, boxCols), 0);
  log(`${name}: ${groups.length}/${meta.row_groups.length} nhóm hàng có thể chứa khu này (file ${mb(file.byteLength)})`);
  if (boxBytes > budget) throw new Error(`khu này cần đọc ${mb(boxBytes)}, quá giới hạn ${mb(budget)}`);

  const starts: number[] = [];
  meta.row_groups.reduce((s, rg) => (starts.push(s), s + Number(rg.num_rows)), 0);
  const read = (columns: string[], rowStart: number, rowEnd: number) => {
    if (opts.signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError');
    return parquetReadObjects({ file, metadata: meta, columns, rowStart, rowEnd, compressors, useOffsetIndex: true });
  };

  // Pass 1: which rows lie in the area, from the bounding boxes alone.
  const plan: { g: number; runs: [number, number][] }[] = [];
  let need = 0;
  for (const g of groups) {
    const n = Number(meta.row_groups[g].num_rows);
    const rows = await read(boxCols, starts[g], starts[g] + n);
    const hits: number[] = [];
    rows.forEach((row, i) => {
      const x0 = at(row, box.xmin);
      const y0 = at(row, box.ymin);
      const x1 = at(row, box.xmax);
      const y1 = at(row, box.ymax);
      if (x0 === null || y0 === null || x1 === null || y1 === null) hits.push(i);
      else if (x0 <= area.maxLon && x1 >= area.minLon && y0 <= area.maxLat && y1 >= area.minLat) hits.push(i);
    });
    if (!hits.length) continue;
    const runs = rowRuns(hits);
    const bytes = rowGroupBytes(meta, g, wanted);
    const share = hasOffsetIndex(meta, g, wanted) ? runs.reduce((s, [a, b]) => s + b - a, 0) / n : 1;
    need += bytes * share;
    plan.push({ g, runs });
  }
  log(`${name}: ${plan.reduce((s, p) => s + p.runs.reduce((t, [a, b]) => t + b - a, 0), 0)} hàng trong khung, cần khoảng ${mb(need)} nữa`);
  if (counter.bytesRead + need > budget) throw new Error(`khu này cần đọc ${mb(counter.bytesRead + need)}, quá giới hạn ${mb(budget)}`);

  // Pass 2: the footprints of those rows.
  const footprints: Footprint[] = [];
  for (const { g, runs } of plan) {
    for (const [a, b] of runs) {
      for (const row of await read(wanted, starts[g] + a, starts[g] + b)) {
        const geom = row[cols.geometry] as GeoJsonGeometry | Uint8Array | null;
        if (geom instanceof Uint8Array) throw new Error('cột hình học không có siêu dữ liệu GeoParquet');
        for (const poly of polygonsOf(geom)) {
          if (!bboxesOverlap(bboxOf(poly.outer), area)) continue;
          const conf = cols.confidence ? toNumber(row[cols.confidence]) : null;
          footprints.push({
            ...poly,
            confidence: conf === null || Number.isNaN(conf) || conf < 0 ? null : conf,
            source: cols.source ? ((row[cols.source] as string | null) ?? null) : null,
          });
        }
      }
    }
  }
  log(`${name}: đọc ${mb(counter.bytesRead)}, ${footprints.length} nhà trong khung`);
  return {
    footprints,
    stats: { file: name, bytesRead: counter.bytesRead, fileBytes: file.byteLength, rowGroupsRead: plan.length, rowGroupsTotal: meta.row_groups.length },
  };
}

/**
 * All Open Buildings footprints touching a drawn area: picks the country's tile files covering it (or the single
 * country file when the country is not tiled) and reads just the matching parts.
 */
export async function fetchOpenBuildings(
  iso3: string,
  polygon: LonLat[],
  opts: FetchOptions = {},
): Promise<{ footprints: Footprint[]; stats: ReadStats[] }> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const log = opts.log ?? (() => {});
  let files: string[];
  try {
    const tiles = await listTiles(iso3, f, opts.signal);
    files = tiles.length ? tilesForArea(tiles, polygon) : [countryFileUrl(iso3)];
    log(tiles.length ? `${iso3} chia ${tiles.length} ô, khu này nằm trong ${files.length} ô` : `${iso3} không chia ô, đọc file cả nước`);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    log(`Không liệt kê được ô (${(err as Error).message}), đọc file cả nước`);
    files = [countryFileUrl(iso3)];
  }
  const area = bboxOf(polygon);
  const footprints: Footprint[] = [];
  const stats: ReadStats[] = [];
  for (const url of files) {
    const r = await readFootprints(url, area, { ...opts, fetch: f });
    footprints.push(...r.footprints);
    stats.push(r.stats);
  }
  return { footprints, stats };
}
