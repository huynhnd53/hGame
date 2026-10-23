// link.js – nối máy tính ↔ điện thoại.
// Cách 1 (ưu tiên): WebRTC qua PeerJS, góc xoay đi thẳng giữa hai máy. Máy chủ PeerJS miễn phí (0.peerjs.com)
//   chỉ dùng lúc ghép cặp.
// Cách 2 (dự phòng): khi WebRTC không thông (điện thoại dùng 4G, wifi chặn, trình duyệt trong Zalo/Facebook…),
//   hai máy gửi tin qua máy chủ MQTT công cộng (WebSocket). Chậm hơn chút nhưng gần như mạng nào cũng qua được.
// Tham số URL để thử: ?peer=host:port (máy chủ PeerJS riêng), ?relay=ws://host:port (máy chủ MQTT riêng),
//   ?via=p2p | ?via=relay (chỉ dùng một cách).
(() => {
"use strict";

const PREFIX = "hgame-tiltpad-";
// Các trang dùng chung một phòng: chuyển game thì máy tính giữ mã cũ (?room=), điện thoại tự nối lại.
const GAMES = { hub: "index.html", fruit: "fruit.html", pickle: "pickleball.html", cube: "cube.html" };
const ROOM_KEY = "tiltpad.room";               // tránh trùng ID với app khác trên máy chủ PeerJS chung
const TOPIC = "hgame/tiltpad/v1/";             // gốc chủ đề MQTT, mỗi phòng một nhánh
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const RELAYS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
// Nhiều STUN để tìm đường xuyên NAT; TURN của PeerJS chuyển tiếp khi không xuyên được.
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
];
const P2P_GRACE_MS = 5000;     // điện thoại chờ WebRTC chừng này rồi thử đường trung gian
const WELCOME_MS = 4000;       // gõ cửa qua trung gian mà chừng này chưa thấy máy tính trả lời: coi như không có phòng
const JOIN_TIMEOUT_MS = 20000;
const HOST_GRACE_MS = 2500;    // máy tính đợi PeerJS chừng này trước khi hiện mã chỉ có đường trung gian
const RELAY_SEND_MS = 33;      // qua trung gian gửi góc xoay ~30 lần/giây
const PING_MS = 4000;
const PAD_SILENT_MS = 13000;

const params = new URLSearchParams(location.search);
const via = params.get("via");
const useP2P = via !== "relay" && typeof Peer === "function";
const useRelay = via !== "p2p" && typeof mqtt === "object" && typeof mqtt.connect === "function";

function peerOptions() {
  const opts = { debug: 1, config: { iceServers: ICE_SERVERS } };
  const p = params.get("peer");
  if (!p) return opts;
  const [host, port] = p.split(":");
  return { ...opts, host, port: Number(port) || 9000, path: "/", secure: location.protocol === "https:" };
}

const randomId = () => Math.random().toString(36).slice(2, 10);

function newCode() {
  return Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
}

/** Mở kết nối MQTT tới mọi máy chủ trung gian; `onMessage(client, obj)` nhận tin đã giải JSON. */
function relayClients(subTopic, will, { onConnect = () => {}, onMessage }) {
  return relayUrls().map((url) => {
    const c = mqtt.connect(url, {
      clientId: "hgtp-" + randomId(), clean: true, keepalive: 20, connectTimeout: 8000, reconnectPeriod: 3000,
      protocolVersion: 4, will: { topic: will.topic, payload: JSON.stringify(will.msg), qos: 0, retain: false },
    });
    c.on("connect", () => { c.subscribe(subTopic); onConnect(c); });
    c.on("message", (_topic, payload) => {
      let obj; try { obj = JSON.parse(payload.toString()); } catch { return; }
      if (obj && typeof obj === "object") onMessage(c, obj);
    });
    c.on("error", (err) => console.warn("[link] trung gian", url, err && err.message));
    return c;
  });
}
const publish = (c, topic, obj) => { if (c.connected) c.publish(topic, JSON.stringify(obj)); };

/** Đọc/ghi sessionStorage an toàn (chế độ riêng tư có thể chặn). */
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};

/**
 * Máy tính: mở một phòng, nhận góc xoay từ các điện thoại nối vào. `game` là tên trang (xem GAMES), được báo cho
 * điện thoại để nó đổi chữ hướng dẫn. Điện thoại gửi {t:"pick", game} thì máy tính chuyển sang game đó.
 */
function hostScreen({ game = "cube", onCode, onPads, onMessage: onAppMessage, onError }) {
  const direct = new Set();     // DataConnection WebRTC
  const relayed = new Map();    // mã điện thoại → { c: máy chủ MQTT đang dùng, seen }
  let code = null, shown = false, peer = null, clients = [], peerErr = null;
  let graceTimer = 0, lastCount = 0;
  // Giữ mã phòng của trang trước (cùng tab) để điện thoại nối lại được.
  const keep = [params.get("room"), store.get(ROOM_KEY)].find((c) => /^[A-Z]{4}$/.test(c || "")) || null;

  const count = () => {
    const n = direct.size + relayed.size;
    if (n > lastCount) broadcast({ t: "game", game });        // điện thoại mới vào: báo đang ở game nào
    lastCount = n;
    onPads(n, { direct: direct.size, relay: relayed.size });
  };
  const show = () => {
    if (shown) return;
    shown = true; clearTimeout(graceTimer);
    store.set(ROOM_KEY, code);
    onCode(code);
  };
  const onMessage = (msg) => {
    if (msg && msg.t === "pick" && GAMES[msg.game]) { goTo(msg.game); return; }
    onAppMessage(msg);
  };
  const up = () => TOPIC + code + "/up";
  const down = () => TOPIC + code + "/down";

  const startPeer = (tries) => {
    peer = new Peer(PREFIX + code, peerOptions());
    peer.on("open", show);
    peer.on("connection", (conn) => {
      conn.on("open", () => { direct.add(conn); count(); });
      conn.on("data", (msg) => onMessage(msg));
      const gone = () => { if (direct.delete(conn)) count(); };
      conn.on("close", gone);
      conn.on("error", gone);
    });
    peer.on("error", (err) => {
      console.warn("[link] PeerJS:", err.type, err.message);
      // Mã còn bị trang trước giữ (vừa chuyển game): chờ chút rồi thử lại. Trùng với phòng nơi khác: lấy mã khác.
      if (err.type === "unavailable-id" && !shown && tries < 8) {
        stopAll();
        if (keep && tries < 5) setTimeout(() => start(tries + 1), 700); else start(tries + 1);
        return;
      }
      if (err.type === "peer-unavailable") return;   // không xảy ra ở phía máy tính, phòng xa
      if (peer && !peer.open) {
        peerErr = err;
        if (!useRelay && !shown) onError(err);
        else if (clients.some((c) => c.connected)) show();
      }
    });
    // Mất kết nối tới máy chủ ghép cặp: các điện thoại đã nối vẫn chạy, nối lại để giữ mã cho máy mới.
    peer.on("disconnected", () => setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1000));
  };

  const startRelay = () => {
    clients = relayClients(up(), { topic: down(), msg: { k: "msg", m: { t: "closed" } } }, {
      onConnect() {
        // PeerJS lỗi hoặc chậm: vẫn hiện mã, điện thoại sẽ vào bằng đường trung gian.
        if (!useP2P || peerErr) show();
        else if (!shown && !graceTimer) graceTimer = setTimeout(show, HOST_GRACE_MS);
      },
      onMessage(c, { p, k, m }) {
        if (typeof p !== "string") return;
        const pad = relayed.get(p);
        if (k === "knock") { publish(c, down(), { k: "here", to: p }); return; }
        if (k === "hello") {
          if (pad && pad.c !== c) return;            // điện thoại đã chọn máy chủ khác
          if (!pad) { relayed.set(p, { c, seen: Date.now() }); count(); }
          publish(c, down(), { k: "welcome", to: p });
          return;
        }
        if (!pad || pad.c !== c) return;
        pad.seen = Date.now();
        if (k === "msg" && m) onMessage(m);
        else if (k === "bye") { relayed.delete(p); count(); }
      },
    });
  };

  const stopAll = () => {
    clearTimeout(graceTimer); graceTimer = 0;
    if (peer) { peer.destroy(); peer = null; }
    for (const c of clients) c.end(true);
    clients = [];
  };

  const start = (tries) => {
    code = keep && tries < 5 ? keep : newCode(); peerErr = null;
    if (useP2P) startPeer(tries);
    if (useRelay) startRelay();
    if (!useP2P && !useRelay) onError({ type: "no-transport", message: "Không tải được thư viện kết nối" });
  };
  start(0);
  setTimeout(() => { if (!shown) onError(peerErr || { type: "timeout", message: "Không vào được máy chủ kết nối" }); }, JOIN_TIMEOUT_MS);

  // Điện thoại qua trung gian im lặng quá lâu (tắt màn hình, mất mạng): bỏ khỏi danh sách.
  setInterval(() => {
    const now = Date.now();
    for (const [p, pad] of relayed) if (now - pad.seen > PAD_SILENT_MS) { relayed.delete(p); count(); }
  }, 3000);

  function broadcast(msg) {
    for (const conn of direct) { try { conn.send(msg); } catch {} }
    for (const c of new Set([...relayed.values()].map((pad) => pad.c))) publish(c, down(), { k: "msg", m: msg });
  }
  /** Sang trang game khác, giữ mã phòng; điện thoại được báo trước để tự nối lại. */
  function goTo(next) {
    if (!GAMES[next]) return;
    const u = new URL(GAMES[next], location.href);
    if (code) u.searchParams.set("room", code);
    for (const k of ["peer", "relay", "via", "debug"]) if (params.has(k)) u.searchParams.set(k, params.get(k));
    broadcast({ t: "switch", game: next });
    setTimeout(() => { location.href = u.href; }, 120);
  }
  addEventListener("pagehide", () => { broadcast({ t: "closed" }); stopAll(); });

  return {
    /** Gửi tin tới mọi điện thoại đang nối (ví dụ {t:"buzz", ms} để rung). */
    broadcast,
    goTo,
  };
}

/** Điện thoại: nối vào phòng có mã `code`. onOpen(mode) với mode "p2p" (trực tiếp) hoặc "relay" (trung gian). */
function joinPad(code, { onOpen, onClosed, onError, onMessage = () => {} }) {
  const pid = randomId();
  const up = TOPIC + code + "/up";
  const down = TOPIC + code + "/down";
  let mode = null, ended = false;
  let peer = null, conn = null, p2pErr = null, peerOpened = false;
  let clients = [], bound = null, relayUp = false, helloing = false, roomSeen = false, knockExpired = false;
  let pending = null, flushTimer = 0, pingTimer = 0;
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  const handle = (msg) => {
    if (!msg) return;
    if (msg.t === "closed") onClosed();
    else onMessage(msg);
  };
  const stopP2P = () => { if (peer) { peer.destroy(); peer = null; conn = null; } };
  const stopRelay = (keep) => { for (const c of clients) if (c !== keep) c.end(true); clients = keep ? [keep] : []; };

  const done = (m) => {
    if (mode || ended) return false;
    mode = m; timers.forEach(clearTimeout);
    if (m === "p2p") stopRelay(null);
    else {
      stopP2P();
      pingTimer = setInterval(() => publish(bound, up, { p: pid, k: "ping" }), PING_MS);
    }
    onOpen(m);
    return true;
  };
  const fail = (text) => {
    if (mode || ended) return;
    ended = true; timers.forEach(clearTimeout); stopP2P(); stopRelay(null);
    onError(text);
  };
  const failSlow = () => {
    const parts = [];
    if (useP2P) parts.push("trực tiếp: " + (p2pErr ? p2pErr.type || p2pErr.message : "quá giờ"));
    if (useRelay) parts.push("trung gian: " + (relayUp ? "máy tính không trả lời" : "không vào được"));
    if (!useP2P && !useRelay) parts.push("không tải được thư viện kết nối");
    fail("Không nối được tới máy tính (" + parts.join(", ") + "). Thử tải lại cả hai trang, hoặc cho hai máy dùng chung một mạng wifi.");
  };
  // Sai mã: máy chủ PeerJS báo không có mã này (hoặc không vào được nó) VÀ không máy tính nào trả lời
  // lời gõ cửa qua trung gian.
  const checkNoRoom = () => {
    if (roomSeen) return;
    const p2pNo = !useP2P || (p2pErr && (p2pErr.type === "peer-unavailable" || !peerOpened));
    const relayNo = !useRelay || knockExpired;
    if (p2pNo && relayNo && (useP2P || useRelay)) fail("Không có phòng với mã này. Kiểm tra lại mã trên màn hình máy tính.");
  };

  // Chuyển sang đường trung gian: chào máy tính trên mọi máy chủ MQTT, máy chủ nào trả lời trước thì dùng.
  const fallback = () => {
    if (mode || ended || helloing || !useRelay) return;
    helloing = true;
    for (const c of clients) publish(c, up, { p: pid, k: "hello" });
  };
  const p2pFailed = (err) => {
    if (mode) return;
    p2pErr = err;
    if (useRelay) fallback();
    if (!useRelay && err.type !== "peer-unavailable") failSlow();
    else checkNoRoom();
  };

  if (useP2P) {
    peer = new Peer(peerOptions());
    peer.on("open", () => {
      if (!peer) return;
      peerOpened = true;
      const c = peer.connect(PREFIX + code, { serialization: "json" });
      conn = c;
      c.on("open", () => { if (!done("p2p")) c.close(); });
      c.on("data", (msg) => { if (mode === "p2p") handle(msg); });
      c.on("close", () => { if (mode === "p2p") onClosed(); });
      // Không xuyên được NAT (thường gặp khi điện thoại dùng 4G): sang trung gian ngay, khỏi chờ.
      c.on("iceStateChanged", (st) => { if (st === "failed") p2pFailed({ type: "ice-failed" }); });
      c.on("error", p2pFailed);
    });
    peer.on("error", (err) => { console.warn("[link] PeerJS:", err.type, err.message); p2pFailed(err); });
  }

  if (useRelay) {
    clients = relayClients(down, { topic: up, msg: { p: pid, k: "bye" } }, {
      onConnect(c) {
        if (mode === "relay" && c !== bound) return;
        // Gõ cửa: máy tính đang mở phòng này sẽ trả lời "here" (chưa tính là đã nối).
        publish(c, up, { p: pid, k: "knock" });
        if (!relayUp) { relayUp = true; later(() => { knockExpired = true; checkNoRoom(); }, WELCOME_MS); }
        if (helloing || mode === "relay") publish(c, up, { p: pid, k: "hello" });
      },
      onMessage(c, { k, to, m }) {
        if (to && to !== pid) return;
        if (k === "here") { roomSeen = true; if (p2pErr) fallback(); return; }
        if (k === "welcome" && !mode) { bound = c; stopRelay(c); done("relay"); return; }
        if (mode === "relay" && c === bound && k === "msg") handle(m);
      },
    });
  }

  later(fallback, useP2P ? P2P_GRACE_MS : 0);
  later(failSlow, JOIN_TIMEOUT_MS);
  if (!useP2P && !useRelay) failSlow();

  addEventListener("pagehide", () => { if (mode === "relay") publish(bound, up, { p: pid, k: "bye" }); });

  const flush = () => { flushTimer = 0; if (pending) { publish(bound, up, { p: pid, k: "msg", m: pending }); pending = null; } };
  return {
    /** Đóng hẳn (trước khi nối lại phòng sau khi máy tính chuyển game). */
    close() {
      ended = true; timers.forEach(clearTimeout); clearInterval(pingTimer); clearTimeout(flushTimer);
      if (mode === "relay") publish(bound, up, { p: pid, k: "bye" });
      mode = null; stopP2P(); stopRelay(null);
    },
    send(msg) {
      if (mode === "p2p") { if (conn && conn.open) conn.send(msg); return; }
      if (mode !== "relay") return;
      if (msg.t === "orient") {                  // gộp góc xoay, gửi bản mới nhất ~30 lần/giây
        pending = msg;
        if (!flushTimer) flushTimer = setTimeout(flush, RELAY_SEND_MS);
        return;
      }
      flush();
      publish(bound, up, { p: pid, k: "msg", m: msg });
    },
  };
}

// check.html dùng chung cấu hình máy chủ để kiểm tra đúng những gì game dùng.
const relayUrls = () => (params.get("relay") ? [params.get("relay")] : RELAYS);
window.TiltLink = { hostScreen, joinPad, peerOptions, ICE_SERVERS, relayUrls, PREFIX, GAMES };
})();
