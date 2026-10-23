// link.js – nối máy tính ↔ điện thoại thẳng với nhau bằng WebRTC (PeerJS), không cần server riêng.
// Máy chủ PeerJS miễn phí (0.peerjs.com) chỉ dùng lúc ghép cặp; sau đó góc xoay đi thẳng giữa hai máy.
(() => {
"use strict";

const PREFIX = "hgame-tiltpad-";               // tránh trùng ID với app khác trên máy chủ PeerJS chung
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const JOIN_TIMEOUT_MS = 12000;

// ?peer=host:port để dùng máy chủ PeerJS riêng (thử trên máy, hoặc khi máy chủ chung trục trặc).
function peerOptions() {
  const p = new URLSearchParams(location.search).get("peer");
  if (!p) return { debug: 1 };
  const [host, port] = p.split(":");
  return { host, port: Number(port) || 9000, path: "/", secure: location.protocol === "https:", debug: 1 };
}

function newCode() {
  return Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
}

/** Máy tính: mở một phòng, nhận góc xoay từ các điện thoại nối vào. */
function hostScreen({ onCode, onPads, onMessage, onError }) {
  const pads = new Set();
  let peer = null;

  const start = (tries) => {
    const code = newCode();
    peer = new Peer(PREFIX + code, peerOptions());
    peer.on("open", () => onCode(code));
    peer.on("connection", (conn) => {
      conn.on("open", () => { pads.add(conn); onPads(pads.size); });
      conn.on("data", (msg) => onMessage(msg));
      const gone = () => { if (pads.delete(conn)) onPads(pads.size); };
      conn.on("close", gone);
      conn.on("error", gone);
    });
    peer.on("error", (err) => {
      // Mã trùng với phòng đang mở ở nơi khác: lấy mã khác.
      if (err.type === "unavailable-id" && tries < 5) { peer.destroy(); start(tries + 1); return; }
      onError(err);
    });
    // Mất kết nối tới máy chủ ghép cặp: các điện thoại đã nối vẫn chạy, nối lại để giữ mã cho máy mới.
    peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
  };
  start(0);

  addEventListener("pagehide", () => {
    for (const conn of pads) { try { conn.send({ t: "closed" }); } catch {} }
    if (peer) peer.destroy();
  });
}

/** Điện thoại: nối vào phòng có mã `code`. Trả về hàm gửi tin. */
function joinPad(code, { onOpen, onClosed, onError }) {
  const peer = new Peer(peerOptions());
  let conn = null;
  let opened = false;
  const fail = (text) => { if (opened) return; clearTimeout(timer); peer.destroy(); onError(text); };
  const timer = setTimeout(
    () => fail("Không nối được tới máy tính. Thử cho hai máy dùng chung một mạng wifi."),
    JOIN_TIMEOUT_MS,
  );

  peer.on("open", () => {
    conn = peer.connect(PREFIX + code, { serialization: "json" });
    conn.on("open", () => { opened = true; clearTimeout(timer); onOpen(); });
    conn.on("data", (msg) => { if (msg && msg.t === "closed") onClosed(); });
    conn.on("close", () => { if (opened) onClosed(); });
  });
  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") fail("Không có phòng với mã này.");
    else if (!opened) fail("Lỗi kết nối: " + (err.type || err.message));
  });

  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
  };
}

window.TiltLink = { hostScreen, joinPad };
})();
