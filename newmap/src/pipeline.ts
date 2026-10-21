import { centroid, LocalProjection, type LonLat } from './geo';
import { type MergeStats, mergeFootprints } from './merge';
import { osmToScene, type SceneModel } from './model';
import { lookupPlace, type Place } from './nominatim';
import { fetchOpenBuildings, type ReadStats } from './openBuildings';
import { buildQuery, parseOverpass, raceOverpass } from './overpass';

export interface BuildOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  log?: (msg: string) => void;
  /** Overpass fallback delay, shortened in tests. */
  fallbackAfterMs?: number;
}

export interface BuildResult {
  place: Place | null;
  model: SceneModel;
  projection: LocalProjection;
  merge: MergeStats;
  overpassServer: string;
  openBuildings: ReadStats[];
  warnings: string[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isAbort = (err: unknown) => (err as Error)?.name === 'AbortError';

/**
 * What "Dựng khu này" does: straight from the browser, ask Overpass for the OSM map of the area and Nominatim for its
 * name and country, then read that country's Open Buildings footprints for the area, and merge them under the OSM
 * buildings. Nothing goes through a server of ours.
 */
export async function buildArea(polygon: LonLat[], opts: BuildOptions = {}): Promise<BuildResult> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const log = opts.log ?? (() => {});
  const warnings: string[] = [];
  const mid = centroid(polygon) as LonLat;
  const projection = new LocalProjection(mid[0], mid[1]);
  // One controller for all requests, so a failure of the OSM part also cancels the building download.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const signal = ctrl.signal;

  const osmTask = raceOverpass(buildQuery(polygon), { fetch: f, signal, log, fallbackAfterMs: opts.fallbackAfterMs });

  // Open Buildings needs the country code, so it starts once Nominatim answers, while Overpass is still working.
  const placeTask = lookupPlace(mid, f, signal).then(
    (place) => {
      log(`Khu: ${place.name || '(không tên)'}${place.iso3 ? ` · ${place.iso3}` : ''}`);
      return place;
    },
    (err: unknown) => {
      if (isAbort(err)) throw err;
      warnings.push(`Không hỏi được tên khu: ${message(err)}`);
      return null;
    },
  );
  const obTask = placeTask.then(async (place) => {
    if (!place?.iso3) {
      if (place) warnings.push('Không biết mã nước của khu này nên bỏ qua Open Buildings.');
      return null;
    }
    log(`Đọc Open Buildings của ${place.iso3}…`);
    try {
      return await fetchOpenBuildings(place.iso3, polygon, { fetch: f, signal, log });
    } catch (err) {
      if (isAbort(err)) throw err;
      warnings.push(`Open Buildings: ${message(err)}`);
      return null;
    }
  });

  let results;
  try {
    results = await Promise.all([osmTask, placeTask, obTask]);
  } catch (err) {
    ctrl.abort();
    throw err;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
  const [osm, place, ob] = results;
  log(`OSM từ ${osm.server}: ${osm.json.elements.length} đối tượng`);

  const boundary = polygon.map((q) => projection.toXZ(q));
  const model = osmToScene(parseOverpass(osm.json), boundary, projection);
  const merge = mergeFootprints(model, ob?.footprints ?? [], projection);
  return { place, model, projection, merge, overpassServer: osm.server, openBuildings: ob?.stats ?? [], warnings };
}
