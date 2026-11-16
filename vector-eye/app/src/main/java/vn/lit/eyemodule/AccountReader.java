package vn.lit.eyemodule;

import android.content.Context;
import android.os.Process;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.Method;

final class AccountReader {
    private static Object call(Object target, String name) throws Exception {
        return target.getClass().getMethod(name).invoke(target);
    }

    static JSONObject read(Context context) throws Exception {
        ClassLoader loader = context.getClassLoader();
        Class<?> mmkvClass = loader.loadClass("com.tencent.mmkv.MMKV");
        Object mmkv = mmkvClass.getMethod("defaultMMKV").invoke(null);
        Method getString = mmkvClass.getMethod("getString", String.class, String.class);
        JSONObject key = new JSONObject((String) getString.invoke(mmkv, "litmatch_key_info", "{}"));
        Class<?> sessionClass = loader.loadClass("com.lit.app.model.b0");
        String sid = (String) sessionClass.getMethod("b").invoke(null);
        String userId = (String) sessionClass.getMethod("c").invoke(null);
        if (sid == null || sid.isEmpty() || userId == null || userId.isEmpty()) {
            throw new IllegalStateException("Chưa có tài khoản đăng nhập trong Litmatch user 0.");
        }
        if (!sid.equals(key.optString("session")) || !userId.equals(key.optString("userId"))) {
            throw new IllegalStateException("Tài khoản đang thay đổi. Chờ Litmatch lưu xong rồi lấy lại.");
        }
        String stored = (String) loader.loadClass("xl.d").getMethod("a0", String.class, String.class)
            .invoke(null, "sp_user_info", "{}");
        JSONObject profile = new JSONObject(stored.isEmpty() ? "{}" : stored);
        if (!userId.equals(profile.optString("user_id"))) {
            throw new IllegalStateException("Hồ sơ lưu chưa khớp tài khoản hiện tại. Mở trang cá nhân rồi thử lại.");
        }
        JSONObject env = new JSONObject();
        JSONArray missing = new JSONArray();
        env.put("LIT_USER_ID", userId);
        env.put("LIT_SID", sid);
        env.put("LIT_PLATFORM", "android");
        env.put("LIT_VERSION", context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName);
        put(env, missing, "LIT_UUID", getString.invoke(mmkv, "device_id", ""));
        put(env, missing, "HX_USERNAME", profile.optString("huanxin_id"));
        put(env, missing, "HX_PASSWORD", key.optString("hxPwd"));
        JSONObject im = new JSONObject();
        try {
            Object client = loader.loadClass("com.hyphenate.chat.EMClient").getMethod("getInstance").invoke(null);
            String current = (String) call(client, "getCurrentUser");
            if (current != null && !current.isEmpty() && !current.equals(profile.optString("huanxin_id"))) {
                throw new IllegalStateException("Phiên IM chưa khớp tài khoản Litmatch. Mở lại Litmatch rồi thử lại.");
            }
            Object options = call(client, "getOptions");
            put(env, missing, "HX_APP_KEY", call(options, "getAppKey"));
            Object host = call(options, "getImServer");
            im.put("configuredHost", host == null ? JSONObject.NULL : host);
            im.put("configuredPort", call(options, "getImPort"));
            Object rest = call(options, "getRestServer");
            im.put("configuredRestServer", rest == null ? JSONObject.NULL : rest);
            im.put("loggedIn", call(client, "isLoggedIn"));
        } catch (IllegalStateException e) { throw e; }
        catch (Exception e) { missing.put("HX_APP_KEY/configured IM options"); }
        if (!sid.equals(sessionClass.getMethod("b").invoke(null)) || !userId.equals(sessionClass.getMethod("c").invoke(null))) {
            throw new IllegalStateException("Tài khoản vừa thay đổi. Hãy lấy lại JSON.");
        }
        return new JSONObject().put("schemaVersion", 1).put("capturedAt", System.currentTimeMillis())
            .put("androidUser", Process.myUid() / 100000).put("packageName", context.getPackageName())
            .put("account", key).put("profile", profile).put("env", env).put("im", im)
            .put("missing", missing).put("source", "Litmatch process: current session + MMKV + EMClient");
    }

    private static void put(JSONObject env, JSONArray missing, String name, Object value) throws Exception {
        if (value instanceof String && !((String) value).isEmpty()) env.put(name, value);
        else missing.put(name);
    }
}
