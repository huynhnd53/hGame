// pickleball.js – Pickleball góc nhìn thứ ba. Điện thoại (hoặc bàn phím/chuột) là vợt; nhân vật tự chạy tới bóng,
// người chơi chỉ cần vung đúng lúc. Đơn vị: mét, giây. Lưới ở z = 0; bên mình (side = +1) là z > 0, máy (side = -1) là z < 0.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const T = THREE;
const params = new URLSearchParams(location.search);

// ---------- Kích thước sân và vật lý ----------
const HALF_W = 3.05, HALF_L = 6.705, KITCHEN = 2.13;     // sân 20 x 44 feet, vùng cấm 7 feet
const NET_SIDE = 0.914, NET_MID = 0.864, POST_X = HALF_W + 0.3;
const BALL_R = 0.037, BALL_DRAW = 2.2;                    // bóng vẽ to hơn thật cho dễ nhìn
const G = 9.81, E_BOUNCE = 0.62, FRICTION = 0.8;
const STEP = 1 / 120;
const LINE_TOL = BALL_R;                                  // bóng chạm vạch vẫn tính là trong
const netHeight = (x) => NET_MID + (NET_SIDE - NET_MID) * Math.min(1, Math.abs(x) / HALF_W);
const sideOf = (z) => (z >= 0 ? 1 : -1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// Mức máy: tốc độ chạy, độ lệch cú đánh, độ trễ phản xạ.
const LEVELS = [
  { speed: 3.4, sigma: 0.85, react: 0.28, name: "Dễ" },
  { speed: 4.3, sigma: 0.5, react: 0.18, name: "Vừa" },
  { speed: 5.2, sigma: 0.28, react: 0.1, name: "Khó" },
];
const PLAYER_SPEED = 5.6;          // người chơi chạy nhanh hơn chút để dễ chơi
const WIN_AT = 11;

// ---------- Cảnh 3D ----------
const stage = $("stage");
const renderer = new T.WebGLRenderer({ canvas: $("gl"), antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
const scene = new T.Scene();
scene.background = new T.Color(0xa9d8ff);
scene.fog = new T.Fog(0xa9d8ff, 30, 70);
const camera = new T.PerspectiveCamera(50, 1, 0.1, 200);
scene.add(new T.HemisphereLight(0xffffff, 0x5d8a4f, 0.75));
const sun = new T.DirectionalLight(0xffffff, 0.8);
sun.position.set(-6, 14, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -12, near: 1, far: 40 });
scene.add(sun);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 70 : 50;     // điện thoại dựng đứng: mở rộng góc nhìn
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

const mat = (color, extra = {}) => new T.MeshLambertMaterial({ color, ...extra });
function box(w, h, d, m) { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.castShadow = true; return o; }

// Nền, sân, vạch
const ground = new T.Mesh(new T.PlaneGeometry(120, 120), mat(0x5f9d55));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const apron = new T.Mesh(new T.PlaneGeometry(HALF_W * 2 + 6, HALF_L * 2 + 8), mat(0x3f8a5c));
apron.rotation.x = -Math.PI / 2; apron.position.y = 0.002; apron.receiveShadow = true; scene.add(apron);
const courtMat = mat(0x2d62b0), kitchenMat = mat(0x3b7bd0);
for (const s of [1, -1]) {
  const back = new T.Mesh(new T.PlaneGeometry(HALF_W * 2, HALF_L - KITCHEN), courtMat);
  back.rotation.x = -Math.PI / 2; back.position.set(0, 0.004, s * (KITCHEN + HALF_L) / 2); back.receiveShadow = true; scene.add(back);
  const k = new T.Mesh(new T.PlaneGeometry(HALF_W * 2, KITCHEN), kitchenMat);
  k.rotation.x = -Math.PI / 2; k.position.set(0, 0.004, s * KITCHEN / 2); k.receiveShadow = true; scene.add(k);
}
const lineMat = new T.MeshBasicMaterial({ color: 0xffffff });
function line(x1, z1, x2, z2) {
  const w = 0.05, len = Math.hypot(x2 - x1, z2 - z1) + w;
  const m = new T.Mesh(new T.PlaneGeometry(len, w), lineMat);
  m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(z2 - z1, x2 - x1);
  m.position.set((x1 + x2) / 2, 0.007, (z1 + z2) / 2); scene.add(m);
}
for (const s of [1, -1]) {
  line(-HALF_W, s * HALF_L, HALF_W, s * HALF_L);       // vạch cuối sân
  line(-HALF_W, s * KITCHEN, HALF_W, s * KITCHEN);     // vạch vùng cấm
  line(0, s * KITCHEN, 0, s * HALF_L);                 // vạch giữa (chỉ trong ô giao bóng)
}
line(-HALF_W, -HALF_L, -HALF_W, HALF_L); line(HALF_W, -HALF_L, HALF_W, HALF_L);

// Lưới
const netTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"); g.strokeStyle = "rgba(20,20,20,.85)"; g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(POST_X * 2 / 0.08, NET_SIDE / 0.08); return t;
})();
const net = new T.Mesh(new T.PlaneGeometry(POST_X * 2, NET_SIDE), new T.MeshBasicMaterial({ map: netTex, transparent: true, side: T.DoubleSide, depthWrite: false }));
net.position.y = NET_SIDE / 2; scene.add(net);
const tape = box(POST_X * 2, 0.06, 0.03, mat(0xffffff)); tape.position.y = (NET_SIDE + NET_MID) / 2; scene.add(tape);
for (const s of [1, -1]) { const p = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 1, 10), mat(0x333344)); p.position.set(s * POST_X, 0.5, 0); p.castShadow = true; scene.add(p); }

// Hàng rào và vài hàng cây cho có cảnh
const fenceMat = new T.MeshLambertMaterial({ color: 0x1f4f3a, transparent: true, opacity: 0.55, side: T.DoubleSide });
for (const [w, x, z, ry] of [[HALF_W * 2 + 8, 0, -(HALF_L + 5), 0], [HALF_W * 2 + 8, 0, HALF_L + 9, 0], [HALF_L * 2 + 14, -(HALF_W + 4), 2, Math.PI / 2], [HALF_L * 2 + 14, HALF_W + 4, 2, Math.PI / 2]]) {
  const f = new T.Mesh(new T.PlaneGeometry(w, 3), fenceMat); f.position.set(x, 1.5, z); f.rotation.y = ry; scene.add(f);
}
for (let i = 0; i < 26; i++) {
  const a = (i / 26) * Math.PI * 2, r = rand(17, 24);
  const t = new T.Group();
  const trunk = new T.Mesh(new T.CylinderGeometry(0.15, 0.2, 1.4, 6), mat(0x7a5233)); trunk.position.y = 0.7;
  const top = new T.Mesh(new T.IcosahedronGeometry(rand(1.1, 1.8), 0), mat(i % 3 ? 0x3c7d3a : 0x4f9444, { flatShading: true })); top.position.y = 2.2;
  t.add(trunk, top); t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r * 1.2); t.scale.setScalar(rand(0.9, 1.4)); scene.add(t);
}

// Người chơi: dựng mặt quay về -z, tay phải ở +x. Máy xoay 180°.
function makePlayer(shirt, shorts) {
  const g = new T.Group();
  const skin = mat(0xf1c7a1);
  const hips = new T.Group(); hips.position.y = 0.9; g.add(hips);
  const legs = [-1, 1].map((s) => {
    const pivot = new T.Group(); pivot.position.set(s * 0.12, 0, 0);
    const leg = box(0.15, 0.82, 0.16, mat(shorts)); leg.position.y = -0.41; pivot.add(leg);
    const shoe = box(0.17, 0.08, 0.28, mat(0xffffff)); shoe.position.set(0, -0.84, -0.05); pivot.add(shoe);
    hips.add(pivot); return pivot;
  });
  const torso = box(0.42, 0.62, 0.24, mat(shirt)); torso.position.y = 0.33; hips.add(torso);
  const head = new T.Mesh(new T.SphereGeometry(0.15, 16, 12), skin); head.position.y = 0.8; head.castShadow = true; hips.add(head);
  const cap = new T.Mesh(new T.SphereGeometry(0.155, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(shirt)); cap.position.y = 0.83; hips.add(cap);
  const visor = box(0.2, 0.02, 0.14, mat(shirt)); visor.position.set(0, 0.84, -0.17); hips.add(visor);
  const leftArm = new T.Group(); leftArm.position.set(-0.27, 0.58, 0); hips.add(leftArm);
  const la = box(0.11, 0.56, 0.11, skin); la.position.y = -0.28; leftArm.add(la); leftArm.rotation.z = -0.2;
  // Tay phải cầm vợt: xoay quanh vai theo trục dọc để vung.
  const shoulder = new T.Group(); shoulder.position.set(0.27, 0.58, 0); hips.add(shoulder);
  const arm = new T.Group(); arm.rotation.z = 0.6; shoulder.add(arm);
  const ua = box(0.11, 0.58, 0.11, skin); ua.position.y = -0.29; arm.add(ua);
  const paddle = new T.Group(); paddle.position.y = -0.6; arm.add(paddle);
  const handle = box(0.04, 0.14, 0.04, mat(0x222222)); handle.position.y = -0.05; paddle.add(handle);
  const face = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.02, 20), mat(0xffd23f)); face.scale.set(1, 1, 1.25);
  face.rotation.z = Math.PI / 2; face.position.y = -0.24; face.castShadow = true; paddle.add(face);
  scene.add(g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, hips, legs, shoulder, arm, leftArm };
}

// Bóng, bóng đổ giả, vệt bay và vòng đánh dấu chỗ bóng sẽ rơi
const ballMesh = new T.Mesh(new T.SphereGeometry(BALL_R * BALL_DRAW, 16, 12), new T.MeshLambertMaterial({ color: 0xe8ff3a, emissive: 0x3a4000 }));
ballMesh.castShadow = true; scene.add(ballMesh);
const blob = new T.Mesh(new T.CircleGeometry(BALL_R * 2.4, 16), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; scene.add(blob);
const TRAIL_N = 14;
const trailGeo = new T.BufferGeometry(); trailGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
trail.frustumCulled = false; scene.add(trail);
const marker = new T.Mesh(new T.RingGeometry(0.16, 0.22, 24), new T.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.7, depthWrite: false }));
marker.rotation.x = -Math.PI / 2; marker.position.y = 0.01; marker.visible = false; scene.add(marker);

// ---------- Âm thanh tự tổng hợp ----------
let audio = null;
function unlockAudio() {
  if (!audio) { try { audio = new AudioContext(); } catch { audio = null; } }
  if (audio && audio.state === "suspended") audio.resume();
}
function sound(kind, vol = 1) {
  if (!audio) return;
  const t = audio.currentTime;
  const tone = (freq, dur, gain, type = "sine") => {
    const o = audio.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = audio.createGain(); g.gain.setValueAtTime(gain * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  };
  if (kind === "pock") { tone(1100, 0.07, 0.5, "triangle"); tone(520, 0.05, 0.3); }
  if (kind === "bounce") tone(260, 0.08, 0.35);
  if (kind === "net") tone(140, 0.2, 0.4, "square");
  if (kind === "whoosh") tone(500, 0.12, 0.05, "sawtooth");
  if (kind === "win") { tone(660, 0.15, 0.25, "triangle"); setTimeout(() => sound("win2", vol), 120); }
  if (kind === "win2") tone(990, 0.25, 0.25, "triangle");
  if (kind === "lose") tone(220, 0.35, 0.25, "triangle");
}

// ---------- Trạng thái trận ----------
let level = LEVELS[1];
let demo = params.has("demo");
const players = { 1: null, [-1]: null };
function newPlayerState(side, mesh) {
  return { side, x: 0, z: side * (HALF_L + 0.3), vx: 0, vz: 0, mesh, plan: null, swingAt: -9, swingHand: 1, runPhase: 0, shots: 0 };
}
players[1] = newPlayerState(1, makePlayer(0x2f6fff, 0x1d2b55));
players[-1] = newPlayerState(-1, makePlayer(0xe2463c, 0x3a2222));
players[-1].mesh.group.rotation.y = Math.PI;

const ball = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, netHit: false };
const game = {
  state: "menu",        // menu | serve | rally | point | over
  t: 0,                 // giờ mô phỏng
  score: { 1: 0, [-1]: 0 },
  server: 1,
  hitter: 0, shotN: 0, bounces: 0, bounceSide: 0,
  stateAt: 0, samples: [], trail: [],
  stats: { winners: 0, errors: 0, longest: 0 },
};

function stepBall(b) {
  const pz = b.z;
  b.vy -= G * STEP;
  b.x += b.vx * STEP; b.y += b.vy * STEP; b.z += b.vz * STEP;
  let ev = null;
  if (!b.netHit && pz !== 0 && Math.sign(pz) !== Math.sign(b.z) && Math.abs(b.x) < POST_X && b.y - BALL_R < netHeight(b.x)) {
    b.netHit = true; b.z = pz; b.vz *= -0.12; b.vx *= 0.3; b.vy = Math.min(b.vy, 0) * 0.3; ev = "net";
  }
  if (b.y < BALL_R) {
    b.y = BALL_R;
    if (b.vy < 0) {
      b.vy = -b.vy * E_BOUNCE; b.vx *= FRICTION; b.vz *= FRICTION;
      if (b.vy < 0.3) b.vy = 0;
      ev = ev || "bounce";
    } else { b.vx *= 0.97; b.vz *= 0.97; }
  }
  return ev;
}

/** Mô phỏng trước đường bóng (dùng đúng hàm vật lý nên khớp tuyệt đối). */
function predict(maxT = 3.2) {
  const b = { ...ball };
  const out = [];
  let side = sideOf(b.z), n = game.bounceSide === side ? game.bounces : 0;
  for (let t = STEP; t <= maxT; t += STEP) {
    const ev = stepBall(b);
    const s = sideOf(b.z);
    if (s !== side) { side = s; n = 0; }
    if (ev === "net") { out.push({ t: game.t + t, x: b.x, y: b.y, z: b.z, vz: b.vz, side: s, n, ev }); break; }
    if (ev === "bounce") n++;
    out.push({ t: game.t + t, x: b.x, y: b.y, z: b.z, vz: b.vz, side: s, n, ev });
    if (n >= 2) break;
  }
  return out;
}

/** Bóng nảy lần đầu ở bên `side` có trong sân không (giao bóng: phải vào đúng ô chéo, qua vùng cấm). */
function bounceIn(x, z, side, serve) {
  const az = Math.abs(z), ax = Math.abs(x);
  if (az > HALF_L + LINE_TOL || ax > HALF_W + LINE_TOL) return false;
  if (!serve) return true;
  if (az < KITCHEN + LINE_TOL) return false;                      // giao bóng chạm vạch vùng cấm cũng là hỏng
  return Math.sign(x) === game.serveBoxSign || ax < LINE_TOL;
}

// ---------- Lên kế hoạch đỡ bóng ----------
const reachBody = (c, p, fore) => ({ x: c.x - p.side * (fore ? 0.62 : -0.62), z: c.z + p.side * 0.25 });

function plan(p) {
  const s = p.side;
  const requireBounce = game.shotN + 1 <= 3;
  const samples = game.samples;
  // Bóng sẽ rơi ra ngoài thì để nó đi.
  const firstBounce = samples.find((m) => m.side === s && m.ev === "bounce" && m.n === 1);
  const netFirst = samples.find((m) => m.ev === "net");
  if (netFirst) return null;
  if (firstBounce && !bounceIn(firstBounce.x, firstBounce.z, s, game.shotN === 1)) return { letGo: true, bounce: firstBounce };
  const speed = s === 1 && !demo ? PLAYER_SPEED : level.speed;
  const react = s === 1 && !demo ? 0 : level.react;
  const near = Math.abs(p.z) < KITCHEN + 1.6;
  let volley = null, ground = null, fallback = null, chase = null, bestShort = Infinity;
  for (const m of samples) {
    if (m.t <= game.t || m.side !== s || m.n >= 2) continue;
    if (m.y < 0.28 || m.y > 1.7 || m.vz * s <= 0) continue;
    const az = Math.abs(m.z);
    if (az > HALF_L + 2.5 || Math.abs(m.x) > HALF_W + 2) continue;
    if (m.n === 0 && (requireBounce || az < KITCHEN + 0.2)) continue;      // chưa được vô-lê, hoặc đứng trong vùng cấm
    const fore = Math.abs(reachBody(m, p, true).x - p.x) <= Math.abs(reachBody(m, p, false).x - p.x) + 0.3;
    const body = reachBody(m, p, fore);
    const need = Math.hypot(body.x - p.x, body.z - p.z) / speed + react;
    const avail = m.t - game.t;
    const c = { ...m, fore, body };
    if (need <= avail) {
      if (m.n === 0) { if (!volley) volley = c; }
      else if (!ground && m.y >= 0.45 && m.y <= 1.25) ground = c;
      else if (!fallback) fallback = c;
    } else if (need - avail < bestShort) { bestShort = need - avail; chase = { ...c, miss: true }; }
  }
  // Đứng gần lưới thì vô-lê luôn; ở cuối sân thì chờ bóng nảy.
  return (near && volley) || ground || fallback || volley || chase;
}

function readyPosition(p) {
  const s = p.side;
  const advance = p.shots >= (game.server === s ? 2 : 1);
  return { x: clamp(ball.x * 0.35, -1.5, 1.5), z: s * (advance ? KITCHEN + 0.45 : HALF_L - 0.3) };
}

function movePlayer(p, dt) {
  let tx, tz;
  if (game.state === "serve") {
    const pos = servePosition(p.side); tx = pos.x; tz = pos.z;
  } else if (p.plan && !p.plan.letGo && game.state === "rally") { tx = p.plan.body.x; tz = p.plan.body.z; }
  else { const r = readyPosition(p); tx = r.x; tz = r.z; }
  // Không chạy vào vùng cấm khi chưa cần (đánh bóng nảy trong vùng cấm thì vẫn được vào).
  const speed = p.side === 1 && !demo ? PLAYER_SPEED : level.speed;
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  const want = d < 0.02 ? 0 : Math.min(speed, d / Math.max(dt, 0.05) * 0.5);
  const vx = d ? dx / d * want : 0, vz = d ? dz / d * want : 0;
  const k = Math.min(1, dt * 12);
  p.vx += (vx - p.vx) * k; p.vz += (vz - p.vz) * k;
  p.x += p.vx * dt; p.z += p.vz * dt;
  if (Math.sign(p.z) !== p.side) p.z = p.side * 0.3;      // không sang sân bên kia
}

// ---------- Giao bóng ----------
function servePosition(s) {
  const fromRight = game.score[game.server] % 2 === 0;
  if (s === game.server) {
    const xs = (fromRight ? 1 : -1) * s;                    // bên phải của người giao (nhìn về phía lưới)
    return { x: xs * 1.1, z: s * (HALF_L + 0.35) };
  }
  const xs = (fromRight ? 1 : -1) * game.server;            // người đỡ đứng chéo
  return { x: -xs * 1.4, z: s * (HALF_L - 0.1) };
}

function setupServe() {
  game.state = "serve"; game.stateAt = game.t;
  game.hitter = 0; game.shotN = 0; game.bounces = 0; game.bounceSide = 0;
  for (const s of [1, -1]) { const p = players[s]; const pos = servePosition(s); p.x = pos.x; p.z = pos.z; p.vx = p.vz = 0; p.plan = null; p.shots = 0; }
  const fromRight = game.score[game.server] % 2 === 0;
  game.serveBoxSign = -(fromRight ? 1 : -1) * game.server;  // ô chéo bên kia
  ball.netHit = false; ball.vx = ball.vy = ball.vz = 0;
  game.trail.length = 0; marker.visible = false;
  updateBoard();
  hint(game.server === 1 && !demo ? "Vung để giao bóng" : "");
}

// ---------- Đánh bóng ----------
/** Vận tốc để bóng đi từ `from` tới (tx, BALL_R, tz) trong thời gian `t`. */
function solve(from, tx, tz, t) {
  return { vx: (tx - from.x) / t, vz: (tz - from.z) / t, vy: (BALL_R - from.y + 0.5 * G * t * t) / t };
}
function clearsNet(from, v, margin) {
  if (sideOf(from.z) === sideOf(from.z + v.vz)) { /* luôn sang sân kia */ }
  const tn = -from.z / v.vz;
  if (!(tn > 0)) return false;
  const y = from.y + v.vy * tn - 0.5 * G * tn * tn, x = from.x + v.vx * tn;
  return y - BALL_R >= netHeight(x) + margin;
}
const SHOTS = {
  serve: { margin: 0.3, speed: 12, label: "Giao bóng" },
  dink: { margin: 0.06, speed: 6.2, label: "Bỏ nhỏ" },
  drive: { margin: 0.12, speed: 13.5, label: "Đánh thường" },
  fast: { margin: 0.07, speed: 17, label: "Đánh mạnh" },
  smash: { margin: 0.04, speed: 20, label: "Đập!" },
  lob: { margin: 1.4, speed: 9, label: "Lốp" },
};
/** Chọn đích theo kiểu đánh, rồi tìm thời gian bay ngắn nhất mà vẫn qua lưới an toàn. */
function shotVelocity(from, kind, aimX, sigma, depthJitter = 0) {
  const s = sideOf(from.z), o = -s;
  let tz;
  if (kind === "dink") tz = o * rand(0.7, 1.8);
  else if (kind === "lob") tz = o * rand(5.4, 6.3);
  else if (kind === "serve") tz = o * rand(4.6, 5.9);
  else if (kind === "smash") tz = o * rand(3.0, 5.0);
  else tz = o * rand(3.8, 5.6);
  let tx = kind === "serve" ? game.serveBoxSign * rand(0.7, 2.1) : aimX;
  tx += gauss() * sigma; tz += o * (gauss() * sigma * 0.8 + depthJitter);
  const spec = SHOTS[kind];
  const dist = Math.hypot(tx - from.x, tz - from.z);
  let t = dist / spec.speed;
  for (let i = 0; i < 200 && !clearsNet(from, solve(from, tx, tz, t), spec.margin); i++) t += 0.02;
  if (kind === "lob") t = Math.max(t, 1.5 + dist / 25);
  t *= 1 + gauss() * sigma * 0.06;                          // lệch nhịp: có thể vào lưới
  return solve(from, tx, tz, Math.max(0.25, t));
}

function hitBall(p, kind, aimX, sigma, quality) {
  const s = p.side;
  if (game.state === "rally") {
    const requireBounce = game.shotN + 1 <= 3;
    if (requireBounce && !(game.bounceSide === s && game.bounces === 1)) { endPoint(-s, "Phải để bóng nảy", "Hai cú đầu sau giao phải để bóng nảy"); return; }
  }
  const from = { x: ball.x, y: ball.y, z: ball.z };
  if (kind === "smash" && ball.y < 1.0) kind = "fast";
  const v = shotVelocity(from, kind, aimX, sigma);
  Object.assign(ball, v); ball.netHit = false;
  game.hitter = s; game.shotN++; game.bounces = 0; game.bounceSide = 0;
  p.shots++; p.plan = null; players[-s].plan = null;
  p.swingAt = game.t; p.swingHand = kind === "serve" ? 1 : (p.lastFore ? 1 : -1);
  game.samples = predict();
  players[-s].plan = plan(players[-s]);
  sound("pock", kind === "dink" ? 0.6 : 1);
  if (s === 1) {
    link.broadcast({ t: "buzz", ms: kind === "smash" || kind === "fast" ? 60 : 30 });
    const tag = quality == null ? "" : quality > 0.85 ? " · Đẹp!" : quality < 0.4 ? (game.lastOff > 0 ? " · Sớm" : " · Muộn") : "";
    if (!demo || quality != null) popupAt(p, SHOTS[kind].label + tag, quality > 0.85);
  }
  if (game.state === "serve") { game.state = "rally"; hint(""); }
}

// ---------- Máy (và người chơi ở chế độ xem máy đấu) chọn cú đánh ----------
function aiShot(p) {
  const s = p.side, opp = players[-s];
  const meNear = Math.abs(p.z) < KITCHEN + 1.2, oppNear = Math.abs(opp.z) < KITCHEN + 1.4;
  const r = Math.random();
  let kind;
  if (game.shotN === 2 && !meNear) kind = r < 0.55 ? "dink" : "drive";        // cú thứ ba: thả nhỏ để lên lưới
  else if (meNear && oppNear) kind = r < 0.7 ? "dink" : r < 0.9 ? "fast" : "lob";
  else if (meNear) kind = r < 0.45 ? "fast" : "drive";
  else kind = oppNear ? (r < 0.25 ? "lob" : r < 0.5 ? "dink" : "drive") : (r < 0.2 ? "dink" : "drive");
  if (ball.y > 1.2 && Math.abs(ball.z) < 5) kind = "smash";
  // Đánh về phía xa người kia.
  const away = -Math.sign(opp.x || rand(-1, 1));
  const aimX = clamp(away * rand(0.6, 2.2), -HALF_W + 0.5, HALF_W - 0.5);
  return { kind, aimX };
}

// ---------- Điều khiển của người chơi ----------
const LEAD = 0.05;          // vung trước lúc chạm bóng chừng này là đẹp nhất
const EARLY = 0.4, LATE = 0.16, WINDOW = 0.26;
let swing = null;           // { at: giờ mô phỏng, kind, peak, up, aim }
let mouseAim = 0, mouseAimAt = -1e9;

function requestSwing(kind, info = {}) {
  if (game.state === "menu" || game.state === "over" || demo) return;
  unlockAudio();
  const p = players[1];
  if (game.t - p.swingAt < 0.3) return;
  if (game.state === "serve") {
    if (game.server !== 1 || game.t - game.stateAt < 0.4) return;
    serveBall(p, info.aim ?? aimFromMouse());
    return;
  }
  if (game.state !== "rally") return;
  swing = { at: game.t, kind, aim: info.aim ?? aimFromMouse(), sw: info.sw || null };
  p.swingAt = game.t; p.swingHand = p.plan && !p.plan.letGo ? (p.plan.fore ? 1 : -1) : 1;
  sound("whoosh");
}
const aimFromMouse = () => (performance.now() - mouseAimAt < 4000 ? mouseAim : 0);

function serveBall(p, aim) {
  const pos = handPosition(p);
  Object.assign(ball, { x: pos.x, y: 0.75, z: pos.z });
  hitBall(p, "serve", aim * 2, p.side === 1 && !demo ? 0.18 : level.sigma * 0.35, null);
}

/** Người chơi: bóng tới điểm chạm mà đang trong lúc vung thì đánh trúng. */
function playerContact(p) {
  const pl = p.plan;
  if (!pl || pl.letGo || pl.miss || !swing) return;
  const dt = game.t - pl.t;
  if (dt < -STEP / 2 || dt > LATE) return;
  const reach = Math.hypot(pl.body.x - p.x, pl.body.z - p.z);
  if (reach > 0.5) return;
  const off = (pl.t - swing.at) - LEAD;                       // > 0: sớm, < 0: muộn
  if (off > EARLY - LEAD) return;                              // vung quá sớm, đã hụt
  const quality = clamp(1 - Math.abs(off) / WINDOW, 0, 1);
  game.lastOff = off;
  const aimX = clamp(swing.aim * 2.3 - off / WINDOW * 1.6, -HALF_W - 0.6, HALF_W + 0.6);
  p.lastFore = pl.fore;
  // Cú vung điện thoại: kiểu đánh chốt lúc chạm bóng, theo tốc độ cao nhất đo được tới lúc đó.
  const kind = swing.kind === "phone" ? phoneKind(swing.sw) : swing.kind;
  swing = null;
  hitBall(p, kind, aimX, 0.12 + (1 - quality) * 0.9, quality);
}

function aiContact(p) {
  const pl = p.plan;
  if (!pl || pl.letGo || pl.miss) return;
  if (game.t < pl.t - STEP / 2) return;
  if (Math.hypot(pl.body.x - p.x, pl.body.z - p.z) > 0.5) { p.plan = { ...pl, miss: true }; return; }
  p.lastFore = pl.fore;
  const { kind, aimX } = aiShot(p);
  hitBall(p, kind, aimX, p.side === 1 ? 0.35 : level.sigma, null);
}

// Bàn phím, chuột
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  const map = { " ": "drive", z: "dink", x: "lob", c: "smash" };
  if (map[k] && game.state !== "menu" && game.state !== "over") { e.preventDefault(); requestSwing(map[k]); }
});
stage.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  mouseAim = clamp((e.clientX / stage.clientWidth) * 2 - 1, -1, 1) * 1.15; mouseAimAt = performance.now();
});
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".panel")) return;
  if (e.pointerType === "mouse") { mouseAim = clamp((e.clientX / stage.clientWidth) * 2 - 1, -1, 1) * 1.15; mouseAimAt = performance.now(); }
  requestSwing(e.shiftKey ? "dink" : e.button === 2 ? "lob" : "drive");
});
stage.addEventListener("contextmenu", (e) => { if (!e.target.closest(".panel")) e.preventDefault(); });

// ---------- Điện thoại: tính tốc độ xoay để nhận cú vung ----------
const DEG = Math.PI / 180;
const zee = new T.Vector3(0, 0, 1);
const euler = new T.Euler();
const q0 = new T.Quaternion();
const q1 = new T.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function deviceToQuaternion(q, alpha, beta, gamma, orient) {
  euler.set(beta * DEG, alpha * DEG, -gamma * DEG, "YXZ");
  q.setFromEuler(euler); q.multiply(q1); q.multiply(q0.setFromAxisAngle(zee, -orient * DEG));
}
const raw = new T.Quaternion(), offset = new T.Quaternion(), rel = new T.Quaternion(), prevRel = new T.Quaternion();
let pendingCenter = true, prevTs = 0, phoneCount = 0, relayCount = 0;
const SWING_START = 260, SWING_END = 140;     // độ/giây
const history = [];                           // { ts, up } – độ ngóc của đầu máy
let phoneSwing = null;                        // { ts, peak, up0 }
let lastPhoneSwingEnd = 0;

function onOrient(d) {
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  deviceToQuaternion(raw, num(d.a), num(d.b), num(d.g), num(d.o));
  if (pendingCenter) { offset.copy(raw).invert(); pendingCenter = false; }
  rel.copy(offset).multiply(raw);
  const ts = Number.isFinite(+d.ts) ? +d.ts : performance.now();
  const dt = (ts - prevTs) / 1000;
  const angle = 2 * Math.acos(Math.min(1, Math.abs(prevRel.dot(rel)))) / DEG;
  prevRel.copy(rel);
  const top = new T.Vector3(0, 1, 0).applyQuaternion(rel);
  history.push({ ts, up: top.z }); while (history.length && ts - history[0].ts > 500) history.shift();
  if (prevTs === 0 || dt <= 0 || dt > 0.25) { prevTs = ts; return; }
  prevTs = ts;
  const speed = angle / Math.max(dt, 0.008);
  if (!phoneSwing) {
    if (speed > SWING_START && ts - lastPhoneSwingEnd > 250) {
      const before = history.find((h) => ts - h.ts <= 140) || history[0];
      phoneSwing = { ts, peak: speed, up0: before ? before.up : top.z, upMax: top.z };
      // Báo cú vung ngay để tính đúng lúc; kiểu đánh chốt lúc bóng chạm vợt (peak đo tới lúc đó).
      requestSwing("phone", { aim: 0, sw: phoneSwing });
    }
  } else {
    phoneSwing.peak = Math.max(phoneSwing.peak, speed);
    phoneSwing.upMax = Math.max(phoneSwing.upMax, top.z);
    if (speed < SWING_END || ts - phoneSwing.ts > 450) { phoneSwing = null; lastPhoneSwingEnd = ts; }
  }
}
/** Kiểu đánh từ cú vung điện thoại: hất lên là lốp, nhẹ là bỏ nhỏ, mạnh là đập. */
function phoneKind(sw) {
  if (!sw) return "drive";
  if (sw.upMax - sw.up0 > 0.45) return "lob";
  if (sw.peak < 520) return "dink";
  if (sw.peak > 1100) return "smash";
  if (sw.peak > 820) return "fast";
  return "drive";
}

const padUrl = (code) => {
  const u = new URL("pad.html", location.href);
  if (code) u.searchParams.set("c", code);
  u.searchParams.set("game", "pickle");
  for (const k of ["peer", "relay", "via"]) if (params.get(k)) u.searchParams.set(k, params.get(k));
  return u;
};
$("padUrl").textContent = padUrl().host + padUrl().pathname;
const link = TiltLink.hostScreen({
  game: "pickle",
  onCode(code) {
    $("codeOut").textContent = code; $("qr").innerHTML = "";
    new QRCode($("qr"), { text: padUrl(code).href, width: 132, height: 132, correctLevel: QRCode.CorrectLevel.M });
    setPadText();
  },
  onPads(n, { relay }) { phoneCount = n; relayCount = relay; if (n > 0) pendingCenter = true; setPadText(); },
  onMessage(d) {
    if (d.t === "reset") { pendingCenter = true; popupCenter("Đã căn giữa"); return; }
    if (d.t === "orient") onOrient(d);
  },
  onError(err) { $("padText").textContent = "Không mở được phòng (" + (err.type || err.message) + ")"; },
});
function setPadText() {
  $("padDot").classList.toggle("live", phoneCount > 0);
  const code = $("codeOut").textContent;
  $("padText").textContent = phoneCount > 0
    ? "Điện thoại đã kết nối" + (relayCount ? " qua trung gian" : "") + " · phòng " + code
    : "Chưa có điện thoại · dùng Space/chuột · phòng " + code;
}

// ---------- Kết thúc pha bóng ----------
function endPoint(winner, title, sub = "") {
  if (game.state !== "rally" && game.state !== "serve") return;
  game.state = "point"; game.stateAt = game.t;
  game.score[winner]++;
  game.stats.longest = Math.max(game.stats.longest, game.shotN);
  if (winner === 1) game.stats.winners++; else game.stats.errors++;
  game.server = winner;
  banner((winner === 1 ? "Bạn được điểm" : "Máy được điểm") + "<small>" + title + (sub ? " · " + sub : "") + "</small>");
  sound(winner === 1 ? "win" : "lose", 0.7);
  if (winner === 1) link.broadcast({ t: "buzz", ms: 120 });
  marker.visible = false; swing = null;
  updateBoard();
}
function checkGameOver() {
  const a = game.score[1], b = game.score[-1];
  if (Math.max(a, b) >= WIN_AT && Math.abs(a - b) >= 2) {
    game.state = "over";
    $("overTitle").textContent = demo ? "Hết trận" : a > b ? "Bạn thắng!" : "Máy thắng";
    $("overScore").textContent = a + " – " + b;
    $("overStats").textContent = "Pha bóng dài nhất: " + game.stats.longest + " cú · Mức máy: " + level.name;
    show("over"); banner("");
    return true;
  }
  return false;
}

function onBallEvent(ev) {
  if (ev === "net") {
    sound("net");
    if (game.hitter) endPoint(-game.hitter, "Chạm lưới");
    return;
  }
  if (ev !== "bounce") return;
  sound("bounce", Math.min(1, Math.abs(ball.vy) / 4 + 0.2));
  const s = sideOf(ball.z);
  if (game.state !== "rally") return;
  if (s === game.hitter) { endPoint(-game.hitter, "Bóng không qua lưới"); return; }
  if (game.bounceSide !== s) { game.bounceSide = s; game.bounces = 0; }
  game.bounces++;
  if (game.bounces === 1 && !bounceIn(ball.x, ball.z, s, game.shotN === 1)) {
    const serve = game.shotN === 1;
    const kitchen = serve && Math.abs(ball.z) < KITCHEN + LINE_TOL && Math.abs(ball.z) <= HALF_L;
    endPoint(s, serve ? (kitchen ? "Giao bóng vào vùng cấm" : "Giao bóng hỏng") : "Bóng ra ngoài");
  } else if (game.bounces === 2) {
    endPoint(game.hitter, s === 1 ? "Không đỡ được" : "Máy không đỡ được");
  }
}

// ---------- Giao diện ----------
function updateBoard() {
  $("scoreMe").textContent = game.score[1]; $("scoreAi").textContent = game.score[-1];
  $("srvMe").classList.toggle("on", game.server === 1); $("srvAi").classList.toggle("on", game.server === -1);
}
function banner(html) { $("banner").innerHTML = html; }
function hint(text) { $("hint").textContent = text; }
const proj = new T.Vector3();
function popupAt(p, text, good) {
  proj.set(p.x, 2.1, p.z).project(camera);
  popup((proj.x + 1) / 2 * stage.clientWidth, (1 - proj.y) / 2 * stage.clientHeight, text, good);
}
function popupCenter(text) { popup(stage.clientWidth / 2, stage.clientHeight * 0.45, text, true); }
function popup(x, y, text, good) {
  const d = document.createElement("div"); d.textContent = text; if (good) d.className = "good";
  d.style.left = x + "px"; d.style.top = y + "px"; $("popups").appendChild(d);
  setTimeout(() => d.remove(), 1000);
}
function show(id) { for (const p of ["menu", "over"]) $(p).classList.toggle("hidden", p !== id); }

function startMatch(asDemo) {
  unlockAudio();
  demo = asDemo;
  game.score[1] = game.score[-1] = 0;
  game.stats = { winners: 0, errors: 0, longest: 0 };
  game.server = Math.random() < 0.5 ? 1 : -1;
  show(null); banner("");
  setupServe();
}
$("playBtn").onclick = () => startMatch(false);
$("demoBtn").onclick = () => startMatch(true);
$("hubBtn").onclick = () => link.goTo("hub");
$("againBtn").onclick = () => startMatch(demo);
$("menuBtn").onclick = () => { game.state = "menu"; show("menu"); hint(""); banner(""); };
for (const b of document.querySelectorAll("#level button")) {
  b.onclick = () => {
    level = LEVELS[+b.dataset.l];
    for (const o of document.querySelectorAll("#level button")) o.classList.toggle("on", o === b);
  };
}

// ---------- Vòng lặp ----------
function handPosition(p) { return { x: p.x + p.side * 0.45, z: p.z - p.side * 0.2 }; }

function simStep() {
  game.t += STEP;
  const st = game.state;
  if (st === "serve") {
    const srv = players[game.server];
    const hp = handPosition(srv);
    Object.assign(ball, { x: hp.x, y: 0.75 + Math.sin(game.t * 3) * 0.02, z: hp.z, vx: 0, vy: 0, vz: 0 });
    const auto = game.server === -1 || demo;
    if (auto && game.t - game.stateAt > 1.3) serveBall(srv, 0);
  } else if (st === "rally" || st === "point") {
    const ev = stepBall(ball);
    if (ev) onBallEvent(ev);
    if (game.state === "rally" && (Math.abs(ball.z) > HALF_L + 14 || Math.abs(ball.x) > HALF_W + 14)) endPoint(-game.hitter, "Bóng ra ngoài");
  }
  if (game.state === "rally") {
    for (const s of [1, -1]) {
      const p = players[s];
      if (game.hitter === s) continue;
      if (!p.plan || p.plan.miss) p.plan = plan(p);                  // chưa với tới thì vừa chạy vừa tính lại
      if (s === 1 && !demo) playerContact(p); else aiContact(p);
    }
    if (swing && game.t - swing.at > EARLY + LATE) swing = null;
  }
  for (const s of [1, -1]) movePlayer(players[s], STEP);
  if (game.state === "point" && game.t - game.stateAt > 1.8) {
    banner("");
    if (!checkGameOver()) setupServe();
  }
}

function animatePlayer(p, dt) {
  const m = p.mesh;
  m.group.position.set(p.x, 0, p.z);
  const sp = Math.hypot(p.vx, p.vz);
  p.runPhase += sp * dt * 3.2;
  const swingK = sp > 0.3 ? Math.sin(p.runPhase) * Math.min(1, sp / 3) * 0.7 : 0;
  m.legs[0].rotation.x = swingK; m.legs[1].rotation.x = -swingK;
  m.hips.position.y = 0.9 - (sp > 0.3 ? Math.abs(Math.sin(p.runPhase)) * 0.04 : 0) - (game.state === "rally" ? 0.06 : 0);
  m.leftArm.rotation.x = -swingK * 0.6;
  // Vung vợt: 0 → 0.3 s
  const u = (game.t - p.swingAt) / 0.3;
  const hand = p.swingHand;
  // Quay quanh vai: âm là vợt ra sau lưng, dương là vợt ra trước. Trái tay: vợt vắt sang trái rồi quét ra trước.
  if (u >= 0 && u <= 1) {
    const e = Math.sin(u * Math.PI / 2);
    m.shoulder.rotation.y = hand > 0 ? -1.2 + e * 2.8 : 2.9 - e * 2.0;
    m.arm.rotation.z = 0.9 + Math.sin(u * Math.PI) * 0.5;
  } else {
    const ready = p.plan && !p.plan.letGo && !p.plan.fore ? 2.3 : 0.4;
    m.shoulder.rotation.y += (ready - m.shoulder.rotation.y) * Math.min(1, dt * 8);
    m.arm.rotation.z += (0.6 - m.arm.rotation.z) * Math.min(1, dt * 8);
  }
  // Nhìn theo bóng
  const look = Math.atan2(ball.x - p.x, -(ball.z - p.z) * p.side) * 0.5;
  m.group.rotation.y = (p.side === 1 ? 0 : Math.PI) - clamp(look, -0.7, 0.7) * p.side;
}

const camPos = new T.Vector3(0, 3.4, HALF_L + 5), camLook = new T.Vector3(0, 0.6, -6);
function updateCamera(dt) {
  const me = players[1];
  const k = Math.min(1, dt * 3);
  const tight = camera.aspect < 1 ? 1.25 : 1;
  camPos.lerp(new T.Vector3(me.x * 0.6, 4.0 * tight, me.z + 5.6 * tight), k);
  camLook.lerp(new T.Vector3(me.x * 0.3, 0.3, me.z - 7), k);
  camera.position.copy(camPos); camera.lookAt(camLook);
}

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (game.state !== "menu" && game.state !== "over") {
    acc += dt;
    while (acc >= STEP) { simStep(); acc -= STEP; }
  }
  // Vẽ
  ballMesh.position.set(ball.x, ball.y, ball.z);
  blob.position.set(ball.x, 0.012, ball.z);
  blob.material.opacity = clamp(0.4 - ball.y * 0.08, 0.12, 0.4);
  if (game.state === "rally") { game.trail.push(ball.x, ball.y, ball.z); if (game.trail.length > TRAIL_N * 3) game.trail.splice(0, 3); }
  const arr = trailGeo.attributes.position.array;
  for (let i = 0; i < TRAIL_N; i++) {
    const j = Math.max(0, game.trail.length - (TRAIL_N - i) * 3);
    arr[i * 3] = game.trail[j] ?? ball.x; arr[i * 3 + 1] = game.trail[j + 1] ?? ball.y; arr[i * 3 + 2] = game.trail[j + 2] ?? ball.z;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trail.visible = game.state === "rally";
  // Vòng đánh dấu chỗ bóng sắp nảy bên mình
  const me = players[1];
  if (game.state === "rally" && game.hitter === -1 && game.samples.length) {
    const b = game.samples.find((m) => m.side === 1 && m.ev === "bounce" && m.t > game.t);
    marker.visible = !!b;
    if (b) { marker.position.set(b.x, 0.012, b.z); marker.material.color.set(me.plan && me.plan.letGo ? 0xff5a4f : 0xffe14d); }
  } else marker.visible = false;
  if (!demo && game.state === "rally") {
    if (me.plan && me.plan.letGo && game.hitter === -1) hint("Bóng sẽ ra ngoài – để nó đi!");
    else if (game.hitter === -1 && me.plan && !me.plan.letGo) hint(me.plan.n === 0 ? "Vô-lê!" : "");
    else if ($("hint").textContent && game.hitter === 1) hint("");
  }
  for (const s of [1, -1]) animatePlayer(players[s], dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
for (const s of [1, -1]) { const p = players[s]; p.x = 0; p.z = s * (HALF_L - 0.5); }
requestAnimationFrame(frame);
if (params.has("debug")) window.__pb = { game, ball, players, requestSwing, startMatch, predict, phoneKind, onOrient };
if (params.has("demo")) startMatch(true);
})();
