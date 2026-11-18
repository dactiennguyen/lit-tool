package vn.lit.eyemodule;

import android.app.Application;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.util.Log;
import java.util.concurrent.atomic.AtomicBoolean;

public final class AccountBridge {
    static final String DEVICE_ACTION = "vn.lit.eyemodule.READ_DEVICE";
    static final String PERMISSION = "vn.lit.eyemodule.permission.EXPORT_ACCOUNT";
    private static final AtomicBoolean started = new AtomicBoolean();

    static void start() {
        if (!started.compareAndSet(false, true)) return;
        Handler handler = new Handler(Looper.getMainLooper());
        handler.post(new Runnable() {
            int tries;
            @Override public void run() {
                try {
                    Class<?> activityThread = Class.forName("android.app.ActivityThread");
                    Application app = (Application) activityThread.getMethod("currentApplication").invoke(null);
                    if (app == null) {
                        if (++tries < 120) handler.postDelayed(this, 500);
                        return;
                    }
                    register(app);
                } catch (Throwable e) {
                    Log.w("VectorEye", "Account bridge unavailable: " + e.getClass().getSimpleName());
                }
            }
        });
    }

    // Before API 33 the signature permission protects this exported receiver; the flag is unavailable.
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    private static void register(Context context) {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent intent) {
                if (!DEVICE_ACTION.equals(intent.getAction())) return;
                ResultReceiver reply = intent.getParcelableExtra("reply");
                if (reply == null) return;
                Bundle result = new Bundle();
                try {
                    String json = DeviceReport.read(c).toString(2);
                    if (json.length() > 180000) throw new IllegalStateException("Dữ liệu vượt giới hạn xuất JSON.");
                    result.putString("json", json);
                    reply.send(0, result);
                } catch (Throwable e) {
                    result.putString("error", e instanceof IllegalStateException ? e.getMessage()
                        : "Không đọc được thiết bị trên phiên bản Litmatch này. Mở Litmatch rồi thử lại.");
                    reply.send(1, result);
                }
            }
        };
        IntentFilter filter = new IntentFilter(DEVICE_ACTION);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, PERMISSION, null, Context.RECEIVER_EXPORTED);
        else context.registerReceiver(receiver, filter, PERMISSION, null);
        Log.i("VectorEye", "Device bridge ready");
    }
}
