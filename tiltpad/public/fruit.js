// fruit.js – Chém hoa quả: điện thoại (hoặc chuột) là thanh kiếm, quả bay lên từ dưới màn hình.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const T = THREE;
const params = new URLSearchParams(location.search);

// ---------- Cảnh 3D ----------
const stage = $("stage");
const glCanvas = $("gl");
const trailCanvas = $("trail");
const splatCanvas = $("splats");
const trailCtx = trailCanvas.getContext("2d");
const splatCtx = splatCanvas.getContext("2d");

const renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 18);
scene.add(new T.HemisphereLight(0xfff6e8, 0x5a3820, 0.9));
const sun = new T.DirectionalLight(0xffffff, 0.9);
sun.position.set(-5, 8, 10);
scene.add(sun);

let W = 1, H = 1, halfW = 1, halfH = 1;
function resize() {
  W = stage.clientWidth; H = stage.clientHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  halfH = Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  halfW = halfH * camera.aspect;
  for (const c of [trailCanvas, splatCanvas]) { c.width = W * devicePixelRatio; c.height = H * devicePixelRatio; }
  trailCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  splatCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  if (state === "gallery") layoutGallery();
}
addEventListener("resize", resize);

/** Điểm 3D (z = 0) sang toạ độ màn hình. */
const toScreen = (() => {
  const v = new T.Vector3();
  return (p) => { v.copy(p).project(camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; };
})();
/** Bán kính trên màn hình của một quả bán kính r (thế giới) đặt ở p. */
function screenRadius(p, r) {
  const a = toScreen(p), b = toScreen(new T.Vector3(p.x + r, p.y, p.z));
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ---------- Âm thanh (tự tổng hợp) ----------
let audio = null;
function sound(kind) {
  if (!audio) return;
  const t = audio.currentTime;
  const noise = (dur, freq, q, gain, type = "bandpass") => {
    const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = audio.createBufferSource(); src.buffer = buf;
    const f = audio.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = audio.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(audio.destination);
    src.start(t);
  };
  if (kind === "swoosh") noise(0.18, 1800, 0.8, 0.25);
  if (kind === "splat") { noise(0.25, 600, 1.2, 0.9); noise(0.12, 2600, 2, 0.35); }
  if (kind === "boom") { noise(0.9, 120, 0.6, 1.6, "lowpass"); noise(0.4, 900, 0.7, 0.6); }
}
function unlockAudio() {
  if (!audio) { try { audio = new AudioContext(); } catch { audio = null; } }
  if (audio && audio.state === "suspended") audio.resume();
}

// ---------- Kết nối điện thoại: điện thoại là con trỏ ----------
const DEG = Math.PI / 180;
const zee = new T.Vector3(0, 0, 1);
const euler = new T.Euler();
const q0 = new T.Quaternion();
const q1 = new T.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° quanh X
function deviceToQuaternion(q, alpha, beta, gamma, orient) {
  euler.set(beta * DEG, alpha * DEG, -gamma * DEG, "YXZ");
  q.setFromEuler(euler);
  q.multiply(q1);
  q.multiply(q0.setFromAxisAngle(zee, -orient * DEG));
}
/** Góc (độ) để con trỏ đi từ giữa tới mép trái/phải màn hình. */
const AIM_RANGE = 28;
const raw = new T.Quaternion();
const offset = new T.Quaternion();
let pendingCenter = true;
let phoneCount = 0;

/**
 * Hướng đầu máy so với lúc căn giữa → vị trí trên màn hình. Lúc căn giữa đầu máy (trục Y của điện thoại) chĩa
 * vào giữa; xoay sang trái/phải dời con trỏ ngang, ngóc lên/chúc xuống dời con trỏ dọc.
 */
function aimToScreen(rel) {
  const v = new T.Vector3(0, 1, 0).applyQuaternion(rel);
  const yaw = Math.atan2(v.x, v.y);
  const pitch = Math.atan2(v.z, Math.hypot(v.x, v.y));
  const k = (W / 2) / (AIM_RANGE * DEG);
  return {
    x: Math.max(0, Math.min(W, W / 2 + yaw * k)),
    y: Math.max(0, Math.min(H, H / 2 - pitch * k)),
  };
}

const padUrl = (code) => {
  const u = new URL("pad.html", location.href);
  if (code) u.searchParams.set("c", code);
  u.searchParams.set("game", "fruit");
  const peer = params.get("peer");
  if (peer) u.searchParams.set("peer", peer);
  return u;
};
$("padUrl").textContent = padUrl().host + padUrl().pathname;

const link = TiltLink.hostScreen({
  onCode(code) {
    $("codeOut").textContent = code;
    $("qr").innerHTML = "";
    new QRCode($("qr"), { text: padUrl(code).href, width: 132, height: 132, correctLevel: QRCode.CorrectLevel.M });
    setPadText();
  },
  onPads(n) {
    phoneCount = n;
    if (n > 0) pendingCenter = true;
    setPadText();
  },
  onMessage(d) {
    if (d.t === "reset") { pendingCenter = true; return; }
    if (d.t !== "orient") return;
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    deviceToQuaternion(raw, num(d.a), num(d.b), num(d.g), num(d.o));
    if (pendingCenter) { offset.copy(raw).invert(); pendingCenter = false; }
    const p = aimToScreen(offset.clone().multiply(raw));
    moveBlade(p.x, p.y, "phone");
  },
  onError(err) { $("padText").textContent = "Không mở được phòng (" + (err.type || err.message) + ")"; },
});
function setPadText() {
  $("padDot").classList.toggle("live", phoneCount > 0);
  const code = $("codeOut").textContent;
  $("padText").textContent = phoneCount > 0
    ? (phoneCount === 1 ? "Điện thoại đã kết nối" : phoneCount + " điện thoại") + " · phòng " + code
    : "Chưa có điện thoại · đang chơi bằng chuột · phòng " + code;
}
const buzz = (ms) => link.broadcast({ t: "buzz", ms });

// ---------- Lưỡi kiếm ----------
/** Vết kiếm gần đây (toạ độ màn hình) để vẽ và để biết tốc độ vung. */
const trail = [];
const TRAIL_MS = 140;
/** Vung nhanh hơn mức này (px/giây) mới chém được. */
const CUT_SPEED = 700;
let lastSwoosh = 0;
function moveBlade(x, y, source) {
  const now = performance.now();
  const prev = trail[trail.length - 1];
  trail.push({ x, y, t: now, source });
  if (!prev || now - prev.t > 120) return;
  const dt = (now - prev.t) / 1000 || 1 / 60;
  const speed = Math.hypot(x - prev.x, y - prev.y) / dt;
  if (speed < CUT_SPEED) return;
  if (now - lastSwoosh > 250) { sound("swoosh"); lastSwoosh = now; }
  cutAlong(prev, { x, y }, now);
}
stage.addEventListener("pointermove", (e) => {
  const r = stage.getBoundingClientRect();
  // Điện thoại đang điều khiển thì chuột chỉ để bấm nút.
  if (phoneCount > 0 && e.pointerType === "mouse") return;
  moveBlade(e.clientX - r.left, e.clientY - r.top, "mouse");
});

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

// ---------- Quả, nửa quả, nước quả ----------
const fruits = [];   // quả còn nguyên đang bay
const pieces = [];   // nửa quả rơi xuống
const drops = [];    // giọt nước quả
const splats = [];   // vết nước trên bàn
const GRAVITY = 13;

function addFruit(type, pos, vel, opts = {}) {
  const info = Fruits.TYPES[type];
  const obj = Fruits.whole(type);
  obj.position.copy(pos);
  scene.add(obj);
  const f = {
    type, obj, info, pos: obj.position, vel: vel.clone(), radius: info.radius,
    spinAxis: new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
    spinSpeed: (opts.spinSpeed ?? 1.5) * (0.6 + Math.random()),
    gravity: opts.gravity ?? true,
    slot: opts.slot ?? null,
    born: performance.now(),
  };
  fruits.push(f);
  return f;
}

function removeObject(obj) {
  scene.remove(obj);
  obj.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
}

const dropGeo = new T.SphereGeometry(0.09, 6, 4);
const dropMats = {};
function juiceBurst(pos, color, n = 16) {
  dropMats[color] ??= new T.MeshBasicMaterial({ color });
  for (let i = 0; i < n; i++) {
    const m = new T.Mesh(dropGeo, dropMats[color]);
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
    scene.add(m);
    drops.push({ mesh: m, vel: new T.Vector3(Math.cos(a) * s, Math.sin(a) * s + 2, (Math.random() - 0.5) * 3), life: 0.6 + Math.random() * 0.4 });
  }
}

function addSplat(x, y, r, color) {
  const blobs = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.9;
    blobs.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: r * (0.25 + Math.random() * 0.45) });
  }
  splats.push({ blobs, color: "#" + new T.Color(color).getHexString(), age: 0 });
  if (splats.length > 25) splats.shift();
}

/** Chém quả theo hướng vung (dx, dy trên màn hình). */
function slice(f, dx, dy) {
  const i = fruits.indexOf(f);
  if (i < 0) return;
  fruits.splice(i, 1);
  removeObject(f.obj);
  const at = toScreen(f.pos);
  const rpx = screenRadius(f.pos, f.radius);

  if (Fruits.isBomb(f.type)) { explode(f, at); return; }

  // Mặt cắt chứa hướng vung và hướng nhìn; trục X của hai nửa là pháp tuyến của mặt cắt.
  const len = Math.hypot(dx, dy) || 1;
  const d = new T.Vector2(dx / len, -dy / len);
  const n = new T.Vector2(-d.y, d.x);
  const angle = Math.atan2(n.y, n.x);
  Fruits.halves(f.type).forEach((half, k) => {
    const holder = new T.Group();
    // Hai nửa hơi xoay để thấy ruột.
    half.rotation.y = k === 0 ? 0.7 : -0.7;
    holder.add(half);
    holder.position.copy(f.pos);
    holder.rotation.z = angle;
    scene.add(holder);
    const side = k === 0 ? 1 : -1;
    pieces.push({
      obj: holder,
      vel: new T.Vector3(f.vel.x * 0.6 + n.x * side * 2.6, f.vel.y * 0.4 + n.y * side * 2.6 + 1.5, 0),
      spin: side * (1.5 + Math.random() * 2),
    });
  });
  juiceBurst(f.pos, f.info.juice);
  addSplat(at.x, at.y, rpx * 1.1, f.info.juice);
  sound("splat");
  buzz(35);
  onSliced(f, at);
}

function explode(f, at) {
  sound("boom");
  buzz(350);
  juiceBurst(f.pos, 0xff8a1f, 28);
  juiceBurst(f.pos, 0x2b2b2b, 16);
  const flash = $("flash");
  flash.style.transition = "none"; flash.style.opacity = "0.9";
  requestAnimationFrame(() => { flash.style.transition = "opacity .6s"; flash.style.opacity = "0"; });
  popup(at.x, at.y, "BÙM!", "combo");
  onBomb(f);
}

function cutAlong(a, b, now) {
  for (const f of fruits.slice()) {
    const c = toScreen(f.pos);
    if (distToSegment(c, a, b) < screenRadius(f.pos, f.radius)) slice(f, b.x - a.x, b.y - a.y);
  }
}

function popup(x, y, text, cls = "") {
  const el = document.createElement("div");
  el.textContent = text;
  if (cls) el.className = cls;
  el.style.left = x + "px"; el.style.top = y + "px";
  $("popups").append(el);
  setTimeout(() => el.remove(), 1000);
}

// ---------- Trạng thái game ----------
let state = "menu";   // menu | play | over | gallery
let score = 0, lives = 3, best = 0;
try { best = Number(localStorage.getItem("tiltpad.fruit.best")) || 0; } catch {}
$("best").textContent = best;
let combo = { n: 0, points: 0, at: 0, x: 0, y: 0 };
let nextWave = 0;

function setScore(v) { score = v; $("score").textContent = score; }
function setLives(v) {
  lives = v;
  [...$("lives").children].forEach((el, i) => el.classList.toggle("lost", i >= lives));
}

function onSliced(f, at) {
  if (state !== "play") { if (state === "gallery") popup(at.x, at.y - 30, f.info.name); return; }
  setScore(score + f.info.points);
  popup(at.x, at.y, "+" + f.info.points);
  const now = performance.now();
  // Chém nhiều quả trong một lần vung thì được thưởng.
  if (now - combo.at < 220) { combo.n++; } else { combo.n = 1; }
  combo.at = now; combo.x = at.x; combo.y = at.y;
}
function onBomb() {
  if (state === "play") endGame(true);
}
function onMissed(f) {
  if (state !== "play" || Fruits.isBomb(f.type)) return;
  const at = toScreen(new T.Vector3(f.pos.x, -halfH + 0.6, 0));
  popup(at.x, at.y - 20, "✕");
  setLives(lives - 1);
  buzz(120);
  if (lives <= 0) endGame(false);
}

function clearField() {
  for (const f of fruits) removeObject(f.obj);
  for (const p of pieces) removeObject(p.obj);
  for (const d of drops) scene.remove(d.mesh);
  fruits.length = pieces.length = drops.length = splats.length = 0;
  $("labels").innerHTML = "";
}

function show(panel) {
  for (const id of ["menu", "over"]) $(id).classList.toggle("hidden", id !== panel);
  $("galleryBar").classList.toggle("hidden", state !== "gallery");
}

function startGame() {
  unlockAudio();
  clearField();
  state = "play";
  setScore(0); setLives(3);
  nextWave = performance.now() + 600;
  show(null);
}
function endGame(byBomb) {
  state = "over";
  if (score > best) { best = score; try { localStorage.setItem("tiltpad.fruit.best", String(best)); } catch {} }
  $("best").textContent = best;
  $("overTitle").textContent = byBomb ? "Trúng bom rồi!" : "Hết lượt!";
  $("overScore").textContent = score;
  $("overBest").textContent = score >= best && score > 0 ? "Kỷ lục mới!" : "Kỷ lục: " + best;
  setTimeout(() => { if (state === "over") show("over"); }, 700);
}
function toMenu() {
  clearField();
  state = "menu";
  show("menu");
}

/** Một đợt quả: càng nhiều điểm càng nhiều quả, càng nhiều bom. */
function launchWave() {
  const level = Math.min(1, score / 120);
  const n = 1 + Math.floor(Math.random() * (2 + level * 4));
  const bombChance = 0.08 + level * 0.17;
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      if (state !== "play") return;
      const bomb = i > 0 && Math.random() < bombChance;
      launch(bomb ? "bomb" : Fruits.FRUIT_TYPES[Math.floor(Math.random() * Fruits.FRUIT_TYPES.length)]);
    }, i * (150 + Math.random() * 250));
  }
  nextWave = performance.now() + 1800 - level * 700 + Math.random() * 600;
}
/** Ném một quả từ dưới lên, đỉnh bay trong khoảng giữa màn hình. */
function launch(type) {
  const x0 = (Math.random() * 2 - 1) * halfW * 0.75;
  const y0 = -halfH - 1.5;
  const apex = halfH * (0.05 + Math.random() * 0.7);
  const vy = Math.sqrt(2 * GRAVITY * (apex - y0));
  const flight = (2 * vy) / GRAVITY;
  const x1 = (Math.random() * 2 - 1) * halfW * 0.5;
  addFruit(type, new T.Vector3(x0, y0, 0), new T.Vector3((x1 - x0) / flight, vy, 0));
}

// ---------- Xem các loại quả ----------
const GALLERY = [...Fruits.FRUIT_TYPES, "bomb"];
function slotPosition(i) {
  const cols = 4, rows = Math.ceil(GALLERY.length / cols);
  const c = i % cols, r = Math.floor(i / cols);
  return new T.Vector3((c - (cols - 1) / 2) * Math.min(4.2, halfW * 0.48), ((rows - 1) / 2 - r) * Math.min(4.6, halfH * 0.8) + 0.4, 0);
}
function placeGalleryFruit(i) {
  const f = addFruit(GALLERY[i], slotPosition(i), new T.Vector3(), { gravity: false, spinSpeed: 0.8, slot: i });
  f.obj.scale.setScalar(0.01);
  return f;
}
function layoutGallery() {
  for (const f of fruits) if (f.slot !== null) f.pos.copy(slotPosition(f.slot));
}
function openGallery() {
  unlockAudio();
  clearField();
  state = "gallery";
  show(null);
  GALLERY.forEach((_, i) => placeGalleryFruit(i));
  $("labels").innerHTML = GALLERY.map((t, i) => `<span data-slot="${i}">${Fruits.TYPES[t].name}</span>`).join("");
}
const respawn = [];  // [ô, thời điểm] quả trong bộ sưu tập sẽ mọc lại

// ---------- Vòng lặp ----------
let last = performance.now();
let menuSpawn = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === "play" && now > nextWave) launchWave();
  // Menu: vài quả bay lên làm cảnh, chém chơi được.
  if (state === "menu" && now > menuSpawn) {
    launch(Fruits.FRUIT_TYPES[Math.floor(Math.random() * Fruits.FRUIT_TYPES.length)]);
    menuSpawn = now + 1400 + Math.random() * 900;
  }

  for (const f of fruits.slice()) {
    if (f.gravity) {
      f.vel.y -= GRAVITY * dt;
      f.pos.addScaledVector(f.vel, dt);
    } else if (f.obj.scale.x < 1) {
      f.obj.scale.setScalar(Math.min(1, f.obj.scale.x + dt * 4));
    }
    f.obj.rotateOnAxis(f.spinAxis, f.spinSpeed * dt);
    if (f.type === "bomb") {
      const spark = f.obj.getObjectByName("spark");
      if (spark) spark.scale.setScalar(0.7 + Math.random() * 0.8);
    }
    if (f.gravity && f.pos.y < -halfH - 2.5 && f.vel.y < 0) {
      fruits.splice(fruits.indexOf(f), 1);
      removeObject(f.obj);
      onMissed(f);
    }
  }
  if (state === "gallery") {
    // Quả đã chém mọc lại sau một lúc.
    GALLERY.forEach((_, i) => {
      if (fruits.some((f) => f.slot === i)) return;
      const r = respawn.find((x) => x[0] === i);
      if (!r) respawn.push([i, now + 1300]);
      else if (now > r[1]) { respawn.splice(respawn.indexOf(r), 1); placeGalleryFruit(i); }
    });
    for (const el of $("labels").children) {
      const p = toScreen(slotPosition(Number(el.dataset.slot)));
      el.style.left = p.x + "px";
      el.style.top = p.y + screenRadius(slotPosition(0), 1.35) + "px";
    }
  }
  for (const p of pieces.slice()) {
    p.vel.y -= GRAVITY * dt;
    p.obj.position.addScaledVector(p.vel, dt);
    p.obj.rotation.z += p.spin * dt;
    if (p.obj.position.y < -halfH - 3) { pieces.splice(pieces.indexOf(p), 1); removeObject(p.obj); }
  }
  for (const d of drops.slice()) {
    d.vel.y -= GRAVITY * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.life -= dt;
    d.mesh.scale.setScalar(Math.max(0.01, d.life));
    if (d.life <= 0) { drops.splice(drops.indexOf(d), 1); scene.remove(d.mesh); }
  }
  // Combo: báo khi đã hết lượt vung.
  if (combo.n >= 3 && now - combo.at > 230 && state === "play") {
    setScore(score + combo.n);
    popup(combo.x, combo.y - 50, `Combo ×${combo.n}  +${combo.n}`, "combo");
    combo.n = 0;
  } else if (now - combo.at > 230) {
    combo.n = 0;
  }

  drawSplats(dt);
  drawTrail(now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function drawSplats(dt) {
  splatCtx.clearRect(0, 0, W, H);
  for (const s of splats) {
    s.age += dt;
    const alpha = Math.max(0, 0.5 - s.age * 0.08);
    splatCtx.globalAlpha = alpha;
    splatCtx.fillStyle = s.color;
    for (const b of s.blobs) { splatCtx.beginPath(); splatCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2); splatCtx.fill(); }
  }
  splatCtx.globalAlpha = 1;
  while (splats.length && splats[0].age > 6) splats.shift();
}

function drawTrail(now) {
  while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
  trailCtx.clearRect(0, 0, W, H);
  if (trail.length < 2) {
    // Con trỏ của điện thoại khi đứng yên.
    const p = trail[trail.length - 1];
    if (p && p.source === "phone") { trailCtx.fillStyle = "rgba(255,255,255,.8)"; trailCtx.beginPath(); trailCtx.arc(p.x, p.y, 6, 0, Math.PI * 2); trailCtx.fill(); }
    return;
  }
  trailCtx.lineCap = "round";
  trailCtx.shadowColor = "#bfe6ff"; trailCtx.shadowBlur = 14;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    const k = i / trail.length;
    trailCtx.strokeStyle = `rgba(255,255,255,${0.25 + 0.75 * k})`;
    trailCtx.lineWidth = 2 + 9 * k;
    trailCtx.beginPath(); trailCtx.moveTo(a.x, a.y); trailCtx.lineTo(b.x, b.y); trailCtx.stroke();
  }
  trailCtx.shadowBlur = 0;
}

// ---------- Nút ----------
$("playBtn").onclick = startGame;
$("againBtn").onclick = startGame;
$("menuBtn").onclick = toMenu;
$("galleryBtn").onclick = openGallery;
$("galleryBack").onclick = toMenu;
if (params.has("gallery")) openGallery();

resize();
requestAnimationFrame(frame);
if (params.has("debug")) {
  window.__fruit = {
    get state() { return state; }, get score() { return score; }, get lives() { return lives; },
    fruits, pieces, toScreen, screenRadius, moveBlade, launch,
  };
}
})();
