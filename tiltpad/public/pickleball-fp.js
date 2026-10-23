// pickleball-fp.js – Pickleball góc nhìn thứ nhất, tách từ pickleball.js (góc nhìn thứ ba). Khác bản kia:
// - camera ở mắt người chơi; cây vợt trên màn hình xoay đúng theo điện thoại;
// - nhận dạng động tác từ đường đi của đầu vợt: vụt từ dưới lên, smash (đập xuống), dink (đẩy nhẹ), lốp, đánh thẳng;
// - bóng có xoáy: vụt từ dưới lên xoáy lên nên cắm nhanh, dink xoáy ngược nên bổng (đổi trọng lực hiệu dụng của quả bóng).
// Đơn vị: mét, giây. Lưới ở z = 0; bên mình (side = +1) là z > 0, máy (side = -1) là z < 0.
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
const SPIN_G = 3.5;              // xoáy lên/ngược thêm/bớt chừng này m/s² vào trọng lực (thay cho lực Magnus)
const SMASH_MIN = 1.05;          // bóng thấp hơn chừng này mà đập thì vào lưới
const EYE_Y = 1.55;
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
// Độ phân giải tự hạ khi khung hình chậm (xem adaptResolution), tối đa 1,5× để máy màn hình nét vẫn mượt.
const MAX_RATIO = Math.min(1.5, devicePixelRatio || 1);
let pixelRatio = MAX_RATIO;
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
const scene = new T.Scene();
scene.background = new T.Color(0xa9d8ff);
scene.fog = new T.Fog(0xa9d8ff, 30, 70);
const camera = new T.PerspectiveCamera(68, 1, 0.05, 200);
camera.rotation.order = "YXZ";
scene.add(camera);                                         // để vợt gắn vào camera được vẽ
scene.add(new T.HemisphereLight(0xffffff, 0x5d8a4f, 0.75));
const sun = new T.DirectionalLight(0xffffff, 0.8);
sun.position.set(-6, 14, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -12, near: 1, far: 40 });
scene.add(sun);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 85 : 68;     // điện thoại dựng đứng: mở rộng góc nhìn
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
// Vai phải cao SHOULDER_Y khi đứng, lệch 0,27 m sang phải; mặt vợt cách vai REACH. Điểm chạm bóng tính từ đây nên
// lúc vợt chạm bóng, mặt vợt nằm đúng chỗ quả bóng.
const HIP_Y = 0.9, SHOULDER_DY = 0.58, SHOULDER_X = 0.27, REACH = 0.84;
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
// Vòng canh nhịp ở chỗ vợt sẽ chạm bóng: co dần lại, khép vào chấm (chuyển xanh) là lúc vung.
const cueMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: T.DoubleSide });
const cue = new T.Mesh(new T.RingGeometry(0.88, 1, 48), cueMat);
const cueDot = new T.Mesh(new T.RingGeometry(0.1, 0.13, 32), new T.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthTest: false, side: T.DoubleSide }));
cue.renderOrder = cueDot.renderOrder = 10;
cue.visible = cueDot.visible = false;
scene.add(cue, cueDot);

// Vợt của mình (paddle.js, dùng chung với trang kiểm tra motion.html): có điện thoại thì vợt lấy đúng tư thế điện
// thoại trong không gian; không có thì chạy hoạt cảnh theo kiểu đánh. Vợt đặt trong sân theo người, không gắn vào
// camera, nên quay đầu nhìn bóng không kéo vợt theo.
const PM = window.PaddleMotion;
const fpPaddle = PM.buildPaddle();
scene.add(fpPaddle);
// Hoạt cảnh: [chúc/ngóc, quét ngang] lúc lấy đà và lúc kết thúc. Chúc/ngóc âm là đầu vợt ra trước, quá π/2 là đầu vợt
// chúc xuống đất phía sau; quét ngang dương là sang trái.
const READY = [-0.5, -0.15];
const FP_SWINGS = {
  vut: [[2.4, -0.3], [-1.0, 0.3]], smash: [[0.5, -0.1], [-2.3, 0.1]], dink: [[-0.9, 0], [-1.35, 0]],
  lob: [[2.5, 0], [-0.3, 0]], drive: [[-1.45, -1.2], [-1.45, 1.0]], fast: [[-1.45, -1.4], [-1.45, 1.2]],
  serve: [[2.4, -0.3], [-0.9, 0.2]], netfault: [[0.5, -0.1], [-2.3, 0.1]],
};
let fpAnim = null;               // { kind, t0 } (giờ thật, ms)
function fpSwing(kind) { fpAnim = { kind: FP_SWINGS[kind] ? kind : "vut", t0: performance.now() }; }
const fpQ = new T.Quaternion(), eyeV = new T.Vector3();
function updateFpPaddle() {
  const me = players[1];
  eyeV.set(me.rx, EYE_Y, me.rz);
  if (phoneCount && motion.live() && motion.centered) { PM.place(fpPaddle, motion.q, eyeV); return; }
  let [ax, ay] = READY;
  if (fpAnim) {
    const [[x0, y0], [x1, y1]] = FP_SWINGS[fpAnim.kind];
    const u = (performance.now() - fpAnim.t0) / 280;
    if (u < 0.3) { const e = u / 0.3; ax = lerp(READY[0], x0, e); ay = lerp(READY[1], y0, e); }
    else if (u < 0.75) { const e = easeOut((u - 0.3) / 0.45); ax = lerp(x0, x1, e); ay = lerp(y0, y1, e); }
    else if (u < 1.7) { const e = (u - 0.75) / 0.95; ax = lerp(x1, READY[0], e); ay = lerp(y1, READY[1], e); }
    else fpAnim = null;
  }
  PM.place(fpPaddle, PM.poseFrom(fpQ, ax, ay), eyeV);
}

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
  return { side, x: 0, z: side * (HALF_L + 0.3), vx: 0, vz: 0, mesh, plan: null, runPhase: 0, shots: 0, face: 0,
    anim: { phase: null, t0: 0, hand: 1, y: 1, from: 0.35 }, rx: 0, rz: 0 };
}
players[1] = newPlayerState(1, makePlayer(0x2f6fff, 0x1d2b55));
players[-1] = newPlayerState(-1, makePlayer(0xe2463c, 0x3a2222));
players[-1].mesh.group.rotation.y = Math.PI;
players[1].mesh.group.visible = false;                     // góc nhìn thứ nhất: không thấy thân mình

const ball = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, g: G, netHit: false };
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
  b.vy -= (b.g || G) * STEP;
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
/** Khom người khi bóng thấp. */
const crouchFor = (y) => clamp(0.62 - y, 0, 0.3);
/** Góc giơ tay (quanh vai, 0 là buông thẳng) để mặt vợt tới độ cao y. */
function armAngle(y) {
  const shoulderY = HIP_Y - 0.06 - crouchFor(y) + SHOULDER_DY;
  return clamp(Math.acos(clamp((shoulderY - y) / REACH, -1, 1)), 0.35, 1.95);
}
/** Chỗ đứng để chạm bóng ở c: thuận tay thì bóng bên phải, trái tay thì vợt vắt sang trái thân. */
function reachBody(c, p, fore) {
  if (p.side === 1) return { x: c.x - (fore ? 0.45 : -0.4), z: c.z + 0.85 };   // góc nhìn thứ nhất: bóng tới trước mặt
  const out = REACH * Math.sin(armAngle(c.y));
  const lat = fore ? SHOULDER_X + out : SHOULDER_X - out;
  return { x: c.x - p.side * lat, z: c.z };
}

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

const ACCEL = 16, DECEL = 20;       // m/s²: tăng tốc, hãm lại khi tới chỗ – để chạy không giật cục
function movePlayer(p, dt) {
  let tx, tz;
  if (game.state === "serve" || (game.state === "point" && game.t - game.stateAt > 0.6)) {
    const pos = servePosition(p.side); tx = pos.x; tz = pos.z;               // giữa hai điểm: thong thả đi về chỗ giao
  } else if (p.plan && !p.plan.letGo && game.state === "rally") { tx = p.plan.body.x; tz = p.plan.body.z; }
  else { const r = readyPosition(p); tx = r.x; tz = r.z; }
  const speed = (p.side === 1 && !demo ? PLAYER_SPEED : level.speed) * (game.state === "point" ? 0.6 : 1);
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  // Vận tốc mong muốn: chạy hết tốc, gần tới thì chậm dần để dừng đúng chỗ (v² = 2·a·d).
  const want = d < 0.01 ? 0 : Math.min(speed, Math.sqrt(2 * DECEL * d));
  const wx = d ? dx / d * want : 0, wz = d ? dz / d * want : 0;
  const ex = wx - p.vx, ez = wz - p.vz, e = Math.hypot(ex, ez), maxDv = ACCEL * dt;
  if (e > maxDv) { p.vx += ex / e * maxDv; p.vz += ez / e * maxDv; } else { p.vx = wx; p.vz = wz; }
  p.x += p.vx * dt; p.z += p.vz * dt;
  if (Math.sign(p.z) !== p.side) { p.z = p.side * 0.3; p.vz = 0; }      // không sang sân bên kia
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
  for (const s of [1, -1]) {
    const p = players[s], pos = servePosition(s);
    // Đã đi bộ về gần chỗ giao trong lúc nghỉ; chỉ đặt thẳng vào chỗ nếu còn xa (đầu trận).
    if (Math.hypot(pos.x - p.x, pos.z - p.z) > 0.6) { p.x = pos.x; p.z = pos.z; p.vx = p.vz = 0; }
    p.plan = null; p.shots = 0; p.anim.phase = null;
  }
  const fromRight = game.score[game.server] % 2 === 0;
  game.serveBoxSign = -(fromRight ? 1 : -1) * game.server;  // ô chéo bên kia
  ball.netHit = false; ball.vx = ball.vy = ball.vz = 0;
  game.trail.length = 0; marker.visible = false;
  updateBoard();
  hint(game.server === 1 && !demo ? "Vung để giao bóng" : "");
}

// ---------- Đánh bóng ----------
/** Vận tốc để bóng đi từ `from` tới (tx, BALL_R, tz) trong thời gian `t`. */
function solve(from, tx, tz, t, g = G) {
  return { vx: (tx - from.x) / t, vz: (tz - from.z) / t, vy: (BALL_R - from.y + 0.5 * g * t * t) / t, g };
}
function clearsNet(from, v, margin) {
  const tn = -from.z / v.vz;
  if (!(tn > 0)) return false;
  const y = from.y + v.vy * tn - 0.5 * v.g * tn * tn, x = from.x + v.vx * tn;
  return y - BALL_R >= netHeight(x) + margin;
}
const SHOTS = {
  serve: { margin: 0.3, speed: 12, spin: 0.3, label: "Giao bóng" },
  dink: { margin: 0.08, speed: 6.2, spin: -0.35, label: "Dink" },
  drive: { margin: 0.16, speed: 13.5, spin: 0, label: "Đánh thẳng" },
  fast: { margin: 0.1, speed: 17, spin: 0.15, label: "Đánh mạnh" },
  vut: { margin: 0.28, speed: 15, spin: 1, label: "Vụt" },
  smash: { margin: 0.06, speed: 20, spin: 0.2, label: "Smash!" },
  lob: { margin: 1.4, speed: 9, spin: 0.2, label: "Lốp" },
  netfault: { margin: 0, speed: 12, spin: 0, label: "Smash hụt – bóng thấp" },
};
/** Chọn đích theo kiểu đánh, rồi tìm thời gian bay ngắn nhất mà vẫn qua lưới an toàn. */
function shotVelocity(from, kind, aimX, sigma, depthJitter = 0) {
  const s = sideOf(from.z), o = -s;
  let tz;
  if (kind === "dink") tz = o * rand(0.7, 1.8);
  else if (kind === "lob") tz = o * rand(5.4, 6.3);
  else if (kind === "serve") tz = o * rand(4.6, 5.9);
  else if (kind === "smash") tz = o * rand(3.0, 5.0);
  else if (kind === "vut") tz = o * rand(4.2, 6.0);
  else tz = o * rand(3.8, 5.6);
  let tx = kind === "serve" ? game.serveBoxSign * rand(0.7, 2.1) : aimX;
  tx += gauss() * sigma; tz += o * (gauss() * sigma * 0.8 + depthJitter);
  const spec = SHOTS[kind];
  const g = G + spec.spin * SPIN_G;
  if (kind === "netfault") {                                  // đập bóng thấp: cắm thẳng vào lưới
    const t = Math.abs(from.z) / spec.speed;
    return { vx: (tx - from.x) / t, vz: -from.z / t, vy: (0.3 - from.y + 0.5 * G * t * t) / t, g: G };
  }
  const dist = Math.hypot(tx - from.x, tz - from.z);
  let t = dist / spec.speed;
  for (let i = 0; i < 200 && !clearsNet(from, solve(from, tx, tz, t, g), spec.margin); i++) t += 0.02;
  if (kind === "lob") t = Math.max(t, 1.5 + dist / 25);
  t *= 1 + gauss() * sigma * 0.035;                         // lệch nhịp: thỉnh thoảng vào lưới
  return solve(from, tx, tz, Math.max(0.25, t), g);
}

function hitBall(p, kind, aimX, sigma, quality) {
  const s = p.side;
  if (game.state === "rally") {
    const requireBounce = game.shotN + 1 <= 3;
    if (requireBounce && !(game.bounceSide === s && game.bounces === 1)) { endPoint(-s, "Phải để bóng nảy", "Hai cú đầu sau giao phải để bóng nảy"); return; }
  }
  const from = { x: ball.x, y: ball.y, z: ball.z };
  // Động tác phải hợp với bóng: đập bóng thấp là vào lưới (người chơi), vụt bóng đã cao thì thành lốp bổng.
  if (kind === "smash" && ball.y < SMASH_MIN) kind = s === 1 && !demo ? "netfault" : "fast";
  if (kind === "vut" && ball.y > 1.35) kind = "lob";
  const v = shotVelocity(from, kind, aimX, sigma);
  Object.assign(ball, v); ball.netHit = false;
  game.hitter = s; game.shotN++; game.bounces = 0; game.bounceSide = 0;
  p.shots++; p.plan = null; players[-s].plan = null;
  if (p.anim.phase !== "strike" || game.t - p.anim.t0 > STRIKE_T) strike(p, kind === "serve" || p.lastFore ? 1 : -1, from.y, true);
  game.samples = predict();
  players[-s].plan = plan(players[-s]);
  sound("pock", kind === "dink" ? 0.6 : 1);
  if (s === 1) {
    link.broadcast({ t: "buzz", ms: kind === "smash" || kind === "fast" ? 60 : 30 });
    const tag = quality == null ? "" : quality > 0.85 ? "Đẹp!" : quality < 0.4 ? (game.lastOff > 0 ? "Sớm" : "Muộn") : "";
    if (!demo) showGesture(SHOTS[kind].label, [tag, lastGestureInfo].filter(Boolean).join(" · "), kind === "netfault" ? "bad" : quality > 0.85 ? "good" : "");
    if (kind === "serve" || !swingFromKeys) fpSwing(kind);
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
  if (kind === "drive" && Math.random() < 0.5) kind = "vut";
  if (ball.y > 1.2 && Math.abs(ball.z) < 5) kind = "smash";
  // Đánh về phía xa người kia.
  const away = -Math.sign(opp.x || rand(-1, 1));
  const aimX = clamp(away * rand(0.6, 2.2), -HALF_W + 0.5, HALF_W - 0.5);
  return { kind, aimX };
}

// ---------- Điều khiển của người chơi ----------
const LEAD = 0.05;          // vung trước lúc chạm bóng chừng này là đẹp nhất
const EARLY = 0.45, WINDOW = 0.3;
const lateLimit = () => (phoneCount ? 0.2 : 0.16);           // điện thoại chậm hơn phím một chút (mạng, nhận cú vung)
let swing = null;           // { at: giờ mô phỏng, kind, aim, sw }
let mouseAim = 0, mouseAimAt = -1e9;

// ---------- Hoạt cảnh vung vợt ----------
// Vung = lấy đà (WIND_T, vợt ra sau rồi chờ) + đánh (STRIKE_T, vợt quét ra trước). Mặt vợt chạm bóng ở IMPACT_U
// của cú đánh, nên cú đánh bắt đầu trước lúc chạm bóng IMPACT_LEAD giây.
const WIND_T = 0.14, STRIKE_T = 0.24, IMPACT_U = 0.35, RECOVER_T = 0.3;
const IMPACT_LEAD = STRIKE_T * IMPACT_U;
// Góc quay quanh vai (rad): thuận tay ra sau / chạm / theo đà; trái tay vắt sang trái (quanh π).
const POSE = {
  [1]: { ready: 0.35, back: -1.35, impact: 0, follow: 1.45 },
  [-1]: { ready: 2.25, back: Math.PI + 1.15, impact: Math.PI, follow: Math.PI - 1.4 },
};
function windUp(p, hand, y) {
  if (p.anim.phase === "wind" || (p.anim.phase === "strike" && game.t - p.anim.t0 < STRIKE_T)) return;
  p.anim = { phase: "wind", t0: game.t, hand, y, from: p.mesh.shoulder.rotation.y };
}
/** Đánh: `atImpact` thì đặt hoạt cảnh đúng lúc vợt chạm bóng (giao bóng, đánh muộn). */
function strike(p, hand, y, atImpact = false) {
  p.anim = { phase: "strike", t0: game.t - (atImpact ? IMPACT_LEAD : 0), hand, y, from: p.anim.from };
}

function requestSwing(kind, info = {}) {
  if (game.state === "menu" || game.state === "over" || demo) return;
  unlockAudio();
  const p = players[1];
  if (game.state === "serve") {
    if (game.server !== 1 || game.t - game.stateAt < 0.4) return;
    lastGestureInfo = info.sw ? gestureInfo(info.sw) : "";
    if (info.sw) info.sw.hit = true;
    swingFromKeys = kind !== "phone";
    if (swingFromKeys) fpSwing("serve");
    serveBall(p, info.aim ?? aimFromMouse());
    return;
  }
  if (game.state !== "rally") return;
  // Phím bấm hai lần liền: bỏ lần sau. Điện thoại: đoạn vung mới (sau lấy đà) luôn thay đoạn trước.
  if (!info.sw && swing && !swing.sw && game.t - swing.at < 0.15) return;
  // Cú vung mới thay cú cũ (không chặn): cử động lỡ tay ngay trước không nuốt mất cú thật.
  swing = { at: Math.min(game.t, info.at ?? game.t), kind, aim: info.aim ?? aimFromMouse(), sw: info.sw || null };
  const pl = p.plan && !p.plan.letGo ? p.plan : null;
  windUp(p, pl ? (pl.fore ? 1 : -1) : 1, pl ? pl.y : 1);
  if (kind !== "phone") fpSwing(kind);
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
  if (dt < -STEP / 2 || dt > lateLimit()) return;
  const reach = Math.hypot(pl.body.x - p.x, pl.body.z - p.z);
  if (reach > 0.6) return;
  const off = (pl.t - swing.at) - LEAD;                       // > 0: sớm, < 0: muộn
  if (off > EARLY - LEAD) return;                              // vung quá sớm, đã hụt
  const quality = clamp(1 - Math.abs(off) / WINDOW, 0, 1);
  game.lastOff = off;
  const aimX = clamp(swing.aim * 2.3 - off / WINDOW * 1.6, -HALF_W - 0.6, HALF_W + 0.6);
  p.lastFore = pl.fore;
  swingFromKeys = swing.kind !== "phone";
  // Cú vung điện thoại: kiểu đánh chốt lúc chạm bóng, theo tốc độ cao nhất đo được tới lúc đó.
  const kind = swing.kind === "phone" ? classifySwing(swing.sw) : swing.kind;
  lastGestureInfo = swing.kind === "phone" ? gestureInfo(swing.sw) : "";
  if (swing.sw) swing.sw.hit = true;
  swing = null;
  hitBall(p, kind, aimX, 0.1 + (1 - quality) * 0.55, quality);
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
  const map = { " ": "vut", z: "dink", x: "lob", c: "smash", v: "drive" };
  if (map[k] && game.state !== "menu" && game.state !== "over") { e.preventDefault(); requestSwing(map[k]); }
});
stage.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  mouseAim = clamp((e.clientX / stage.clientWidth) * 2 - 1, -1, 1) * 1.15; mouseAimAt = performance.now();
});
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".panel")) return;
  if (e.pointerType === "mouse") { mouseAim = clamp((e.clientX / stage.clientWidth) * 2 - 1, -1, 1) * 1.15; mouseAimAt = performance.now(); }
  requestSwing(e.shiftKey ? "dink" : e.button === 2 ? "smash" : "vut");
});
stage.addEventListener("contextmenu", (e) => { if (!e.target.closest(".panel")) e.preventDefault(); });

// ---------- Điện thoại làm cán vợt (paddle.js): tư thế vợt và nhận động tác ----------
let phoneCount = 0, relayCount = 0, lastGestureInfo = "", swingFromKeys = false;
const motion = PM.create({
  // Thời điểm vung tính lùi theo độ trễ mạng (paddle.js đo bằng giờ trên điện thoại).
  onSwing(sw, late) { requestSwing("phone", { aim: 0, sw, at: game.t - late }); },
  // Cú đánh (không tính lấy đà) mà không trúng bóng: vẫn báo động tác nhận được, để người chơi tập.
  onStroke(sw, group) { if (!group.some((x) => x.hit)) showGesture(SHOTS[PM.classify(sw).kind].label, PM.info(sw), ""); },
});
const classifySwing = (sw) => PM.classify(sw).kind;
const gestureInfo = PM.info;
let gestureTimer = 0;
function showGesture(name, info, cls) {
  $("gName").textContent = name; $("gInfo").textContent = info || "";
  $("gesture").className = cls || "";
  clearTimeout(gestureTimer); gestureTimer = setTimeout(() => $("gesture").classList.add("fade"), 1800);
}

const padUrl = (code) => {
  const u = new URL("pad.html", location.href);
  if (code) u.searchParams.set("c", code);
  u.searchParams.set("game", "picklefp");
  for (const k of ["peer", "relay", "via"]) if (params.get(k)) u.searchParams.set(k, params.get(k));
  return u;
};
$("padUrl").textContent = padUrl().host + padUrl().pathname;
const link = TiltLink.hostScreen({
  game: "picklefp",
  onCode(code) {
    $("codeOut").textContent = code; $("qr").innerHTML = "";
    new QRCode($("qr"), { text: padUrl(code).href, width: 132, height: 132, correctLevel: QRCode.CorrectLevel.M });
    setPadText();
  },
  onPads(n, { relay }) { phoneCount = n; relayCount = relay; if (n > 0) motion.center(); setPadText(); },
  onMessage(d) {
    if (d.t === "reset") { motion.center(); popupCenter("Đã căn giữa"); return; }
    if (d.t === "orient") motion.onOrient(d);
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
$("motionBtn").onclick = () => link.goTo("motion");
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
    Object.assign(ball, { x: hp.x, y: 0.75 + Math.sin(game.t * 3) * 0.02, z: hp.z, vx: 0, vy: 0, vz: 0, g: G });
    const auto = game.server === -1 || demo;
    if (auto && game.t - game.stateAt > 1.3 - WIND_T) windUp(srv, 1, 0.75);
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
      const pl = p.plan && !p.plan.letGo && !p.plan.miss ? p.plan : null;
      const auto = s === -1 || demo;
      // Máy lấy đà sẵn; người chơi lấy đà lúc vung. Tới lúc thì quét vợt để chạm bóng đúng giữa cú đánh.
      if (auto && pl && game.t >= pl.t - IMPACT_LEAD - WIND_T) windUp(p, pl.fore ? 1 : -1, pl.y);
      if (pl && p.anim.phase === "wind" && game.t >= pl.t - IMPACT_LEAD && (auto || swing)) strike(p, pl.fore ? 1 : -1, pl.y);
      if (s === 1 && !demo) playerContact(p); else aiContact(p);
    }
    if (swing) {
      // Vung quá sớm (bóng còn xa) thì hụt ngay cho dễ hiểu; không thì hết cửa sổ mới tính là hụt.
      const me = players[1], mpl = me.plan && !me.plan.letGo && !me.plan.miss ? me.plan : null;
      const tooEarly = mpl && mpl.t - swing.at > EARLY && game.t - swing.at > WIND_T + 0.08;
      if (tooEarly || game.t - swing.at > EARLY + lateLimit()) {
        swing = null;
        if (me.anim.phase === "wind") strike(me, me.anim.hand, me.anim.y);           // vung hụt
      }
    }
  }
  for (const s of [1, -1]) movePlayer(players[s], STEP);
  if (game.state === "point" && game.t - game.stateAt > 2.2) {
    banner("");
    if (!checkGameOver()) setupServe();
  }
}

const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeIn = (u) => u * u;
const lerp = (a, b, u) => a + (b - a) * u;

/** Góc vai và góc giơ tay theo hoạt cảnh vung hiện tại. */
function swingPose(p) {
  const a = p.anim, pose = POSE[a.hand];
  const raise = armAngle(a.y);
  if (a.phase === "wind") return { yaw: lerp(a.from, pose.back, easeOut(Math.min(1, (game.t - a.t0) / WIND_T))), arm: lerp(0.6, raise, 0.8), crouch: crouchFor(a.y) };
  if (a.phase === "strike") {
    const u = (game.t - a.t0) / STRIKE_T;
    if (u < IMPACT_U) return { yaw: lerp(pose.back, pose.impact, easeIn(u / IMPACT_U)), arm: raise, crouch: crouchFor(a.y) };
    if (u < 1) return { yaw: lerp(pose.impact, pose.follow, easeOut((u - IMPACT_U) / (1 - IMPACT_U))), arm: lerp(raise, 1.2, (u - IMPACT_U) / (1 - IMPACT_U)), crouch: crouchFor(a.y) };
    const r = (u - 1) * STRIKE_T / RECOVER_T;
    if (r < 1) return { yaw: lerp(pose.follow, POSE[1].ready, easeOut(r)), arm: lerp(1.2, 0.6, r), crouch: 0 };
    a.phase = null;
  }
  return null;
}

function animatePlayer(p, x, z, dt) {
  const m = p.mesh;
  m.group.position.set(x, 0, z);
  const sp = Math.hypot(p.vx, p.vz);
  p.runPhase += sp * dt * 3.2;
  const step = sp > 0.25 ? Math.sin(p.runPhase) * Math.min(1, sp / 3) * 0.7 : 0;
  m.legs[0].rotation.x += (step - m.legs[0].rotation.x) * Math.min(1, dt * 20);
  m.legs[1].rotation.x = -m.legs[0].rotation.x;
  const k = Math.min(1, dt * 14);
  const pose = swingPose(p);
  if (pose) {
    m.shoulder.rotation.y = pose.yaw;                           // hoạt cảnh tính sẵn theo thời gian, không làm mượt thêm
    m.arm.rotation.z = pose.arm;
  } else {
    const ready = p.plan && !p.plan.letGo && !p.plan.miss && !p.plan.fore ? POSE[-1].ready : POSE[1].ready;
    m.shoulder.rotation.y += (ready - m.shoulder.rotation.y) * k;
    m.arm.rotation.z += (0.6 - m.arm.rotation.z) * k;
  }
  const bob = sp > 0.25 ? Math.abs(Math.sin(p.runPhase)) * 0.04 : 0;
  const hipY = HIP_Y - bob - (game.state === "rally" ? 0.06 : 0) - (pose ? pose.crouch : 0);
  m.hips.position.y += (hipY - m.hips.position.y) * Math.min(1, dt * 18);
  m.leftArm.rotation.x = -m.legs[0].rotation.x * 0.6;
  // Quay mặt theo bóng; sắp đánh thì quay thẳng về lưới cho vợt chạm đúng chỗ.
  const pl = p.plan && !p.plan.letGo && !p.plan.miss ? p.plan : null;
  const facing = pose || (pl && pl.t - game.t < 0.5) ? 0 : clamp(Math.atan2(ball.x - x, -(ball.z - z) * p.side) * 0.5, -0.7, 0.7);
  p.face += (facing - p.face) * Math.min(1, dt * 8);
  m.group.rotation.y = (p.side === 1 ? 0 : Math.PI) - p.face * p.side;
}

// Góc nhìn thứ nhất: mắt người chơi, nhìn về phía sân bên kia, quay đầu một phần theo bóng.
let camYaw = 0, camPitch = -0.12;
function updateCamera(dt) {
  const me = players[1];
  const k = 1 - Math.exp(-dt * 4);
  const ahead = ball.z < me.rz;
  const yawT = ahead ? clamp(Math.atan2(ball.x - me.rx, -(ball.z - me.rz)) * 0.4, -0.45, 0.45) : 0;
  const pitchT = -0.12 + (ahead ? clamp((ball.y - EYE_Y) * 0.06, -0.08, 0.12) : 0);
  camYaw += (-yawT - camYaw) * k; camPitch += (pitchT - camPitch) * k;
  const bob = Math.hypot(me.vx, me.vz) > 0.25 ? Math.abs(Math.sin(me.runPhase)) * 0.025 : 0;
  camera.position.set(me.rx, EYE_Y - bob, me.rz);
  camera.rotation.set(camPitch, camYaw, 0);
}

/** Khung hình chậm (máy yếu, màn hình nét) thì hạ độ phân giải; nhanh lại thì nâng dần. */
let perfTime = 0, perfFrames = 0, fastPeriods = 0;
function adaptResolution(frameTime) {
  perfTime += frameTime; perfFrames++;
  if (perfTime < 1.5) return;
  const avg = perfTime / perfFrames;
  perfTime = 0; perfFrames = 0;
  let next = pixelRatio;
  if (avg > 0.022) { next = Math.max(0.6, pixelRatio - 0.2); fastPeriods = 0; }
  else if (avg < 0.0175 && ++fastPeriods >= 3) { next = Math.min(MAX_RATIO, pixelRatio + 0.1); fastPeriods = 0; }
  if (next !== pixelRatio) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); resize(); }
}

// Vật lý chạy bước cố định 1/120 s; khi vẽ thì nội suy giữa hai bước để màn hình 60/75/90/144 Hz đều mượt.
const prev = { bx: 0, by: 0, bz: 0, [1]: { x: 0, z: 0 }, [-1]: { x: 0, z: 0 } };
function savePrev() {
  prev.bx = ball.x; prev.by = ball.y; prev.bz = ball.z;
  for (const s of [1, -1]) { prev[s].x = players[s].x; prev[s].z = players[s].z; }
}
const mix = (a, b, u) => (Math.abs(b - a) > 1.5 ? b : a + (b - a) * u);   // nhảy chỗ (giao bóng) thì khỏi nội suy

let last = performance.now(), acc = 0;
function frame(now) {
  const frameTime = (now - last) / 1000;
  const dt = Math.min(0.1, frameTime); last = now;
  let u = 1;
  if (game.state !== "menu" && game.state !== "over") {
    acc += dt;
    while (acc >= STEP) { savePrev(); simStep(); acc -= STEP; }
    u = acc / STEP;
  }
  const bx = mix(prev.bx, ball.x, u), by = mix(prev.by, ball.y, u), bz = mix(prev.bz, ball.z, u);
  for (const s of [1, -1]) { const p = players[s]; p.rx = mix(prev[s].x, p.x, u); p.rz = mix(prev[s].z, p.z, u); }
  // Vẽ
  ballMesh.position.set(bx, by, bz);
  blob.position.set(bx, 0.012, bz);
  blob.material.opacity = clamp(0.4 - by * 0.08, 0.12, 0.4);
  if (game.state === "rally") { game.trail.push(bx, by, bz); if (game.trail.length > TRAIL_N * 3) game.trail.splice(0, 3); }
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
  for (const s of [1, -1]) animatePlayer(players[s], players[s].rx, players[s].rz, dt);
  updateCamera(dt);
  updateFpPaddle();
  updateCue();
  renderer.render(scene, camera);
  adaptResolution(frameTime);
  requestAnimationFrame(frame);
}

/** Vòng canh nhịp: bóng còn xa thì vòng to, co dần lại; khép vào chấm vàng (chuyển xanh) là lúc vung đẹp nhất. */
function updateCue() {
  const pl = players[1].plan;
  const show = !demo && game.state === "rally" && game.hitter === -1 && pl && !pl.letGo && !pl.miss && !swing;
  const left = show ? pl.t - LEAD - game.t : 0;                 // còn bao lâu tới lúc vung đẹp nhất
  cue.visible = cueDot.visible = !!show && left < 0.8 && left > -0.15;
  if (!cue.visible) return;
  for (const o of [cue, cueDot]) { o.position.set(pl.x, pl.y, pl.z); o.quaternion.copy(camera.quaternion); }
  cue.scale.setScalar(0.11 + Math.max(0, left) * 0.45);
  const good = Math.abs(left) < 0.07;
  cueMat.color.set(good ? 0x7ff0b8 : 0xffffff);
  cueMat.opacity = 0.5 + 0.4 * (1 - Math.min(1, Math.max(0, left) / 0.8));
}

resize();
for (const s of [1, -1]) { const p = players[s]; p.x = p.rx = 0; p.z = p.rz = s * (HALF_L - 0.5); }
savePrev();
requestAnimationFrame(frame);
if (params.has("debug")) window.__pb = { game, ball, players, requestSwing, startMatch, predict, classifySwing, onOrient: (d) => motion.onOrient(d), motion, IMPACT_LEAD };
if (params.has("demo")) startMatch(true);
})();
