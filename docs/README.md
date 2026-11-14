# Litmatch (com.litatom.app) — Hồ sơ Reverse Engineering

Tài liệu phân tích kỹ thuật ứng dụng **Litmatch** `com.litatom.app` **v7.77.0** (versionCode 711, targetSdk 36).
Nguồn: `base.apk` + `split_config.arm64_v8a.apk` → decompile tại [`../base-decompiled/`](../base-decompiled/) và native lib tại [`../native/libliteye.so`](../native/libliteye.so).

> ⚠️ Chỉ dùng cho mục đích học tập / kiểm thử bảo mật hợp pháp trên APK do bạn sở hữu.

## Mục lục

| File | Nội dung |
|---|---|
| [01-tong-quan.md](01-tong-quan.md) | Tổng quan app, kiến trúc, module, SDK |
| [02-login-session.md](02-login-session.md) | Luồng đăng nhập, session, tham số chung |
| [03-liteye-native.md](03-liteye-native.md) | SDK chống gian lận liteye: `litSign`, `detect`, `siua`, chống tamper |
| [04-chi-tiet-detect-va-chong-cheat.md](04-chi-tiet-detect-va-chong-cheat.md) | Chi tiết blob `detect` + blacklist auto-clicker |
| [05-moi-truong-phan-tich.md](05-moi-truong-phan-tich.md) | Cách tái lập môi trường (Ghidra/REA/Frida) |
| [06-api-va-ky-request.md](06-api-va-ky-request.md) | API & ký request: host, endpoint, `litSign`/`sts-sign`/`X-DFPID`/`X-SIUA`/`X-Application-Info`, libguard |
| [07-libguard-getsigncode.md](07-libguard-getsigncode.md) | Mổ `libguard.so`: `getSignCode`/`sts-sign`/`encodeShadowContent`/`getToken` (giải token Agora) + chống repack |
| [08-liteye-native-returns.md](08-liteye-native-returns.md) | `libliteye.so` các hàm native **trả gì** (ground-truth): `detect`/`dfpToken`/`siua`/`litSign` + crack `/eye` |
| [09-luong-dang-nhap.md](09-luong-dang-nhap.md) | Luồng đăng nhập đầy đủ (mở app → Google login), request/response, **cơ chế lỗi 1112** |
| [10-thong-tin-thiet-bi.md](10-thong-tin-thiet-bi.md) | Ghi chú lịch sử về dữ liệu thiết bị; xem hiệu chỉnh nguồn JSON 198 trường ở tài liệu 12 |
| [11-goi-api-sau-login.md](11-goi-api-sau-login.md) | Gọi API sau khi login: cấu trúc request đã xác thực (sid + ký) + sequence + response |
| [12-kiem-chung-login-user-10.md](12-kiem-chung-login-user-10.md) | Kết quả thử thay bốn trường detect, phản hồi login và giới hạn kết luận |
| [13-google-login-hai-truong-hop.md](13-google-login-hai-truong-hop.md) | Request Google login và hai response thực tế: môi trường bất thường, tài khoản bị khóa |
| [14-api-khoi-dong-va-script.md](14-api-khoi-dong-va-script.md) | 30 API quan sát khi mở app, nguồn store, body POST và script thử GET |
| [15-account-info-header-va-response.md](15-account-info-header-va-response.md) | Header, query và cách giải mã response `account/account_info` |
| [16-nodejs-account-info-khong-adb.md](16-nodejs-account-info-khong-adb.md) | Cách lưu profile một lần và gọi `account/account_info` chỉ bằng Node.js |
| [17-hook-java-frida.md](17-hook-java-frida.md) | Hook tầng Java trên app chống-ART: bridge vá JNI reflection (frida 17.10), điểm hook, header/response thật |
| [18-home-online-users.md](18-home-online-users.md) | API danh sách Home, tham số, header và kết quả quan sát |
| [20-mmkv-default-va-eye-id.md](20-mmkv-default-va-eye-id.md) | Hai kho MMKV, giá trị thực và cách đọc |
| [21-profile-va-luong-tin-nhan.md](21-profile-va-luong-tin-nhan.md) | Hồ sơ, thử gửi một tin và workflow IM |
| [22-nodejs-hyphenate-connect.md](22-nodejs-hyphenate-connect.md) | Client Node.js một file: `.env`, token, handshake TCP, gửi TXT thử và giới hạn |
| [23-full-workflow-gui-tin.md](23-full-workflow-gui-tin.md) | Hook UI → SDK → TCP/ACK, ba HTTPS đi kèm, xác minh tin Node trong history server và local cache |
| [24-nodejs-conversations.md](24-nodejs-conversations.md) | Node thuần: lấy danh sách conversation và lịch sử tin từ server, giải mã protobuf và phân trang |
| [29-feed-api.md](29-feed-api.md) | Tab Gợi ý / Phổ biến / Kết bạn, API và TypeScript |
| [31-node-tcp-listener.md](31-node-tcp-listener.md) | Node tự login và nghe TCP IM, heartbeat, đồng bộ queue, không ADB |
| [99-phu-luc-endpoints.md](99-phu-luc-endpoints.md) | Phụ lục: endpoints, địa chỉ hàm, khoá |

### Workflows (bản tóm tắt điều hướng)

Thư mục [`workflows/`](workflows/) tóm tắt lại các luồng chính để tra nhanh; chi tiết nằm ở docs đánh số ở trên.

| File | Nội dung |
|---|---|
| [workflows/01-tong-quan.md](workflows/01-tong-quan.md) | Sơ đồ tổng quát + 4 interceptor + bảng chữ ký |
| [workflows/02-google-login.md](workflows/02-google-login.md) | Logic Google login (sequence + bảng `onFail`) |
| [workflows/03-goi-api.md](workflows/03-goi-api.md) | Kiến trúc gọi API (Retrofit/OkHttp, host, annotation) |
| [workflows/04-danh-muc-api.md](workflows/04-danh-muc-api.md) | Danh mục endpoint theo nhóm tính năng |

### Công cụ & script (docs đi kèm)

| File | Script | Nội dung |
|---|---|---|
| [eye-device.md](eye-device.md) | `../scripts/src/cli/eye-device.ts` | Thử đọc/thay trường `LitEye.detect()` |
| [google-login-client.md](google-login-client.md) | `../scripts/src/cli/login-google.ts` | Client thử nghiệm luồng Google login |
| [22-nodejs-hyphenate-connect.md](22-nodejs-hyphenate-connect.md) | `../scripts/src/cli/hyphenate-connect.ts` | Kiểm tra kết nối Hyphenate, tùy chọn gửi một TXT thử |

> **13/11/2026 — scripts viết lại bằng TypeScript.** Các script Node trong `../scripts/` đã chuyển sang `../scripts/src/cli/*.ts` (TypeScript, Node 22.18+ chạy thẳng `.ts`). CLI mới **tự đọc** `scripts/.env`, nên bỏ `--env-file` trong mọi lệnh cũ và đổi đuôi file: `scripts/<tên>.js` → `scripts/src/cli/<tên>.ts` (một vài tên đổi gạch dưới thành gạch nối: `home_online`→`home-online`, `user_info`→`user-info`, `build_login_curl`→`build-login-curl`). Hoặc dùng npm script trong [../scripts/package.json](../scripts/package.json) (ví dụ `npm run im:history`, `npm run account`). Bản JS cũ còn trong `scripts/legacy/` chỉ để test đối chiếu, sẽ xoá sau.

**Cập nhật 13/11/2026:** Các nhận định trong tài liệu cũ về nguyên nhân server
từ chối, device ban và số trường fingerprint cần đối chiếu với kết quả quan sát
mới tại [tài liệu 12](12-kiem-chung-login-user-10.md). Chưa xác định được
trường nào quyết định kết quả đăng nhập hay nguyên nhân khóa tài khoản.

## Tóm tắt điều hành

- **App**: mạng xã hội voice-chat/kết bạn. Kotlin + R8 obfuscate nặng (package 1–3 ký tự, Retrofit/OkHttp bị đổi tên). ~44.6k file Java sau decompile.
- **Session**: login trả `UserInfo.session` → lưu MMKV `litmatch_key_info` → dùng làm `sid` gửi kèm mọi request. Không JWT.
- **Lớp mạng**: chuỗi OkHttp interceptor dùng **2 native lib** cùng bảo vệ 1 request (xem [06](06-api-va-ky-request.md)) — **libguard.so** ký (`litSign`=`getSignCode`, `sts-sign`=`getHMac256SignCode`, `X-Application-Info`=`encodeShadowContent`) + **libliteye** (`com.construct.liteye`) tiêm `X-DFPID`/`X-SIUA` + 5 query `litTS/litUA/litNO/litVS/litCK`. Host chính (BASE_URL) `https://www.litatom.com/` (`/api/sns/v1/lit/...`); endpoint nằm plaintext trong annotation Retrofit (grep tĩnh ra 713 cái, xem [04-danh-muc-api](workflows/04-danh-muc-api.md)).
- **Native `libliteye.so`** (chứa toàn bộ bảo mật thật):
  - `litSign(s)` = **`hex(HMAC-SHA256(key="happy0litmatch1", s))`** — khoá đã lộ.
  - `detect` = blob fingerprint ("1.9.9" + timestamp + 11 trường thiết bị) gửi `/api/sns/v1/lit/eye` để lấy `X-DFPID`.
  - `siua` = chạy ~60 hàm dò (root/Frida/proxy/VPN/Xposed...) → đóng gói `X-SIUA`.
  - Chống Frida chủ động (module `Siua`), verify chữ ký APK (PKCS#7), fingerprint phần cứng Widevine, **blacklist 13 app auto-clicker** (chống cheat).

Cập nhật lần cuối: 2026-11-12.
