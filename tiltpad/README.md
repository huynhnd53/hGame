# Tilt Pad – xoay điện thoại, khối 3D trên máy tính xoay theo

Máy tính mở trang chính (`index.html`): hiện một khối 3D (hình điện thoại, mỗi mặt một màu) kèm mã phòng + QR.
Điện thoại mở `pad.html`, nhập mã (hoặc quét QR). Từ đó, cầm điện thoại xoay thế nào, khối trên máy tính xoay y hệt.

## Chạy

Không cần server riêng: máy tính và điện thoại nối thẳng với nhau bằng WebRTC, nên app là các trang tĩnh trong
`public/`, đặt ở host tĩnh nào cũng chạy.

- **Trên mạng:** https://huynhnd53.github.io/hGame/tiltpad/ (GitHub Pages, có sẵn HTTPS nên iPhone dùng được).
- **Trên máy:**

  ```bash
  npm install
  npm start          # http://localhost:3000 (máy tính), http://<IP máy tính>:3000/pad.html (điện thoại)
  ```

  iOS chỉ cấp `DeviceOrientationEvent` cho trang HTTPS và chỉ sau khi người dùng chạm nút (`requestPermission()`),
  nên muốn thử iPhone với bản chạy trên máy thì mở qua `ngrok http 3000` (hoặc `npx localtunnel --port 3000`).

## Cách hoạt động

```
Điện thoại (pad.html)          Máy chủ PeerJS (0.peerjs.com)       Máy tính (index.html, three.js)
                               chỉ dùng lúc ghép cặp:
peer.connect("hgame-tiltpad-ABCD") ──▶ tìm máy có ID đó ◀── new Peer("hgame-tiltpad-ABCD")

sau đó đi thẳng giữa hai máy (WebRTC DataChannel):
deviceorientation ─ 60/s ─────────────────────────────────────▶  alpha/beta/gamma → quaternion
  {t:"orient", a, b, g, o}                                       trừ đi "gốc" (offset)
nút "Đặt lại gốc" ─ {t:"reset"} ──────────────────────────────▶  offset = raw⁻¹
```

Mã phòng 4 chữ là ID của máy tính trên máy chủ PeerJS (thêm tiền tố `hgame-tiltpad-`); trùng với phòng khác đang mở
thì máy tính tự lấy mã mới. Phần kết nối nằm trong `public/link.js`.

Công thức đổi góc Euler của thiết bị sang quaternion lấy từ `DeviceOrientationControls` của three.js
(Euler thứ tự `YXZ`, nhân thêm -90° quanh X và bù góc xoay màn hình), nên hệ trục của khối trùng
hệ trục điện thoại: X sang phải, Y lên đỉnh máy, Z chĩa ra khỏi màn hình.

## Tin nhắn giữa hai máy

| Hướng            | Tin                         | Ý nghĩa                                   |
|------------------|-----------------------------|-------------------------------------------|
| pad → máy tính   | `{t:"orient", a, b, g, o}`  | góc (độ) và góc xoay màn hình, ~60 lần/giây |
| pad → máy tính   | `{t:"reset"}`               | lấy tư thế hiện tại làm gốc              |
| máy tính → pad   | `{t:"closed"}`              | màn hình máy tính đã đóng                 |

Số điện thoại đang nối và việc nhập sai mã ("Không có phòng với mã này.") do PeerJS báo, không cần tin riêng.

## Lưu ý

- `alpha` trên iOS là góc tương đối (không phải la bàn), nên khi mới kết nối khối có thể lệch hướng → bấm "Đặt lại gốc".
- Hai máy cùng một mạng wifi thì gần như luôn nối được. Một số mạng di động hay wifi công ty chặn kết nối thẳng giữa
  hai máy; khi đó cần máy chuyển tiếp (TURN), app hiện chưa có.
- Máy chủ ghép cặp PeerJS miễn phí, không cam kết. Muốn tự chạy: `npx peerjs --port 9000`, rồi mở trang với
  `?peer=<host>:9000` (mã QR tự mang theo tham số này).
- Muốn khối khác (lập phương, mô hình GLTF…): chỉ cần thay `body` trong `public/index.html`, phần quaternion giữ nguyên.
- `render.yaml` vẫn dùng được nếu muốn chạy `npm start` trên Render, nhưng không cần nữa vì app chạy được trên GitHub Pages.
