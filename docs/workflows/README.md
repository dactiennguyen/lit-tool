# docs/workflows — Sơ đồ luồng (đã reverse)

Trực quan hóa các luồng chính của `com.litatom.app` v7.77.0. Thuần phần **hiểu cơ chế** — tham chiếu chi tiết ở `docs/06..11`.

| File | Nội dung |
|---|---|
| [01-tong-quan.md](01-tong-quan.md) | Toàn cảnh: mở app → login → verdict; chuỗi 4 interceptor ký; bảng chữ ký |
| [02-google-login.md](02-google-login.md) | Logic Google login chi tiết (2 flow, lấy ID token, map {token}, xử lý onSuccess/onFail) |
| [03-goi-api.md](03-goi-api.md) | Cách gọi API: Retrofit/OkHttp, vòng đời 1 request, host/routing, response/lỗi |
| [04-danh-muc-api.md](04-danh-muc-api.md) | Danh mục 713 endpoint (plaintext) theo nhóm; danh sách đầy đủ ở ../data/endpoints.txt |

> Xem Mermaid render thành hình: cài extension VSCode `bierner.markdown-mermaid` rồi `Cmd+Shift+V` trên file.
