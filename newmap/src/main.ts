import { MapView, MAX_AREA_M2, MIN_AREA_M2 } from './mapView';
import type { DropReason } from './merge';
import { type BuildResult, buildArea } from './pipeline';
import { AreaView } from './scene3d';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const mapEl = $('map');
const canvas = $<HTMLCanvasElement>('view');
const btnBox = $<HTMLButtonElement>('btn-box');
const btnDraw = $<HTMLButtonElement>('btn-draw');
const btnSquare = $<HTMLButtonElement>('btn-square');
const btnClear = $<HTMLButtonElement>('btn-clear');
const btnBuild = $<HTMLButtonElement>('btn-build');
const btnToggle = $<HTMLButtonElement>('btn-toggle');
const bySource = $<HTMLInputElement>('by-source');
const logEl = $('log');

const map = new MapView(mapEl);
let view: AreaView | null = null;
let result: BuildResult | null = null;
let running: AbortController | null = null;

const fmtArea = (m2: number) => (m2 >= 1e5 ? `${(m2 / 1e6).toFixed(2)} km²` : `${Math.round(m2).toLocaleString('vi-VN')} m²`);
const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

function log(msg: string): void {
  const li = document.createElement('li');
  li.textContent = msg;
  logEl.append(li);
  li.scrollIntoView({ block: 'nearest' });
}

function refresh(): void {
  const poly = map.polygon;
  const area = map.area;
  const tooBig = area > MAX_AREA_M2;
  const tooSmall = area < MIN_AREA_M2;
  btnBox.classList.toggle('active', map.isBoxing);
  btnDraw.textContent = map.isDrawing ? 'Xong' : 'Vẽ khu';
  btnDraw.disabled = map.isDrawing && map.pointCount < 3;
  btnBuild.disabled = !poly || tooBig || tooSmall || !!running;
  btnBuild.textContent = running ? 'Đang dựng…' : 'Dựng khu này';
  const areaEl = $('area');
  if (map.pointCount >= 3) {
    areaEl.textContent = `Diện tích: ${fmtArea(area)}${tooBig ? ` · quá lớn, tối đa ${fmtArea(MAX_AREA_M2)}` : tooSmall ? ' · quá nhỏ' : ''}`;
    areaEl.classList.toggle('warn', tooBig || tooSmall);
  } else {
    areaEl.textContent = map.isDrawing ? 'Chấm các góc của khu trên bản đồ…' : map.isBoxing ? 'Kéo trên bản đồ để vẽ khung…' : '';
  }
}

function showMap(): void {
  mapEl.classList.remove('hidden');
  canvas.classList.add('hidden');
  btnToggle.textContent = 'Xem 3D';
  map.map.invalidateSize();
}

function show3D(): void {
  if (!result) return;
  mapEl.classList.add('hidden');
  canvas.classList.remove('hidden');
  btnToggle.textContent = 'Bản đồ';
  view ??= new AreaView(canvas);
  view.show(result.model, { bySource: bySource.checked });
}

const REASONS: Record<DropReason, string> = {
  lowConfidence: 'độ tin cậy dưới 0,7',
  overlapsOsm: 'trùng nhà OSM',
  onRoad: 'nằm trên lòng đường',
  onWater: 'nằm trên mặt nước',
  outside: 'ngoài khu đã vẽ',
};

function showStats(r: BuildResult): void {
  $('place-name').textContent = r.place?.name || 'Khu không tên';
  const m = r.model;
  const rows: [string, string][] = [
    ['Nhà OSM', `${r.merge.osm}`],
    ['Nhà Open Buildings giữ lại', `${r.merge.kept} / ${r.merge.openBuildings}`],
  ];
  for (const [k, label] of Object.entries(REASONS) as [DropReason, string][]) {
    if (r.merge.dropped[k]) rows.push([`  bỏ: ${label}`, `${r.merge.dropped[k]}`]);
  }
  rows.push(
    ['Đường', `${m.roads.length}`],
    ['Sông, hồ', `${m.water.length + m.waterways.length}`],
    ['Công viên, cây xanh', `${m.parks.length}`],
    ['Đình chùa, di tích', `${m.buildings.filter((b) => b.role !== 'house').length + m.pois.length + m.yards.length}`],
    ['Tường rào', `${m.barriers.length}`],
    ['Máy Overpass', r.overpassServer],
  );
  for (const s of r.openBuildings) {
    rows.push([`Đọc ô ${s.file}`, `${fmtBytes(s.bytesRead)} / ${fmtBytes(s.fileBytes)} (${s.rowGroupsRead}/${s.rowGroupsTotal} nhóm)`]);
  }
  const dl = $('stats');
  dl.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k.trim();
      if (k.startsWith('  ')) dt.classList.add('sub');
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  $('result').classList.remove('hidden');
}

async function build(): Promise<void> {
  const poly = map.polygon;
  if (!poly || running) return;
  running = new AbortController();
  logEl.replaceChildren();
  refresh();
  const t0 = performance.now();
  try {
    result = await buildArea(poly, { signal: running.signal, log });
    for (const w of result.warnings) log(`⚠ ${w}`);
    log(`Xong sau ${((performance.now() - t0) / 1000).toFixed(1)} s: ${result.model.buildings.length} nhà.`);
    showStats(result);
    btnToggle.disabled = false;
    show3D();
  } catch (err) {
    if ((err as Error).name !== 'AbortError') log(`✗ ${(err as Error).message}`);
  } finally {
    running = null;
    refresh();
  }
}

function downloadJson(): void {
  if (!result) return;
  const { place, model, projection, merge, overpassServer } = result;
  const data = { place, origin: { lon: projection.lon0, lat: projection.lat0 }, units: 'm, x east, z south', merge, overpassServer, ...model };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `khu-${(place?.name || 'vgang').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

map.onChange = refresh;
btnBox.addEventListener('click', () => {
  showMap();
  if (map.isBoxing) map.clear();
  else map.startBox();
});
btnDraw.addEventListener('click', () => {
  showMap();
  if (map.isDrawing) map.finishDrawing();
  else map.startDrawing();
});
btnSquare.addEventListener('click', () => {
  showMap();
  map.squareHere(500);
});
btnClear.addEventListener('click', () => {
  running?.abort();
  map.clear();
});
btnBuild.addEventListener('click', () => void build());
btnToggle.addEventListener('click', () => (canvas.classList.contains('hidden') ? show3D() : showMap()));
bySource.addEventListener('change', () => result && view?.show(result.model, { bySource: bySource.checked }));
$('btn-json').addEventListener('click', downloadJson);
refresh();
if (import.meta.env.DEV) (window as unknown as { __newmap: MapView }).__newmap = map;
