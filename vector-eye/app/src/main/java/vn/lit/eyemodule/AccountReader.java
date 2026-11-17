package vn.lit.eyemodule;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Process;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.Method;

/**
 * Reads the logged-in Litmatch account entirely from stable storage keys.
 *
 * <p>Earlier versions resolved the session/profile through obfuscated Litmatch
 * classes ({@code com.lit.app.model.b0}, {@code xl.d}). R8 reassigns those names
 * on every app build, so after a Litmatch update the reflected methods vanish and
 * the read fails. The values we need are all stored under stable string keys that
 * survive obfuscation, so we read those directly:
 * <ul>
 *   <li>{@code litmatch_key_info} (session / userId / hxPwd) — default MMKV</li>
 *   <li>{@code sp_user_info} (profile: user_id, huanxin_id, …) — MMKV "lit_app_default_kv"</li>
 *   <li>{@code device_id} — default MMKV, else SharedPreferences "device_id.xml"</li>
 * </ul>
 * Only the Hyphenate IM client ({@code com.hyphenate.chat.EMClient}) is still read
 * reflectively — it is a stable third-party library, not obfuscated.
 */
final class AccountReader {
    private static Object call(Object target, String name) throws Exception {
        return target.getClass().getMethod(name).invoke(target);
    }

    /** Read a String from an MMKV instance by key via reflection; "" when absent. */
    private static String mmkvString(Method getString, Object instance, String key) throws Exception {
        Object v = getString.invoke(instance, key, "");
        return v == null ? "" : (String) v;
    }

    private static String orEmptyJson(String s) {
        return (s == null || s.isEmpty()) ? "{}" : s;
    }

    static JSONObject read(Context context) throws Exception {
        ClassLoader loader = context.getClassLoader();
        Class<?> mmkvClass = loader.loadClass("com.tencent.mmkv.MMKV");
        Method getString = mmkvClass.getMethod("getString", String.class, String.class);
        Object def = mmkvClass.getMethod("defaultMMKV").invoke(null);

        // --- Credentials: stable key in the default MMKV ---
        JSONObject key = new JSONObject(orEmptyJson(mmkvString(getString, def, "litmatch_key_info")));
        String sid = key.optString("session");
        String userId = key.optString("userId");
        if (sid.isEmpty() || userId.isEmpty()) {
            throw new IllegalStateException("Chưa có tài khoản đăng nhập trong Litmatch user 0.");
        }

        // --- Profile: sp_user_info lives in the "lit_app_default_kv" MMKV instance ---
        String storedProfile = mmkvString(getString, def, "sp_user_info");
        if (storedProfile.isEmpty()) {
            Object appKv = mmkvClass.getMethod("mmkvWithID", String.class).invoke(null, "lit_app_default_kv");
            storedProfile = mmkvString(getString, appKv, "sp_user_info");
        }
        JSONObject profile = new JSONObject(orEmptyJson(storedProfile));
        if (!userId.equals(profile.optString("user_id"))) {
            throw new IllegalStateException("Hồ sơ lưu chưa khớp tài khoản hiện tại. Mở trang cá nhân rồi thử lại.");
        }

        // --- device_id: default MMKV, else SharedPreferences fallbacks ---
        String deviceId = mmkvString(getString, def, "device_id");
        if (deviceId.isEmpty()) {
            SharedPreferences sp = context.getSharedPreferences("device_id.xml", Context.MODE_PRIVATE);
            deviceId = sp.getString("device_id", "");
        }
        if (deviceId.isEmpty()) {
            SharedPreferences sp = context.getSharedPreferences("prefs_device_id_bak", Context.MODE_PRIVATE);
            deviceId = sp.getString("device_id_bak", "");
        }

        JSONObject env = new JSONObject();
        JSONArray missing = new JSONArray();
        env.put("LIT_USER_ID", userId);
        env.put("LIT_SID", sid);
        env.put("LIT_PLATFORM", "android");
        env.put("LIT_VERSION", context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName);
        put(env, missing, "LIT_UUID", deviceId);
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

        return new JSONObject().put("schemaVersion", 1).put("capturedAt", System.currentTimeMillis())
            .put("androidUser", Process.myUid() / 100000).put("packageName", context.getPackageName())
            .put("account", key).put("env", env).put("im", im)
            .put("missing", missing)
            .put("source", "Litmatch process: MMKV litmatch_key_info + lit_app_default_kv/sp_user_info + device_id prefs + EMClient");
    }

    private static void put(JSONObject env, JSONArray missing, String name, Object value) throws Exception {
        if (value instanceof String && !((String) value).isEmpty()) env.put(name, value);
        else missing.put(name);
    }
}
