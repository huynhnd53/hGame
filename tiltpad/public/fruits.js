// fruits.js – các loại quả dựng bằng three.js (không cần file mô hình), mỗi quả cắt được làm đôi.
// Quả tròn dựng bằng LatheGeometry quanh trục Y: nửa A là phi 0..π (x ≥ 0), nửa B là π..2π (x ≤ 0),
// mặt cắt nằm trong mặt phẳng x = 0 và được phủ "ruột" vẽ trên canvas.
(() => {
"use strict";
const T = THREE;

// ---------- Texture vẽ tay ----------
function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new T.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Ruột quả: elip vừa khung, viền vỏ bên ngoài, phần còn lại do `inner` vẽ. */
function fleshTexture(rind, rindWidth, flesh, inner) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = rind; g.fillRect(0, 0, w, h);
    g.save();
    g.beginPath();
    g.ellipse(w / 2, h / 2, w / 2 - rindWidth, h / 2 - rindWidth, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = flesh; g.fillRect(0, 0, w, h);
    if (inner) inner(g, w, h);
    g.restore();
  });
}

function seeds(g, w, h, color, n, spread = 0.36, size = 5) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
    g.beginPath();
    g.ellipse(w / 2 + Math.cos(a) * r * w, h / 2 + Math.sin(a) * r * h, size * 0.6, size, a, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------- Hình dạng ----------
/** Profile (bán kính theo chiều cao) của một elip bầu, từ đáy lên đỉnh. */
function ovalProfile(rx, ry, steps = 24, squash = 0) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI;
    const y = -Math.cos(t) * ry;
    // squash > 0: phình ở dưới, thon ở trên (táo, xoài)
    const r = Math.max(0.0001, Math.sin(t) * rx * (1 + squash * Math.cos(t) * -0.5));
    pts.push(new T.Vector2(r, y));
  }
  return pts;
}

function appleProfile() {
  // Đáy lõm, vai đầy, đỉnh lõm chỗ cuống.
  const raw = [[0, -0.6], [0.25, -0.66], [0.5, -0.6], [0.7, -0.4], [0.8, -0.1], [0.8, 0.2], [0.72, 0.45], [0.5, 0.62], [0.25, 0.6], [0.08, 0.5], [0, 0.46]];
  return raw.map(([r, y]) => new T.Vector2(Math.max(0.0001, r), y));
}

/** Mặt cắt: hình profile lật đối xứng, phủ texture ruột (UV chuẩn hoá theo khung bao). */
function capGeometry(profile) {
  const pts = profile.map((p) => new T.Vector2(p.x, p.y));
  const mirrored = profile.slice().reverse().map((p) => new T.Vector2(-p.x, p.y));
  const shape = new T.Shape([...pts, ...mirrored]);
  const g = new T.ShapeGeometry(shape, 24);
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const pos = g.getAttribute("position"), uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - min.x) / (max.x - min.x), (pos.getY(i) - min.y) / (max.y - min.y));
  }
  uv.needsUpdate = true;
  return g;
}

const mat = (opts) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.55, metalness: 0 }, opts));

// ---------- Phụ kiện (cuống, lá, vảy, ngọn) ----------
function stem(len = 0.3, r = 0.04, color = 0x5b3a1e) {
  const m = new T.Mesh(new T.CylinderGeometry(r * 0.7, r, len, 6), mat({ color }));
  m.position.y = len / 2;
  const g = new T.Group(); g.add(m); return g;
}
function leaf(len = 0.45, width = 0.2, color = 0x3f9b3a) {
  const s = new T.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(width, len * 0.5, 0, len);
  s.quadraticCurveTo(-width, len * 0.5, 0, 0);
  const m = new T.Mesh(new T.ShapeGeometry(s, 8), mat({ color, side: T.DoubleSide }));
  return m;
}

/**
 * Một quả tròn: thân lathe + phụ kiện. Trả về hàm dựng quả nguyên và hàm dựng hai nửa.
 * Phụ kiện có `side`: "top" (theo nửa A), hoặc tự chia theo dấu x.
 */
function latheFruit({ profile, skin, cap, extras = () => [] }) {
  const full = () => {
    const g = new T.Group();
    g.add(new T.Mesh(new T.LatheGeometry(profile, 40), skin));
    for (const e of extras()) g.add(e);
    return g;
  };
  const halves = () => {
    const capGeo = capGeometry(profile);
    return [0, 1].map((k) => {
      const g = new T.Group();
      g.add(new T.Mesh(new T.LatheGeometry(profile, 24, k * Math.PI, Math.PI), skin));
      const c = new T.Mesh(capGeo, cap);
      // Nửa A (x ≥ 0) có mặt cắt nhìn về -X, nửa B nhìn về +X.
      c.rotation.y = k === 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(c);
      for (const e of extras()) {
        e.updateMatrixWorld(true);
        const x = new T.Vector3().setFromMatrixPosition(e.matrixWorld).x;
        // Phụ kiện nằm giữa (cuống, ngọn) theo nửa A; còn lại theo phía của nó.
        if ((Math.abs(x) < 0.05 && k === 0) || (x >= 0.05 && k === 0) || (x <= -0.05 && k === 1)) g.add(e);
      }
      return g;
    });
  };
  return { full, halves };
}

// ---------- Các loại quả ----------
function watermelon() {
  const profile = ovalProfile(0.95, 1.2);
  const skin = mat({
    roughness: 0.35,
    map: canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = "#2f7d32"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#a5d66f"; g.lineWidth = 7;
      for (let i = 0; i < 12; i++) {
        const x0 = (i / 12) * w;
        g.beginPath(); g.moveTo(x0, 0);
        for (let y = 0; y <= h; y += 8) g.lineTo(x0 + Math.sin(y * 0.3 + i) * 5, y);
        g.stroke();
      }
    }),
  });
  const cap = mat({ side: T.DoubleSide, map: fleshTexture("#2f7d32", 6, "#e8384f", (g, w, h) => {
    g.strokeStyle = "#f4f1c9"; g.lineWidth = 10;
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 14, h / 2 - 14, 0, 0, Math.PI * 2); g.stroke();
    seeds(g, w, h, "#1b1b1b", 26, 0.3);
  }) });
  return latheFruit({ profile, skin, cap });
}

function orange() {
  const profile = ovalProfile(0.72, 0.68);
  const skin = mat({
    roughness: 0.7,
    map: canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = "#f28b1c"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? "#e07a12" : "#f7a243"; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    }),
  });
  const cap = mat({ side: T.DoubleSide, map: fleshTexture("#f28b1c", 8, "#ffb23d", (g, w, h) => {
    g.fillStyle = "#fff1c7"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffa32b";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.beginPath(); g.moveTo(w / 2, h / 2);
      g.ellipse(w / 2, h / 2, w / 2 - 14, h / 2 - 14, 0, a + 0.04, a + Math.PI / 5 - 0.04);
      g.closePath(); g.fill();
    }
    seeds(g, w, h, "#fff4d6", 6, 0.2, 4);
  }) });
  const extras = () => {
    const s = stem(0.08, 0.035, 0x557a2b); s.position.y = 0.66;
    const l = leaf(0.3, 0.14); l.position.set(0.02, 0.7, 0); l.rotation.z = -1.1;
    return [s, l];
  };
  return latheFruit({ profile, skin, cap, extras });
}

function apple() {
  const profile = appleProfile();
  const skin = mat({
    roughness: 0.3,
    map: canvasTexture(128, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "#f6d24a"); gr.addColorStop(0.35, "#d8252c"); gr.addColorStop(1, "#a3121b");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(255,210,80,0.35)"; g.lineWidth = 2;
      for (let i = 0; i < 24; i++) { const x = rnd() * w; g.beginPath(); g.moveTo(x, h * 0.3); g.lineTo(x + rnd() * 6 - 3, h); g.stroke(); }
    }),
  });
  const cap = mat({ side: T.DoubleSide, map: fleshTexture("#c8222b", 5, "#fbf0c9", (g, w, h) => {
    g.strokeStyle = "#e9d89a"; g.lineWidth = 3;
    g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.14, h * 0.2, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#5a3418";
    for (const dx of [-1, 1]) { g.beginPath(); g.ellipse(w / 2 + dx * w * 0.05, h / 2, 5, 9, 0, 0, Math.PI * 2); g.fill(); }
  }) });
  const extras = () => {
    const s = stem(0.3, 0.035); s.position.y = 0.46;
    const l = leaf(0.35, 0.15); l.position.set(0.02, 0.68, 0); l.rotation.z = -1.0;
    return [s, l];
  };
  return latheFruit({ profile, skin, cap, extras });
}

function mango() {
  const profile = ovalProfile(0.7, 0.95, 24, 0.25);
  const skin = mat({
    roughness: 0.4,
    map: canvasTexture(128, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, "#9bc53d"); gr.addColorStop(0.45, "#f7c531"); gr.addColorStop(1, "#f06a2a");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }),
  });
  const cap = mat({ side: T.DoubleSide, map: fleshTexture("#f2a531", 5, "#ffb627", (g, w, h) => {
    g.fillStyle = "#f6e7b0";
    g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.12, h * 0.34, 0, 0, Math.PI * 2); g.fill();
  }) });
  const extras = () => { const s = stem(0.12, 0.03, 0x4c6b22); s.position.y = 0.94; return [s]; };
  return latheFruit({ profile, skin, cap, extras });
}

function dragonFruit() {
  const profile = ovalProfile(0.72, 0.98);
  const skin = mat({ color: 0xe0367f, roughness: 0.45 });
  const cap = mat({ side: T.DoubleSide, map: fleshTexture("#e0367f", 7, "#fbfaf6", (g, w, h) => seeds(g, w, h, "#151515", 140, 0.4, 2.5)) });
  const scaleMat = mat({ color: 0xe0367f, side: T.DoubleSide });
  const tipMat = mat({ color: 0x8cc63f, side: T.DoubleSide });
  const extras = () => {
    const out = [];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 7; i++) {
        const phi = (i / 7) * Math.PI * 2 + row * 0.45;
        const y = -0.55 + row * 0.5;
        const r = Math.sqrt(Math.max(0, 1 - (y / 0.98) ** 2)) * 0.72;
        const s = new T.Group();
        const petal = new T.Mesh(new T.ConeGeometry(0.13, 0.42, 4, 1, true), row === 2 ? tipMat : scaleMat);
        petal.position.y = 0.2; s.add(petal);
        const tip = new T.Mesh(new T.ConeGeometry(0.05, 0.14, 4), tipMat);
        tip.position.y = 0.45; s.add(tip);
        s.position.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
        // nghiêng ra ngoài và hơi lên trên
        s.lookAt(s.position.x * 3, y + 1.4, s.position.z * 3);
        s.rotateX(Math.PI / 2);
        out.push(s);
      }
    }
    return out;
  };
  return latheFruit({ profile, skin, cap, extras });
}

function pineapple() {
  const profile = ovalProfile(0.68, 0.95);
  const skin = mat({
    roughness: 0.8,
    map: canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = "#c8902b"; g.fillRect(0, 0, w, h);
      const n = 10;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = (i + (j % 2) * 0.5) * (w / n), y = j * (h / n);
        g.fillStyle = "#e7b445";
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w / n / 2, y + h / n / 2); g.lineTo(x, y + h / n); g.lineTo(x - w / n / 2, y + h / n / 2); g.closePath(); g.fill();
        g.fillStyle = "#7a4e17"; g.beginPath(); g.arc(x, y + h / n / 2, 2.5, 0, Math.PI * 2); g.fill();
      }
    }),
  });
  const cap = mat({ side: T.DoubleSide, map: fleshTexture("#b07a22", 9, "#ffe066", (g, w, h) => {
    g.fillStyle = "#fff3b0";
    g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.1, h * 0.42, 0, 0, Math.PI * 2); g.fill();
  }) });
  const leafMat = mat({ color: 0x3e8a3a, side: T.DoubleSide });
  const extras = () => {
    const crown = new T.Group();
    for (let i = 0; i < 9; i++) {
      const l = new T.Mesh(new T.ConeGeometry(0.07, 0.75 - (i % 3) * 0.12, 3), leafMat);
      const a = (i / 9) * Math.PI * 2;
      l.position.set(Math.sin(a) * 0.06, 0.35, Math.cos(a) * 0.06);
      l.rotation.set(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45);
      crown.add(l);
    }
    crown.position.y = 0.9;
    return [crown];
  };
  return latheFruit({ profile, skin, cap, extras });
}

function banana() {
  // Thân cong theo đường cong, hai nửa là hai đoạn của đường cong, đầu cắt phủ ruột kem.
  const curve = new T.CatmullRomCurve3([
    new T.Vector3(-1.05, 0.25, 0), new T.Vector3(-0.55, -0.12, 0), new T.Vector3(0, -0.25, 0),
    new T.Vector3(0.55, -0.12, 0), new T.Vector3(1.05, 0.25, 0),
  ]);
  const skin = mat({ color: 0xf5d33b, roughness: 0.5 });
  const tipMat = mat({ color: 0x4a3a1c });
  const fleshMat = mat({ color: 0xfbf3cf, side: T.DoubleSide });
  const piece = (t0, t1, capAt) => {
    const g = new T.Group();
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push(curve.getPoint(t0 + ((t1 - t0) * i) / 16));
    g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 20, 0.24, 7), skin));
    for (const t of [t0, t1]) {
      const p = curve.getPoint(t), tan = curve.getTangent(t);
      const isCut = capAt !== null && Math.abs(t - capAt) < 1e-6;
      const m = isCut ? new T.Mesh(new T.CircleGeometry(0.24, 12), fleshMat) : new T.Mesh(new T.SphereGeometry(0.1, 8, 6), tipMat);
      m.position.copy(p);
      if (isCut) m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), tan);
      g.add(m);
    }
    return g;
  };
  return {
    full: () => piece(0, 1, null),
    // Nửa A nằm phía x ≥ 0 như các quả tròn.
    halves: () => [piece(0.5, 1, 0.5), piece(0, 0.5, 0.5)],
  };
}

function bomb() {
  const body = mat({ color: 0x1d1f24, roughness: 0.3, metalness: 0.4 });
  const fuseMat = mat({ color: 0xc9a46b });
  const sparkMat = new T.MeshBasicMaterial({ color: 0xffd34d });
  const full = () => {
    const g = new T.Group();
    g.add(new T.Mesh(new T.SphereGeometry(0.72, 24, 16), body));
    const cap = new T.Mesh(new T.CylinderGeometry(0.2, 0.24, 0.16, 12), mat({ color: 0x3a3d44, metalness: 0.6, roughness: 0.3 }));
    cap.position.y = 0.72; g.add(cap);
    const fuse = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0, 0.78, 0), new T.Vector3(0.1, 1.0, 0), new T.Vector3(0.28, 1.08, 0)]), 8, 0.04, 5), fuseMat);
    g.add(fuse);
    const spark = new T.Mesh(new T.IcosahedronGeometry(0.11, 0), sparkMat);
    spark.position.set(0.3, 1.1, 0); spark.name = "spark"; g.add(spark);
    return g;
  };
  return { full, halves: () => [], isBomb: true };
}

/** Các loại quả: tên hiển thị, màu nước quả, bán kính để chém trúng, điểm. */
const TYPES = {
  watermelon: { name: "Dưa hấu", juice: 0xe8384f, radius: 1.15, points: 3, make: watermelon },
  orange: { name: "Cam", juice: 0xffa32b, radius: 0.72, points: 1, make: orange },
  apple: { name: "Táo", juice: 0xfbf0c9, radius: 0.75, points: 1, make: apple },
  banana: { name: "Chuối", juice: 0xfbf3cf, radius: 0.9, points: 1, make: banana },
  mango: { name: "Xoài", juice: 0xffb627, radius: 0.85, points: 2, make: mango },
  dragon: { name: "Thanh long", juice: 0xe0367f, radius: 0.95, points: 2, make: dragonFruit },
  pineapple: { name: "Dứa", juice: 0xffe066, radius: 1.0, points: 2, make: pineapple },
  bomb: { name: "Bom", juice: 0x333333, radius: 0.75, points: 0, make: bomb },
};

// Dựng mỗi loại một lần (texture và material dùng chung), quả mới chỉ là bản dựng lại các mesh.
const built = {};
function kind(type) {
  if (!built[type]) built[type] = TYPES[type].make();
  return built[type];
}

window.Fruits = {
  TYPES,
  FRUIT_TYPES: Object.keys(TYPES).filter((t) => t !== "bomb"),
  /** Quả nguyên, tâm ở gốc toạ độ. */
  whole: (type) => kind(type).full(),
  /** Hai nửa, mặt cắt là mặt phẳng x = 0 (chuối: cắt ngang thân, cũng tại x = 0). Bom không có. */
  halves: (type) => kind(type).halves(),
  isBomb: (type) => !!kind(type).isBomb,
};
})();
