import { type Decor, makeDecor } from './decor';
import { MapView, MAX_AREA_M2, MIN_AREA_M2, squareAround } from './mapView';
import type { DropReason } from './merge';
import { searchPlaces, type SearchHit } from './nominatim';
import { type BuildResult, buildArea } from './pipeline';
import { AreaView } from './scene3d';
import { compassName, compassShort, localToUtc, sunPosition, zoneOffsetHours } from './sun';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const viewWrap = $('view-wrap');
const btnBox = $<HTMLButtonElement>('btn-box');
const btnDraw = $<HTMLButtonElement>('btn-draw');
const btnSquare = $<HTMLButtonElement>('btn-square');
const btnClear = $<HTMLButtonElement>('btn-clear');
const btnBuild = $<HTMLButtonElement>('btn-build');
const bySource = $<HTMLInputElement>('by-source');
const timeInput = $<HTMLInputElement>('time');
const dateInput = $<HTMLInputElement>('date');
const logEl = $('log');
const statusEl = $('status');

const map = new MapView($('map'));
let view: AreaView | null = null;
let result: BuildResult | null = null;
let decor: Decor | null = null;
let running: AbortController | null = null;
/** The status line shows the result of the last build until the outline changes. */
let builtOutline: unknown = null;

const nf = new Intl.NumberFormat('vi-VN');
const fmtArea = (m2: number) =>
  m2 >= 1e5 ? `${(m2 / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} km²` : `${nf.format(Math.round(m2))} m²`;
const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const fmtSeconds = (s: number) => s.toLocaleString('vi-VN', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function log(msg: string): void {
  const li = document.createElement('li');
  li.textContent = msg;
  logEl.append(li);
  if (running) statusEl.textContent = msg;
}

/** Updates the drawing tools and the status card under the map. */
function refresh(): void {
  const poly = map.polygon;
  const area = map.area;
  const tooBig = area > MAX_AREA_M2;
  const tooSmall = area < MIN_AREA_M2;
  const built = !!poly && poly === builtOutline;
  btnBox.classList.toggle('active', map.isBoxing);
  btnDraw.classList.toggle('active', map.isDrawing);
  btnBuild.disabled = !poly || tooBig || tooSmall || !!running;
  btnBuild.textContent = running ? 'Đang dựng…' : 'Dựng khu này';
  $('status-dot').className = `dot ${running ? 'busy' : built ? 'done' : poly ? 'ready' : ''}`;
  if (running || built) return;
  const title = $('area-title');
  if (map.pointCount >= 3) {
    title.textContent = `Vùng đã vẽ · ${fmtArea(area)}`;
    statusEl.textContent = tooBig
      ? `Khu quá lớn, tối đa ${fmtArea(MAX_AREA_M2)}.`
      : tooSmall
        ? 'Khu quá nhỏ.'
        : map.isDrawing
          ? 'Chấm tiếp các góc, bấm lại góc đầu để khép.'
          : 'Sẵn sàng. Dữ liệu tải song song rồi dựng ngay bên phải.';
  } else {
    title.textContent = 'Chưa vẽ khu';
    statusEl.textContent = map.isBoxing
      ? 'Kéo trên bản đồ để vẽ khung.'
      : map.isDrawing
        ? 'Chấm từng góc của khu trên bản đồ.'
        : 'Bấm nút khung rồi kéo trên bản đồ, hoặc giữ Shift và kéo.';
  }
}

const REASONS: Record<DropReason, string> = {
  lowConfidence: 'độ tin cậy dưới 0,7',
  overlapsOsm: 'trùng nhà OSM',
  onRoad: 'nằm trên lòng đường',
  onWater: 'nằm trên mặt nước',
  outside: 'ngoài khu đã vẽ',
};

function showInfo(r: BuildResult, d: Decor, area: number, seconds: number): void {
  const m = r.model;
  $('place-name').textContent = r.place?.name || 'Khu không tên';
  $('summary').textContent = [
    fmtArea(area),
    `dựng xong trong ${fmtSeconds(seconds)} s`,
    `${nf.format(m.buildings.length)} nhà`,
    `${nf.format(d.trees.length)} cây`,
    `${nf.format(d.cars.length)} xe`,
  ].join(' · ');
  const rows: [string, string][] = [
    ['Nhà OSM', nf.format(r.merge.osm)],
    ['Nhà Open Buildings giữ lại', `${nf.format(r.merge.kept)} / ${nf.format(r.merge.openBuildings)}`],
  ];
  for (const [k, label] of Object.entries(REASONS) as [DropReason, string][]) {
    if (r.merge.dropped[k]) rows.push([`  bỏ: ${label}`, nf.format(r.merge.dropped[k])]);
  }
  rows.push(
    ['Đường', nf.format(m.roads.length)],
    ['Sông, hồ', nf.format(m.water.length + m.waterways.length)],
    ['Công viên, cây xanh', nf.format(m.parks.length)],
    ['Cây có trên OSM', nf.format(m.trees.length)],
    ['Đình chùa, di tích', nf.format(m.buildings.filter((b) => b.role !== 'house').length + m.pois.length + m.yards.length)],
    ['Tường rào', nf.format(m.barriers.length)],
    ['Máy Overpass', r.overpassServer],
  );
  for (const s of r.openBuildings) {
    rows.push([`Đọc ô ${s.file}`, `${fmtBytes(s.bytesRead)} / ${fmtBytes(s.fileBytes)} (${s.rowGroupsRead}/${s.rowGroupsTotal} nhóm)`]);
  }
  $('stats').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k.trim();
      if (k.startsWith('  ')) dt.classList.add('sub');
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  for (const id of ['info', 'compass', 'view-tools', 'timebar']) $(id).classList.remove('hidden');
  $('empty').classList.add('hidden');
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Puts the sun where it is at the chosen time and date over the area. */
function updateSun(): void {
  const minutes = Math.floor(Number(timeInput.value));
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  $('clock').textContent = `${hh}:${mm}`;
  if (!result) return;
  const { lon0, lat0 } = result.projection;
  const sun = sunPosition(localToUtc(dateInput.value || today(), minutes, zoneOffsetHours(lon0)), lat0, lon0);
  $('sun-text').textContent =
    sun.altitude > 0
      ? `Mặt trời ${Math.round(sun.altitude)}°, hướng ${compassName(sun.azimuth)}`
      : sun.altitude > -6
        ? 'Chạng vạng'
        : 'Ban đêm, đèn đã lên';
  view?.setSun(sun);
}

function ensureView(): AreaView {
  if (view) return view;
  view = new AreaView(canvas);
  view.onSpinChange = (on) => viewWrap.querySelector('[data-act="spin"]')?.classList.toggle('active', on);
  view.onViewChange = (v) => {
    $('heading').textContent = compassShort(v.heading);
    $('tilt').textContent = `nghiêng ${Math.round(v.tilt)}°`;
    $('needle').style.transform = `rotate(${-v.heading}deg)`;
    if (result) map.showViewTarget(result.projection.toLonLat(v.target));
  };
  return view;
}

async function build(): Promise<void> {
  const poly = map.polygon;
  if (!poly || running) return;
  running = new AbortController();
  builtOutline = null;
  logEl.replaceChildren();
  $('area-title').textContent = `Vùng đã vẽ · ${fmtArea(map.area)}`;
  statusEl.textContent = 'Đang tải dữ liệu từ 3 nguồn…';
  refresh();
  const t0 = performance.now();
  let done = '';
  try {
    const r = await buildArea(poly, { signal: running.signal, log });
    for (const w of r.warnings) log(`⚠ ${w}`);
    const d = makeDecor(r.model);
    result = r;
    decor = d;
    const v = ensureView();
    v.show(r.model, d, { bySource: bySource.checked });
    updateSun();
    const seconds = (performance.now() - t0) / 1000;
    log(`Xong sau ${fmtSeconds(seconds)} s: ${r.model.buildings.length} nhà, ${d.trees.length} cây, ${d.cars.length} xe.`);
    showInfo(r, d, map.area, seconds);
    builtOutline = poly;
    done = `Đã dựng xong trong ${fmtSeconds(seconds)} s. Kéo cảnh bên phải để xoay.`;
    if (r.warnings.length) done += ` Có ${r.warnings.length} cảnh báo, xem Chi tiết.`;
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      log(`✗ ${(err as Error).message}`);
      done = `Không dựng được: ${(err as Error).message}`;
    }
  } finally {
    running = null;
    refresh();
    if (done) statusEl.textContent = done;
  }
}

function downloadJson(): void {
  if (!result) return;
  const { place, model, projection, merge, overpassServer } = result;
  const data = { place, origin: { lon: projection.lon0, lat: projection.lat0 }, units: 'm, x east, z south', merge, overpassServer, ...model, decor };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `khu-${(place?.name || 'vgang').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 3D controls: toolbar buttons and keys.
const STEP = Math.PI / 8;
const ACTIONS: Record<string, () => void> = {
  left: () => view?.turn({ yaw: STEP }),
  right: () => view?.turn({ yaw: -STEP }),
  up: () => view?.turn({ pitch: STEP / 2 }),
  down: () => view?.turn({ pitch: -STEP / 2 }),
  in: () => view?.turn({ zoom: 0.7 }),
  out: () => view?.turn({ zoom: 1 / 0.7 }),
  spin: () => view?.setSpin(!view.spinning),
  reset: () => view?.reset(),
  full: () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void viewWrap.requestFullscreen?.();
  },
};
const KEYS: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  '+': 'in',
  '=': 'in',
  '-': 'out',
  ' ': 'spin',
  r: 'reset',
  f: 'full',
};
// Phones without fullscreen for elements (iPhone Safari) do not get the button.
if (!document.fullscreenEnabled) viewWrap.querySelector('[data-act="full"]')?.remove();
$('view-tools').addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act) ACTIONS[act]?.();
});
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, select')) return;
  if (e.key === '/') {
    e.preventDefault();
    $('search-input').focus();
    return;
  }
  const act = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!act || !view || e.ctrlKey || e.metaKey || e.altKey) return;
  // Space on a focused button already clicks it.
  if (act === 'spin' && target.closest('button')) return;
  e.preventDefault();
  ACTIONS[act]();
});
$('btn-north').addEventListener('click', () => view?.faceNorth());

// Time of day.
let playing = false;
let lastTick = 0;
function tick(now: number): void {
  if (!playing) return;
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  // A whole day in about 40 seconds.
  timeInput.value = String((Number(timeInput.value) + dt * 36) % 1440);
  updateSun();
  requestAnimationFrame(tick);
}
$('btn-play').addEventListener('click', () => {
  playing = !playing;
  $('btn-play').title = playing ? 'Dừng thời gian' : 'Cho thời gian trôi';
  $('play-icon').innerHTML = playing
    ? '<path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z" fill="currentColor" />'
    : '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />';
  if (playing) {
    lastTick = performance.now();
    requestAnimationFrame(tick);
  }
});
timeInput.addEventListener('input', updateSun);
dateInput.addEventListener('change', updateSun);
dateInput.value = today();

// Search.
const searchInput = $<HTMLInputElement>('search-input');
const resultsEl = $('search-results');
let searchCtrl: AbortController | null = null;
const note = (text: string) => resultsEl.replaceChildren(Object.assign(document.createElement('li'), { textContent: text }));
$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  searchCtrl?.abort();
  searchCtrl = new AbortController();
  note('Đang tìm…');
  resultsEl.classList.remove('hidden');
  try {
    showHits(await searchPlaces(q, fetch, searchCtrl.signal));
  } catch (err) {
    if ((err as Error).name !== 'AbortError') note(`Không tìm được: ${(err as Error).message}`);
  }
});
function showHits(hits: SearchHit[]): void {
  if (!hits.length) {
    note('Không thấy địa điểm nào.');
    return;
  }
  resultsEl.replaceChildren(
    ...hits.map((h) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.append(h.name, Object.assign(document.createElement('small'), { textContent: h.detail }));
      li.addEventListener('click', () => {
        map.goTo(h.lat, h.lon, h.bbox);
        resultsEl.classList.add('hidden');
        searchInput.blur();
      });
      return li;
    }),
  );
}
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    resultsEl.classList.add('hidden');
    searchInput.blur();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('.search')) resultsEl.classList.add('hidden');
});

// Drawing tools.
map.onChange = refresh;
btnBox.addEventListener('click', () => (map.isBoxing ? map.clear() : map.startBox()));
btnDraw.addEventListener('click', () => (map.isDrawing ? map.finishDrawing() : map.startDrawing()));
btnSquare.addEventListener('click', () => map.squareHere(500));
btnClear.addEventListener('click', () => {
  running?.abort();
  map.clear();
});
btnBuild.addEventListener('click', () => void build());
$('btn-example').addEventListener('click', () => {
  // Khương Thượng and Kim Liên, Đống Đa, Hà Nội: about 1 km².
  map.setOutline(squareAround(105.8297, 21.0068, 980), true);
  void build();
});
$('btn-details').addEventListener('click', () => {
  const open = !$('details').classList.toggle('hidden');
  $('btn-details').setAttribute('aria-expanded', String(open));
  $('btn-details').textContent = open ? 'Ẩn chi tiết' : 'Chi tiết';
});
bySource.addEventListener('change', () => result && decor && view?.show(result.model, decor, { bySource: bySource.checked }));
$('btn-json').addEventListener('click', downloadJson);
refresh();
updateSun();
if (import.meta.env.DEV) Object.assign(window, { __newmap: map });
