# 13 — Google login: lỗi môi trường và tài khoản bị khóa

Ngày 13/11/2026, Litmatch 7.77.0 trên Android user 10, dùng cùng tài khoản
Google đã có trên thiết bị. Hai lượt dưới đây là **request thực tế do app gửi**;
response được đọc sau interceptor giải mã, có gắn Frida quan sát. Không lưu
Google ID token, chữ ký, session, định danh thiết bị hay mã theo dõi. Mã
`<...>` trong tài liệu là chỗ đã che, không phải giá trị gửi nguyên văn.

## Endpoint và request

Cả hai lượt gọi:

```http
POST https://www.litatom.com/api/sns/v1/lit/user/google_login?<query>
Content-Type: application/x-litatom-json; charset=UTF-8
X-Application-Info: <query đã mã hóa>
litSign: <có>
sts-sign: <có>
X-SIUA: <có>
X-DFPID: <có>
fingerprint: <có>

<body đã mã hóa, 1644 byte trong hai lượt này>
```

Hai request quan sát tại `CallServerInterceptor` có cùng **tên** query:
`loc`, `uuid`, `version`, `lang`, `platform`, `model`, `loctype`, `os`,
`net_type`, `app_source`, `appid`. Không lưu giá trị query; không suy ra hai
request có cùng giá trị hoặc cùng body. Không quan sát `Content-Encoding`.
Độ dài body và sự hiện diện header chỉ phản ánh hai lượt này.

### Body trước khi mã hóa

Từ mã app: `GoogleLoginActivity.h()`/`i0.java` đặt Google ID token vào map
với key `token`; Retrofit `va0/a.java` khai báo POST `google_login` với
`@Body Map<String, String>`. Vì vậy body logic có dạng:

```json
{"token":"<Google ID token>"}
```

Đây là **cấu trúc suy ra từ mã**, không phải plaintext đã ghi lại từ hai lượt
này. Converter `bg0/b.java` serialize map thành JSON, gọi
`LibGuard.encodeShadowContent(json, 3)` rồi tạo body với content type phía
trên. Observer thấy body tại điểm gửi không parse được thành JSON. Không lưu
body mã hóa vì nó có thể chứa thông tin đăng nhập.

Interceptor `c00/a.java` mã hóa **query string** riêng và đưa vào header
`X-Application-Info`; header này không thay thế body. Các header Eye và chữ ký
có mặt trong cả hai lượt. `X-Is-Enc` có mặt trong cả hai response, nhưng lượt
này không lưu giá trị giải ra hay cờ cho biết body trên wire có mã hóa không.
JSON bên dưới là kết quả app đã xử lý tại `cg0/a.java`, không tuyên bố đó là
byte thô trên mạng.

## Trường hợp 1 — môi trường bị báo bất thường

Điều kiện: tạm tắt riêng Vector Eye và Hide My Device, khởi động lại tiến trình
Litmatch; ADB và Frida vẫn hoạt động, máy vẫn root/Vector. Không khởi động lại
thiết bị và không kiểm soát riêng cache DFP hoặc toàn bộ module hệ thống.

Response app quan sát được: **HTTP 200**

```json
{
  "message": "Môi trường thiết bị của bạn bất thường. Vui lòng đăng nhập lại sau khi gỡ bỏ phần mềm không an toàn hoặc tắt chế độ nhà phát triển. Mã 1113-<id>",
  "result": -1,
  "success": false
}
```

Mã sau `1113-` được che; `1113` nằm trong **chuỗi message**, còn trường số
`result` thực tế là `-1`. Response quan sát không có trường `data` hoặc
session. Không xác định được tín hiệu cụ thể hay điều kiện server dùng để từ
chối; không thể chỉ từ lượt này quy lỗi cho user 10, ADB, root hoặc Frida.

## Trường hợp 2 — tài khoản bị khóa

Điều kiện: bật Eye và Hide My Device cho Litmatch/user 10 trước khi khởi động
tiến trình; Frida đang gắn để quan sát. Tình trạng bật được kiểm tra bằng
Vector. Không chứng minh từng trường module đã thay hoặc DFP gửi lên mang giá
trị nào trong đúng lượt này.

Response app quan sát được: **HTTP 200**

```json
{
  "forbidden_session": "<đã che>",
  "message": "... tài khoản của bạn sẽ bị cấm đến 2125-10-20 09:38:29 ... BAN_ID<đã che>",
  "result": -14,
  "success": false,
  "unban_diamonds": 800
}
```

`message` ở đây được **rút gọn**, không phải nguyên văn đầy đủ. App hiển thị
hộp thoại khóa với cùng thời hạn, mã BAN_ID và địa chỉ hỗ trợ. Trường
`forbidden_session` có mặt nhưng giá trị đã che; chưa xác định công dụng. Số
`unban_diamonds` là giá trị response ở lượt này, chưa xác minh chính sách hoặc
khả năng mở khóa. Không thấy `data.session` trong response này.

## Đọc kết quả

| Trường hợp | HTTP | `success` | `result` | Quan sát |
|---|---:|---|---:|---|
| Môi trường bất thường | 200 | false | -1 | `message` chứa mã bắt đầu `1113-`; không có `data` trong response đã quan sát |
| Tài khoản bị khóa | 200 | false | -14 | Có `forbidden_session`, `unban_diamonds`, và thông báo cấm tài khoản |

HTTP 200 chỉ cho biết request được xử lý ở tầng HTTP; cả hai trường hợp đều
không phải đăng nhập thành công. Đây là hai lượt riêng với cấu hình module
khác nhau, cùng có Frida, nên không chứng minh quan hệ nhân quả giữa module,
lỗi môi trường và trạng thái khóa. Đã bật lại hai module sau lượt đối chứng và
dừng Frida server/ADB forward dùng để quan sát.
