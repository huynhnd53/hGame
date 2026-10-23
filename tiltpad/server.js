// server.js – ghép cặp màn hình ↔ điện thoại theo mã phòng, chuyển tiếp góc xoay
const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const http = createServer(app);
const io = new Server(http);

app.use(express.static(path.join(__dirname, "public")));
app.get("/pad", (_req, res) => res.sendFile(path.join(__dirname, "public", "pad.html")));

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const rooms = new Map(); // code -> { screen, pads:Set }

function newCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(""); }
  while (rooms.has(code));
  return code;
}
const num = (v) => (Number.isFinite(+v) ? +v : 0);

io.on("connection", (socket) => {
  socket.on("screen:create", (ack) => {
    const code = newCode();
    rooms.set(code, { screen: socket.id, pads: new Set() });
    socket.data = { role: "screen", code };
    socket.join(code);
    ack({ code });
  });

  socket.on("pad:join", (raw, ack) => {
    const code = String(raw || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ error: "Không có phòng với mã này." });
    room.pads.add(socket.id);
    socket.data = { role: "pad", code };
    socket.join(code);
    io.to(room.screen).emit("pads", room.pads.size);
    ack({ ok: true });
  });

  // Góc xoay thô từ DeviceOrientation: alpha/beta/gamma (độ) + góc xoay màn hình.
  // Tần số cao (~60/s) → volatile, rơi vài gói không sao.
  socket.on("orient", (d) => {
    const { role, code } = socket.data || {};
    if (role !== "pad" || !code) return;
    socket.volatile.to(code).emit("orient", {
      a: num(d?.a), b: num(d?.b), g: num(d?.g), o: num(d?.o), from: socket.id,
    });
  });

  // "Đặt lại" – lấy tư thế hiện tại làm gốc. Phải đến nơi → không volatile.
  socket.on("reset", () => {
    const { role, code } = socket.data || {};
    if (role === "pad" && code) socket.to(code).emit("reset", socket.id);
  });

  socket.on("disconnect", () => {
    const { role, code } = socket.data || {};
    const room = code && rooms.get(code);
    if (!room) return;
    if (role === "screen") { io.to(code).emit("room:closed"); rooms.delete(code); }
    else { room.pads.delete(socket.id); io.to(room.screen).emit("pads", room.pads.size); }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Tilt Pad chạy tại http://localhost:${PORT}`));
