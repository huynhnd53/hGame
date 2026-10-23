# Tilt Pad – xoay điện thoại, khối 3D trên máy tính xoay theo

Máy tính mở trang chính (`index.html`): hiện một khối 3D (hình điện thoại, mỗi mặt một màu) kèm mã phòng + QR.
Điện thoại mở `pad.html`, nhập mã (hoặc quét QR). Từ đó, cầm điện thoại xoay thế nào, khối trên máy tính xoay y hệt.

## Chạy

Không cần server riêng: máy tính và điện thoại nối thẳng với nhau bằng WebRTC, không thông thì đi qua máy chủ MQTT
công cộng, nên app là các trang tĩnh trong `public/`, đặt ở host tĩnh nào cũng chạy.

- **Trên mạng:** https://huynhnd53.github.io/hGame/tiltpad/ (GitHub Pages, có sẵn HTTPS nên iPhone dùng được).
- **Trên máy:**

  ```bash
  npm install
  npm start          # http://localhost:3000 (máy tính), http://<IP máy tính>:3000/pad.html (điện thoại)
  ```

  iOS chỉ cấp `DeviceOrientationEvent` cho trang HTTPS và chỉ sau khi người dùng chạm nút (`requestPermission()`),
  nên muốn thử iPhone với bản chạy trên máy thì mở qua `ngrok http 3000` (hoặc `npx localtunnel --port 3000`).

## Game: Chém hoa quả (`fruit.html`)

https://huynhnd53.github.io/hGame/tiltpad/fruit.html

- Máy tính mở `fruit.html`, điện thoại quét QR (trang điện thoại tự thành "Thanh kiếm", nút "CĂN GIỮA").
- Cầm điện thoại như điều khiển TV: mặt màn hình ngửa lên, đầu máy chĩa vào màn hình máy tính, bấm CĂN GIỮA.
  Đầu máy chĩa tới đâu, lưỡi kiếm trên màn hình tới đó (±28° là từ giữa tới mép); vung nhanh qua quả để chém.
- Quả bay lên theo đợt, càng nhiều điểm càng nhiều quả và bom. Bỏ lỡ 3 quả hoặc chém trúng bom là thua.
  Chém từ 3 quả trong một lần vung được thưởng combo. Kỷ lục lưu trong trình duyệt.
- Chém trúng thì điện thoại rung (Android; iPhone không cho trang web rung).
- **Xem các loại quả**: bày 7 loại quả (dưa hấu, cam, táo, chuối, xoài, thanh long, dứa) và bom để chém thử, quả mọc
  lại sau khi chém. Mở thẳng bằng `fruit.html?gallery`.
- Không có điện thoại thì lia chuột qua quả là chém.

Quả dựng bằng three.js trong `public/fruits.js` (không cần file mô hình): quả tròn là khối tiện quanh trục, hai nửa
có mặt cắt vẽ ruột trên canvas; chuối là ống cong. Thêm quả mới: thêm một hàm dựng và một dòng trong `TYPES`.
Phần game nằm trong `public/fruit.js`.

## Game: Pickleball (`pickleball.html`)

https://huynhnd53.github.io/hGame/tiltpad/pickleball.html

- Đánh đơn với máy trên sân pickleball thật (6,1 × 13,4 m, vùng cấm 2,13 m, lưới 0,86–0,91 m), camera sau lưng nhân vật.
- Nhân vật tự chạy tới chỗ bóng (giống Wii Tennis); người chơi chỉ vung. Vòng vàng trên sân là chỗ bóng sắp nảy,
  vòng đỏ là bóng sẽ ra ngoài (nhân vật tự bỏ).
- Điện thoại (`pad.html?game=pickle`): tốc độ xoay của máy quyết định kiểu đánh: dưới ~520°/s bỏ nhỏ, ~520–820°/s
  đánh thường, ~820–1100°/s đánh mạnh, trên ~1100°/s đập (bóng cao). Hất đầu máy lên là lốp. Điện thoại gửi kèm giờ
  của nó (`ts`) để tốc độ vung không bị lệch vì mạng.
- Vung đúng lúc (khoảng 0,05 s trước khi bóng tới vợt) thì cú đánh chắc; vung sớm bóng sang trái, muộn sang phải, càng
  lệch càng dễ hỏng.
- Bàn phím/chuột: `Space` hoặc bấm chuột là đánh, `Z` bỏ nhỏ, `X` lốp, `C` đập; vị trí chuột trái/phải để nhắm.
- Luật: giao chéo, bóng giao phải qua vùng cấm; hai cú đầu sau giao phải để bóng nảy; không vô-lê trong vùng cấm;
  chạm lưới, ra ngoài hoặc để bóng nảy hai lần là mất điểm. Tính điểm kiểu rally (pha nào cũng có điểm, người thắng
  pha giao tiếp), tới 11 hơn 2 điểm. Máy có ba mức: Dễ, Vừa, Khó.
- `pickleball.html?demo`: máy đấu máy để xem.

Vật lý chạy bước cố định 1/120 s (trọng lực, nảy mất ~38% vận tốc đứng). Cả người và máy dùng chung một hàm mô phỏng
trước đường bóng để tìm điểm đỡ nên dự đoán khớp tuyệt đối. Phần game nằm trong `public/pickleball.js`.

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

### Đường dự phòng: máy chủ trung gian MQTT

WebRTC hay không thông khi điện thoại dùng 4G/5G, khi wifi công ty/quán chặn, khi máy chủ chuyển tiếp TURN miễn phí
của PeerJS quá tải, hoặc khi quét QR bằng Zalo/Facebook (mở trong trình duyệt riêng của app). Nên máy tính mở phòng
trên cả hai đường cùng lúc:

- **Trực tiếp (WebRTC qua PeerJS):** như trên, ưu tiên dùng. Thêm STUN của Google và Cloudflare để dễ xuyên NAT.
- **Trung gian (MQTT qua WebSocket):** máy tính nghe chủ đề `hgame/tiltpad/v1/<MÃ>/up` trên `broker.emqx.io` và
  `broker.hivemq.com` (miễn phí, không cần khoá), trả lời trên `…/<MÃ>/down`.

Điện thoại:

1. Thử WebRTC, đồng thời "gõ cửa" qua MQTT (`knock`) để biết phòng có tồn tại không.
2. Sau 5 giây WebRTC chưa thông (hoặc báo lỗi, hoặc ICE thất bại): gửi `hello` qua MQTT. Máy tính trả `welcome`,
   từ đó tin đi qua máy chủ trung gian (góc xoay gộp lại ~30 lần/giây, `ping` mỗi 4 giây để máy tính biết điện thoại
   còn đó).
3. PeerJS báo không có mã và không ai trả lời lời gõ cửa trong 4 giây: báo "Không có phòng với mã này".
   Quá 20 giây không nối được đường nào: báo lỗi kèm lý do của từng đường.

Trên điện thoại, dòng trạng thái ghi "trực tiếp" hoặc "qua trung gian"; trên máy tính ghi "(qua máy chủ trung gian)".
Tin qua MQTT công cộng ai biết mã phòng cũng đọc được; ở đây chỉ là góc xoay nên chấp nhận được.

Công thức đổi góc Euler của thiết bị sang quaternion lấy từ `DeviceOrientationControls` của three.js
(Euler thứ tự `YXZ`, nhân thêm -90° quanh X và bù góc xoay màn hình), nên hệ trục của khối trùng
hệ trục điện thoại: X sang phải, Y lên đỉnh máy, Z chĩa ra khỏi màn hình.

## Tin nhắn giữa hai máy

| Hướng            | Tin                         | Ý nghĩa                                   |
|------------------|-----------------------------|-------------------------------------------|
| pad → máy tính   | `{t:"orient", a, b, g, o, ts}` | góc (độ), góc xoay màn hình và giờ trên điện thoại (ms), ~60 lần/giây |
| pad → máy tính   | `{t:"reset"}`               | lấy tư thế hiện tại làm gốc              |
| máy tính → pad   | `{t:"closed"}`              | màn hình máy tính đã đóng                 |
| máy tính → pad   | `{t:"buzz", ms}`            | rung điện thoại (chém trúng, đánh trúng bóng, được điểm) |

Qua đường trung gian, các tin trên được bọc trong `{p: mã điện thoại, k: "msg", m: tin}`; ngoài ra có `knock`/`here`,
`hello`/`welcome`, `ping` và `bye` (điện thoại đóng trang; máy chủ MQTT cũng tự gửi khi điện thoại rớt mạng).

## Kiểm tra kết nối (`check.html`)

https://huynhnd53.github.io/hGame/tiltpad/check.html – mở trên cả máy tính và điện thoại để biết vì sao WebRTC không thông:

1. **Trình duyệt:** có đang mở trong Zalo/Facebook không, HTTPS, có WebRTC và thư viện không.
2. **Máy chủ:** vào được máy chủ ghép cặp PeerJS và các máy chủ trung gian MQTT không, mất bao lâu.
3. **ICE:** địa chỉ nội bộ (host), địa chỉ công khai qua STUN (srflx), NAT có đối xứng không, TURN của PeerJS (UDP và
   TCP) có trả lời không.
4. **Nối hai máy:** máy tính bấm "Mở phòng thử", điện thoại quét QR. Trang cho biết hai máy nối bằng cặp địa chỉ nào
   (cùng mạng nội bộ / xuyên NAT / qua TURN) hoặc ICE chết ở bước nào, và đo độ trễ.

Nút "Sao chép kết quả" chép toàn bộ ra chữ để gửi đi. Trang điện thoại hiện link tới đây khi không nối được.

## Lưu ý

- `alpha` trên iOS là góc tương đối (không phải la bàn), nên khi mới kết nối khối có thể lệch hướng → bấm "Đặt lại gốc".
- Hai máy cùng một mạng wifi thì gần như luôn nối thẳng được; khác mạng thì thường đi qua trung gian (trễ thêm vài
  chục tới vài trăm ms).
- Máy chủ PeerJS và MQTT đều miễn phí, không cam kết. Tham số để thử hoặc dùng máy chủ riêng (mã QR tự mang theo):
  - `?peer=<host>:9000`: máy chủ PeerJS riêng (`npx peerjs --port 9000`).
  - `?relay=wss://<host>/mqtt`: máy chủ MQTT riêng (ví dụ Mosquitto có bật WebSocket).
  - `?via=p2p` hoặc `?via=relay`: chỉ dùng một đường, để biết đường nào hỏng.
- Muốn khối khác (lập phương, mô hình GLTF…): chỉ cần thay `body` trong `public/index.html`, phần quaternion giữ nguyên.
- `render.yaml` vẫn dùng được nếu muốn chạy `npm start` trên Render, nhưng không cần nữa vì app chạy được trên GitHub Pages.
