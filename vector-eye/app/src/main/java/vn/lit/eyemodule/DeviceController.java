package vn.lit.eyemodule;

import android.util.Base64;
import android.util.Xml;
import java.io.StringReader;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlSerializer;

final class DeviceController {
    static final String HMD = "io.github.imkamaran.hidemydevice";
    static final String TARGET = "com.litatom.app";
    private static final String CLI = "/data/adb/lspd/cli";
    private static final String APP_PREFS = "/data/user/0/" + HMD + "/shared_prefs/ids.xml";
    private final RootShell.Runner shell;

    static final class Snapshot {
        final LinkedHashMap<String, String> files;
        final LinkedHashMap<String, Object> settings;
        Snapshot(LinkedHashMap<String, String> files, LinkedHashMap<String, Object> settings) {
            this.files = files; this.settings = settings;
        }
        String androidId() { return String.valueOf(settings.getOrDefault("android_id", "")); }
        String description() {
            StringBuilder out = new StringBuilder("Hide My Device: ")
                .append(Boolean.TRUE.equals(settings.get("enabled")) ? "bật" : "tắt")
                .append(" · Litmatch / user 0\n");
            for (String key : DeviceIdentity.FIELDS) out.append(key).append(": ").append(settings.getOrDefault(key, "—")).append('\n');
            return out.toString();
        }
    }
    DeviceController() { this(RootShell::run); }
    DeviceController(RootShell.Runner shell) { this.shell = shell; }

    Snapshot read() throws Exception {
        checkScope();
        String paths = shell.run("set -eu\nfor p in /data/misc/*/prefs/" + HMD + "/ids.xml; do\n"
            + "  if [ -f \"$p\" ] && [ ! -L \"$p\" ]; then printf '%s\\n' \"$p\"; fi\ndone");
        String[] found = paths.trim().split("\\r?\\n");
        if (found.length != 1 || !found[0].matches("/data/misc/[A-Za-z0-9-]+/prefs/" + HMD.replace(".", "\\.") + "/ids\\.xml"))
            throw new IllegalStateException("Không xác định được cấu hình Vector user 0. Mở Hide My Device và lưu cấu hình một lần.");
        LinkedHashMap<String, String> files = new LinkedHashMap<>();
        for (String path : new String[]{found[0]}) {
            String encoded = shell.run("set -eu\np=" + RootShell.quote(path) + "\n[ -f \"$p\" ] && [ ! -L \"$p\" ]\nbase64 \"$p\"");
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length > 65536) throw new IllegalStateException("Cấu hình thiết bị quá lớn.");
            String xml = new String(bytes, StandardCharsets.UTF_8);
            parse(xml);
            files.put(path, xml);
        }
        return new Snapshot(files, parse(files.get(found[0])));
    }

    void checkScope() throws Exception {
        JSONObject modules = new JSONObject(shell.run(CLI + " modules ls --json"));
        boolean active = false;
        JSONArray rows = modules.getJSONArray("data");
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (HMD.equals(row.optString("PACKAGE")) && "enabled".equals(row.optString("STATUS")) && row.optInt("UID") / 100000 == 0) active = true;
        }
        if (!modules.optBoolean("success") || !active) throw new IllegalStateException("Bật Hide My Device cho user 0 trong Vector trước.");
        JSONObject scope = new JSONObject(shell.run(CLI + " scope ls " + HMD + " --json"));
        JSONArray apps = scope.getJSONArray("data");
        if (!scope.optBoolean("success") || apps.length() != 1 || !TARGET.equals(apps.getJSONObject(0).optString("APP_PACKAGE"))
                || apps.getJSONObject(0).optInt("USER_ID", -1) != 0)
            throw new IllegalStateException("Để đổi riêng Litmatch, phạm vi Hide My Device phải chỉ gồm Litmatch/user 0. Hãy kiểm tra Vector.");
    }

    Snapshot rotate(Snapshot before, boolean clearLitmatch) throws Exception {
        if (before == null) throw new IllegalStateException("Đọc thông tin thiết bị trước.");
        checkScope();
        if (!clearLitmatch && (!Boolean.TRUE.equals(before.settings.get("enabled")) || Boolean.TRUE.equals(before.settings.get("random_each_launch"))))
            throw new IllegalStateException("Không thể bảo đảm giữ UUID khi module đang tắt hoặc random mỗi lần mở. Hãy kiểm tra cấu hình trước.");
        String keep = clearLitmatch ? null : before.androidId();
        Map<String, String> generated;
        do { generated = DeviceIdentity.create(keep); }
        while (clearLitmatch && generated.get("android_id").equals(before.androidId()));
        LinkedHashMap<String, Object> next = new LinkedHashMap<>(before.settings);
        next.putAll(generated);
        next.put("enabled", true);
        next.put("random_each_launch", false);
        String xml = serialize(next);
        String result = shell.run(mutationScript(before, xml, clearLitmatch));
        if (!result.endsWith("EYE_APPLIED")) throw new IllegalStateException("Chưa xác nhận được kết quả. Đọc lại cấu hình trước khi thử lại.");
        LinkedHashMap<String, String> files = new LinkedHashMap<>();
        for (String path : before.files.keySet()) files.put(path, xml);
        return new Snapshot(files, next);
    }

    static String mutationScript(Snapshot before, String xml, boolean clearLitmatch) throws Exception {
        if (before.files.size() != 1 || before.files.containsKey(APP_PREFS)) throw new IllegalArgumentException("Invalid configuration files");
        String suffix = ".eye-" + UUID.randomUUID();
        String encoded = Base64.encodeToString(xml.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        StringBuilder script = new StringBuilder("set -eu\nlock=/data/local/tmp/eye-device-control-0.lock\n")
            .append("mkdir \"$lock\" 2>/dev/null || { echo EYE_BUSY; exit 1; }\nsuccess=0\nchanged=0\n");
        int i = 0;
        for (String path : before.files.keySet()) {
            if (!path.equals(APP_PREFS) && !path.matches("/data/misc/[A-Za-z0-9-]+/prefs/" + HMD.replace(".", "\\.") + "/ids\\.xml"))
                throw new IllegalArgumentException("Invalid configuration path");
            script.append("p").append(i).append('=').append(RootShell.quote(path)).append('\n');
            script.append("b").append(i).append('=').append(RootShell.quote(path + suffix + ".backup")).append('\n');
            script.append("n").append(i).append('=').append(RootShell.quote(path + suffix + ".next")).append('\n');
            i++;
        }
        script.append("cleanup() {\n  rc=$?\n  trap - EXIT HUP INT TERM\n  set +e\n  rollback_failed=0\n  if [ \"$success\" != 1 ] && [ \"$changed\" = 1 ]; then\n");
        for (i = 0; i < 1; i++) script.append("    if [ -f \"$b").append(i).append("\" ]; then mv -f \"$b").append(i).append("\" \"$p").append(i).append("\" || rollback_failed=1; else rollback_failed=1; fi\n");
        script.append("    if [ \"$rollback_failed\" = 1 ]; then echo EYE_ROLLBACK_FAILED; else echo EYE_ROLLED_BACK; fi\n")
            .append("  fi\n  rm -f \"$n0\"\n  if [ \"$rollback_failed\" = 0 ]; then rm -f \"$b0\"; rmdir \"$lock\"; fi\n  exit \"$rc\"\n}\ntrap cleanup EXIT\ntrap 'exit 1' HUP INT TERM\n")
            .append("am force-stop --user 0 ").append(HMD).append("\nam force-stop --user 0 ").append(TARGET).append('\n');
        i = 0;
        for (String original : before.files.values()) {
            script.append("[ -f \"$p").append(i).append("\" ] && [ ! -L \"$p").append(i).append("\" ]\n")
                .append("[ \"$(sha256sum \"$p").append(i).append("\" | cut -d ' ' -f1)\" = ").append(hash(original)).append(" ] || { echo EYE_CONFIG_CHANGED; exit 1; }\n")
                .append("cp -p \"$p").append(i).append("\" \"$b").append(i).append("\"\n")
                .append("chcon \"$(stat -c %C \"$p").append(i).append("\")\" \"$b").append(i).append("\"\n")
                .append("cp -p \"$p").append(i).append("\" \"$n").append(i).append("\"\n")
                .append("chcon \"$(stat -c %C \"$p").append(i).append("\")\" \"$n").append(i).append("\"\n")
                .append("printf '%s' ").append(RootShell.quote(encoded)).append(" | base64 -d > \"$n").append(i).append("\"\n")
                .append("[ \"$(sha256sum \"$n").append(i).append("\" | cut -d ' ' -f1)\" = ").append(hash(xml)).append(" ]\n");
            i++;
        }
        script.append("changed=1\nmv -f \"$n0\" \"$p0\"\n");
        if (clearLitmatch) script.append("[ \"$(pm clear --user 0 ").append(TARGET).append(")\" = Success ] || { echo EYE_CLEAR_FAILED; exit 1; }\n");
        script.append("success=1\necho EYE_APPLIED\n");
        return script.toString();
    }

    private static String hash(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    static LinkedHashMap<String, Object> parse(String xml) throws Exception {
        XmlPullParser parser = Xml.newPullParser(); parser.setInput(new StringReader(xml));
        LinkedHashMap<String, Object> out = new LinkedHashMap<>();
        boolean root = false;
        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.getEventType() != XmlPullParser.START_TAG) continue;
            String tag = parser.getName();
            if (parser.getDepth() == 1 && "map".equals(tag)) { root = true; continue; }
            String name = parser.getAttributeValue(null, "name");
            if (!root || parser.getDepth() != 2 || name == null || out.containsKey(name)) throw new IllegalStateException("Cấu hình Hide My Device không hợp lệ.");
            if ("string".equals(tag)) out.put(name, parser.nextText());
            else if ("boolean".equals(tag)) {
                String value = parser.getAttributeValue(null, "value");
                if (!"true".equals(value) && !"false".equals(value)) throw new IllegalStateException("Cấu hình boolean không hợp lệ.");
                out.put(name, Boolean.valueOf(value));
            } else throw new IllegalStateException("Phiên bản cấu hình Hide My Device chưa được hỗ trợ.");
        }
        if (!root) throw new IllegalStateException("Không đọc được cấu hình Hide My Device.");
        if (!out.containsKey("enabled")) out.put("enabled", true);
        return out;
    }
    static String serialize(Map<String, Object> settings) throws Exception {
        StringWriter text = new StringWriter(); XmlSerializer xml = Xml.newSerializer(); xml.setOutput(text);
        xml.startDocument("UTF-8", true); xml.startTag(null, "map");
        for (Map.Entry<String, Object> entry : settings.entrySet()) {
            boolean bool = entry.getValue() instanceof Boolean;
            String tag = bool ? "boolean" : "string";
            xml.startTag(null, tag).attribute(null, "name", entry.getKey());
            if (bool) xml.attribute(null, "value", entry.getValue().toString()); else xml.text(entry.getValue().toString());
            xml.endTag(null, tag);
        }
        xml.endTag(null, "map"); xml.endDocument(); return text.toString();
    }
}
