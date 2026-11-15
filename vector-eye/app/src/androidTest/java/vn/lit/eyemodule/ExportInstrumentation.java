package vn.lit.eyemodule;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

public final class ExportInstrumentation extends Instrumentation {
    private boolean exportOnly;
    @Override public void onCreate(Bundle args) { super.onCreate(args); exportOnly = args != null && "true".equals(args.getString("exportOnly")); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if (exportOnly) {
                java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
                AtomicReference<String> exported = new AtomicReference<>();
                Intent request = new Intent(AccountBridge.ACTION).setPackage("com.litatom.app");
                request.putExtra("reply", new android.os.ResultReceiver(new android.os.Handler(android.os.Looper.getMainLooper())) {
                    @Override protected void onReceiveResult(int code, Bundle data) {
                        if (code == 0) exported.set(data.getString("json"));
                        done.countDown();
                    }
                });
                getTargetContext().sendBroadcast(request);
                check(done.await(12, java.util.concurrent.TimeUnit.SECONDS) && exported.get() != null, "Current account export unavailable");
                JSONObject current = new JSONObject(exported.get());
                check(current.getInt("androidUser") == 10, "Wrong user");
                try (java.io.FileOutputStream file = getTargetContext().openFileOutput("current-account-export.json", Context.MODE_PRIVATE)) {
                    file.write(exported.get().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }
                result.putString("result", "PASS: current account exported to app-private file");
                finish(Activity.RESULT_OK, result);
                return;
            }
            try (android.os.ParcelFileDescriptor fd = getUiAutomation().executeShellCommand(
                    "am start --user 10 -n com.litatom.app/.DefaultLauncherAlias")) {
                try (java.io.FileInputStream in = new java.io.FileInputStream(fd.getFileDescriptor())) {
                    byte[] buffer = new byte[1024];
                    while (in.read(buffer) != -1) { }
                }
            }
            Thread.sleep(5000);
            Activity activity = startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();
            ViewGroup root = (ViewGroup) activity.getWindow().getDecorView();
            AtomicReference<Button> fetch = new AtomicReference<>(), copy = new AtomicReference<>();
            runOnMainSync(() -> { fetch.set(find(root, "Lấy tài khoản hiện tại")); copy.set(find(root, "Copy JSON")); });
            if (fetch.get() == null || copy.get() == null) throw new AssertionError("Missing buttons");
            runOnMainSync(() -> fetch.get().performClick());
            boolean enabled = false;
            for (int i = 0; i < 100; i++) {
                Thread.sleep(100);
                AtomicReference<Boolean> ready = new AtomicReference<>(false);
                runOnMainSync(() -> ready.set(copy.get().isEnabled()));
                if (ready.get()) { enabled = true; break; }
            }
            if (!enabled) throw new AssertionError("Export did not enable Copy JSON; open Litmatch after instrumentation starts");
            AtomicReference<Boolean> hidden = new AtomicReference<>(false), shown = new AtomicReference<>(false);
            runOnMainSync(() -> {
                hidden.set(!hasVisibleJson(root));
                find(root, "Xem JSON").performClick();
                shown.set(hasVisibleJson(root));
                find(root, "Ẩn JSON").performClick();
            });
            check(hidden.get() && shown.get(), "JSON preview toggle failed");
            check(getTargetContext().getPackageManager().checkPermission(AccountBridge.PERMISSION, "vn.lit.eyemodule")
                == android.content.pm.PackageManager.PERMISSION_GRANTED, "Eye permission missing");
            check(getTargetContext().getPackageManager().checkPermission(AccountBridge.PERMISSION, "com.android.shell")
                == android.content.pm.PackageManager.PERMISSION_DENIED, "Untrusted caller has export permission");
            AtomicReference<String> clipboard = new AtomicReference<>();
            runOnMainSync(() -> {
                copy.get().performClick();
                ClipboardManager manager = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.set(manager.getPrimaryClip().getItemAt(0).getText().toString());
            });
            JSONObject json = new JSONObject(clipboard.get());
            JSONObject account = json.getJSONObject("account"), profile = json.getJSONObject("profile"), env = json.getJSONObject("env");
            check(json.getInt("androidUser") == 10, "Wrong Android user");
            check(account.getString("userId").equals(profile.getString("user_id")), "Profile mismatch");
            check(account.getString("session").equals(env.getString("LIT_SID")), "Session mismatch");
            check(account.getString("hxPwd").equals(env.getString("HX_PASSWORD")), "Password mismatch");
            check(profile.getString("huanxin_id").equals(env.getString("HX_USERNAME")), "IM identity mismatch");
            for (String key : new String[] {"LIT_UUID", "HX_APP_KEY", "HX_USERNAME", "HX_PASSWORD"}) check(!env.getString(key).isEmpty(), "Missing " + key);
            result.putString("result", "PASS: fetch + preview toggle + Copy JSON + account/session/IM identity + permission checks");
            result.putInt("jsonCharacters", clipboard.get().length());
            result.putInt("profileFields", profile.length());
            result.putInt("missingFields", json.getJSONArray("missing").length());
            finish(Activity.RESULT_OK, result);
        } catch (Throwable e) {
            result.putString("result", "FAIL: " + e.getClass().getSimpleName());
            if (e instanceof AssertionError) result.putString("assertion", e.getMessage());
            finish(Activity.RESULT_CANCELED, result);
        }
    }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static boolean hasVisibleJson(View view) {
        if (view instanceof TextView && view.isShown() && ((TextView) view).getText().toString().startsWith("{")) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) if (hasVisibleJson(group.getChildAt(i))) return true;
        }
        return false;
    }
    private static Button find(View view, String label) {
        if (view instanceof Button && label.contentEquals(((TextView) view).getText())) return (Button) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) { Button found = find(group.getChildAt(i), label); if (found != null) return found; }
        }
        return null;
    }
}
