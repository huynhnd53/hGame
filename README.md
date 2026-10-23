# hGame

Repo gom các dự án web, mỗi dự án nằm trong một thư mục riêng, có `package.json`, build và test riêng.

| Thư mục | Dự án | Bản chạy |
| --- | --- | --- |
| [`vgang-online/`](vgang-online/) | Vgang Online: game 3D lái xe máy dạo phố về đêm | https://huynhnd53.github.io/hGame/vgang-online/ |
| [`newmap/`](newmap/) | Dựng khu thật: vẽ một khu trên bản đồ, dựng thành mô hình 3D từ OSM và Open Buildings | https://huynhnd53.github.io/hGame/newmap/ |

Trang chào ở gốc (`index.html`) dẫn tới hai dự án: https://huynhnd53.github.io/hGame/

## Phát triển

Mỗi dự án chạy riêng trong thư mục của nó (`npm install`, `npm run dev`, `npm test`, `npm run build`), xem README
trong từng thư mục. Ở gốc có lệnh chạy cả hai:

```bash
npm run install:all   # cài thư viện cho cả hai dự án
npm test              # test cả hai
npm run build         # build cả hai rồi ghép vào dist/ (index.html, vgang-online/, newmap/)
```

## Phát hành

Workflow `.github/workflows/deploy.yml` build cả hai dự án, ghép lại như trên và đăng lên GitHub Pages mỗi khi có
commit vào `main` (Settings → Pages → Source: GitHub Actions).
