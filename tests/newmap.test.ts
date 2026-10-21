/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { areaM2, boxFromCorners, clipPolyline, LocalProjection, type LonLat, pointInRing, samplePoints, type XZ } from '../newmap/src/geo';
import { mergeFootprints, MIN_CONFIDENCE } from '../newmap/src/merge';
import { guessLevels, osmBuilding, osmToScene, parseLength, roadWidth, type SceneModel } from '../newmap/src/model';
import { iso3, placeName } from '../newmap/src/nominatim';
import {
  countryFileUrl,
  type Footprint,
  parseListing,
  readFootprints,
  tilesForArea,
  tilesPrefix,
} from '../newmap/src/openBuildings';
import {
  assembleRings,
  buildQuery,
  OVERPASS_FALLBACKS,
  OVERPASS_PRIMARY,
  type OverpassJson,
  parseOverpass,
  raceOverpass,
} from '../newmap/src/overpass';
import { buildArea } from '../newmap/src/pipeline';
import { cellContains, cellLevel, leafCellId, parseCellId } from '../newmap/src/s2';
import * as THREE from 'three';
import { MAX_POLAR, MIN_DISTANCE, parseOsmColour, turnCamera } from '../newmap/src/scene3d';

const HANOI: LonLat = [105.8262, 21.0042];

describe('S2 cells', () => {
  it('matches reference leaf ids (checked against the s2-geometry package)', () => {
    expect(leafCellId(0, 0)).toBe(1152921504606846977n);
    expect(leafCellId(...HANOI)).toBe(3545929950965851705n);
    expect(leafCellId(-58.4, -34.6)).toBe(10789721546405091631n);
  });

  it('reads signed file names and finds the containing cell', () => {
    expect(parseCellId('-7657022527304459985')).toBe(10789721546405091631n);
    const level6 = 3545740281624133632n;
    expect(cellLevel(level6)).toBe(6);
    expect(cellContains(level6, leafCellId(...HANOI))).toBe(true);
    expect(cellContains(level6, leafCellId(106.7, 10.77))).toBe(false);
  });
});

describe('geometry helpers', () => {
  it('projects to metres and back', () => {
    const p = new LocalProjection(...HANOI);
    const [x, z] = p.toXZ([HANOI[0] + 0.001, HANOI[1] + 0.001]);
    expect(x).toBeCloseTo(103.9, 0);
    expect(z).toBeCloseTo(-110.6, 0);
    const back = p.toLonLat([x, z]);
    expect(back[0]).toBeCloseTo(HANOI[0] + 0.001, 9);
    expect(back[1]).toBeCloseTo(HANOI[1] + 0.001, 9);
  });

  it('measures lon/lat polygons in square metres', () => {
    const d = 0.001;
    const sq: LonLat[] = [HANOI, [HANOI[0] + d, HANOI[1]], [HANOI[0] + d, HANOI[1] + d], [HANOI[0], HANOI[1] + d]];
    expect(areaM2(sq)).toBeGreaterThan(11_400);
    expect(areaM2(sq)).toBeLessThan(11_600);
  });

  it('makes a box from two opposite corners dragged in any direction', () => {
    const box: LonLat[] = [
      [105.8, 21.0],
      [105.81, 21.0],
      [105.81, 21.01],
      [105.8, 21.01],
    ];
    expect(boxFromCorners([105.8, 21.0], [105.81, 21.01])).toEqual(box);
    expect(boxFromCorners([105.81, 21.0], [105.8, 21.01])).toEqual(box);
    expect(boxFromCorners([105.81, 21.01], [105.8, 21.0])).toEqual(box);
  });

  it('spreads sample points inside a footprint', () => {
    const L: XZ[] = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 10],
      [0, 10],
    ];
    const pts = samplePoints(L);
    expect(pts.length).toBeGreaterThan(5);
    for (const [x, z] of pts) expect(pointInRing(x, z, L)).toBe(true);
  });
});

describe('Overpass', () => {
  const poly: LonLat[] = [
    [105.82, 21.0],
    [105.83, 21.0],
    [105.83, 21.01],
  ];

  it('asks for every layer inside the drawn polygon, in lat lon order', () => {
    const q = buildQuery(poly);
    expect(q).toContain('poly:"21.0000000 105.8200000 21.0000000 105.8300000 21.0100000 105.8300000"');
    for (const part of ['"building"', '"highway"', '"waterway"', '"natural"="water"', 'leisure', 'place_of_worship', 'historic', 'barrier']) {
      expect(q).toContain(part);
    }
    expect(q).toContain('out geom;');
  });

  it('joins multipolygon member ways into closed rings', () => {
    const rings = assembleRings([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 1],
        [1, 0],
      ],
      [
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it('sorts elements into buildings, roads, water, parks, walls and temples', () => {
    const sq = (x: number, y: number, d = 0.0001) => [
      { lon: x, lat: y },
      { lon: x + d, lat: y },
      { lon: x + d, lat: y + d },
      { lon: x, lat: y + d },
      { lon: x, lat: y },
    ];
    const json: OverpassJson = {
      elements: [
        { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '4', 'building:colour': '#ffcc00' }, geometry: sq(105.82, 21) },
        { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: [{ lon: 105.82, lat: 21 }, { lon: 105.83, lat: 21 }] },
        { type: 'way', id: 3, tags: { natural: 'water' }, geometry: sq(105.825, 21.005, 0.001) },
        { type: 'way', id: 4, tags: { leisure: 'park' }, geometry: sq(105.826, 21.005, 0.001) },
        { type: 'way', id: 5, tags: { barrier: 'wall' }, geometry: [{ lon: 105.82, lat: 21.001 }, { lon: 105.821, lat: 21.001 }] },
        { type: 'way', id: 6, tags: { building: 'temple', amenity: 'place_of_worship', name: 'Chùa' }, geometry: sq(105.827, 21.002) },
        { type: 'node', id: 7, lon: 105.828, lat: 21.003, tags: { historic: 'memorial' } },
        { type: 'way', id: 8, tags: { waterway: 'river' }, geometry: [{ lon: 105.82, lat: 21.004 }, { lon: 105.83, lat: 21.004 }] },
        {
          type: 'relation',
          id: 9,
          tags: { type: 'multipolygon', building: 'yes' },
          members: [
            { type: 'way', role: 'outer', geometry: sq(105.829, 21.006, 0.0002) },
            { type: 'way', role: 'inner', geometry: sq(105.82905, 21.00605, 0.00005) },
          ],
        },
      ],
    };
    const osm = parseOverpass(json);
    const kinds = (k: string) => osm.areas.filter((a) => a.kind === k).map((a) => a.id);
    expect(kinds('building')).toEqual(['way/1', 'way/6', 'relation/9']);
    expect(kinds('water')).toEqual(['way/3']);
    expect(kinds('park')).toEqual(['way/4']);
    expect(osm.areas.find((a) => a.id === 'relation/9')!.holes).toHaveLength(1);
    expect(osm.lines.map((l) => `${l.kind}:${l.id}`)).toEqual(['road:way/2', 'barrier:way/5', 'waterway:way/8']);
    expect(osm.pois.map((p) => p.kind)).toEqual(['heritage']);
  });

  const okJson = (n: number) => new Response(JSON.stringify({ elements: Array.from({ length: n }, (_, i) => ({ type: 'node', id: i })) }));

  it('uses the main server when it answers within 7 s', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const f = vi.fn(async (url: string | URL | Request) => {
        calls.push(String(url));
        await new Promise((r) => setTimeout(r, 3000));
        return okJson(1);
      }) as unknown as typeof fetch;
      const p = raceOverpass('q', { fetch: f });
      await vi.advanceTimersByTimeAsync(3000);
      const r = await p;
      expect(r.server).toBe('overpass-api.de');
      expect(calls).toEqual([OVERPASS_PRIMARY]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after 7 s also asks the two fallbacks and takes whichever answers first', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const aborted: string[] = [];
      const delays: Record<string, number> = {
        [OVERPASS_PRIMARY]: 60_000,
        [OVERPASS_FALLBACKS[0]]: 5000,
        [OVERPASS_FALLBACKS[1]]: 2000,
      };
      const f = vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        calls.push(u);
        return new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(okJson(2)), delays[u]);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            aborted.push(u);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }) as unknown as typeof fetch;
      const p = raceOverpass('q', { fetch: f });
      await vi.advanceTimersByTimeAsync(6999);
      expect(calls).toEqual([OVERPASS_PRIMARY]);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toEqual([OVERPASS_PRIMARY, ...OVERPASS_FALLBACKS]);
      await vi.advanceTimersByTimeAsync(2000);
      const r = await p;
      expect(r.server).toBe('maps.mail.ru');
      expect(aborted.sort()).toEqual([OVERPASS_PRIMARY, OVERPASS_FALLBACKS[0]].sort());
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes to the fallbacks straight away when the main server fails, and fails when all do', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response('busy', { status: 429 });
    }) as unknown as typeof fetch;
    await expect(raceOverpass('q', { fetch: f })).rejects.toThrow(/Không máy Overpass nào/);
    expect(calls).toEqual([OVERPASS_PRIMARY, ...OVERPASS_FALLBACKS]);
  });

  it('treats a runtime-error remark as a failure', async () => {
    const f = vi.fn(async (url: string | URL | Request) =>
      String(url) === OVERPASS_PRIMARY
        ? new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }))
        : okJson(3),
    ) as unknown as typeof fetch;
    const r = await raceOverpass('q', { fetch: f });
    expect(r.server).not.toBe('overpass-api.de');
    expect(r.json.elements).toHaveLength(3);
  });
});

describe('Nominatim', () => {
  it('names the area by ward and district', () => {
    expect(placeName({ quarter: 'Khương Thượng', city_district: 'Đống Đa', city: 'Hà Nội', country_code: 'vn' })).toBe(
      'Khương Thượng, Đống Đa',
    );
    expect(placeName({ suburb: 'Phường Láng', city: 'Hà Nội' })).toBe('Phường Láng, Hà Nội');
    expect(placeName({}, 'fallback')).toBe('fallback');
  });

  it('maps country codes to the alpha-3 names of the Open Buildings files', () => {
    expect(iso3('vn')).toBe('VNM');
    expect(iso3('LA')).toBe('LAO');
    expect(iso3('KH')).toBe('KHM');
    expect(iso3('zz')).toBeNull();
  });
});

describe('model', () => {
  it('reads heights, levels and widths from tags', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12.5 m')).toBe(12.5);
    expect(parseLength('10 ft')).toBeCloseTo(3.048);
    expect(parseLength('tall')).toBeNull();
    expect(roadWidth({ highway: 'primary' })).toBe(12);
    expect(roadWidth({ highway: 'service', width: '3' })).toBe(3);
    expect(roadWidth({ highway: 'residential', lanes: '3' })).toBeCloseTo(9.6);
  });

  it('builds OSM buildings from height, levels, colour and roof tags', () => {
    const ring: XZ[] = [
      [0, 0],
      [5, 0],
      [5, 15],
      [0, 15],
    ];
    const a = osmBuilding('way/1', ring, [], { building: 'yes', height: '20', 'roof:shape': 'gabled', 'roof:height': '3' }, 75);
    expect(a.height).toBe(17);
    expect(a.roofHeight).toBe(3);
    const b = osmBuilding('way/2', ring, [], { building: 'yes', 'building:levels': '5', 'building:colour': 'white' }, 75);
    expect(b.height).toBeCloseTo(16);
    expect(b.color).toBe('white');
    const c = osmBuilding('way/3', ring, [], { building: 'yes' }, 75);
    expect(c.height / 3.2).toBe(guessLevels('way/3', 75));
    expect(osmBuilding('way/4', ring, [], { building: 'yes', amenity: 'place_of_worship' }, 75).role).toBe('worship');
  });

  it('turns, tilts and zooms the 3D camera around the middle of the area, within limits', () => {
    const target = new THREE.Vector3(10, 0, 20);
    const pos = new THREE.Vector3(10, 100, 120);
    const turned = turnCamera(pos, target, { yaw: Math.PI / 2 });
    expect(turned.distanceTo(target)).toBeCloseTo(pos.distanceTo(target));
    expect(turned.y).toBeCloseTo(100);
    expect(turned.x).toBeCloseTo(110);
    expect(turned.z).toBeCloseTo(20);
    // Tilting down stops before the horizon; zooming in stops at the minimum distance.
    const low = turnCamera(pos, target, { pitch: -10 });
    expect(Math.acos((low.y - target.y) / low.distanceTo(target))).toBeCloseTo(MAX_POLAR);
    expect(turnCamera(pos, target, { zoom: 0.0001 }).distanceTo(target)).toBeCloseTo(MIN_DISTANCE);
  });

  it('parses OSM colours', () => {
    expect(parseOsmColour('#ffcc00')).toBe(0xffcc00);
    expect(parseOsmColour('fc0')).toBe(0xffcc00);
    expect(parseOsmColour('White')).toBe(0xffffff);
    expect(parseOsmColour('light_blue')).toBe(0xadd8e6);
    expect(parseOsmColour('nope')).toBeNull();
  });
});

/** A scene with one OSM house, a road along z = 50 and a pond, inside a 200 m square. */
function testScene(): { m: SceneModel; p: LocalProjection } {
  const p = new LocalProjection(...HANOI);
  const boundary: XZ[] = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];
  const m = osmToScene({ areas: [], lines: [], pois: [] }, boundary, p);
  m.buildings.push(
    osmBuilding('way/1', [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ], [], { building: 'yes' }, 100),
  );
  m.roads.push({ id: 'way/2', points: [[-100, 50], [100, 50]], width: 8, kind: 'residential', hidden: false });
  m.roads.push({ id: 'way/3', points: [[-100, -50], [100, -50]], width: 8, kind: 'service', hidden: true });
  m.water.push({ id: 'way/4', outer: [[-80, -80], [-40, -80], [-40, -40], [-80, -40]], holes: [], kind: 'water' });
  return { m, p };
}

function footprintAt(p: LocalProjection, x: number, z: number, size: number, confidence: number | null = 0.9): Footprint {
  const ring: XZ[] = [
    [x, z],
    [x + size, z],
    [x + size, z + size],
    [x, z + size],
  ];
  return { outer: ring.map((q) => p.toLonLat(q)), holes: [], confidence, source: 'google' };
}

describe('cutting the OSM answer to the drawn area', () => {
  it('keeps roads that cross the area without a node inside, and lakes that contain it', () => {
    const p = new LocalProjection(...HANOI);
    const boundary: XZ[] = [
      [-50, -50],
      [50, -50],
      [50, 50],
      [-50, 50],
    ];
    const ll = (x: number, z: number) => p.toLonLat([x, z]);
    const m = osmToScene(
      {
        areas: [
          { id: 'way/1', kind: 'water', outer: [ll(-500, -500), ll(500, -500), ll(500, 500), ll(-500, 500)], holes: [], tags: {} },
          { id: 'way/2', kind: 'park', outer: [ll(200, 200), ll(300, 200), ll(300, 300)], holes: [], tags: {} },
        ],
        lines: [
          { id: 'way/3', kind: 'road', points: [ll(-300, 0), ll(300, 0)], tags: { highway: 'primary' } },
          { id: 'way/4', kind: 'road', points: [ll(-300, 200), ll(300, 200)], tags: { highway: 'primary' } },
        ],
        pois: [],
      },
      boundary,
      p,
    );
    expect(m.water.map((w) => w.id)).toEqual(['way/1']);
    expect(m.parks).toEqual([]);
    expect(m.roads.map((r) => r.id)).toEqual(['way/3']);
    // Cut at the edges of the area.
    expect(m.roads[0].points[0][0]).toBeCloseTo(-50, 6);
    expect(m.roads[0].points[m.roads[0].points.length - 1][0]).toBeCloseTo(50, 6);
  });

  it('cuts lines to a concave area, giving one piece per stretch inside', () => {
    const U: XZ[] = [
      [0, 0],
      [30, 0],
      [30, 30],
      [20, 30],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ];
    const pieces = clipPolyline(
      [
        [-5, 20],
        [35, 20],
      ],
      U,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0][0][0]).toBeCloseTo(0);
    expect(pieces[0][1][0]).toBeCloseTo(10);
    expect(pieces[1][0][0]).toBeCloseTo(20);
    expect(pieces[1][1][0]).toBeCloseTo(30);
  });
});

describe('merging Open Buildings under OSM', () => {
  it('keeps OSM buildings and drops footprints by confidence, overlap, road and water', () => {
    const { m, p } = testScene();
    const stats = mergeFootprints(
      m,
      [
        footprintAt(p, 30, 0, 8), // free spot: kept
        footprintAt(p, 30, 20, 8, MIN_CONFIDENCE - 0.01), // low confidence
        footprintAt(p, 2, 2, 6), // on the OSM house
        footprintAt(p, -5, -5, 25), // swallows the OSM house
        footprintAt(p, 0, 47, 6), // on the road
        footprintAt(p, -70, -70, 10), // in the pond
        footprintAt(p, 0, -53, 6), // over a tunnel: kept
        footprintAt(p, 150, 150, 6), // outside the drawn area
        footprintAt(p, 60, 0, 8, null), // no confidence given: judged on position, kept
      ],
      p,
    );
    expect(stats.osm).toBe(1);
    expect(stats.openBuildings).toBe(9);
    expect(stats.dropped).toEqual({ lowConfidence: 1, overlapsOsm: 2, onRoad: 1, onWater: 1, outside: 1 });
    expect(stats.kept).toBe(3);
    expect(m.buildings).toHaveLength(4);
    expect(m.buildings[0].source).toBe('osm');
    expect(m.buildings.slice(1).every((b) => b.source === 'google')).toBe(true);
  });

  it('keeps footprints that only touch a neighbouring OSM house along a shared wall', () => {
    const { m, p } = testScene();
    const stats = mergeFootprints(m, [footprintAt(p, 10, 0, 5)], p);
    expect(stats.kept).toBe(1);
  });
});

/** Serves a local file like data.source.coop: HEAD for the size, 206 for Range requests. */
function fileServer(bytes: Uint8Array, opts: { ignoreRange?: boolean } = {}) {
  const ranges: [number, number][] = [];
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(bytes.byteLength) } });
    const range = new Headers(init?.headers).get('range');
    const m = range?.match(/bytes=(\d+)-(\d+)/);
    if (!m || opts.ignoreRange) return new Response(bytes.slice());
    const [a, b] = [Number(m[1]), Number(m[2])];
    ranges.push([a, b]);
    return new Response(bytes.slice(a, b + 1), { status: 206 });
  }) as unknown as typeof fetch;
  return { f, ranges };
}

describe('Open Buildings', () => {
  const sample = new Uint8Array(readFileSync(new URL('./fixtures/open-buildings-sample.parquet', import.meta.url)));
  /** Just the footer of the small sample, so the reads that follow show which parts of the file are used. */
  const FOOTER = 8_000;

  it('reads an S3 listing and picks the tile files covering the area', () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
      <Contents><Key>${tilesPrefix('VNM')}3545740281624133632.parquet</Key></Contents>
      <Contents><Key>${tilesPrefix('VNM')}-7657022527304459985.parquet</Key></Contents>
      <NextContinuationToken>abc&amp;1</NextContinuationToken></ListBucketResult>`;
    const { keys, next } = parseListing(xml);
    expect(keys).toHaveLength(2);
    expect(next).toBe('abc&1');
    const urls = keys.map((k) => `https://data.source.coop/vida/${k}`);
    const square: LonLat[] = [HANOI, [HANOI[0] + 0.004, HANOI[1]], [HANOI[0] + 0.004, HANOI[1] + 0.004]];
    expect(tilesForArea(urls, square)).toEqual([urls[0]]);
    expect(countryFileUrl('VNM')).toBe(
      'https://data.source.coop/vida/google-microsoft-open-buildings/geoparquet/by_country/country_iso=VNM/VNM.parquet',
    );
  });

  it('reads only the row groups of the area, by byte ranges', async () => {
    const { f } = fileServer(sample);
    // The sample has four latitude bands (21.00, 21.01, 21.02, 21.03), one row group each.
    const area = { minLon: 105.8, minLat: 21.005, maxLon: 105.81, maxLat: 21.015 };
    const { footprints, stats } = await readFootprints('https://x/3545740281624133632.parquet', area, { fetch: f, footerBytes: FOOTER });
    expect(stats.rowGroupsTotal).toBe(4);
    expect(stats.rowGroupsRead).toBe(1);
    expect(stats.bytesRead).toBeLessThan(sample.byteLength / 2);
    // Buildings 0–10 of the 21.01 band have lon 105.800–105.810.
    expect(footprints).toHaveLength(11);
    for (const fp of footprints) expect(fp.outer[0][1]).toBeCloseTo(21.01, 6);
    const ms = footprints.filter((fp) => fp.source === 'microsoft');
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((fp) => fp.confidence === null)).toBe(true);
    expect(footprints.find((fp) => fp.source === 'google')!.confidence).toBeGreaterThan(0);
  });

  it('fetches only the pages of the matching rows when the file has a page index', async () => {
    const small = { minLon: 105.8, minLat: 21.005, maxLon: 105.81, maxLat: 21.015 };
    const band = { minLon: 105.7, minLat: 21.005, maxLon: 106.1, maxLat: 21.015 };
    const dataBytes = async (area: typeof small) => {
      const r = await readFootprints('https://x/a.parquet', area, { fetch: fileServer(sample).f, footerBytes: FOOTER });
      return { n: r.footprints.length, bytes: r.stats.bytesRead };
    };
    const a = await dataBytes(small);
    const b = await dataBytes(band);
    expect(a.n).toBe(11);
    expect(b.n).toBe(200);
    // The geometry of a whole band is about 4 KB compressed; the small area needs only its first pages.
    expect(b.bytes - a.bytes).toBeGreaterThan(3000);
  });

  it('refuses to download the whole file when the server ignores Range', async () => {
    const { f } = fileServer(sample, { ignoreRange: true });
    const area = { minLon: 105.8, minLat: 21.005, maxLon: 105.81, maxLat: 21.015 };
    await expect(readFootprints('https://x/a.parquet', area, { fetch: f })).rejects.toThrow(/đọc từng đoạn/);
  });

  it('refuses areas that would need more than the byte budget', async () => {
    const { f } = fileServer(sample);
    const area = { minLon: 105.7, minLat: 20.9, maxLon: 105.9, maxLat: 21.1 };
    await expect(readFootprints('https://x/a.parquet', area, { fetch: f, maxBytes: 100 })).rejects.toThrow(/quá giới hạn/);
  });
});

describe('Dựng khu này', () => {
  it('runs Overpass, Nominatim and Open Buildings and merges the buildings', async () => {
    const sample = new Uint8Array(readFileSync(new URL('./fixtures/open-buildings-sample.parquet', import.meta.url)));
    const server = fileServer(sample);
    const hosts: string[] = [];
    const tile = `${tilesPrefix('VNM')}3545740281624133632.parquet`;
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      hosts.push(u.host);
      if (u.host === 'overpass-api.de') {
        // One OSM house exactly on the Open Buildings footprint at (105.808, 21.01).
        const d = 0.0001;
        const g = [
          { lon: 105.808, lat: 21.01 },
          { lon: 105.808 + d, lat: 21.01 },
          { lon: 105.808 + d, lat: 21.01 + d },
          { lon: 105.808, lat: 21.01 + d },
          { lon: 105.808, lat: 21.01 },
        ];
        return new Response(JSON.stringify({ elements: [{ type: 'way', id: 1, tags: { building: 'yes' }, geometry: g }] }));
      }
      if (u.host === 'nominatim.openstreetmap.org') {
        return new Response(JSON.stringify({ address: { quarter: 'Khương Thượng', city_district: 'Đống Đa', country_code: 'vn' } }));
      }
      if (u.host === 'data.source.coop' && u.searchParams.get('list-type') === '2') {
        expect(u.pathname).toBe('/vida');
        expect(u.searchParams.get('prefix')).toBe(tilesPrefix('VNM'));
        return new Response(`<ListBucketResult><Contents><Key>${tile}</Key></Contents></ListBucketResult>`);
      }
      if (u.host === 'data.source.coop') {
        expect(u.pathname).toBe(`/vida/${tile}`);
        return server.f(url, init);
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    // A box around buildings 0–10 of the 21.01 band.
    const poly: LonLat[] = [
      [105.7995, 21.0095],
      [105.8105, 21.0095],
      [105.8105, 21.0105],
      [105.7995, 21.0105],
    ];
    const r = await buildArea(poly, { fetch: f });
    expect(new Set(hosts)).toEqual(new Set(['overpass-api.de', 'nominatim.openstreetmap.org', 'data.source.coop']));
    expect(r.place?.name).toBe('Khương Thượng, Đống Đa');
    expect(r.overpassServer).toBe('overpass-api.de');
    expect(r.merge.osm).toBe(1);
    expect(r.merge.openBuildings).toBe(11);
    expect(r.merge.dropped.overlapsOsm).toBe(1);
    // Sample confidences are 0.5 + k * 0.05 for Google (k = 1–4, 6–9); k = 0, 5, 10 are Microsoft with none.
    // Under 0.7: k = 1, 2, 3. The house sits on k = 8.
    expect(r.merge.dropped.lowConfidence).toBe(3);
    expect(r.merge.kept).toBe(7);
    expect(r.warnings).toEqual([]);
  });
});
