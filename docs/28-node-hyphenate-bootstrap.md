# Tạo template và lấy server bằng Node.js

Đã kiểm chứng ngày 14/11/2026: [hyphenate-bootstrap.js](../scripts/hyphenate-bootstrap.js) tự gọi discovery, tạo gói login mới và tùy chọn kiểm tra kết nối. Không cần điện thoại, ADB, Frida, MMKV, file `server.json` trên điện thoại hay template capture.

## Đầu vào

Node >=22.18 và dependency của `scripts` đã cài. File env tối thiểu để tạo mẫu và kiểm tra đăng nhập:

```dotenv
HX_APP_KEY="1102190223222824#lit"
HX_USERNAME="IM_USERNAME_CUA_BAN"
HX_PASSWORD="IM_PASSWORD_CUA_BAN"
```

`HX_APP_KEY` bắt buộc khai báo trong `.env` hoặc environment; code không có app key mặc định. `HX_USERNAME` là tên tài khoản IM, không phải business userId/email/Lit ID. Password là `hxPwd`, không phải mật khẩu Google. Có thể thay `HX_PASSWORD` bằng `HX_ACCESS_TOKEN` còn hạn; token được ưu tiên nếu có cả hai.

Chỉ tạo mẫu và lấy server không cần password/token. `--check` mới cần một trong hai để đăng nhập thử. Không cần `LIT_UUID`, `LIT_SID`, DFPID, SIUA hay JSON thiết bị cho luồng IM này. Script không lấy lại username/password từ email Google hoặc business userId.

## Chạy

Từ thư mục gốc project:

```sh
node --env-file=scripts/.env scripts/hyphenate-bootstrap.js --check
```

Script tự đọc `scripts/.env` theo cơ chế chung của project; biến environment/`--env-file` ưu tiên hơn. Khi dùng file credential khác, thay `--env-file` tương ứng. Ví dụ input đã chuẩn bị cho tài khoản May troi: `.private/hx-node-input.env`, chỉ chứa app key, username, password. `scripts/.env` hiện còn tài khoản trước; lượt này không ghi đè file đó.

`--check` xin token khi cần, gửi login + followup rồi đóng kết nối, không gửi chat. Không có cờ này, output chỉ được tạo, chưa kiểm chứng server chấp nhận. Đăng nhập cùng tài khoản từ client khác có thể ảnh hưởng phiên đang mở.

Script chỉ log JSON ra terminal, không tạo file và không sửa `.env`. Event `bootstrap_complete` chứa:

```text
HX_APP_KEY
HX_USERNAME
HX_IM_HOST
HX_IM_PORT
HX_REST_BASE
HX_CLIENT_UUID
HX_LOGIN_TEMPLATE_B64
```

Password/token không được in ra terminal; token trong template là chuỗi rỗng. Nếu muốn dùng lại mẫu với CLI kết nối, bạn tự chép các giá trị `HX_*` từ log vào cấu hình rồi chạy:

```sh
node --env-file=scripts/.env scripts/hyphenate-connect.js --dry-run
```

Bỏ `--dry-run` để kiểm tra kết nối thật. Nếu dùng `.private/hx-node-input.env` ở bước đầu, dùng cùng file đó thay `scripts/.env` ở đây.

## API và logic

1. `GET https://rs.easemob.com/easemob/server.json?app_key=<URL-encoded app key>&_v=<timestamp>` trả cấu hình server, không cần token người dùng. Đọc `msync-im.hosts`, bỏ trùng host/port, giữ thứ tự response. Chọn phần tử đầu tiên hoặc `--index N`; không random hay thử lại tự động. Host có IP thì dùng IP, nếu không dùng domain. Đây là kết quả discovery mới, có thể khác cache Android và thay đổi theo lần gọi.
2. Chọn REST HTTPS trong response, hoặc dùng `HX_REST_BASE` đã chỉ định. Validator chấp nhận tên miền `easemob.com` và `easecdn.com` cùng các subdomain, chỉ HTTPS cổng 443. Token được lấy qua `POST /{org}/{app}/token` với username/password bằng helper hiện có. Nếu không có REST hợp lệ và không có override, mới dùng REST mặc định.
3. Tạo `JID` và `Provision` protobuf bằng code JS từ app key/username, UUID client mới và timestamp phiên. Đặt `actionVersion="v6.0"`, lưu `authToken={"token":""}` trong mẫu. Client nhận diện là Node.js và khai báo hệ điều hành của máy chạy; không chép model/UUID điện thoại.
4. Encode protobuf `MSync` (`command=3`) thành Base64 rồi log `HX_LOGIN_TEMPLATE_B64`. Đây là logic dựng mẫu tại máy, không phải API trả nguyên Base64.
5. Khi đăng nhập, `buildLoginFrame` chèn `authToken={"token":"$t$<access token>"}` cho mẫu v6 rồi thêm prefix độ dài 4 byte big-endian. Mẫu Android v3 cũ vẫn dùng token không có tiền tố `$t$`.

`HX_CLIENT_UUID` tùy chọn cho phép giữ định danh client Node ở lần bootstrap sau; nếu bỏ trống, dùng `crypto.randomUUID()`. Timestamp phiên được tạo mới. Các giá trị `vid/cid` của mẫu Android v3 không được dùng trong luồng v6 này.

## Bằng chứng và giới hạn

- Nguồn schema/logic: gói chính thức [`easemob-websdk@5.2.0`](https://registry.npmjs.org/easemob-websdk/-/easemob-websdk-5.2.0.tgz), `index.js`: `Provision`, `MSync`, `encodeProvision()` và hàm discovery. SHA-256 của archive: `42fcea20103a361eead95d5db8561ea5cac8ae2863e6a8182e23ee89bd9c36a6`; `index.js`: `bb0ceffc94117e442bbaf32dcb87d56411fe1153329fd406fca5bf089be8ef71`.
- REA phân tích tĩnh package với source lựa chọn `index.js`: Evidence `ev_94c616563fd8cbf116715ed2a92ebf0ac5548a569b2ece15dd85be4197d6fb82`. Graph bị giới hạn số node, không được dùng để khẳng định đã hiểu mọi nhánh SDK; các field liên quan được đối chiếu trực tiếp source và kiểm tra live bên dưới.
- Lượt chạy CLI chỉ đưa app key/username/password vào input; cố ý đặt `HX_LOGIN_TEMPLATE_B64`, `HX_IM_HOST`, `HX_IM_PORT` đầu vào thành `unused` để xác nhận không phụ thuộc các giá trị cũ. Code bootstrap không đọc snapshot tài khoản hay file capture.
- Account `love147916324948659`: discovery chọn `msync-im1-sgp-ga.easemob.com:6717`; template mới 254 byte. Token được xin mới bằng password; login `type=3/code=0`, followup `type=1/code=0`, `chatSent=false`. Bản trước đã lưu mẫu để kiểm chứng CLI connect; bản hiện tại chỉ log ra terminal.
- Kiểm tra TypeScript và bộ test qua, gồm token v6, tương thích template cũ, protobuf, discovery và các test sẵn có của project.

Mẫu v6 này là mẫu client Node có thể đăng nhập, không giống từng byte mẫu SDK Android. Đã bổ sung [listener Node](31-node-tcp-listener.md) dùng mẫu này để nhận message và giữ phiên bằng UNREAD; bằng chứng runtime mới ghi ở tài liệu đó. Chưa kiểm chứng cho mọi tài khoản hoặc mọi chính sách nhiều thiết bị. Cần dùng code Node đã cập nhật token v6; luồng Rust/UI cũ chưa được kiểm chứng với mẫu này. SDK npm và REA chỉ dùng khi điều tra; script chạy không phụ thuộc chúng.
