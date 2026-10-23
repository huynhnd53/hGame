// paddle.js – điện thoại làm cán vợt: tư thế vợt theo đúng tay người chơi và nhận động tác vung.
// Dùng chung cho pickleball-fp.html (game) và motion.html (trang kiểm tra cử động), nên kiểm tra đúng ở trang kia là
// game cũng đúng. Cần three.js (THREE) đã tải.
//
// Hệ trục "sân": Y hướng lên trời, -Z hướng về màn hình máy tính (về phía lưới), X sang phải người chơi.
// Vợt: cán theo trục Y (từ tay lên mặt vợt), mặt vợt vuông góc trục Z. Điện thoại: đỉnh máy là Y, mặt màn hình là Z.
// Vậy tư thế vợt = đúng tư thế điện thoại trong hệ sân: dựng đứng điện thoại thì vợt dựng đứng, chúc đầu máy xuống thì
// vợt chúc xuống, quay mặt màn hình về lưới thì mặt vợt quay về lưới.
(() => {
"use strict";
const T = THREE;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Từ alpha/beta/gamma (độ) sang quaternion thiết bị → thế giới (Y lên), cùng công thức DeviceOrientationControls.
const zee = new T.Vector3(0, 0, 1), yAxis = new T.Vector3(0, 1, 0);
const euler = new T.Euler(), qa = new T.Quaternion();
const q1 = new T.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° quanh X
function deviceToQuaternion(q, alpha, beta, gamma, orient) {
  euler.set(beta * DEG, alpha * DEG, -gamma * DEG, "YXZ");
  q.setFromEuler(euler); q.multiply(q1); q.multiply(qa.setFromAxisAngle(zee, -orient * DEG));
}

// Ngưỡng nhận động tác (đổi ở đây là đổi cho cả game lẫn trang kiểm tra).
const TH = {
  start: 170,        // °/s: bắt đầu một cú vung (thấp để bắt được cả cú dink chậm)
  end: 120,          // °/s: hết cú vung
  maxMs: 450,        // cú vung dài nhất
  dink: 420,         // tốc độ cao nhất dưới mức này là dink
  smashHigh: 12,     // smash: đầu vợt phải từng giơ cao hơn (độ, so với mặt đất)
  smashDrop: 30,     // … và chúc xuống ít nhất chừng này (độ)
  vutRise: 25,       // vụt: đầu vợt đi lên ít nhất chừng này (độ)
  lobRise: 70,       // lốp: đi lên nhiều hơn chừng này…
  lobSpeed: 750,     // … mà chậm hơn chừng này (°/s)
  fast: 950,         // vung ngang nhanh hơn: đánh mạnh
};

/** Hướng đầu vợt trong hệ sân: elev = ngóc lên (+) / chúc xuống (−), yaw = lệch phải (+) / trái (−), độ. */
const tipV = new T.Vector3();
function tipOf(q) {
  tipV.set(0, 1, 0).applyQuaternion(q);
  return { elev: Math.asin(clamp(tipV.y, -1, 1)) / DEG, yaw: Math.atan2(tipV.x, -tipV.z) / DEG, dir: tipV.clone() };
}

/** Phân loại một cú vung; trả về { kind, why } để trang kiểm tra giải thích được vì sao. */
function classify(sw) {
  if (!sw) return { kind: "vut", why: "" };
  const rise = sw.elev - sw.elev0;
  let sweep = Math.abs(sw.yaw - sw.yaw0); if (sweep > 180) sweep = 360 - sweep;
  const f = (v) => Math.round(v);
  if (sw.peak < TH.dink) return { kind: "dink", why: `nhanh nhất ${f(sw.peak)}°/s < ${TH.dink}` };
  if (rise < -TH.smashDrop && sw.elevMax > TH.smashHigh && -rise > sweep * 0.6)
    return { kind: "smash", why: `đầu vợt từng giơ ${f(sw.elevMax)}° rồi chúc xuống ${f(-rise)}° (quét ngang ${f(sweep)}°)` };
  if (rise > TH.vutRise && rise > sweep * 0.7) {
    if (rise > TH.lobRise && sw.peak < TH.lobSpeed) return { kind: "lob", why: `đi lên ${f(rise)}° > ${TH.lobRise}, chậm ${f(sw.peak)}°/s` };
    return { kind: "vut", why: `đầu vợt đi lên ${f(rise)}° (quét ngang ${f(sweep)}°)` };
  }
  return sw.peak > TH.fast
    ? { kind: "fast", why: `vung ngang ${f(sweep)}°, ${f(sw.peak)}°/s > ${TH.fast}` }
    : { kind: "drive", why: `vung ngang ${f(sweep)}°, lên/xuống ${f(rise)}°` };
}
const NAMES = { vut: "Vụt từ dưới lên", smash: "Smash", dink: "Dink", lob: "Lốp", drive: "Đánh thẳng", fast: "Đánh mạnh" };
function info(sw) {
  if (!sw) return "";
  const rise = sw.elev - sw.elev0;
  return Math.round(sw.peak) + "°/s · " + (rise >= 0 ? "↑" : "↓") + Math.abs(Math.round(rise)) + "°";
}

/**
 * Theo dõi điện thoại.
 * - onSwing(sw, late): bắt đầu một đoạn vung (late: giây tin đến muộn hơn bình thường, để tính lùi thời điểm vung).
 *   sw được cập nhật dần trong lúc vung (tốc độ cao nhất, hướng đầu vợt).
 * - onSwingEnd(sw): hết đoạn vung đó.
 * - onStroke(sw, group): cú đánh thật. Một cú đánh thường gồm lấy đà (giơ vợt lên trước khi smash, hạ vợt xuống
 *   trước khi vụt), cú đánh, rồi đưa vợt về; các đoạn này nối nhau (đầu vợt đổi chiều, hoặc đoạn sau bắt đầu ngay khi
 *   đoạn trước hết). Cả nhóm xong thì đoạn nhanh nhất là cú đánh; các đoạn khác là lấy đà/đưa về (sw.back = true).
 */
const STROKE_WAIT = 280;   // ms sau khi hết đoạn vung mà không có đoạn mới thì mới chắc đó là cú đánh
const wrapDeg = (d) => ((d + 540) % 360) - 180;
function create({ onSwing = () => {}, onSwingEnd = () => {}, onStroke = () => {}, onSample = () => {} } = {}) {
  const raw = new T.Quaternion(), heading = new T.Quaternion(), prev = new T.Quaternion();
  const m = {
    q: new T.Quaternion(),            // tư thế vợt trong hệ sân
    tip: { elev: 0, yaw: 0, dir: new T.Vector3(0, 1, 0) },
    speed: 0, at: -1e9, swing: null, history: [], centered: false,
  };
  let wantCenter = true, prevTs = 0, lagFloor = Infinity;
  let pending = null, pendingTimer = 0, group = [];   // đoạn vừa hết (chờ đoạn nối tiếp); các đoạn của một cú đánh

  /** Căn giữa: lấy hướng đầu máy (hoặc lưng máy nếu đang dựng đứng) lúc này làm hướng về màn hình. */
  m.center = () => { wantCenter = true; };

  m.onOrient = (d) => {
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    // Bỏ qua góc xoay giao diện (d.o): vợt theo đỉnh máy thật, kể cả khi màn hình điện thoại tự xoay ngang giữa cú vung.
    deviceToQuaternion(raw, num(d.a), num(d.b), num(d.g), 0);
    if (wantCenter) {
      const top = new T.Vector3(0, 1, 0).applyQuaternion(raw);
      const back = new T.Vector3(0, 0, -1).applyQuaternion(raw);
      const dir = Math.hypot(top.x, top.z) > 0.35 ? top : back;     // đầu máy chĩa lên trời thì dùng lưng máy
      heading.setFromAxisAngle(yAxis, Math.atan2(dir.x, -dir.z));
      wantCenter = false; m.centered = true;
    }
    m.q.copy(heading).multiply(raw);
    const last = m.tip;
    const now = performance.now();
    m.at = now;
    const ts = Number.isFinite(+d.ts) ? +d.ts : now;
    const lag = now - ts;
    lagFloor = Math.min(lagFloor + 0.05, lag);                     // nhích dần lên để theo kịp khi đồng hồ hai máy trôi
    const dt = (ts - prevTs) / 1000;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(prev.dot(m.q)))) / DEG;
    prev.copy(m.q);
    m.tip = tipOf(m.q);
    m.history.push({ ts, elev: m.tip.elev, yaw: m.tip.yaw }); while (m.history.length && ts - m.history[0].ts > 600) m.history.shift();
    if (prevTs === 0 || dt <= 0 || dt > 0.25) { prevTs = ts; m.speed = 0; onSample(m); return; }
    prevTs = ts;
    m.speed = angle / Math.max(dt, 0.008);
    const t = m.tip;
    const late = clamp((lag - lagFloor) / 1000, 0, 0.25);
    const start = (from, linked) => {
      // Nối tiếp đoạn trước (đổi chiều, hoặc bắt đầu ngay khi đoạn trước vừa hết): cùng một cú đánh.
      if (pending) { clearTimeout(pendingTimer); pending = null; }
      if (!linked) group = [];
      m.swing = { ts, peak: m.speed, elev0: from.elev, yaw0: from.yaw, elev: t.elev, yaw: t.yaw,
        elevMax: Math.max(from.elev, t.elev), elevMin: Math.min(from.elev, t.elev), hit: false, back: false };
      group.push(m.swing);
      onSwing(m.swing, late);
    };
    const end = (sw) => {
      m.swing = null; sw.endTs = ts;
      onSwingEnd(sw);
      pending = sw;
      const g = group;
      pendingTimer = setTimeout(() => {
        if (pending !== sw) return;
        pending = null;
        // Cả nhóm xong: đoạn nhanh nhất là cú đánh, các đoạn khác là lấy đà/đưa vợt về.
        const best = g.reduce((a, b) => (b.peak > a.peak ? b : a));
        for (const x of g) x.back = x !== best;
        onStroke(best, g);
      }, STROKE_WAIT);
    };
    if (!m.swing) {
      if (m.speed > TH.start) {
        // Nối tiếp ngay sau đoạn trước (lấy đà xong vung luôn): tính từ chỗ đổi chiều. Không thì từ tư thế ~0,12 s trước.
        const linked = !!pending && ts - pending.endTs < 200;
        start(linked ? pending : m.history.find((h) => ts - h.ts <= 120) || m.history[0], linked);
      }
    } else {
      const sw = m.swing;
      // Đầu vợt quay ngược chiều đã đi (đã đi được > 15°): đoạn vừa rồi là lấy đà, bắt đầu cú đánh từ chỗ đổi chiều.
      const ae = sw.elev - sw.elev0, ay = wrapDeg(sw.yaw - sw.yaw0);
      const de = t.elev - last.elev, dy = wrapDeg(t.yaw - last.yaw);
      const moved = Math.hypot(ae, ay), step = Math.hypot(de, dy);
      if (moved > 15 && step > 1.5 && de * ae + dy * ay < -0.5 * step * moved) {
        end(sw);
        if (m.speed > TH.start) start(last, true);   // tay vẫn vung nhanh: đánh luôn từ chỗ đổi chiều
      } else {
        sw.peak = Math.max(sw.peak, m.speed);
        sw.elev = t.elev; sw.yaw = t.yaw;
        sw.elevMax = Math.max(sw.elevMax, t.elev); sw.elevMin = Math.min(sw.elevMin, t.elev);
        if (m.speed < TH.end || ts - sw.ts > TH.maxMs) end(sw);
      }
    }
    onSample(m);
  };
  /** Có tin điện thoại gần đây không. */
  m.live = () => performance.now() - m.at < 400;
  return m;
}

/** Tay phải cầm vợt: lệch so với mắt (hệ sân), và tay vươn theo hướng đầu vợt một chút cho đường vung rộng như thật. */
const GRIP = new T.Vector3(0.32, -0.48, -0.4), REACH_OUT = 0.12;
const placeV = new T.Vector3();
function place(group, q, eye) {
  placeV.set(0, 1, 0).applyQuaternion(q).multiplyScalar(REACH_OUT);
  group.position.copy(eye).add(GRIP).add(placeV);
  group.quaternion.copy(q);
}
/** Tư thế vợt từ góc chúc/ngóc (pitch, quanh X: âm là đầu vợt ra trước) và góc quét ngang (yaw, quanh Y: dương sang trái). */
const qY = new T.Quaternion(), qX = new T.Quaternion(), xAxis = new T.Vector3(1, 0, 0);
function poseFrom(q, pitch, yaw) { return q.copy(qY.setFromAxisAngle(yAxis, yaw)).multiply(qX.setFromAxisAngle(xAxis, pitch)); }

/** Cây vợt 3D: gốc ở tay cầm, cán theo +Y, mặt vợt vuông góc +Z. */
function buildPaddle(scale = 1) {
  const mat = (color) => new T.MeshLambertMaterial({ color });
  const g = new T.Group();
  const grip = new T.Mesh(new T.BoxGeometry(0.034, 0.13, 0.03), mat(0x222222)); grip.position.y = 0.065; g.add(grip);
  const faceG = new T.Group(); faceG.position.y = 0.25; faceG.scale.set(1, 1.3, 1); g.add(faceG);
  const face = new T.Mesh(new T.CylinderGeometry(0.095, 0.095, 0.014, 28), mat(0xffd23f)); face.rotation.x = Math.PI / 2; faceG.add(face);
  // Mặt trước (cùng phía màn hình điện thoại) có chấm xanh, để biết vợt đang ngửa hay úp.
  const dot = new T.Mesh(new T.CircleGeometry(0.03, 16), mat(0x2fb380)); dot.position.z = 0.0075; faceG.add(dot);
  const rim = new T.Mesh(new T.TorusGeometry(0.095, 0.007, 6, 28), mat(0x1f2a44)); faceG.add(rim);
  const fist = new T.Mesh(new T.SphereGeometry(0.045, 12, 10), mat(0xf1c7a1)); fist.position.y = 0.04; fist.scale.set(1, 1.3, 1.1); g.add(fist);
  g.scale.setScalar(scale);
  return g;
}

window.PaddleMotion = { create, classify, info, buildPaddle, place, poseFrom, tipOf, deviceToQuaternion, TH, NAMES };
})();
