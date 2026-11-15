package vn.lit.eyemodule;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.os.Process;
import android.os.ResultReceiver;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status, preview;
    private Button fetch, copy, show;
    private String accountJson;
    private int requestId;
    private boolean waiting, visible;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final DeviceController devices = new DeviceController();
    private DeviceController.Snapshot deviceSnapshot;
    private TextView deviceStatus, devicePreview;
    private Button readDevice, rotateDevice, resetDevice, verifyDevice, open, rootManager;
    private boolean deviceBusy, deviceWaiting;
    private int deviceRequestId;
    private final boolean controllerUser = isControllerUser();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);
        scroll.addView(layout);
        TextView title = text(layout, "Eye · Tài khoản và thiết bị", 28);
        title.setTextColor(Color.rgb(23, 43, 77));
        text(layout, "Lấy JSON của tài khoản Litmatch đang đăng nhập trên user 10.", 16);
        status = text(layout, controllerUser && Process.myUid() / 100000 == 0
            ? "Eye user 0 có thể điều khiển Hide My Device cho Litmatch/user 10."
            : "Mở Litmatch một lần, sau đó quay lại Eye và bấm Lấy tài khoản.", 16);
        open = button(layout, "Mở Litmatch");
        open.setOnClickListener(v -> {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.litatom.app");
            if (launch != null) startActivity(launch);
            else status.setText("Không có Litmatch trong user Android này.");
        });
        fetch = button(layout, "Lấy tài khoản hiện tại");
        fetch.setOnClickListener(v -> requestAccount());
        copy = button(layout, "Copy JSON");
        copy.setEnabled(false);
        copy.setOnClickListener(v -> {
            if (accountJson == null) return;
            ClipData clip = ClipData.newPlainText("Litmatch account JSON", accountJson);
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
            ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(clip);
            Toast.makeText(this, "Đã copy JSON tài khoản", Toast.LENGTH_SHORT).show();
        });
        show = button(layout, "Xem JSON");
        show.setEnabled(false);
        show.setOnClickListener(v -> {
            visible = !visible;
            preview.setText(visible ? accountJson : "");
            preview.setVisibility(visible ? View.VISIBLE : View.GONE);
            show.setText(visible ? "Ẩn JSON" : "Xem JSON");
        });
        text(layout, "JSON chứa phiên đăng nhập và thông tin IM của bạn. Chỉ copy khi cần sử dụng.", 14);
        preview = text(layout, "", 13);
        preview.setTypeface(android.graphics.Typeface.MONOSPACE);
        preview.setTextIsSelectable(true);
        preview.setVisibility(View.GONE);
        text(layout, "Thiết bị · Litmatch / user 10", 22);
        text(layout, "Điều khiển Hide My Device ngay trong Eye. Cần cấp quyền root cho Eye; module Hide My Device vẫn phải bật trong Vector.", 15);
        text(layout, "Hỗ trợ 18 trường của Hide My Device. device/product/board/hardware chưa được module này thay đổi.", 14);
        rootManager = button(layout, "Mở trình quản lý root để cấp quyền cho Eye");
        rootManager.setOnClickListener(v -> openRootManager());
        deviceStatus = text(layout, "Bấm Đọc cấu hình để xem thông tin đang lưu.", 15);
        readDevice = button(layout, "Đọc cấu hình thiết bị");
        readDevice.setOnClickListener(v -> runDeviceAction(false, false));
        rotateDevice = button(layout, "Đổi thông tin · giữ UUID");
        rotateDevice.setOnClickListener(v -> confirmDeviceChange(false));
        resetDevice = button(layout, "Xóa dữ liệu Litmatch và đổi thiết bị");
        resetDevice.setOnClickListener(v -> confirmDeviceChange(true));
        verifyDevice = button(layout, "Kiểm tra thiết bị trong Litmatch");
        verifyDevice.setOnClickListener(v -> requestDeviceReport());
        devicePreview = text(layout, "", 13);
        devicePreview.setTypeface(android.graphics.Typeface.MONOSPACE);
        devicePreview.setTextIsSelectable(true);
        updateDeviceButtons();
        setContentView(scroll);
        if (!controllerUser) {
            status.setText("Mở Eye ở user 0 hoặc user 10 để điều khiển Litmatch/user 10.");
            fetch.setEnabled(false);
            open.setEnabled(false);
            rootManager.setEnabled(false);
            readDevice.setEnabled(false); rotateDevice.setEnabled(false); resetDevice.setEnabled(false); verifyDevice.setEnabled(false);
        } else if (Process.myUid() / 100000 == 0) {
            // Account export is scoped to the Litmatch process in user 10. User 0 is a device controller only.
            fetch.setEnabled(false);
            open.setEnabled(false);
            verifyDevice.setEnabled(false);
        }
    }

    private void updateDeviceButtons() {
        boolean available = !deviceBusy && !deviceWaiting && controllerUser;
        readDevice.setEnabled(available);
        rotateDevice.setEnabled(available && deviceSnapshot != null);
        resetDevice.setEnabled(available && deviceSnapshot != null);
        verifyDevice.setEnabled(available);
        open.setEnabled(available && Process.myUid() / 100000 == 10);
        rootManager.setEnabled(controllerUser);
        fetch.setEnabled(available && Process.myUid() / 100000 == 10 && !waiting);
    }

    private static boolean isControllerUser() {
        int user = Process.myUid() / 100000;
        return user == 0 || user == 10;
    }

    private void openRootManager() {
        String[] packages = {"me.yuki.folk", "me.bmax.apatch", "com.topjohnwu.magisk"};
        for (String packageName : packages) {
            Intent launch = getPackageManager().getLaunchIntentForPackage(packageName);
            if (launch == null && "me.yuki.folk".equals(packageName)) {
                launch = new Intent().setComponent(new ComponentName(packageName,
                    "me.bmax.apatch.ui.MainActivityAliasAnime"));
            }
            if (launch != null) {
                startActivity(launch);
                deviceStatus.setText("Trong trình quản lý root, cấp ROOT cho Eye ở user 10 rồi quay lại đọc cấu hình.");
                return;
            }
        }
        deviceStatus.setText("Không tìm thấy trình quản lý root. Cài/mở APatch, KernelSU hoặc Magisk rồi cấp ROOT cho Eye.");
    }

    private void confirmDeviceChange(boolean clear) {
        if (deviceBusy || deviceWaiting || deviceSnapshot == null) return;
        new AlertDialog.Builder(this)
            .setTitle(clear ? "Xóa dữ liệu và tạo thiết bị mới?" : "Đổi thông tin thiết bị?")
            .setMessage(clear
                ? "Xóa toàn bộ dữ liệu Litmatch ở user 10: phiên đăng nhập, tin nhắn lưu trên máy và cài đặt. Sau đó dùng bộ thông tin mới, gồm Android ID/UUID mới. Bạn phải đăng nhập lại. Tài khoản Google trên Android không bị xóa. Không thể hoàn tác dữ liệu Litmatch đã xóa."
                : "Litmatch sẽ đóng. Đổi các trường Hide My Device nhưng giữ Android ID/UUID hiện tại và giữ dữ liệu Litmatch. Các thông tin khác thay đổi vẫn có thể khiến server yêu cầu đăng nhập lại.")
            .setNegativeButton("Hủy", null)
            .setPositiveButton(clear ? "Xóa và đổi thiết bị" : "Đổi thông tin", (dialog, which) -> runDeviceAction(true, clear))
            .show();
    }

    private void runDeviceAction(boolean mutate, boolean clear) {
        if (deviceBusy || deviceWaiting) return;
        deviceBusy = true; deviceRequestId++;
        if (mutate) forgetAccount();
        updateDeviceButtons();
        deviceStatus.setText(mutate ? "Đang cập nhật thiết bị…" : "Đang đọc cấu hình. Eye cần được cấp quyền trong trình quản lý root của máy.");
        DeviceController.Snapshot before = deviceSnapshot;
        worker.execute(() -> {
            try {
                DeviceController.Snapshot result = mutate ? devices.rotate(before, clear) : devices.read();
                handler.post(() -> {
                    if (isDestroyed()) return;
                    deviceBusy = false; deviceSnapshot = result; updateDeviceButtons();
                    devicePreview.setText(result.description());
                    deviceStatus.setText(mutate
                        ? clear ? "Đã xóa dữ liệu Litmatch và tạo thiết bị mới. Bấm Mở Litmatch để đăng nhập lại."
                            : "Đã đổi cấu hình và giữ UUID. Bấm Mở Litmatch, rồi Kiểm tra thiết bị để xác minh app đã nhận."
                        : "Đã đọc cấu hình. Đây là thông tin đã lưu; dùng Kiểm tra thiết bị để xem giá trị trong tiến trình Litmatch.");
                });
            } catch (Exception error) {
                android.util.Log.w("VectorEye", "Device action failed: " + error.getClass().getSimpleName());
                handler.post(() -> {
                    if (isDestroyed()) return;
                    deviceBusy = false; deviceSnapshot = null; updateDeviceButtons();
                    devicePreview.setText("");
                    deviceStatus.setText(error instanceof IllegalStateException || error instanceof IllegalArgumentException
                        ? error.getMessage() : "Không thực hiện được thao tác (" + error.getClass().getSimpleName() + "). Kiểm tra quyền root và đọc lại cấu hình.");
                });
            }
        });
    }

    private void forgetAccount() {
        requestId++; waiting = false;
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (accountJson != null && clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0
                && accountJson.contentEquals(String.valueOf(clipboard.getPrimaryClip().getItemAt(0).getText()))) {
            if (android.os.Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip();
            else clipboard.setPrimaryClip(ClipData.newPlainText("", ""));
        }
        accountJson = null; visible = false; preview.setText(""); preview.setVisibility(View.GONE);
        show.setText("Xem JSON"); show.setEnabled(false); copy.setEnabled(false);
        status.setText("Bản chụp tài khoản đã bỏ. Lấy lại sau khi mở Litmatch.");
    }

    private void requestDeviceReport() {
        if (deviceBusy || deviceWaiting || Process.myUid() / 100000 != 10) {
            if (Process.myUid() / 100000 == 0) deviceStatus.setText("Kiểm tra trong tiến trình Litmatch cần mở Eye ở user 10.");
            return;
        }
        int id = ++deviceRequestId;
        deviceWaiting = true;
        updateDeviceButtons();
        deviceStatus.setText("Đang đọc thiết bị từ tiến trình Litmatch…");
        Intent intent = new Intent(AccountBridge.DEVICE_ACTION).setPackage(DeviceController.TARGET);
        intent.putExtra("reply", new ResultReceiver(handler) {
            @Override protected void onReceiveResult(int code, Bundle data) {
                if (id != deviceRequestId || isDestroyed()) return;
                deviceRequestId++; deviceWaiting = false; updateDeviceButtons();
                if (code != 0) { deviceStatus.setText("Chưa đọc được thiết bị. Mở Litmatch rồi thử lại."); return; }
                try {
                    JSONObject actual = new JSONObject(data.getString("json"));
                    String match = "Chưa đọc cấu hình để đối chiếu.";
                    if (deviceSnapshot != null) {
                        boolean same = true;
                        for (String key : new String[]{"android_id", "brand", "manufacturer", "model"})
                            same &= actual.optString(key).equals(String.valueOf(deviceSnapshot.settings.get(key)));
                        match = same ? "UUID, brand, manufacturer và model khớp cấu hình." : "Thông tin chưa khớp cấu hình. Hãy đóng/mở lại Litmatch và kiểm tra Vector.";
                    }
                    deviceStatus.setText("Đã đọc từ Litmatch. " + match);
                    devicePreview.setText(actual.toString(2));
                } catch (Exception error) { deviceStatus.setText("Phản hồi thiết bị không hợp lệ."); }
            }
        });
        sendBroadcast(intent);
        handler.postDelayed(() -> {
            if (id != deviceRequestId || isDestroyed()) return;
            deviceRequestId++; deviceWaiting = false; updateDeviceButtons();
            deviceStatus.setText("Không nhận được phản hồi. Mở Litmatch sau khi cập nhật Eye, rồi thử lại.");
        }, 8000);
    }

    private void requestAccount() {
        if (deviceBusy || deviceWaiting || waiting || Process.myUid() / 100000 != 10) return;
        int id = ++requestId;
        waiting = true;
        accountJson = null;
        visible = false;
        preview.setVisibility(View.GONE);
        show.setText("Xem JSON");
        copy.setEnabled(false);
        show.setEnabled(false);
        preview.setText("");
        fetch.setEnabled(false);
        status.setText("Đang lấy tài khoản từ Litmatch…");
        Intent request = new Intent(AccountBridge.ACTION).setPackage("com.litatom.app");
        request.putExtra("reply", new ResultReceiver(handler) {
            @Override protected void onReceiveResult(int code, Bundle data) {
                if (id != requestId || !waiting || isDestroyed()) return;
                waiting = false;
                updateDeviceButtons();
                if (code != 0) { status.setText(data.getString("error", "Không lấy được tài khoản.")); return; }
                try {
                    String value = data.getString("json");
                    JSONObject root = new JSONObject(value);
                    JSONObject profile = root.getJSONObject("profile");
                    status.setText("Đã lấy: " + profile.optString("nickname", "Tài khoản") + "\nUser ID: "
                        + root.getJSONObject("account").getString("userId") + "\nTrường chưa có: " + root.getJSONArray("missing").length());
                    accountJson = value;
                    copy.setEnabled(true);
                    show.setEnabled(true);
                } catch (Exception e) { status.setText("Dữ liệu trả về không hợp lệ. Hãy lấy lại."); }
            }
        });
        sendBroadcast(request);
        handler.postDelayed(() -> {
            if (id != requestId || !waiting || isDestroyed()) return;
            waiting = false;
            updateDeviceButtons();
            status.setText("Chưa nhận được phản hồi. Bật Eye cho Litmatch user 10 trong Vector, đóng/mở lại Litmatch rồi thử lại.");
        }, 8000);
    }

    private TextView text(LinearLayout layout, String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setPadding(0, 12, 0, 12);
        layout.addView(view);
        return view;
    }
    private Button button(LinearLayout layout, String label) {
        Button view = new Button(this);
        view.setText(label);
        view.setAllCaps(false);
        layout.addView(view, new LinearLayout.LayoutParams(-1, -2));
        return view;
    }
    @Override protected void onDestroy() {
        requestId++;
        deviceRequestId++;
        worker.shutdown();
        waiting = false;
        handler.removeCallbacksAndMessages(null);
        accountJson = null;
        super.onDestroy();
    }
}
