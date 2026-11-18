package vn.lit.eyemodule;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Process;
import java.util.Base64;
import java.util.Arrays;
import java.io.StringReader;
import javax.xml.parsers.DocumentBuilderFactory;
import org.xml.sax.InputSource;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

/** Reads the last persisted account from Litmatch user 0. No network or running app required.
 * Storage names are version-specific; unsupported/corrupt MMKV is rejected, never scanned.
 */
final class RootAccountReader {
    private static final String PKG = "com.litatom.app";
    private static final String MMKV_DIR = "/data/user/0/" + PKG + "/files/mmkv";
    private static final String PREFS_DIR = "/data/user/0/" + PKG + "/shared_prefs";
    private static final int MAX_FILE = 8 * 1024 * 1024;
    interface Storage { byte[] read(String path) throws Exception; }

    static JSONObject read(Context context) throws Exception {
        return read(RootAccountReader::readFileRoot, Process.myUid() / 100000,
            litVersion(context), metaData(context, "EASEMOB_APPKEY"));
    }

    static JSONObject read(Storage storage, int androidUser, String version, String appKey) throws Exception {
        if (androidUser != 0) throw new IllegalStateException("Mở Eye ở user 0 để đọc tài khoản Litmatch/user 0.");
        MmkvSnapshot def = snapshot(storage, "mmkv.default");
        String keyJson = def.string("litmatch_key_info");
        JSONObject key = asJson(keyJson);
        String sid = stringField(key, "session");
        String userId = stringField(key, "userId");
        if (sid.isEmpty() || userId.isEmpty()) {
            throw new IllegalStateException("Chưa có tài khoản đăng nhập trong Litmatch user 0.");
        }

        // --- Profile (for huanxin_id + user_id cross-check) ---
        MmkvSnapshot appKv = snapshot(storage, "lit_app_default_kv");
        String profileJson = appKv.string("sp_user_info");
        JSONObject profile = asJson(profileJson);
        if (!userId.equals(stringField(profile, "user_id"))) {
            throw new IllegalStateException("Hồ sơ lưu chưa khớp tài khoản hiện tại. Mở Litmatch (vào trang cá nhân) rồi thử lại.");
        }

        String deviceId = deviceId(storage, def);

        // Re-read after both stores and preference fallbacks. This detects account switches;
        // it cannot promise an atomic transaction across independent files or server validity.
        MmkvSnapshot latestDef = snapshot(storage, "mmkv.default");
        MmkvSnapshot latestApp = snapshot(storage, "lit_app_default_kv");
        if (!keyJson.equals(latestDef.string("litmatch_key_info"))
                || !profileJson.equals(latestApp.string("sp_user_info"))
                || !deviceId.equals(deviceId(storage, latestDef))) {
            throw new IllegalStateException("Tài khoản đang thay đổi. Chờ Litmatch lưu xong rồi lấy lại.");
        }

        JSONObject env = new JSONObject();
        JSONArray missing = new JSONArray();
        env.put("LIT_USER_ID", userId);
        env.put("LIT_SID", sid);
        env.put("LIT_PLATFORM", "android");
        put(env, missing, "LIT_VERSION", version);
        put(env, missing, "LIT_UUID", deviceId);
        put(env, missing, "HX_USERNAME", stringField(profile, "huanxin_id"));
        put(env, missing, "HX_PASSWORD", stringField(key, "hxPwd"));
        put(env, missing, "HX_APP_KEY", appKey);

        JSONObject result = new JSONObject()
            .put("schemaVersion", 1).put("capturedAt", System.currentTimeMillis())
            .put("androidUser", androidUser).put("packageName", PKG)
            .put("account", key).put("env", env).put("missing", missing)
            .put("captureMode", "persisted-storage")
            .put("source", "Root: MMKV litmatch_key_info + lit_app_default_kv/sp_user_info + device_id + manifest EASEMOB_APPKEY (no Xposed, Litmatch not required to be running)");
        if (result.toString(2).length() > 180000) throw new IllegalStateException("Dữ liệu vượt giới hạn xuất JSON.");
        return result;
    }

    private static MmkvSnapshot snapshot(Storage storage, String name) throws Exception {
        String path = MMKV_DIR + "/" + name;
        byte[] before = storage.read(path + ".crc");
        byte[] data = storage.read(path);
        byte[] after = storage.read(path + ".crc");
        if (data.length == 0 || before.length == 0 || after.length == 0) {
            throw new IllegalStateException("Chưa có dữ liệu MMKV của Litmatch user 0. Mở Litmatch và đăng nhập rồi lấy lại.");
        }
        if (!Arrays.equals(before, after)) {
            throw new IllegalStateException("Litmatch đang lưu dữ liệu. Chờ một chút rồi lấy lại.");
        }
        return new MmkvSnapshot(data, after);
    }

    /** Binary-safe, bounded, read-only transport. Missing and unreadable are different states. */
    private static byte[] readFileRoot(String path) throws Exception {
        String quoted = RootShell.quote(path);
        String encoded = RootShell.runReadOnly("set -o pipefail\n"
            + "if [ ! -e " + quoted + " ]; then printf EYE_MISSING; exit 0; fi\n"
            + "[ -f " + quoted + " ] && [ -r " + quoted + " ] || exit 1\n"
            + "size=$(wc -c < " + quoted + ") || exit 1\n"
            + "[ \"$size\" -le " + MAX_FILE + " ] || exit 1\n"
            + "gzip -c " + quoted + " 2>/dev/null | base64");
        if ("EYE_MISSING".equals(encoded)) return new byte[0];
        byte[] compressed = Base64.getDecoder().decode(encoded.replaceAll("\\s", ""));
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(compressed));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) {
                if (out.size() > MAX_FILE - count) throw new IllegalStateException("File dữ liệu Litmatch vượt giới hạn đọc.");
                out.write(buffer, 0, count);
            }
            return out.toByteArray();
        }
    }

    private static String deviceId(Storage storage, MmkvSnapshot defaults) throws Exception {
        String value = defaults.string("device_id");
        if (value.isEmpty()) value = prefString(storage.read(PREFS_DIR + "/device_id.xml.xml"), "device_id");
        if (value.isEmpty()) value = prefString(storage.read(PREFS_DIR + "/prefs_device_id_bak.xml"), "device_id_bak");
        return value;
    }

    static String prefString(byte[] bytes, String name) throws Exception {
        if (bytes.length == 0) return "";
        String xml = new String(bytes, StandardCharsets.UTF_8);
        if (xml.contains("<!DOCTYPE")) throw new IllegalStateException("SharedPreferences chứa DTD không được hỗ trợ.");
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setExpandEntityReferences(false);
        javax.xml.parsers.DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler() {
            @Override public void error(org.xml.sax.SAXParseException e) throws org.xml.sax.SAXException { throw e; }
            @Override public void fatalError(org.xml.sax.SAXParseException e) throws org.xml.sax.SAXException { throw e; }
        });
        Element root = builder.parse(new InputSource(new StringReader(xml))).getDocumentElement();
        if (!"map".equals(root.getTagName())) throw new IllegalStateException("SharedPreferences không đúng định dạng.");
        NodeList children = root.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            if (!(children.item(i) instanceof Element)) continue;
            Element item = (Element) children.item(i);
            if ("string".equals(item.getTagName()) && name.equals(item.getAttribute("name"))) return item.getTextContent();
        }
        return "";
    }

    // ---- misc ----

    private static String stringField(JSONObject value, String name) {
        Object field = value.opt(name);
        return field instanceof String ? (String) field : "";
    }

    private static JSONObject asJson(String s) throws Exception {
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) return new JSONObject();
        try { return new JSONObject(s); }
        catch (org.json.JSONException error) { throw new IllegalStateException("JSON tài khoản đã lưu không hợp lệ. Mở Litmatch rồi lấy lại."); }
    }

    private static String metaData(Context ctx, String name) {
        try {
            ApplicationInfo ai = ctx.getPackageManager().getApplicationInfo(PKG, PackageManager.GET_META_DATA);
            Object v = ai.metaData != null ? ai.metaData.get(name) : null;
            return v == null ? "" : String.valueOf(v);
        } catch (Exception e) { return ""; }
    }

    private static String litVersion(Context ctx) {
        try { return ctx.getPackageManager().getPackageInfo(PKG, 0).versionName; }
        catch (Exception e) { return ""; }
    }

    private static void put(JSONObject env, JSONArray missing, String name, String value) throws Exception {
        if (value != null && !value.isEmpty()) env.put(name, value);
        else missing.put(name);
    }
}
