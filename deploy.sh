#!/usr/bin/env bash
# Chạy trên VPS: kéo code mới, build, để web server phát thẳng thư mục dist/.
# Không có tiến trình nào để khởi động lại (toàn file tĩnh); build hỏng thì dist/ cũ vẫn còn.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only origin main
npm run install:all   # npm ci cho vgang-online và newmap
npm run build         # tsc + vite cho hai app, rồi ghép vào dist/ (cùng tiltpad/public và index.html)

echo "Đã triển khai $(git rev-parse --short HEAD) → $(pwd)/dist"
