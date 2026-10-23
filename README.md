# hGame

Repo gom các dự án web, mỗi dự án nằm trong một thư mục riêng, có `package.json`, build và test riêng.

| Thư mục | Dự án | Bản chạy |
| --- | --- | --- |
| [`vgang-online/`](vgang-online/) | Vgang Online: game 3D lái xe máy dạo phố về đêm | https://huynhnd53.github.io/hGame/vgang-online/ |
| [`newmap/`](newmap/) | Dựng khu thật: vẽ một khu trên bản đồ, dựng thành mô hình 3D từ OSM và Open Buildings | https://huynhnd53.github.io/hGame/newmap/ |
| [`tiltpad/`](tiltpad/) | Tilt Pad: xoay điện thoại, khối 3D trên máy tính xoay theo (WebRTC) | https://huynhnd53.github.io/hGame/tiltpad/ |
| [`tiltpad/`](tiltpad/) | Chém hoa quả: điện thoại làm thanh kiếm, dùng chung kết nối của Tilt Pad | https://huynhnd53.github.io/hGame/tiltpad/fruit.html |
| [`tiltpad/`](tiltpad/) | Pickleball: góc nhìn thứ ba, điện thoại làm vợt | https://huynhnd53.github.io/hGame/tiltpad/pickleball.html |

Trang chào ở gốc (`index.html`) dẫn tới các dự án: https://huynhnd53.github.io/hGame/

## Phát triển

Mỗi dự án chạy riêng trong thư mục của nó, xem README trong từng thư mục. `vgang-online/` và `newmap/` dùng Vite
(`npm install`, `npm run dev`, `npm test`, `npm run build`); `tiltpad/` là trang tĩnh, không cần build (`npm start` để
chạy thử trên máy). Ở gốc có lệnh chạy cho các dự án Vite:

```bash
npm run install:all   # cài thư viện cho cả hai dự án
npm test              # test cả hai
npm run build         # build cả hai rồi ghép vào dist/ (index.html, vgang-online/, newmap/, tiltpad/)
```

## Phát hành

Workflow `.github/workflows/deploy.yml` build hai dự án Vite, ghép cùng `tiltpad/public/` như trên và đăng lên GitHub Pages mỗi khi có
commit vào `main` (Settings → Pages → Source: GitHub Actions).
