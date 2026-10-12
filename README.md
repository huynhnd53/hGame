# Vgang Online

Game web 3D lái xe máy dạo phố về đêm, nhìn từ góc người lái. Thong thả chạy quanh khu phố, không điểm số, không thời gian.

Bản chơi: https://huynhnd53.github.io/vgang-online/

## Cách chơi

- Khi vào game, chọn một trong 6 đầu xe (tay ga đỏ, tay ga xanh kim cam, tay ga trắng LCD, tay ga đen LCD xanh,
  côn tay đen, xe số mặt trắng); tất cả dùng chung mặt đồng hồ kim của tay ga đỏ. Đổi xe bằng nút *Đổi xe*.
- Không giới hạn tốc độ: giữ ga là xe tiếp tục tăng tốc (đồng hồ chia tới 200 km/h).
- Khu phố 10×10 ô (khoảng 600 m mỗi chiều) với hồ, công viên, quảng trường; có xe máy, ô tô chạy theo làn,
  rẽ ở ngã tư, dừng khi bị chắn, và người đi bộ trên vỉa hè. Đâm vào xe hay người đều bị chặn lại.
- Phố có hơi thở đời thường: quán vỉa hè ghế nhựa, xe đẩy, quầy hàng, kệ snack, xe máy đỗ trước nhà, chậu cây,
  cây xanh, cột điện với dây điện vắt ngang đường, cục nóng điều hòa, cờ đỏ sao vàng, biển vẫy (CÀ PHÊ, TRÀ ĐÁ…)
  và bồn nước inox trên mái. Người đi bộ là ảnh người thật, quay mặt theo hướng đi.
- Nhà phố dùng ảnh thật cho cửa sắt kéo, cửa gỗ, cửa sổ khung trắng; mái hiên sọc xanh-trắng, tôn xanh, sọc
  đỏ-trắng; công viên và hồ có hàng rào; ghế đá xanh rêu; nắp cống dọc mép đường; hộp công tơ điện trên tường.
  Xe máy NPC dán ảnh xe và người lái ở hai bên hông, nhìn ngang như xe thật.
- Có thể phi lên vỉa hè (xe nảy nhẹ khi qua bó vỉa); cột đèn, bồn cây, ghế đá, cọc giao thông và mặt tiền nhà vẫn chặn xe.
- Mỗi xe có tiếng bô riêng: tay ga êm hoặc trầm, tay ga thể thao khàn, côn tay có sang số và nổ pô khi nhả ga,
  xe số "tạch tạch". Bấm vào xe ở màn chọn xe để nghe thử.
- Hai góc nhìn: từ tay lái (ảnh đầu xe) hoặc từ sau xe (góc nhìn thứ 3, thấy cả người lái và xe đúng màu xe đã
  chọn, xe nghiêng khi cua, có đèn pha, đèn phanh, xi nhan). Đổi bằng nút "Nhìn" hoặc phím V.
- Bốc đầu: khi chạy chậm, giữ Shift (hoặc B, hay nút "Bốc") và vít ga để nhấc đầu xe, rồi giữ thăng bằng
  bằng ga và phanh sau. Mô phỏng như con lắc quanh bánh sau: ga đẩy đầu xe lên, trọng lực kéo xuống, quá điểm
  cân bằng là lật xe (chết máy, phải đề lại). Côn tay dễ bốc nhất, tay ga khó nhất; quãng bốc đầu dài nhất được lưu.
- **Máy tính:** W/↑ ga, S/↓/Space phanh, A D hoặc ← → lái, K nổ máy, H còi (giữ để bóp dài), Q E xi nhan,
  L đèn pha, M tắt tiếng, V đổi góc nhìn. Kéo chuột để quay đầu nhìn quanh.
- **Điện thoại:** kéo nửa trái màn hình như cần điều khiển: đẩy lên là ga, kéo xuống là phanh, sang hai bên là lái.
  Vuốt nửa phải để nhìn. Các nút Còi, xi nhan, Đèn, Đề ở góc phải. Nên xoay ngang.
- Có thể bấm thẳng vào công tắc trên ảnh tay lái: đèn, còi, xi nhan, nút đề ⚡.
- Xi nhan tự tắt sau khi rẽ xong. Đứng yên giữ phanh để dắt lùi xe.

Quãng đường (đồng hồ km), vị trí, đèn và âm thanh được lưu trong `localStorage` của từng trình duyệt.

## Phát triển

```bash
npm install
npm run dev      # chạy thử tại http://localhost:5173
npm test         # kiểm thử vật lý xe và bố cục khu phố
npm run build    # build ra thư mục dist/
```

Cấu trúc:

- `src/sim/wheelie.ts` — vật lý bốc đầu (góc nâng, điểm cân bằng, lật xe).
- `src/sim/traffic.ts` — NPC: xe chạy theo làn bên phải, rẽ ở ngã tư, giữ khoảng cách và dừng trước người chơi; người đi bộ vòng quanh vỉa hè.
- `src/world/night/npcs.ts` — vẽ xe NPC bằng các khối hộp (instancing), có đèn pha, đèn hậu; người đi bộ là ảnh cắt.
- `src/world/night/streetLife.ts` — đặt đồ vật đời thường trước từng căn nhà, cây, cột điện, đồ gắn tường và mái.
- `src/world/night/rider.ts` — xe và người lái của mình cho góc nhìn thứ 3 (khối hộp, màu theo xe).
- `src/sim/` — logic thuần: vật lý xe máy, bố cục khu phố (sinh ngẫu nhiên có seed cố định, gồm loại tầng trệt,
  cửa sổ từng tầng, mái hiên, biển hiệu). Có test trong `tests/`.
- `src/world/night/` — phố đêm, giữ đơn giản để chạy mượt:
  - `facade.ts`, `surfaces.ts` — texture tự sinh cho mặt tiền nhà, nhựa đường, gạch vỉa hè, bó vỉa, mái hiên.
  - `houses.ts` — nhà ống theo tầng và gian, ban công, mái hiên, biển hiệu, cửa sổ sáng đèn.
  - `bake.ts` — ánh đèn đường được tính sẵn một lần khi tải vào màu đỉnh, nên lúc chạy không cần tính ánh sáng.
  - `billboards.ts` — vẽ ảnh asset (cột đèn, đèn giao thông, ghế, bồn cây, cọc) thành tấm luôn quay về
    phía người lái, mỗi loại một lần vẽ.
  - `simpleCity.ts` — ghép tất cả: đường, vỉa hè, vạch sơn, nhà, đồ đường phố, hồ, công viên, đèn pha xe.
- `src/cockpit/bikes.ts` — cấu hình từng đầu xe: ảnh, khung đồng hồ (`gauge`, `gaugeClip`: `'ellipse'`, `'rect'` hoặc
  đa giác), cỡ chữ (`textScale`), độ cao (`offsetY`, để đầu xe ngang mức tay ga đỏ), điểm xoay, vị trí công tắc. `src/cockpit/classicGauge.ts` — mặt đồng hồ kim.
- `src/cockpit/` — lớp tay lái: ảnh `public/assets/handlebar.webp` (được làm tối theo ánh đèn quanh xe),
  đồng hồ tốc độ vẽ đè lên mặt kính, vùng bấm công tắc.
- `src/audio/` — âm thanh tổng hợp bằng Web Audio (máy nổ, còi, xi nhan, va chạm), không cần file âm thanh.
  - `exhaust.ts` — tiếng bô từng xe: mỗi kỳ nổ là một xung vang theo cộng hưởng ống xả, vòng tua và số
    tính từ ga và tốc độ (tay ga giữ vòng tua, xe số/côn tay sang số).
- `src/input/`, `src/ui/` — điều khiển bàn phím/chuột/cảm ứng và bản đồ nhỏ.

Game tự giảm độ phân giải khi khung hình tụt.

### Thay asset

- Ảnh tay lái: `public/assets/handlebar.webp` (1672×940, nền trong suốt). Nếu đổi ảnh khác kích thước,
  sửa các hằng số `IMG_W`, `IMG_H`, `BAR_TOP`, `GAUGE` và `HOTSPOTS` trong `src/cockpit/cockpit.ts`.
- Đồ đường phố: `public/assets/lamp.png`, `traffic-light.png`, `bench.png`, `planter.png`, `cone.png` (PNG nền
  trong suốt, đã cắt sát vật). Kích thước ngoài đời và điểm chạm đất của từng ảnh nằm ở đầu
  `src/world/night/simpleCity.ts` (`LAMP`, `TRAFFIC`, `BENCH`, `PLANTER`, `CONE`).
- Đồ đời thường và người đi bộ: `public/assets/props/*.webp`, đã cắt sát vật, thu nhỏ (cạnh dài 512 px, cây/cột
  768 px) và nén WebP từ bộ ảnh gốc trong `asset-src/moi/`. Chiều cao ngoài đời của từng món nằm trong `PROPS`
  (`streetLife.ts`) và `WALKERS` (`npcs.ts`).
- `asset-src/` là ảnh gốc để làm việc, không được đăng lên GitHub Pages (chỉ thư mục `public/` được đăng).

## Phát hành

Workflow `.github/workflows/deploy.yml` tự build và đăng lên GitHub Pages mỗi khi có commit vào `main`
(Settings → Pages → Source: GitHub Actions).
