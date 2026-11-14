package vn.lit.eyemodule;

import android.app.Activity;
import android.content.ClipData;
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
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status, preview;
    private Button fetch, copy, show;
    private String accountJson;
    private int requestId;
    private boolean waiting, visible;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);
        scroll.addView(layout);
        TextView title = text(layout, "Eye · Tài khoản", 28);
        title.setTextColor(Color.rgb(23, 43, 77));
        text(layout, "Lấy JSON của tài khoản Litmatch đang đăng nhập trên user 10.", 16);
        status = text(layout, "Mở Litmatch một lần, sau đó quay lại Eye và bấm Lấy tài khoản.", 16);
        Button open = button(layout, "Mở Litmatch");
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
        setContentView(scroll);
        if (Process.myUid() / 100000 != 10) {
            status.setText("Hãy mở Eye trong user 10 để lấy đúng tài khoản Litmatch.");
            fetch.setEnabled(false);
            open.setEnabled(false);
        }
    }

    private void requestAccount() {
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
                fetch.setEnabled(true);
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
            fetch.setEnabled(true);
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
        waiting = false;
        handler.removeCallbacksAndMessages(null);
        accountJson = null;
        super.onDestroy();
    }
}
