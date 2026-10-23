// server.js – chỉ phát các trang trong public/ để chạy thử trên máy (npm start).
// Ghép cặp và góc xoay đi thẳng giữa hai máy bằng WebRTC (public/link.js), nên trên mạng
// app chạy được ở bất kỳ host tĩnh nào, ví dụ GitHub Pages.
const path = require("path");
const express = require("express");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
// Đường dẫn cũ /pad vẫn mở trang điện thoại.
app.get("/pad", (_req, res) => res.sendFile(path.join(__dirname, "public", "pad.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tilt Pad chạy tại http://localhost:${PORT}`));
