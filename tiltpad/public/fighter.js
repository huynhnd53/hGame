// fighter.js – Không chiến: lái máy bay chiến đấu, hạ 5 đợt máy bay địch. Điện thoại cầm ngang là cần lái (nghiêng để
// lượn, chúc/ngóc để bổ nhào/kéo lên), nút trên điện thoại để bắn, phóng tên lửa, thả mồi nhiệt, tăng tốc.
// Đơn vị: mét, giây. Trục Y hướng lên; mũi máy bay là -Z của nó.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const T = THREE;
const params = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;
const rand = (a, b) => a + Math.random() * (b - a);
const DEG = Math.PI / 180;

// ---------- Thông số ----------
const MAP = 6000;                 // nửa cạnh vùng bay
const SPEED = { min: 95, cruise: 150, boost: 230, max: 270 };
const RATE = { roll: 2.6, pitch: 1.25, yaw: 0.45 };   // rad/s khi cần lái hết cỡ
const GUN = { rate: 13, speed: 950, life: 1.3, dmg: 4 };
const MISSILE = { speed: 470, accel: 260, turn: 3.2, life: 9, prox: 16, dmg: 60, reload: 5, lockAngle: 18 * DEG, lockRange: 2600, lockTime: 0.8 };
const FLARE = { count: 3, recharge: 8 };
const WAVES = [3, 4, 5, 6, 7];
const LEVELS = [
  { name: "Dễ", turn: 0.85, aim: 9 * DEG, hp: 28, dmgTaken: 0.6, missiles: false },
  { name: "Vừa", turn: 1.1, aim: 6 * DEG, hp: 36, dmgTaken: 1, missiles: true },
  { name: "Khó", turn: 1.35, aim: 4 * DEG, hp: 44, dmgTaken: 1.3, missiles: true },
];
let level = LEVELS[1];

// ---------- Cảnh ----------
const stage = $("stage");
const renderer = new T.WebGLRenderer({ canvas: $("gl"), antialias: true });
const MAX_RATIO = Math.min(1.5, devicePixelRatio || 1);
let pixelRatio = MAX_RATIO;
renderer.setPixelRatio(pixelRatio);
const scene = new T.Scene();
const SKY = new T.Color(0x86b9ea);
scene.background = SKY;
scene.fog = new T.Fog(0x9cc6ee, 1500, 9000);
const camera = new T.PerspectiveCamera(70, 1, 1, 20000);
scene.add(new T.HemisphereLight(0xdfefff, 0x4a5a3a, 0.85));
const sun = new T.DirectionalLight(0xfff2dd, 0.75); sun.position.set(-0.5, 1, 0.3); scene.add(sun);
const hud = $("hud"), hg = hud.getContext("2d");
let W = 1, H = 1;
function resize() {
  W = stage.clientWidth; H = stage.clientHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  hud.width = W * devicePixelRatio; hud.height = H * devicePixelRatio;
  hg.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener("resize", resize);

// Địa hình: đồng bằng, đảo ở giữa, núi cao dần ra xa; biển ở độ cao 0.
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function terrainH(x, z) {
  const d = Math.hypot(x, z);
  let h = 140 * Math.sin(x * 0.0011 + 0.4) * Math.cos(z * 0.0013) + 90 * Math.sin(x * 0.0027 + 1.3) * Math.sin(z * 0.0021 + 0.7)
    + 35 * Math.sin(x * 0.007 + z * 0.005) + 60;
  h += smooth(1800, 5200, d) * 1100 * (0.55 + 0.45 * Math.sin(x * 0.0009 + 2) * Math.cos(z * 0.0011 + 1));
  return h;
}
{
  const N = 170, size = MAP * 2.4;
  const geo = new T.PlaneGeometry(size, size, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = [];
  const c = new T.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainH(x, z);
    pos.setY(i, h);
    if (h < 12) c.set(0xd9c9a0); else if (h < 260) c.set(0x5f9d55).lerp(new T.Color(0x3f7d45), Math.random() * 0.4);
    else if (h < 700) c.set(0x6d7a5a).lerp(new T.Color(0x8a8270), Math.random() * 0.5); else c.set(0xf2f4f7);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new T.Mesh(geo.toNonIndexed(), new T.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  ground.geometry.computeVertexNormals();
  scene.add(ground);
  const sea = new T.Mesh(new T.PlaneGeometry(size * 3, size * 3), new T.MeshLambertMaterial({ color: 0x2f6fae, transparent: true, opacity: 0.92 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = 0; scene.add(sea);
}
// Mây: các cụm hình cầu trắng, mờ.
{
  const mat = new T.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, flatShading: true });
  const geo = new T.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 70; i++) {
    const g = new T.Group();
    const cx = rand(-MAP, MAP), cz = rand(-MAP, MAP), cy = rand(900, 1700);
    for (let k = 0; k < 5; k++) {
      const m = new T.Mesh(geo, mat);
      m.scale.set(rand(90, 200), rand(40, 80), rand(90, 200));
      m.position.set(rand(-180, 180), rand(-20, 30), rand(-180, 180));
      g.add(m);
    }
    g.position.set(cx, cy, cz); scene.add(g);
  }
}

// ---------- Máy bay ----------
function makeJet(body, accent) {
  const g = new T.Group();
  const mat = (c, extra = {}) => new T.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
  const m = mat(body), a = mat(accent);
  const fus = new T.Mesh(new T.CylinderGeometry(0.9, 1.1, 13, 10), m); fus.rotation.x = Math.PI / 2; g.add(fus);
  const nose = new T.Mesh(new T.ConeGeometry(0.9, 4, 10), m); nose.rotation.x = -Math.PI / 2; nose.position.z = -8.5; g.add(nose);
  const canopy = new T.Mesh(new T.SphereGeometry(0.75, 12, 8), mat(0x1c2a44, { emissive: 0x0c1830 })); canopy.scale.set(0.8, 0.7, 2.2);
  canopy.position.set(0, 0.85, -4.2); g.add(canopy);
  const wingShape = new T.Shape(); wingShape.moveTo(0, -2.5); wingShape.lineTo(7.5, 2.2); wingShape.lineTo(7.5, 3.6); wingShape.lineTo(0, 3.2);
  const wingGeo = new T.ExtrudeGeometry(wingShape, { depth: 0.25, bevelEnabled: false });
  for (const s of [1, -1]) {
    const w = new T.Mesh(wingGeo, a); w.rotation.x = Math.PI / 2; w.scale.x = s; w.position.set(s * 0.6, 0, 0.5); g.add(w);
    const st = new T.Mesh(new T.BoxGeometry(2.6, 0.18, 1.6), a); st.position.set(s * 2.2, 0, 6); g.add(st);
  }
  const fin = new T.Mesh(new T.BoxGeometry(0.2, 3.2, 2.6), a); fin.position.set(0, 1.9, 5.4); fin.rotation.x = -0.35; g.add(fin);
  const glow = new T.Mesh(new T.CylinderGeometry(0.7, 0.4, 2.4, 10), new T.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85 }));
  glow.rotation.x = Math.PI / 2; glow.position.z = 7.6; g.add(glow);
  g.userData.glow = glow;
  return g;
}

// ---------- Hiệu ứng: nổ, khói, chớp ----------
const puffTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c);
})();
const fx = [];
function puff(pos, { color = 0x888888, size = 8, grow = 3, life = 1.6, add = false, vel = null } = {}) {
  const s = new T.Sprite(new T.SpriteMaterial({ map: puffTex, color, transparent: true, depthWrite: false, blending: add ? T.AdditiveBlending : T.NormalBlending }));
  s.position.copy(pos); s.scale.setScalar(size); scene.add(s);
  fx.push({ s, t: 0, life, size, grow, vel: vel ? vel.clone() : null });
}
function explosion(pos, big = 1) {
  puff(pos, { color: 0xfff1b0, size: 30 * big, grow: 2.5, life: 0.35, add: true });
  for (let i = 0; i < 10 * big; i++) {
    const v = new T.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).multiplyScalar(rand(10, 40));
    puff(pos.clone().addScaledVector(v, 0.1), { color: i % 3 ? 0xff7a2a : 0x555555, size: rand(8, 18) * big, grow: 1.8, life: rand(0.6, 1.6), add: i % 3 !== 0, vel: v });
  }
  sound("boom", Math.min(1, 0.4 + big * 0.4) * clamp(1 - camera.position.distanceTo(pos) / 4000, 0.15, 1));
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt;
    const u = f.t / f.life;
    if (u >= 1) { scene.remove(f.s); f.s.material.dispose(); fx.splice(i, 1); continue; }
    if (f.vel) { f.s.position.addScaledVector(f.vel, dt); f.vel.multiplyScalar(1 - dt * 1.5); }
    f.s.scale.setScalar(f.size * (1 + u * f.grow));
    f.s.material.opacity = (1 - u) * 0.9;
  }
}

// ---------- Âm thanh tự tổng hợp ----------
let audio = null, engine = null;
function unlockAudio() {
  if (!audio) {
    try { audio = new AudioContext(); } catch { audio = null; }
    if (audio) {
      const o = audio.createOscillator(), f = audio.createBiquadFilter(), g = audio.createGain();
      o.type = "sawtooth"; o.frequency.value = 70; f.type = "lowpass"; f.frequency.value = 500; g.gain.value = 0;
      o.connect(f).connect(g).connect(audio.destination); o.start();
      engine = { o, f, g };
    }
  }
  if (audio && audio.state === "suspended") audio.resume();
}
function noiseBurst(dur, freq, gain, type = "bandpass") {
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = audio.createBufferSource(); src.buffer = buf;
  const f = audio.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = audio.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(audio.destination); src.start();
}
function tone(freq, dur, gain, type = "square") {
  const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
}
function sound(kind, vol = 1) {
  if (!audio) return;
  if (kind === "gun") noiseBurst(0.06, 1400, 0.25 * vol);
  if (kind === "boom") { noiseBurst(1.1, 120, 1.4 * vol, "lowpass"); noiseBurst(0.4, 700, 0.5 * vol); }
  if (kind === "missile") noiseBurst(0.7, 900, 0.5 * vol, "highpass");
  if (kind === "hit") tone(220, 0.08, 0.15 * vol, "sawtooth");
  if (kind === "lockbeep") tone(1050, 0.05, 0.06);
  if (kind === "locked") tone(1400, 0.12, 0.08);
  if (kind === "warn") tone(760, 0.09, 0.09);
  if (kind === "flare") noiseBurst(0.25, 2500, 0.2, "highpass");
}

// ---------- Trạng thái ----------
const player = { pos: new T.Vector3(), q: new T.Quaternion(), speed: SPEED.cruise, hp: 100, alive: true, mesh: makeJet(0x8a96a8, 0x5d6878),
  gunCd: 0, missiles: [0, 0], flares: FLARE.count, flareT: 0, lock: null, lockT: 0, lockBeep: 0, deadT: 0 };
scene.add(player.mesh);
const enemies = [], bullets = [], missiles = [], flares = [];
const game = { state: "menu", wave: 0, lives: 3, score: 0, kills: 0, t: 0, waveT: 0, banner: "", bannerT: 0, warn: "", hitFlash: 0, view: "chase" };

const fwd = new T.Vector3(), up = new T.Vector3(), right = new T.Vector3(), tmp = new T.Vector3(), tmpQ = new T.Quaternion();
const axisX = new T.Vector3(1, 0, 0), axisY = new T.Vector3(0, 1, 0), axisZ = new T.Vector3(0, 0, 1);
const forwardOf = (q, out = new T.Vector3()) => out.set(0, 0, -1).applyQuaternion(q);
const upOf = (q, out = new T.Vector3()) => out.set(0, 1, 0).applyQuaternion(q);

function resetPlayer(pos, dir) {
  player.pos.copy(pos);
  player.q.setFromUnitVectors(new T.Vector3(0, 0, -1), dir.clone().normalize());
  player.speed = SPEED.cruise; player.hp = 100; player.alive = true; player.deadT = 0;
  player.missiles = [0, 0]; player.flares = FLARE.count; player.lock = null; player.lockT = 0;
  player.mesh.visible = game.view === "chase";
}

// ---------- Điều khiển ----------
const keys = new Set();
const ctl = { pitch: 0, roll: 0, yaw: 0, boost: false, gun: false };
addEventListener("keydown", (e) => {
  if (game.state === "menu" || game.state === "over") return;
  keys.add(e.code);
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === "KeyF" || e.code === "Enter") fireMissile();
  if (e.code === "KeyC") dropFlares();
  if (e.code === "KeyV") toggleView();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

// Điện thoại: cầm ngang như tay cầm chơi game. Lúc căn giữa ghi lại trục "phía trước" (mép trên màn hình theo cách cầm)
// và trục "bên phải" của máy; sau đó độ chúc/ngóc của trục trước là chúc/ngóc máy bay, độ nghiêng của trục phải là lượn.
const PHONE = { pitchFull: 28, rollFull: 35, dead: 3 };
const phone = { count: 0, relay: 0, at: -1e9, raw: new T.Quaternion(), F: null, R: null, pitch0: 0, roll0: 0, center: true, pitch: 0, roll: 0, gun: false, boost: false };
const zee = new T.Vector3(0, 0, 1), eul = new T.Euler(), qa = new T.Quaternion(), q1 = new T.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
function deviceQ(q, a, b, g) { eul.set(b * DEG, a * DEG, -g * DEG, "YXZ"); q.setFromEuler(eul); q.multiply(q1); }
function onOrient(d) {
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  deviceQ(phone.raw, num(d.a), num(d.b), num(d.g));
  phone.at = performance.now();
  const worldOf = (v) => v.clone().applyQuaternion(phone.raw);
  if (phone.center) {
    // Chọn cách cầm: dọc (đỉnh máy là phía trước) hay ngang (mép trên của màn hình ngang là phía trước).
    const upDev = new T.Vector3(0, 1, 0).applyQuaternion(phone.raw.clone().invert());    // trời, theo trục máy
    let o = num(d.o); if (o > 180) o -= 360;
    let side = o === 90 ? 1 : o === -90 ? -1 : 0;
    if (!side) side = Math.abs(upDev.y) > Math.abs(upDev.x) + 0.15 ? 0 : (Math.sign(upDev.x) || 1);
    if (side === 0) { phone.F = new T.Vector3(0, 1, 0); phone.R = new T.Vector3(1, 0, 0); }
    else { phone.F = new T.Vector3(side, 0, 0); phone.R = new T.Vector3(0, -side, 0); }
    phone.pitch0 = Math.asin(clamp(worldOf(phone.F).y, -1, 1)) / DEG;
    phone.roll0 = Math.asin(clamp(worldOf(phone.R).y, -1, 1)) / DEG;
    phone.center = false;
  }
  phone.pitch = Math.asin(clamp(worldOf(phone.F).y, -1, 1)) / DEG - phone.pitch0;
  phone.roll = Math.asin(clamp(worldOf(phone.R).y, -1, 1)) / DEG - phone.roll0;
}
const axis = (deg, full) => { const a = Math.abs(deg); if (a < PHONE.dead) return 0; return Math.sign(deg) * clamp((a - PHONE.dead) / (full - PHONE.dead), 0, 1); };

function readControls() {
  const k = (c) => keys.has(c);
  let pitch = (k("KeyS") || k("ArrowDown") ? 1 : 0) - (k("KeyW") || k("ArrowUp") ? 1 : 0);
  let roll = (k("KeyD") || k("ArrowRight") ? 1 : 0) - (k("KeyA") || k("ArrowLeft") ? 1 : 0);
  const yaw = (k("KeyE") ? 1 : 0) - (k("KeyQ") ? 1 : 0);
  const phoneLive = phone.count && performance.now() - phone.at < 500;
  if (phoneLive) {
    pitch = clamp(pitch + axis(phone.pitch, PHONE.pitchFull), -1, 1);   // ngóc mép trên lên = kéo mũi lên
    roll = clamp(roll - axis(phone.roll, PHONE.rollFull), -1, 1);       // mép phải chúc xuống = lượn phải
  }
  ctl.pitch = pitch; ctl.roll = roll; ctl.yaw = yaw;
  ctl.boost = k("ShiftLeft") || k("ShiftRight") || (phoneLive && phone.boost);
  ctl.gun = k("Space") || (phoneLive && phone.gun);
}

// ---------- Bay ----------
const dq = new T.Quaternion(), de = new T.Euler();
function flyPlayer(dt) {
  const p = player;
  forwardOf(p.q, fwd); upOf(p.q, up);
  // Độ nghiêng cánh so với chân trời (để tự cân bằng khi buông cần lái).
  right.crossVectors(fwd, axisY).normalize();
  const bank = Math.atan2(right.dot(up), up.y);              // dương: nghiêng phải (trục "lên" của máy bay ngả sang phải)
  let rollRate = ctl.roll * RATE.roll;                       // dương: lượn phải
  if (Math.abs(ctl.roll) < 0.08 && Math.abs(fwd.y) < 0.9) rollRate += clamp(-bank * 1.4, -1.2, 1.2);   // buông cần: tự cân bằng
  de.set(ctl.pitch * RATE.pitch * dt, -ctl.yaw * RATE.yaw * dt, -rollRate * dt, "XYZ");
  p.q.multiply(dq.setFromEuler(de)).normalize();
  // Lượn thì tự quay theo (như máy bay thật): cánh nghiêng tạo lực ngang.
  p.q.premultiply(dq.setFromAxisAngle(axisY, -Math.sin(bank) * 0.55 * dt)).normalize();
  forwardOf(p.q, fwd);
  // Tốc độ: tăng tốc/giảm tốc, bổ nhào thì nhanh lên, kéo lên thì chậm lại.
  const target = ctl.boost ? SPEED.boost : SPEED.cruise;
  p.speed += (target - p.speed) * Math.min(1, dt * 0.6) - fwd.y * 30 * dt;
  p.speed = clamp(p.speed, SPEED.min, SPEED.max);
  p.pos.addScaledVector(fwd, p.speed * dt);
  // Ra khỏi vùng chiến: tự quay về.
  const out = Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z)) - MAP * 0.92;
  if (out > 0) {
    tmp.set(-p.pos.x, 0, -p.pos.z).normalize();
    const turn = Math.sign(tmp.x * fwd.z - tmp.z * fwd.x) * Math.min(1, out / 400) * 0.8 * dt;
    p.q.premultiply(dq.setFromAxisAngle(axisY, turn)).normalize();
  }
  if (p.pos.y > 4200) p.pos.y = 4200;
  const ground = Math.max(0, terrainH(p.pos.x, p.pos.z));
  if (p.pos.y < ground + 6) { killPlayer("Đâm xuống đất!"); return; }
  game.warn = p.pos.y - ground < 220 && fwd.y < -0.05 ? "KÉO LÊN!" : "";
  if (out > 0) game.warn = game.warn || "QUAY LẠI VÙNG CHIẾN";
}

// ---------- Địch ----------
function spawnEnemy(i, n) {
  const e = { pos: new T.Vector3(), q: new T.Quaternion(), speed: rand(140, 175), hp: level.hp, mesh: makeJet(0xb0473a, 0x6e2a24), gunCd: rand(0, 1),
    missileCd: rand(6, 12), lockT: 0, smoke: 0, dead: false, fall: 0, jink: rand(0, 6), turnJink: 0 };
  const a = (i / n) * Math.PI * 1.2 - Math.PI * 0.6 + rand(-0.2, 0.2);
  forwardOf(player.q, fwd); fwd.y = 0; fwd.normalize();
  const dir = fwd.clone().applyAxisAngle(axisY, a);
  e.pos.copy(player.pos).addScaledVector(dir, rand(2600, 3600));
  e.pos.y = Math.max(terrainH(e.pos.x, e.pos.z) + 500, rand(700, 1500));
  e.q.setFromUnitVectors(new T.Vector3(0, 0, -1), tmp.subVectors(player.pos, e.pos).normalize());
  scene.add(e.mesh);
  enemies.push(e);
}
const want = new T.Vector3(), cur = new T.Vector3();
function flyEnemy(e, dt) {
  if (e.dead) {                                      // rơi xoắn, bốc khói, chạm đất thì nổ
    e.fall += dt;
    e.q.multiply(dq.setFromAxisAngle(axisZ, 3 * dt));
    forwardOf(e.q, fwd);
    e.pos.addScaledVector(fwd, e.speed * 0.6 * dt); e.pos.y -= (40 + e.fall * 60) * dt;
    if ((e.smoke -= dt) < 0) { e.smoke = 0.05; puff(e.pos, { color: 0x333333, size: 14, grow: 2.5, life: 2.2 }); puff(e.pos, { color: 0xff8a30, size: 7, grow: 1, life: 0.3, add: true }); }
    if (e.pos.y < Math.max(0, terrainH(e.pos.x, e.pos.z)) + 3 || e.fall > 9) { explosion(e.pos, 1.2); scene.remove(e.mesh); e.gone = true; }
    return;
  }
  forwardOf(e.q, cur);
  // Đích: dẫn trước người chơi một chút; thấp quá thì kéo lên; thỉnh thoảng lượn né.
  const lead = clamp(player.pos.distanceTo(e.pos) / 900, 0, 1.5);
  forwardOf(player.q, fwd);
  want.copy(player.pos).addScaledVector(fwd, player.speed * lead).sub(e.pos).normalize();
  const ground = Math.max(0, terrainH(e.pos.x, e.pos.z));
  if (e.pos.y - ground < 350) want.y = Math.max(want.y, 0.6);
  e.jink -= dt;
  if (e.jink < 0) { e.jink = rand(4, 9); e.turnJink = rand(1, 2.2) * (Math.random() < 0.5 ? -1 : 1); }
  if (e.turnJink) { want.applyAxisAngle(axisY, e.turnJink * 0.45); e.turnJink *= Math.pow(0.4, dt); if (Math.abs(e.turnJink) < 0.05) e.turnJink = 0; }
  want.normalize();
  // Quay mũi về phía đích với tốc độ quay giới hạn; nghiêng cánh theo hướng rẽ.
  const ang = cur.angleTo(want), maxTurn = 0.75 * level.turn * dt;
  if (ang > 1e-4) {
    const ax = tmp.crossVectors(cur, want).normalize();
    e.q.premultiply(dq.setFromAxisAngle(ax, Math.min(ang, maxTurn))).normalize();
  }
  forwardOf(e.q, cur); upOf(e.q, up);
  const turnSide = tmp.crossVectors(cur, want).y;               // >0: rẽ trái
  const wantBank = clamp(-turnSide * 6, -1.1, 1.1);
  right.crossVectors(cur, axisY).normalize();
  const bank = Math.atan2(right.dot(up), up.y);
  e.q.multiply(dq.setFromAxisAngle(axisZ, -(wantBank - bank) * Math.min(1, dt * 3))).normalize();
  e.pos.addScaledVector(cur, e.speed * dt);
  // Bắn: mũi chĩa đúng người chơi và đủ gần.
  const toP = tmp.subVectors(player.pos, e.pos), dist = toP.length();
  const aim = cur.angleTo(toP);
  e.gunCd -= dt;
  if (player.alive && dist < 1000 && aim < level.aim && e.gunCd <= 0) {
    e.gunCd = 0.16;
    shoot(e.pos.clone().addScaledVector(cur, 10), cur, e.speed, "enemy", 0.9 * DEG);
  }
  // Tên lửa (từ đợt 3, mức Vừa trở lên): giữ người chơi trong tầm một lúc thì phóng.
  e.missileCd -= dt;
  if (level.missiles && game.wave >= 3 && player.alive && dist < 2600 && aim < 20 * DEG) e.lockT += dt; else e.lockT = 0;
  if (e.lockT > 1.6 && e.missileCd <= 0) { e.missileCd = rand(10, 16); e.lockT = 0; launchMissile(e, player, "enemy"); }
  if (e.hp < level.hp * 0.5 && (e.smoke -= dt) < 0) { e.smoke = 0.12; puff(e.pos, { color: 0x555555, size: 9, grow: 2, life: 1.4 }); }
}

// ---------- Vũ khí ----------
const bulletGeo = new T.BoxGeometry(0.35, 0.35, 9);
const bulletMeshP = new T.InstancedMesh(bulletGeo, new T.MeshBasicMaterial({ color: 0xffe36a }), 300);
const bulletMeshE = new T.InstancedMesh(bulletGeo, new T.MeshBasicMaterial({ color: 0xff5a3a }), 300);
for (const m of [bulletMeshP, bulletMeshE]) { m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.frustumCulled = false; scene.add(m); }
function shoot(from, dir, carrier, owner, spread) {
  const d = dir.clone();
  d.x += rand(-spread, spread); d.y += rand(-spread, spread); d.z += rand(-spread, spread); d.normalize();
  bullets.push({ pos: from.clone(), prev: from.clone(), vel: d.multiplyScalar(GUN.speed + carrier), life: GUN.life, owner });
  if (owner === "player") sound("gun", 0.8);
  else if (from.distanceTo(player.pos) < 700 && Math.random() < 0.3) sound("gun", 0.25);
}
const segSphere = (a, b, c, r) => {                // đoạn a→b có chạm cầu tâm c bán kính r
  const ab = tmp.subVectors(b, a), t = clamp(new T.Vector3().subVectors(c, a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceToSquared(c) < r * r;
};
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.prev.copy(b.pos); b.pos.addScaledVector(b.vel, dt); b.life -= dt;
    let hit = false;
    if (b.owner === "player") {
      for (const e of enemies) if (!e.dead && segSphere(b.prev, b.pos, e.pos, 9)) { damageEnemy(e, GUN.dmg, b.pos); hit = true; break; }
    } else if (player.alive && segSphere(b.prev, b.pos, player.pos, 7)) { damagePlayer(GUN.dmg * level.dmgTaken * 0.8); hit = true; }
    if (hit || b.life <= 0 || b.pos.y < 0) bullets.splice(i, 1);
  }
  const m4 = new T.Matrix4(), s1 = new T.Vector3(1, 1, 1);
  let np = 0, ne = 0;
  for (const b of bullets) {
    tmpQ.setFromUnitVectors(axisZ, tmp.copy(b.vel).normalize());
    m4.compose(b.pos, tmpQ, s1);
    if (b.owner === "player") { if (np < 300) bulletMeshP.setMatrixAt(np++, m4); } else if (ne < 300) bulletMeshE.setMatrixAt(ne++, m4);
  }
  bulletMeshP.count = np; bulletMeshE.count = ne;
  bulletMeshP.instanceMatrix.needsUpdate = true; bulletMeshE.instanceMatrix.needsUpdate = true;
}

const missileGeo = new T.CylinderGeometry(0.25, 0.25, 3.6, 8); missileGeo.rotateX(Math.PI / 2);
function launchMissile(owner, target, side) {
  const fromQ = owner === player ? player.q : owner.q;
  const pos = (owner === player ? player.pos : owner.pos).clone().add(new T.Vector3(side === "player" ? (player.missiles[0] <= 0 ? 3 : -3) : 0, -1.2, 0).applyQuaternion(fromQ));
  const dir = forwardOf(fromQ);
  const mesh = new T.Mesh(missileGeo, new T.MeshLambertMaterial({ color: side === "player" ? 0xeeeeee : 0xffb0a0 }));
  mesh.position.copy(pos); scene.add(mesh);
  missiles.push({ pos, dir, speed: (owner.speed || SPEED.cruise) + 40, target, side, life: MISSILE.life, mesh, smoke: 0 });
  sound("missile", side === "player" ? 1 : 0.5);
  if (side === "enemy") { link.broadcast({ t: "buzz", ms: 200 }); }
}
function updateMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.life -= dt;
    m.speed = Math.min(MISSILE.speed, m.speed + MISSILE.accel * dt);
    // Mồi nhiệt gần tên lửa địch: hay bị đánh lừa.
    if (m.side === "enemy" && m.target === player) for (const f of flares) if (f.pos.distanceTo(m.pos) < 900 && Math.random() < dt * 1.6) m.target = f;
    const tgt = m.target && (m.target.dead === undefined || !m.target.dead) && !(m.target.gone) ? m.target : null;
    if (tgt) {
      want.subVectors(tgt.pos, m.pos).normalize();
      const ang = m.dir.angleTo(want), maxTurn = MISSILE.turn * dt * (m.side === "enemy" ? 0.55 * level.turn : 1);
      if (ang > 1e-4) m.dir.applyAxisAngle(tmp.crossVectors(m.dir, want).normalize(), Math.min(ang, maxTurn)).normalize();
    }
    m.pos.addScaledVector(m.dir, m.speed * dt);
    m.mesh.position.copy(m.pos); m.mesh.quaternion.setFromUnitVectors(axisZ, m.dir);
    if ((m.smoke -= dt) < 0) { m.smoke = 0.03; puff(m.pos, { color: 0xdddddd, size: 4, grow: 2.5, life: 1.2 }); }
    let boom = m.life <= 0 || m.pos.y < Math.max(0, terrainH(m.pos.x, m.pos.z));
    if (m.side === "player") {
      for (const e of enemies) if (!e.dead && e.pos.distanceTo(m.pos) < MISSILE.prox) { damageEnemy(e, MISSILE.dmg, m.pos); boom = true; break; }
    } else if (player.alive && player.pos.distanceTo(m.pos) < MISSILE.prox) { damagePlayer(45 * level.dmgTaken); boom = true; }
    if (tgt && tgt.flare && tgt.pos.distanceTo(m.pos) < 20) boom = true;
    if (boom) { explosion(m.pos, 0.6); scene.remove(m.mesh); missiles.splice(i, 1); }
  }
}
function fireMissile() {
  if (game.state !== "fight" || !player.alive) return;
  const slot = player.missiles.findIndex((t) => t <= 0);
  if (slot < 0) return;
  player.missiles[slot] = MISSILE.reload;
  launchMissile(player, player.lock && player.lockT >= MISSILE.lockTime ? player.lock : null, "player");
}
function dropFlares() {
  if (game.state !== "fight" || !player.alive || player.flares <= 0) return;
  player.flares--; sound("flare");
  forwardOf(player.q, fwd);
  for (let i = 0; i < 6; i++) {
    const vel = fwd.clone().multiplyScalar(player.speed * 0.4).add(new T.Vector3(rand(-40, 40), rand(-60, -10), rand(-40, 40)));
    flares.push({ pos: player.pos.clone(), vel, life: 3, flare: true });
  }
}
function updateFlares(dt) {
  if (player.flares < FLARE.count && (player.flareT += dt) > FLARE.recharge) { player.flares++; player.flareT = 0; }
  for (let i = flares.length - 1; i >= 0; i--) {
    const f = flares[i];
    f.pos.addScaledVector(f.vel, dt); f.vel.y -= 20 * dt; f.life -= dt;
    puff(f.pos, { color: 0xffd080, size: 6, grow: 0.5, life: 0.25, add: true });
    if (f.life <= 0) flares.splice(i, 1);
  }
}
// Khoá mục tiêu: địch gần tâm ngắm nhất trong hình nón phía trước.
function updateLock(dt) {
  forwardOf(player.q, fwd);
  let best = null, bestA = MISSILE.lockAngle;
  for (const e of enemies) {
    if (e.dead) continue;
    tmp.subVectors(e.pos, player.pos);
    const d = tmp.length(); if (d > MISSILE.lockRange) continue;
    const a = fwd.angleTo(tmp);
    if (a < bestA) { bestA = a; best = e; }
  }
  if (best !== player.lock) { player.lock = best; player.lockT = 0; }
  if (best) {
    const before = player.lockT;
    player.lockT += dt;
    if (before < MISSILE.lockTime && player.lockT >= MISSILE.lockTime) { sound("locked"); link.broadcast({ t: "buzz", ms: 40 }); }
    if (player.lockT < MISSILE.lockTime && (player.lockBeep -= dt) < 0) { player.lockBeep = 0.12; sound("lockbeep"); }
  }
  for (let i = 0; i < 2; i++) player.missiles[i] = Math.max(0, player.missiles[i] - dt);
}

// ---------- Trúng đạn, hạ, chết ----------
function damageEnemy(e, dmg, at) {
  e.hp -= dmg;
  puff(at, { color: 0xffe08a, size: 5, grow: 1, life: 0.2, add: true });
  sound("hit", 0.5); game.hitFlash = 0.12;
  if (e.hp <= 0 && !e.dead) {
    e.dead = true; explosion(e.pos, 0.9);
    game.kills++; game.score += 100 + Math.round(player.pos.distanceTo(e.pos) / 10);
    link.broadcast({ t: "buzz", ms: 120 });
    flash("Hạ 1 máy bay!");
    updateTop();
  }
}
function damagePlayer(d) {
  if (!player.alive) return;
  player.hp -= d; game.hurt = 0.35;
  link.broadcast({ t: "buzz", ms: Math.min(250, 40 + d * 6) });
  if (player.hp <= 0) killPlayer("Bị bắn hạ!");
}
function killPlayer(why) {
  if (!player.alive) return;
  player.alive = false; player.deadT = 0; player.hp = 0;
  explosion(player.pos, 1.4);
  player.mesh.visible = false;
  game.lives--; updateTop();
  link.broadcast({ t: "buzz", ms: 500 });
  banner(why, game.lives > 0 ? "Còn " + game.lives + " mạng" : "Hết mạng");
}

// ---------- Đợt, điểm ----------
function updateTop() {
  $("wave").textContent = Math.max(1, game.wave); $("kills").textContent = game.kills;
  $("score").textContent = game.score; $("lives").textContent = game.lives;
}
function banner(title, sub = "") { $("banner").innerHTML = title + (sub ? "<small>" + sub + "</small>" : ""); game.bannerT = 2.5; }
let flashT = 0; function flash(text) { game.flashText = text; flashT = 1.2; }
function startWave(n) {
  game.wave = n; updateTop();
  const count = WAVES[n - 1];
  for (let i = 0; i < count; i++) spawnEnemy(i, count);
  banner("Đợt " + n, count + " máy bay địch" + (level.missiles && n >= 3 ? " · có tên lửa" : ""));
}
function startGame() {
  unlockAudio();
  for (const e of enemies) scene.remove(e.mesh);
  for (const m of missiles) scene.remove(m.mesh);
  enemies.length = bullets.length = missiles.length = flares.length = 0;
  game.state = "fight"; game.lives = 3; game.score = 0; game.kills = 0; game.t = 0;
  resetPlayer(new T.Vector3(0, 900, 3600), new T.Vector3(0, 0, -1));
  show(null); startWave(1);
}
function endGame(win) {
  game.state = "over";
  $("overTitle").textContent = win ? "Hoàn thành nhiệm vụ!" : "Nhiệm vụ thất bại";
  $("overScore").textContent = game.score;
  $("overStats").textContent = "Hạ " + game.kills + " máy bay · tới đợt " + game.wave + " · mức " + level.name;
  show("over");
}
function show(id) { $("menu").hidden = id !== "menu"; $("over").hidden = id !== "over"; }
function toggleView() { game.view = game.view === "chase" ? "cockpit" : "chase"; player.mesh.visible = game.view === "chase" && player.alive; }

// ---------- Vòng lặp ----------
function step(dt) {
  game.t += dt;
  readControls();
  if (player.alive) {
    flyPlayer(dt);
    player.gunCd -= dt;
    if (ctl.gun && player.gunCd <= 0 && player.alive) {
      player.gunCd = 1 / GUN.rate;
      forwardOf(player.q, fwd); right.set(1, 0, 0).applyQuaternion(player.q);
      for (const s of [1, -1]) shoot(player.pos.clone().addScaledVector(right, s * 2.2).addScaledVector(fwd, 6), fwd, player.speed, "player", 0.35 * DEG);
    }
    updateLock(dt);
  } else if ((player.deadT += dt) > 3 && game.lives > 0) {
    forwardOf(player.q, fwd); fwd.y = 0; if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1); fwd.normalize();
    resetPlayer(player.pos.clone().setY(Math.max(1000, terrainH(player.pos.x, player.pos.z) + 700)), fwd);
    player.hp = 100;
    banner("Bay tiếp!", "");
  } else if (player.deadT > 3 && game.lives <= 0 && game.state === "fight") { endGame(false); return; }
  for (const e of enemies) flyEnemy(e, dt);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].gone) enemies.splice(i, 1);
  updateBullets(dt); updateMissiles(dt); updateFlares(dt);
  if (game.state === "fight" && enemies.length === 0) {
    if (game.wave >= WAVES.length) { endGame(true); return; }
    game.waveT += dt;
    if (game.waveT > 3) { game.waveT = 0; player.hp = Math.min(100, player.hp + 35); startWave(game.wave + 1); }
  }
}

// Camera bám đuôi (mặc định) hoặc trong buồng lái.
const camPos = new T.Vector3(0, 950, 3700), camUp = new T.Vector3(0, 1, 0), look = new T.Vector3();
function updateCamera(dt) {
  forwardOf(player.q, fwd); upOf(player.q, up);
  if (game.view === "cockpit" && player.alive) {
    camera.position.copy(player.pos).addScaledVector(up, 1.3).addScaledVector(fwd, -3.5);
    camera.quaternion.copy(player.q);
  } else {
    const k = 1 - Math.exp(-dt * 6);
    const target = tmp.copy(player.pos).addScaledVector(fwd, -24).addScaledVector(up, 6);
    if (!player.alive) target.copy(player.pos).add(new T.Vector3(0, 40, 90));
    camPos.lerp(target, k);
    camUp.lerp(player.alive ? up : axisY, k).normalize();
    camera.position.copy(camPos); camera.up.copy(camUp);
    look.copy(player.pos).addScaledVector(fwd, player.alive ? 60 : 0);
    camera.lookAt(look);
  }
  const fov = 70 + (player.speed - SPEED.cruise) * 0.06;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (engine) {
    engine.o.frequency.value = 55 + player.speed * 0.45;
    engine.f.frequency.value = 300 + player.speed * 3 + (ctl.boost ? 600 : 0);
    engine.g.gain.value = game.state === "fight" && player.alive ? 0.05 + (ctl.boost ? 0.03 : 0) : 0;
  }
}

// ---------- HUD ----------
const proj = new T.Vector3();
function toScreen(p) {
  proj.copy(p).project(camera);
  return { x: (proj.x + 1) / 2 * W, y: (1 - proj.y) / 2 * H, behind: proj.z > 1 };
}
let warnBeep = 0;
function drawHud(dt) {
  hg.clearRect(0, 0, W, H);
  if (game.state !== "fight") return;
  const green = "rgba(140,255,170,.95)";
  hg.lineWidth = 2; hg.font = "bold 13px system-ui, sans-serif"; hg.textAlign = "center";
  // Tâm ngắm: điểm phía trước mũi 600 m.
  forwardOf(player.q, fwd);
  if (player.alive) {
    const c = toScreen(tmp.copy(player.pos).addScaledVector(fwd, 600));
    hg.strokeStyle = green;
    hg.beginPath(); hg.arc(c.x, c.y, 14, 0, Math.PI * 2); hg.moveTo(c.x - 26, c.y); hg.lineTo(c.x - 16, c.y); hg.moveTo(c.x + 16, c.y); hg.lineTo(c.x + 26, c.y);
    hg.moveTo(c.x, c.y - 26); hg.lineTo(c.x, c.y - 16); hg.stroke();
    if (game.hitFlash > 0) { hg.strokeStyle = "#fff"; hg.beginPath(); for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { hg.moveTo(c.x + dx * 8, c.y + dy * 8); hg.lineTo(c.x + dx * 16, c.y + dy * 16); } hg.stroke(); }
  }
  // Địch: khung trên màn hình, mũi tên ở mép nếu ngoài màn hình.
  for (const e of enemies) {
    if (e.dead) continue;
    const s = toScreen(e.pos), d = player.pos.distanceTo(e.pos);
    const locked = e === player.lock;
    const lockU = locked ? Math.min(1, player.lockT / MISSILE.lockTime) : 0;
    const onScreen = !s.behind && s.x > 20 && s.x < W - 20 && s.y > 20 && s.y < H - 20;
    hg.strokeStyle = lockU >= 1 ? "#ff4a3a" : locked ? "#ffd23f" : "rgba(255,110,90,.95)";
    hg.fillStyle = hg.strokeStyle;
    if (onScreen) {
      const r = clamp(2400 / d * 6, 9, 26);
      hg.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
      if (locked) { const rr = r + 8 + (1 - lockU) * 30; hg.beginPath(); hg.moveTo(s.x, s.y - rr); hg.lineTo(s.x + rr, s.y); hg.lineTo(s.x, s.y + rr); hg.lineTo(s.x - rr, s.y); hg.closePath(); hg.stroke(); }
      hg.fillText(Math.round(d) + " m", s.x, s.y + r + 14);
      // máu địch
      hg.fillStyle = "rgba(0,0,0,.4)"; hg.fillRect(s.x - r, s.y - r - 7, r * 2, 3);
      hg.fillStyle = "#ff6a50"; hg.fillRect(s.x - r, s.y - r - 7, r * 2 * Math.max(0, e.hp / level.hp), 3);
    } else {
      let dx = s.x - W / 2, dy = s.y - H / 2;
      if (s.behind) { dx = -dx; dy = -dy; }
      const a = Math.atan2(dy, dx), R = Math.min(W, H) / 2 - 36;
      const x = W / 2 + Math.cos(a) * R, y = H / 2 + Math.sin(a) * R;
      hg.save(); hg.translate(x, y); hg.rotate(a);
      hg.beginPath(); hg.moveTo(14, 0); hg.lineTo(-8, -9); hg.lineTo(-8, 9); hg.closePath(); hg.fill(); hg.restore();
    }
  }
  // Tên lửa địch đang bám: cảnh báo.
  const threat = missiles.some((m) => m.side === "enemy" && m.target === player);
  const warn = !player.alive ? "" : threat ? "TÊN LỬA! – MỒI NHIỆT" : game.warn;
  if (warn) {
    if ((warnBeep -= dt) < 0) { warnBeep = threat ? 0.18 : 0.4; sound("warn"); }
    if (Math.floor(game.t * 4) % 2 === 0) { hg.font = "bold 26px system-ui, sans-serif"; hg.fillStyle = "#ff4a3a"; hg.fillText(warn, W / 2, H * 0.24); }
  }
  if (flashT > 0) { flashT -= dt; hg.font = "bold 20px system-ui, sans-serif"; hg.fillStyle = `rgba(255,230,120,${Math.min(1, flashT * 2)})`; hg.fillText(game.flashText, W / 2, H * 0.32); }
  // Bảng số bên trái/phải.
  hg.textAlign = "left"; hg.font = "bold 14px system-ui, sans-serif"; hg.fillStyle = green;
  const ground = Math.max(0, terrainH(player.pos.x, player.pos.z));
  hg.fillText("TỐC ĐỘ " + Math.round(player.speed * 3.6) + " km/h", 18, H / 2 - 10);
  hg.fillText("ĐỘ CAO " + Math.round(player.pos.y) + " m" + (player.pos.y - ground < 300 ? " ⚠" : ""), 18, H / 2 + 12);
  hg.textAlign = "right";
  const ms = player.missiles.map((t) => (t <= 0 ? "▮" : "▯")).join(" ");
  hg.fillText("TÊN LỬA " + ms, W - 18, H / 2 - 10);
  hg.fillText("MỒI NHIỆT " + "●".repeat(player.flares) + "○".repeat(FLARE.count - player.flares), W - 18, H / 2 + 12);
  // Máu
  const bw = Math.min(260, W * 0.3);
  hg.fillStyle = "rgba(0,0,0,.4)"; hg.fillRect(W / 2 - bw / 2, H - 52, bw, 10);
  hg.fillStyle = player.hp > 50 ? "#7ff0b8" : player.hp > 25 ? "#ffd23f" : "#ff4a3a";
  hg.fillRect(W / 2 - bw / 2, H - 52, bw * Math.max(0, player.hp) / 100, 10);
  // Radar
  drawRadar();
  // Trúng đạn: viền đỏ.
  if (game.hurt > 0) { game.hurt -= dt; hg.fillStyle = `rgba(255,40,30,${game.hurt})`; hg.fillRect(0, 0, W, 8); hg.fillRect(0, H - 8, W, 8); hg.fillRect(0, 0, 8, H); hg.fillRect(W - 8, 0, 8, H); }
  if (game.hitFlash > 0) game.hitFlash -= dt;
}
function drawRadar() {
  const R = 70, cx = 18 + R, cy = H - 18 - R, range = 4500;
  hg.fillStyle = "rgba(6,20,14,.55)"; hg.beginPath(); hg.arc(cx, cy, R, 0, Math.PI * 2); hg.fill();
  hg.strokeStyle = "rgba(140,255,170,.5)"; hg.lineWidth = 1;
  hg.beginPath(); hg.arc(cx, cy, R / 2, 0, Math.PI * 2); hg.stroke();
  forwardOf(player.q, fwd);
  const heading = Math.atan2(fwd.x, -fwd.z);
  const dot = (x, z, color, r) => {
    const dx = x - player.pos.x, dz = z - player.pos.z;
    const rx = dx * Math.cos(heading) + dz * Math.sin(heading), rz = -dx * Math.sin(heading) + dz * Math.cos(heading);
    let px = rx / range * R, py = rz / range * R;
    const len = Math.hypot(px, py); if (len > R - 4) { px *= (R - 4) / len; py *= (R - 4) / len; }
    hg.fillStyle = color; hg.beginPath(); hg.arc(cx + px, cy + py, r, 0, Math.PI * 2); hg.fill();
  };
  for (const e of enemies) if (!e.dead) dot(e.pos.x, e.pos.z, e === player.lock ? "#ffd23f" : "#ff5a40", 3.5);
  for (const m of missiles) if (m.side === "enemy") dot(m.pos.x, m.pos.z, "#ffffff", 2);
  hg.fillStyle = "#8cffaa"; hg.beginPath(); hg.moveTo(cx, cy - 7); hg.lineTo(cx + 5, cy + 5); hg.lineTo(cx - 5, cy + 5); hg.closePath(); hg.fill();
}

// ---------- Kết nối điện thoại ----------
const padUrl = (code) => {
  const u = new URL("pad.html", location.href);
  if (code) u.searchParams.set("c", code);
  u.searchParams.set("game", "fighter");
  for (const k of ["peer", "relay", "via"]) if (params.get(k)) u.searchParams.set(k, params.get(k));
  return u;
};
$("padUrl").textContent = padUrl().host + padUrl().pathname;
const link = TiltLink.hostScreen({
  game: "fighter",
  onCode(code) {
    $("codeOut").textContent = code; $("qr").innerHTML = "";
    new QRCode($("qr"), { text: padUrl(code).href, width: 132, height: 132, correctLevel: QRCode.CorrectLevel.M });
    setPadText();
  },
  onPads(n, { relay }) { phone.count = n; phone.relay = relay; if (n) phone.center = true; setPadText(); },
  onMessage(d) {
    if (d.t === "orient") onOrient(d);
    else if (d.t === "reset") { phone.center = true; flash("Đã căn giữa cần lái"); }
    else if (d.t === "btn") {
      if (d.b === "gun") phone.gun = !!d.on;
      else if (d.b === "boost") phone.boost = !!d.on;
      else if (d.b === "missile" && d.on) fireMissile();
      else if (d.b === "flare" && d.on) dropFlares();
      else if (d.b === "view" && d.on) toggleView();
      else if (d.b === "start" && d.on && game.state !== "fight") startGame();
    }
  },
  onError(err) { $("padText").textContent = "Không mở được phòng (" + (err.type || err.message) + ")"; },
});
function setPadText() {
  $("padDot").classList.toggle("live", phone.count > 0);
  $("padText").textContent = phone.count
    ? "Điện thoại đã kết nối" + (phone.relay ? " qua trung gian" : "") + " · phòng " + $("codeOut").textContent
    : "Chưa có điện thoại · dùng bàn phím · phòng " + $("codeOut").textContent;
}
// Gửi trạng thái cho điện thoại hiện: máu, tên lửa, mồi nhiệt, khoá mục tiêu.
let hudT = 0;
function sendPhoneHud(dt) {
  if (!phone.count || (hudT += dt) < 0.2) return;
  hudT = 0;
  link.broadcast({ t: "hud", hp: Math.max(0, Math.round(player.hp)), ms: player.missiles.filter((t) => t <= 0).length,
    fl: player.flares, lock: player.lock ? Math.min(1, player.lockT / MISSILE.lockTime) : 0,
    warn: missiles.some((m) => m.side === "enemy" && m.target === player) ? "missile" : game.warn ? "low" : "", state: game.state });
}

// ---------- Menu ----------
$("playBtn").onclick = startGame;
$("againBtn").onclick = startGame;
$("menuBtn").onclick = () => { game.state = "menu"; show("menu"); };
$("hubBtn").onclick = () => link.goTo("hub");
for (const b of document.querySelectorAll("#level button")) {
  b.onclick = () => { level = LEVELS[+b.dataset.l]; for (const o of document.querySelectorAll("#level button")) o.classList.toggle("on", o === b); };
}

// ---------- Khung hình ----------
let perfT = 0, perfN = 0, fast = 0;
function adapt(frameTime) {
  perfT += frameTime; perfN++;
  if (perfT < 1.5) return;
  const avg = perfT / perfN; perfT = 0; perfN = 0;
  let next = pixelRatio;
  if (avg > 0.022) { next = Math.max(0.6, pixelRatio - 0.2); fast = 0; } else if (avg < 0.0175 && ++fast >= 3) { next = Math.min(MAX_RATIO, pixelRatio + 0.1); fast = 0; }
  if (next !== pixelRatio) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); resize(); }
}
let last = performance.now();
function frame(now) {
  const frameTime = (now - last) / 1000; last = now;
  const dt = Math.min(0.05, frameTime);
  if (game.state === "fight") {
    const sub = dt > 0.025 ? 2 : 1;
    for (let i = 0; i < sub; i++) step(dt / sub);
  } else {
    // Menu: máy bay bay vòng tròn chậm cho đẹp.
    game.t += dt;
    player.pos.set(Math.cos(game.t * 0.15) * 900, 1100, Math.sin(game.t * 0.15) * 900);
    tmp.set(-Math.sin(game.t * 0.15), 0, Math.cos(game.t * 0.15));
    player.q.setFromUnitVectors(new T.Vector3(0, 0, -1), tmp).multiply(dq.setFromAxisAngle(axisZ, 0.35));
  }
  player.mesh.position.copy(player.pos); player.mesh.quaternion.copy(player.q);
  player.mesh.userData.glow.scale.setScalar(ctl.boost && game.state === "fight" ? 1.6 : 1);
  for (const e of enemies) { e.mesh.position.copy(e.pos); e.mesh.quaternion.copy(e.q); }
  updateFx(dt);
  updateCamera(dt);
  drawHud(dt);
  if (game.bannerT > 0 && (game.bannerT -= dt) <= 0) $("banner").innerHTML = "";
  sendPhoneHud(dt);
  renderer.render(scene, camera);
  adapt(frameTime);
  requestAnimationFrame(frame);
}
resize();
requestAnimationFrame(frame);
if (params.has("debug")) window.__fighter = { game, player, enemies, missiles, bullets, phone, onOrient, startGame, fireMissile, dropFlares, ctl, level: () => level };
})();
