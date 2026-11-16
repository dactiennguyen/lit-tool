## Tải về

| Máy | File |
|---|---|
| macOS chip Apple (M1 trở lên) | `sky-manager_{{VERSION}}_macos_aarch64.dmg` |
| macOS chip Intel | `sky-manager_{{VERSION}}_macos_x64.dmg` |
| Windows 10/11 | `sky-manager_{{VERSION}}_windows_x64-setup.exe` (bộ cài), `sky-manager_{{VERSION}}_windows_x64.msi`, hoặc `sky-manager_{{VERSION}}_windows_x64_portable.exe` (chạy luôn, không cài) |

Bản `.app.zip` là app macOS dạng nén, dùng khi không muốn mở file `.dmg`. Kiểm tra file tải về bằng `SHA256SUMS.txt` (`shasum -a 256 -c SHA256SUMS.txt --ignore-missing`).

## Bản này chưa ký số

- **macOS** báo "app bị hỏng" hoặc "không thể mở": kéo `Sky Manager.app` vào Applications, rồi chạy một lần trong Terminal:
  ```bash
  xattr -cr "/Applications/Sky Manager.app"
  ```
- **Windows** hiện "Windows protected your PC": bấm **More info** → **Run anyway**.

## Tự cập nhật

App đã cài tự tìm bản mới trên trang Releases này khi mở app và mỗi 10 phút khi đang chạy (hoặc bấm Kiểm tra trong Cài đặt → Phiên bản). Có bản mới lúc mở app là bắt buộc: app tự tải, kiểm chữ ký, cài rồi mở lại. Tìm thấy khi đang chạy thì cuối thanh bên hiện nút **Cập nhật**, bấm là tự cài và mở lại. Bản `_portable.exe` không tự cập nhật.
