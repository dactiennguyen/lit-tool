# Kiểm chứng SIUA và DFPID cùng phiên app — 15/11/2026

## Phạm vi

Litmatch 7.77.0 user 10, tài khoản Nancry, tiến trình 27378; Eye và Hide My
Device đang bật. Hook Frida 17.10 sử dụng bridge reflection để đọc getter của
app và `LitEye.detect()`; không thay giá trị, không đăng nhập hay gửi chat.
Mẫu chứa session, fingerprint và token chỉ lưu tại
`.private/siua-dfpid-hook-current.json` (quyền 600), không đưa vào Git.

Trong tiến trình, `EyeConnector.fetchSIUA()` trả token 128 ký tự,
`getDfpId()` trả 88 ký tự, `LitEye.detect()` trả blob 4224 ký tự. User ID trong
session khớp profile; UUID app dùng khớp `android_id_secure` trong detect.
Snapshot detect giải bằng AES-CBC, kiểm tra padding và inflate thành JSON 198
trường; `model=Pixel 8 Pro`, `brand=google`, `manufacturer=Google`.

Hook bổ sung `EyeConnector.getDfpId`, `fetchSIUA` và builder `tq0.n0.a` ghi
nhận **4 lần `X-DFPID` và 4 lần `X-SIUA`** được thêm; mỗi giá trị bằng output
getter tương ứng trên cùng luồng. Hook này xác minh tại builder, không phải
capture TLS hoặc xác minh response của từng request. Việc chuyển tab làm app
chạy các request và tác vụ bình thường của app.

## SIUA

- SIUA app giải bằng `decodeSiua` của Node, format `2.1` / Eye `1.9.9`.
- Mã hóa lại nguyên plaintext app bằng `encodeSiua` cho **token trùng từng byte
  trong mẫu này**. Token Node tự tạo cũng giải mã round-trip được.
- Khối scan thực của mẫu không bằng `SCAN_CLEAN` cố định trong script. Token
  Node mặc định vì thế không được coi là bản sao tín hiệu thiết bị hiện tại.
- Kiểm chứng này chỉ có một mẫu. Tài liệu [25](25-runtime-request-headers.md)
  đã đối chiếu 10 mẫu trước đó và chỉ 7/10 mã hóa lại trùng byte; khác biệt zlib
  không nhất thiết làm plaintext sau giải khác nhau.

## DFPID

Đưa JSON 198 trường vừa lấy vào `postDetect()` cùng `sid`, `uuid`, model và
phiên bản của phiên hiện tại; các common query còn lại lấy từ default script,
chưa chứng minh giống mọi query do app gửi. API `/eye` trả HTTP 200,
`code=0`, `message=ok`, `data.dfpId` dài 88 ký tự, có `exp` và `ver`.
Giá trị mới khác getter tại thời điểm hook; đây là hai token opaque nên không
suy luận nguyên nhân hay giá trị nào server sẽ ưu tiên chỉ từ sự khác nhau.

## Đối chứng API hồ sơ bản thân

Gọi lần lượt `GET /api/sns/v1/lit/user/get_info/me?from=me&source=me` cho
cùng session/UUID/user ID, dùng request ID mới mỗi lần. Bỏ hoặc gắn header trực
tiếp sau khi tạo request để kiểm soát đúng biến thử:

| SIUA | DFPID | HTTP / success / result | User ID và request ID khớp |
|---|---|---|---|
| Không gửi | Không gửi | 200 / true / 0 | Có |
| App | Getter app | 200 / true / 0 | Có |
| Node `SCAN_CLEAN` | Getter app | 200 / true / 0 | Có |
| Node `SCAN_CLEAN` | `/eye` vừa cấp | 200 / true / 0 | Có |
| App | `/eye` vừa cấp | 200 / true / 0 | Có |
| Node mã hóa lại plaintext app | `/eye` vừa cấp | 200 / true / 0 | Có |

Các thử nghiệm này chứng minh endpoint hồ sơ xử lý thành công các request cụ thể;
không chứng minh header là bắt buộc, nội dung scan được server kiểm tra hay không,
mọi API khác chấp nhận, token còn hạn trong tương lai, hoặc an toàn để sử dụng
token mẫu làm tín hiệu thiết bị thật. Không làm thử nghiệm tác vụ ghi/login.

## Ý nghĩa cho tự động hóa Rust

Rust đã gắn giá trị `siua`/`dfpid` khi tài khoản có sẵn, nhưng chưa tự thu thập
scan, gửi `/eye`, quản lý hạn/cache hay lấy token từ app. Có thể tự động hóa việc
đóng gói và gọi API, song phải có nguồn dữ liệu thiết bị nhất quán và xử lý việc
token hết hạn/lỗi. `SCAN_CLEAN` không nên được trình bày như kết quả scan thật.
Chưa có thay đổi Rust trong lượt kiểm chứng này.

## Chạy thử toàn bộ luồng bằng Node

Script `scripts/src/cli/verify-eye-headers.ts` nhận snapshot hook ở trên;
không cần ADB hoặc app khi chạy. Từ thư mục gốc repository:

```sh
node scripts/src/cli/verify-eye-headers.ts \
  --capture .private/siua-dfpid-hook-current.json \
  --version 7.77.0
```

Thêm `--dry-run` để chỉ kiểm tra local, không gửi request. File capture cần
`sid`, `userId`, `uuid`, `model`, `appSiua` và `detect`; version phải tương ứng
phiên app được capture. Script không sửa `.env`, không ghi token hay response
hồ sơ ra file; stdout chỉ gồm trạng thái và tên header.

Luồng đã chạy thực tế ngày 15/11/2026:

1. Giải detect thành 198 trường; đối chiếu UUID/model với profile request.
2. Giải SIUA hook, lấy khối scan đã thu được, dùng timestamp và UUID ngẫu nhiên
   mới để tạo plaintext; Node nén/mã hóa thành SIUA mới. Round-trip đúng,
   token mới khác token capture. Đây là scan snapshot, không phải đo lại thiết
   bị và không sử dụng `SCAN_CLEAN` mặc định.
3. Node đóng gói detect và POST `/eye`: HTTP 200, `code=0`, có DFPID mới.
4. Gắn `X-SIUA`, `X-DFPID`, ký `litSign`/`sts-sign`, thêm `ts`, `litTime`,
   `X-Application-Info`, `X-request-Id`, `lit-user-id`, rồi GET hồ sơ bản thân:
   HTTP 200, `success=true`, `result=0`, user ID và request ID đều khớp.

SIUA là nén/mã hóa dữ liệu; chữ ký request do các hàm `litSign`/`stsSign` tạo.
Các common query ngoài identity/model/version vẫn dùng defaults của script.
Kết quả chỉ chứng minh request này thành công, không chứng minh mọi API chấp
nhận hay server bắt buộc kiểm tra hai header (đối chứng bỏ header ở trên cũng
thành công). Chưa tự thu thập scan thiết bị bằng Node.

Kiểm tra code: `npm run check` trong `scripts` thành công (typecheck và
265 tests); dry-run và lần chạy live ở trên đều exit 0.
