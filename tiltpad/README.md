# Tilt Pad – xoay điện thoại, khối 3D trên máy tính xoay theo

Máy tính mở `/`: hiện một khối 3D (hình điện thoại, mỗi mặt một màu) kèm mã phòng + QR.
Điện thoại mở `/pad`, nhập mã (hoặc quét QR). Từ đó, cầm điện thoại xoay thế nào, khối trên máy tính xoay y hệt.

## Chạy

```bash
npm install
npm start          # http://localhost:3000
```

## Thử với iPhone thật – bắt buộc HTTPS

iOS chỉ cấp `DeviceOrientationEvent` cho trang HTTPS và chỉ sau khi người dùng chạm nút (`requestPermission()`).

```bash
ngrok http 3000                 # hoặc: npx localtunnel --port 3000
```

Mở link https đó trên cả máy tính lẫn điện thoại. Deploy lên Render (có `render.yaml` sẵn) cũng được HTTPS luôn.

## Cách hoạt động

```
Điện thoại                     Server (Socket.IO)              Máy tính (three.js)
deviceorientation ─ 60/s ──▶  chuyển tiếp "orient" ─volatile─▶  alpha/beta/gamma → quaternion
  {alpha, beta, gamma,                                          trừ đi "gốc" (offset)
   góc xoay màn hình}                                           slerp nhẹ → mesh.quaternion
nút "Đặt lại gốc" ──────────▶  "reset" ───────────────────────▶  offset = raw⁻¹
```

Công thức đổi góc Euler của thiết bị sang quaternion lấy từ `DeviceOrientationControls` của three.js
(Euler thứ tự `YXZ`, nhân thêm -90° quanh X và bù góc xoay màn hình), nên hệ trục của khối trùng
hệ trục điện thoại: X sang phải, Y lên đỉnh máy, Z chĩa ra khỏi màn hình.

## Sự kiện Socket.IO

| Hướng           | Sự kiện         | Dữ liệu                                  |
|-----------------|-----------------|------------------------------------------|
| screen → server | `screen:create` | ack `{code}`                             |
| pad → server    | `pad:join`      | `"ABCD"`, ack `{ok}` / `{error}`          |
| pad → screen    | `orient`        | `{a, b, g, o}` độ, ~60 lần/giây, volatile |
| pad → screen    | `reset`         | lấy tư thế hiện tại làm gốc              |
| server → screen | `pads`          | số điện thoại đang kết nối               |
| server → pad    | `room:closed`   | màn hình đã tắt                          |

## Lưu ý

- `alpha` trên iOS là góc tương đối (không phải la bàn), nên khi mới kết nối khối có thể lệch hướng → bấm "Đặt lại gốc".
- Muốn khối khác (lập phương, mô hình GLTF…): chỉ cần thay `body` trong `public/index.html`, phần quaternion giữ nguyên.
- Độ trễ thấp hơn nữa: dùng Socket.IO làm signaling rồi mở WebRTC DataChannel giữa hai máy.
