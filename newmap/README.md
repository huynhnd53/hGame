# Dựng khu thật (newmap)

Trang dựng khu (bản chạy: https://huynhnd53.github.io/hGame/newmap/): bản đồ tối bên trái, mô hình
3D bên phải (trên điện thoại: bản đồ trên, 3D dưới). Thanh giữa hai bên kéo được để đổi cỡ, bên kia co giãn theo; bấm
đúp để về mặc định, trình duyệt nhớ cỡ đã chọn. Tìm địa điểm (phím `/`), vẽ khu bằng nút khung (kéo chuột/ngón tay, hoặc giữ Shift và kéo), chấm từng góc,
hoặc lấy ô vuông 500 m giữa màn hình; vẽ xong vẫn kéo được các góc. Bấm **Dựng khu này** (hoặc **Ví dụ Khương Thượng**)
để dựng khu đó thành 3D từ dữ liệu thật.

Kiểu 3D: nhà có lưới cửa sổ, tường màu nhạt; nhà nhỏ mái dốc nhiều màu (mái hai dốc hoặc bốn dốc, theo `roof:shape` nếu
có), nhà lớn mái bằng; đường nhựa có vỉa hè và vạch sơn (vạch giữa đứt, đường rộng có vạch làn), cây xanh (cây có trên
OSM, thêm hàng cây ven đường lớn và cây trong công viên chỗ đất trống). Mặt trời theo giờ và
ngày thật của khu (thanh giờ dưới cảnh, nút ▶ cho thời gian trôi), đổ bóng; tối thì cửa sổ sáng đèn. La bàn góc trên
cho biết hướng nhìn và độ nghiêng (bấm để quay về hướng Bắc); chấm xanh trên bản đồ là chỗ camera đang nhìn.

Đưa camera tới địa điểm: mục **Địa điểm** trên thẻ tên khu liệt kê các nơi có tên trong khu (đình chùa, di tích,
trường học, bệnh viện, chợ, cơ quan, công viên, hồ sông, toà nhà, đường phố), lọc được theo tên (gõ không dấu cũng
được); bấm một nơi thì camera bay tới và hiện nhãn tên. Bấm vào bản đồ bên trái (trong khu đã dựng) hoặc chọn một kết
quả tìm kiếm nằm trong khu cũng đưa camera tới đó. Kéo để
xoay, chuột phải hoặc hai ngón để dời, lăn chuột hoặc chụm ngón để phóng; thanh nút bên phải (và phím ← → ↑ ↓ + − R F,
Space) xoay từng nấc, nghiêng, phóng, tự xoay, về góc đầu, toàn màn hình.

Mỗi lần bấm, trình duyệt gọi thẳng 3 nguồn miễn phí, không qua máy chủ nào của mình:

| Nguồn | Lấy gì | Ở đâu |
| --- | --- | --- |
| OpenStreetMap qua Overpass API | Nhà vẽ tay (số tầng, chiều cao, màu, kiểu mái nếu có), đường, sông, hồ, công viên, đình chùa, di tích, tường rào | `overpass-api.de`; sau 7 s chưa trả lời (hoặc lỗi sớm hơn) thì hỏi thêm `overpass.private.coffee` và `maps.mail.ru`, máy nào trả trước thì dùng |
| Open Buildings (Google + Microsoft, bản gộp của VIDA) | Đường viền nhà dò từ ảnh vệ tinh, kèm độ tin cậy | `data.source.coop`, file GeoParquet chia theo nước và theo ô S2; app chỉ đọc đúng phần byte của khu đã vẽ |
| Nominatim | Tên khu (ví dụ “Khương Thượng, Đống Đa”) và mã nước (để biết đọc file Open Buildings nào) | `nominatim.openstreetmap.org` |

Bản đồ nền là ảnh ô của OpenStreetMap (`tile.openstreetmap.org`) được làm tối bằng CSS; nếu không tải được thì
chuyển sang nền xám tối của Esri. Cả hai không cần API key. Ô tìm địa điểm cũng hỏi Nominatim.

Cách đọc Open Buildings mà không tải cả file vài GB: liệt kê các ô của nước đó, tính ô S2 chứa khu, đọc phần đuôi file
(metadata), bỏ các nhóm hàng có khung bao nằm ngoài khu, đọc cột khung bao của các nhóm còn lại để biết đúng những
hàng trong khu, rồi chỉ đọc hình nhà của các hàng đó (chỉ các trang chứa chúng, nếu file có page index). Mọi lần đọc
đều là yêu cầu `Range`; nếu máy chủ định trả cả file thì app huỷ, và mỗi khu không đọc quá 120 MB.

Cách ghép hai nguồn nhà (`newmap/src/merge.ts`):

- Nhà trong OSM được ưu tiên, luôn giữ.
- Nhà từ Open Buildings bị bỏ nếu độ tin cậy dưới 0,7, trùng chỗ nhà OSM (từ 30% diện tích nằm trên nhà OSM, hoặc
  trùm lên giữa một nhà OSM), nằm trên lòng đường hoặc nằm trên mặt nước (từ 30% diện tích). Đường hầm, cầu, cống
  ngầm không tính là lòng đường/mặt nước. Nhà không có giá trị độ tin cậy thì chỉ xét theo vị trí.
- Nhà không có chiều cao được đoán theo diện tích (nhà ống 3–5 tầng), cố định theo vị trí nên lần nào dựng cũng giống nhau.

Cấu trúc: `overpass.ts` (truy vấn, chọn máy, đọc kết quả), `nominatim.ts`, `openBuildings.ts` + `s2.ts` (đọc
GeoParquet theo byte), `model.ts` (đổi sang mét, chiều cao, bề rộng đường), `merge.ts`, `pipeline.ts` (ghép cả quy
trình), `decor.ts` (cây), `places.ts` (danh sách địa điểm), `split.ts` (thanh kéo đổi cỡ), `sun.ts` (vị trí mặt trời), `scene3d.ts` (three.js), `mapView.ts` (Leaflet, vẽ khu),
`main.ts`. Nút *Tải dữ liệu khu (JSON)* xuất toàn bộ
khu (toạ độ mét, x hướng đông, z hướng nam) để dùng tiếp, ví dụ đưa vào game.

File mẫu cho test `tests/fixtures/open-buildings-sample.parquet` có cùng dạng với file của VIDA, tạo bằng
`tests/fixtures/make_open_buildings_sample.py` (cần pyarrow).

## Phát triển

Chạy trong thư mục `newmap/`:

```bash
npm install
npm run dev      # chạy thử tại http://localhost:5173
npm test         # kiểm thử: chọn máy Overpass, ghép nhà, đọc Open Buildings theo byte, mặt trời, địa điểm…
npm run build    # build ra thư mục dist/
```
