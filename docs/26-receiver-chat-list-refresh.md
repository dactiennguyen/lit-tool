# Hội thoại mới chỉ xuất hiện sau refresh

Kiểm tra trên Litmatch Android user 10, ngày 2026-11-14 (UTC+7). Người gửi là `soongng` (`love147911610426381`), người nhận là `May troi` (`love147916324948659`).

**Kết luận:** tái hiện được lỗi mất cập nhật giữa luồng IO thêm hội thoại và luồng main sắp xếp/thay danh sách. Database đã có dòng mới nhưng snapshot cũ ghi đè danh sách trong bộ nhớ; retry insert bị bỏ qua nên không phục hồi dòng. Refresh nạp lại database làm hội thoại xuất hiện. Bằng chứng trực tiếp là phép thử C1 bên dưới.

## Kết quả đã xác minh

Tin A1 lúc 23:01 có server ID `1619663382053390944`. Trước refresh:

- `EMChatManager.getMessage` trả đúng tin TXT, chiều RECEIVE, đúng from/to.
- Hyphenate conversation tồn tại, có 1 tin và 1 tin chưa đọc.
- Database Litmatch `lit_user_db_v2.user_conversation` có dòng người gửi, `userInfo = NULL`, `pinned = 0`, `clearTime = 0`.
- Danh sách trong bộ nhớ `com.lit.app.im.sdk.w.f` chỉ có ba hội thoại khác. UI cũng chỉ có ba hội thoại.
- Tra hồ sơ người gửi bằng API qua app trả hồ sơ hợp lệ.

Người dùng xác nhận đã refresh và hội thoại xuất hiện. Sau đó kiểm tra lại thấy `w.f` có người gửi, có `userInfo`, và UI hiển thị chính nội dung A1. Không gửi lại A1, không bổ sung extension hay gọi metadata từ script để làm A1 xuất hiện.

Tin đối chứng B1, được người dùng cho phép, gửi đúng một lần lúc 23:18:08:

| Thuộc tính | Giá trị |
| --- | --- |
| Nội dung | `Test cap nhat danh sach chat B1` |
| Server ID | `1619667766871071328` |
| Local ID | `17946730883908872` |
| Extension | `mark_msg_id` |
| Gửi metadata Litmatch từ Node | Không |

Hook thụ động ghi nhận B1 đi qua `q1.onMessageReceived`, `c.onMessageReceived`, `a.b` (filter giữ tin), `w.c`, `w.b`, coroutine `t.invokeSuspend`, `w.x`, `ChatFragment.onConversationChanged`, `ChatListAdapter.setNewData`. Adapter nhận danh sách cập nhật khoảng 0,4 giây sau ACK. UI dump xác nhận nội dung B1 hiện ngay, không cần refresh.

B1 kiểm tra **hội thoại đã tồn tại**, không phải phép tái hiện lần liên hệ đầu. Nó chứng minh payload tối giản có thể cập nhật UI trực tiếp trong trạng thái này; không chứng minh mọi trường hợp liên hệ đầu đều hoạt động.

## Tái hiện C1: bắt được cập nhật bị mất

Người dùng cho phép sao lưu rồi tạm gỡ **riêng dòng hội thoại local** soongng, giữ nguyên các tin trong Hyphenate SDK, gửi thêm đúng một tin `Test hoi thoai moi C1`, sau đó khôi phục. Trước khi gửi, DAO xác nhận dòng không còn, danh sách có ba dòng khác, SDK vẫn có hai tin A1/B1. Đây là trạng thái **chưa có dòng LitConversation**, không phải tài khoản/quan hệ server hoàn toàn mới.

C1 có server ID `1619669229257099848`, local ID `17946734289284408`, gửi lúc 23:23:49. Node vẫn dùng cùng builder tối giản, không gọi metadata Litmatch. Hook quan sát argument/return và các thay đổi danh sách, không thay kết quả insert/sort, không ép lịch luồng hay chèn sleep vào app.

| Thời điểm UTC+7 | Luồng | Quan sát |
| --- | --- | --- |
| 23:23:49.384 | SDK | Bộ lọc giữ C1. |
| 23:23:49.483 | IO worker 1 | DAO insert thành công, trả row ID `4`. |
| 23:23:49.533 | main | `w.x` bắt đầu với ba hội thoại cũ. |
| 23:23:49.559 | IO worker 1 | `CopyOnWriteArrayList.add` từ `w.q` xong: danh sách đã có soongng, tổng bốn dòng. |
| 23:23:49.572 | main | `CopyOnWriteArrayList.clear` từ `w.x`: danh sách ngay trước clear vẫn có soongng. |
| 23:23:49.589 | main | `addAll` xong: chỉ khôi phục ba dòng cũ, mất soongng. |
| 23:23:49.629 / .645 | IO workers | Tạo lại soongng, DAO trả `-1` do `INSERT OR IGNORE`; danh sách vẫn thiếu. |
| 23:23:49.679 | main | `w.x` kết thúc với ba dòng cũ. |

Stack của thao tác thêm: `CopyOnWriteArrayList.add → w.q → i.invokeSuspend`. Stack của thao tác xóa: `CopyOnWriteArrayList.clear → w.x → h.invoke`. Vì các thao tác đơn lẻ của `CopyOnWriteArrayList` an toàn luồng không làm cả chuỗi snapshot/sort/clear/addAll thành nguyên tử, kết quả thêm từ luồng IO vẫn bị mất.

UI dump trước khôi phục không có soongng/C1, đúng triệu chứng cần điều tra. Không có trường payload nào khiến app chủ động bỏ C1: insert đã thành công và dòng đã xuất hiện trong bộ nhớ trước khi bị sorter ghi đè.

Sau phép thử, dòng local được khôi phục từ bản sao (giữ timestamp mới nhất). DAO xác nhận dòng tồn tại, SDK có đủ ba tin và C1 còn một tin chưa đọc. Observer kết thúc và detach. Chỉ gửi hai tin bổ sung B1/C1, mỗi tin một lần, theo hai lần cho phép riêng của người dùng.

## D1: gửi lại sau khi người dùng xóa hội thoại trong app

Người dùng tự xóa hội thoại và yêu cầu gửi lại. Trước phép thử, kiểm tra chỉ đọc xác nhận receiver vẫn là May troi, online; dòng database, danh sách bộ nhớ và conversation SDK của soongng đều không còn. Observer đọc trạng thái đã detach trước khi gửi; không cài hook trong lúc tin đến.

Gửi đúng một tin `Test gui lai sau khi xoa hoi thoai D1` lúc 23:29:34, server ID `1619670713159912108`. Vẫn dùng builder Node tối giản và không gọi metadata Litmatch từ Node. UI dump trước gửi không có soongng; UI dump sau gửi có soongng, đúng nội dung D1 và badge 1 tin chưa đọc, không thao tác refresh. Kiểm tra SDK/database sau đó xác nhận hội thoại và tin đã tồn tại.

D1 cho thấy việc không hiển thị không xảy ra ở mọi lần tạo hội thoại mới. Kết quả phù hợp lỗi phụ thuộc thời điểm các luồng chạy; cũng không chứng minh cần bổ sung một API phía gửi để hội thoại xuất hiện. C1 đã tái hiện race có instrumentation, còn D1 thành công khi không hook trong lúc nhận tin. Không suy ra tần suất lỗi thực tế từ hai mẫu này.

Log D1: `/tmp/lit-list-send-d1.jsonl`, `/tmp/lit-d1-before.jsonl`, `/tmp/lit-d1-after.jsonl`. Không khôi phục các tin cũ mà người dùng đã chủ động xóa.

## Luồng code giải thích sự khác nhau

1. [SDK nhận tin](../base-decompiled/sources/com/hyphenate/chat/EMChatManager.java) thêm tin vào cache receiver rồi gọi các listener. Không được dùng việc Node không gọi SDK trên điện thoại để suy ra receiver không có cache.
2. [Listener Litmatch](../base-decompiled/sources/com/lit/app/im/sdk/c.java) lọc tin, gọi tạo/đảm bảo hội thoại và khởi chạy riêng coroutine cập nhật timestamp.
3. [ConversationManager](../base-decompiled/sources/com/lit/app/im/sdk/w.java), `b`/`q`, tạo hội thoại trên luồng IO. `q` chỉ thêm vào `w.f` khi DAO insert trả số không âm.
4. [DAO insert](../base-decompiled/sources/com/lit/app/database/g.java) dùng `INSERT OR IGNORE`; không có nhánh nạp dòng đã tồn tại vào bộ nhớ khi insert bị bỏ qua. Do đó trạng thái **DB có / bộ nhớ thiếu** không tự được chữa bởi thao tác tạo lại này.
5. `w.x` lấy snapshot danh sách, sắp xếp, rồi `clear`/`addAll` trở lại. Thao tác nhiều bước không đồng bộ với luồng IO thêm hội thoại. C1 bắt được trực tiếp việc mất cập nhật này.
6. [Luồng đọc lại local](../base-decompiled/sources/com/lit/app/im/sdk/r.java) và [callback thay danh sách](../base-decompiled/sources/c7/p.java) nạp các dòng database vào bộ nhớ. `ChatFragment.onResume` cũng dùng luồng này.
7. [Adapter](../base-decompiled/sources/com/lit/app/ui/chat/adapter/ChatListAdapter.java) yêu cầu hồ sơ khi bind dòng có `userInfo = null`; [InfoProvider](../base-decompiled/sources/com/lit/app/im/w.java) cập nhật hồ sơ khi API thành công. `userInfo = null` không đủ để kết luận app chủ động loại hội thoại.

## Hướng sửa và giới hạn

Nếu sửa phía ứng dụng receiver: giữ truy vấn database trên IO nhưng đưa **toàn bộ thao tác thay đổi/sắp xếp danh sách** về cùng luồng main hoặc cùng cơ chế khóa; xử lý insert bị bỏ qua bằng cách đọc dòng đã tồn tại và thêm/cập nhật vào bộ nhớ. Luồng nạp toàn bộ danh sách cũng phải tránh ghi snapshot cũ đè lên các cập nhật mới. Chưa vá APK Litmatch trong lượt điều tra này.

Không cần suy diễn thêm header, mã risk hoặc một HTTP request để giải thích C1. Những phần khác biệt giữa Node và app có thể có ý nghĩa riêng, nhưng không sửa lỗi cạnh tranh luồng đã quan sát trên receiver.

Không có trace của thời điểm A1 mất dòng nên không tuyên bố đã biết lịch luồng chính xác của A1. C1 tái hiện đúng trạng thái và triệu chứng với bằng chứng trực tiếp; instrumentation có thể ảnh hưởng thời gian chạy, nên không dùng lượt này để ước tính tần suất lỗi khi không hook. Đây là lỗi receiver đã được tái hiện, không phải bằng chứng rằng mọi tin không hiển thị đều cùng nguyên nhân.

Log chẩn đoán tạm: `/tmp/lit-list-trace.jsonl`, `/tmp/lit-list-trace-b1.jsonl`, `/tmp/lit-list-send-b1.jsonl`, `/tmp/lit-list-trace-c1.jsonl`, `/tmp/lit-list-send-c1.jsonl`. Bản sao dòng dữ liệu ở `/tmp/lit-c1-row-backup.json` (quyền 600). Các hook/script nằm ngoài repo; không sửa payload, mã risk hay dữ liệu thiết bị. `/tmp` không phải nơi lưu trữ bền vững.
