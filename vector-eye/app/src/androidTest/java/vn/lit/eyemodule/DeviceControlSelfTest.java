package vn.lit.eyemodule;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;

/** Runs with app_process against temporary files; never touches installed app data. */
public final class DeviceControlSelfTest {
    private static final String VECTOR = "/data/misc/test-fixture/prefs10/" + DeviceController.HMD + "/ids.xml";
    private static final String APP = "/data/user/10/" + DeviceController.HMD + "/shared_prefs/ids.xml";
    private static int passed;

    public static void main(String[] args) throws Exception {
        if (args.length == 1 && "read".equals(args[0])) {
            DeviceController.Snapshot snapshot = new DeviceController().read();
            System.out.println("PASS: root read " + snapshot.files.size() + " configuration files, " + snapshot.settings.size() + " settings");
            return;
        }
        identity();
        xml();
        scope();
        transaction("success", false, "", false, false);
        transaction("clear-success", true, "", false, false);
        transaction("stale", true, "", true, false);
        transaction("busy", true, "", false, true);
        transaction("second-write-failure", true, failSecondWrite(), false, false);
        transaction("clear-failure", true, "pm() { echo Failure; return 1; }\n", false, false);
        transaction("rollback-failure", true, failSecondWrite()
            .replace("command mv", "case \"$2:$3\" in *.backup:*/vector.xml) return 1;; esac; command mv"), false, false);
        System.out.println("PASS: " + passed + " device controller cases; only scratch files and fake am/pm used");
    }

    private static void identity() throws Exception {
        for (int i = 0; i < 100; i++) {
            Map<String, String> fresh = DeviceIdentity.create(null);
            check(fresh.size() == 18, "18 identity fields");
            for (String key : DeviceIdentity.FIELDS) check(fresh.containsKey(key) && !fresh.get(key).isEmpty(), key);
            check(fresh.get("android_id").matches("[a-f0-9]{16}"), "Android ID format");
            check(fresh.get("media_drm").matches("[a-f0-9]{64}"), "DRM format");
            check(luhnValid(fresh.get("imei")) && fresh.get("imei").length() == 15, "IMEI checksum");
            check(luhnValid(fresh.get("sim_serial")), "SIM checksum");
            check(fresh.get("sub_id").length() == 15 && fresh.get("sub_id").startsWith(fresh.get("sim_operator")), "Carrier consistency");
            check("98ed49cb34b3b25f".equals(DeviceIdentity.create("98ed49cb34b3b25f").get("android_id")), "Preserve session UUID");
        }
        rejects(() -> DeviceIdentity.create(""), "Reject empty preserved UUID");
        passed++;
    }

    private static boolean luhnValid(String number) {
        int sum = 0;
        for (int i = number.length() - 1, n = 0; i >= 0; i--, n++) {
            int digit = number.charAt(i) - '0';
            if (n % 2 == 1) { digit *= 2; if (digit > 9) digit -= 9; }
            sum += digit;
        }
        return sum % 10 == 0;
    }

    private static void xml() throws Exception {
        LinkedHashMap<String, Object> values = new LinkedHashMap<>();
        values.putAll(DeviceIdentity.create(null)); values.put("enabled", true);
        values.put("random_each_launch", false); values.put("unknown", "A & B <'\">\n");
        check(values.equals(DeviceController.parse(DeviceController.serialize(values))), "XML round trip preserves unknown fields");
        check(Boolean.TRUE.equals(DeviceController.parse("<map/>").get("enabled")), "HMD enabled default");
        rejects(() -> DeviceController.parse("<map><string name='x'>1</string><string name='x'>2</string></map>"), "Duplicate field");
        rejects(() -> DeviceController.parse("<map><boolean name='enabled' value='maybe'/></map>"), "Invalid bool");
        rejects(() -> DeviceController.parse("<map><int name='x' value='1'/></map>"), "Unsupported schema");
        passed++;
    }

    private static DeviceController controller(String status, int uid, String scope) {
        return new DeviceController(command -> {
            if (command.contains("modules ls")) return "{\"success\":true,\"data\":[{\"PACKAGE\":\"" + DeviceController.HMD
                + "\",\"STATUS\":\"" + status + "\",\"UID\":" + uid + "}]}";
            if (command.contains("scope ls")) return "{\"success\":true,\"data\":" + scope + "}";
            throw new AssertionError("Unexpected shell mutation");
        });
    }

    private static void scope() throws Exception {
        String scope = "[{\"APP_PACKAGE\":\"com.litatom.app\",\"USER_ID\":10}]";
        DeviceController valid = controller("enabled", 1010320, scope);
        valid.checkScope();
        rejects(() -> controller("disabled", 1010320, scope).checkScope(), "Disabled module");
        rejects(() -> controller("enabled", 10320, scope).checkScope(), "Wrong module user");
        rejects(() -> controller("enabled", 1010320, scope.replace(":10", ":0")).checkScope(), "Wrong target user");
        rejects(() -> controller("enabled", 1010320, scope.replace("com.litatom.app", "other.app")).checkScope(), "Wrong target package");
        rejects(() -> controller("enabled", 1010320, "[" + scope.substring(1, scope.length() - 1) + ",{}]").checkScope(), "Extra scope");
        LinkedHashMap<String, Object> settings = new LinkedHashMap<>();
        settings.put("enabled", false);
        DeviceController.Snapshot snapshot = new DeviceController.Snapshot(new LinkedHashMap<>(), settings);
        rejects(() -> valid.rotate(snapshot, false), "Preserve UUID with disabled hook");
        settings.put("enabled", true); settings.put("random_each_launch", true);
        rejects(() -> valid.rotate(snapshot, false), "Preserve UUID with per-launch rotation");
        passed++;
    }

    private static String failSecondWrite() {
        return "mv() { case \"$2:$3\" in *.next:*/app.xml) return 1;; esac; command mv \"$@\"; }\n";
    }

    private static void transaction(String name, boolean clear, String overrides, boolean stale, boolean busy) throws Exception {
        File dir = Files.createTempDirectory(new File("/data/local/tmp").toPath(), "eye-control-test-").toFile();
        try {
            File vector = new File(dir, "vector.xml"), app = new File(dir, "app.xml"), calls = new File(dir, "calls");
            String oldVector = "<map><string name='android_id'>98ed49cb34b3b25f</string></map>";
            String oldApp = "<map><string name='android_id'>eab89b6de0f57db2</string></map>";
            String next = "<map><string name='android_id'>0123456789abcdef</string></map>";
            write(vector, stale ? "changed" : oldVector); write(app, oldApp);
            LinkedHashMap<String, String> files = new LinkedHashMap<>(); files.put(VECTOR, oldVector); files.put(APP, oldApp);
            String script = DeviceController.mutationScript(new DeviceController.Snapshot(files, DeviceController.parse(oldVector)), next, clear)
                .replace(VECTOR, vector.getPath()).replace(APP, app.getPath())
                .replace("/data/local/tmp/eye-device-control-10.lock", new File(dir, "lock").getPath());
            if (busy) check(new File(dir, "lock").mkdir(), "Create test lock");
            String prefix = "am() { printf '%s\\n' \"$*\" >> " + RootShell.quote(calls.getPath()) + "; }\n"
                + "pm() { printf '%s\\n' \"$*\" >> " + RootShell.quote(calls.getPath()) + "; echo Success; }\n"
                + "chcon() { :; }\n";
            Process process = new ProcessBuilder("/system/bin/sh", "-c", prefix + overrides + script).redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            int exit = process.waitFor();
            boolean success = name.equals("success") || name.equals("clear-success");
            check((exit == 0) == success, name + " exit status: " + output);
            if (success) {
                check(read(vector).equals(next) && read(app).equals(next), "Both configurations updated");
                check(output.contains("EYE_APPLIED"), "Commit acknowledgement");
                check(read(calls).contains("clear --user 10 com.litatom.app") == clear, "Clear only on explicit reset");
            } else if (name.equals("rollback-failure")) {
                check(output.contains("EYE_ROLLBACK_FAILED"), "Report failed recovery");
                check(new File(dir, "lock").exists(), "Retain recovery lock");
                check(dir.listFiles((d, n) -> n.endsWith(".backup")).length == 1, "Preserve unrecovered backup");
                check(read(app).equals(oldApp), "Still recover other file");
            } else {
                check(read(vector).equals(stale ? "changed" : oldVector) && read(app).equals(oldApp), "Original contents preserved: " + name);
                if (!stale && !busy) check(output.contains("EYE_ROLLED_BACK"), "Rollback acknowledged");
            }
            if (!name.equals("rollback-failure") && !busy) {
                check(!new File(dir, "lock").exists(), "Release lock: " + name);
                check(dir.listFiles((d, n) -> n.contains(".eye-")).length == 0, "Remove temporary copies: " + name);
            }
            if (stale || busy || name.equals("second-write-failure"))
                check(!calls.exists() || !read(calls).contains("clear --user"), "No destructive clear on precommit failure");
            passed++;
        } finally { delete(dir); }
    }

    private interface Throwing { void run() throws Exception; }
    private static void rejects(Throwing action, String reason) throws Exception {
        try { action.run(); } catch (IllegalStateException | IllegalArgumentException expected) { return; }
        throw new AssertionError(reason);
    }
    private static void write(File file, String value) throws Exception { Files.write(file.toPath(), value.getBytes(StandardCharsets.UTF_8)); }
    private static String read(File file) throws Exception { return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8); }
    private static void check(boolean value, String reason) { if (!value) throw new AssertionError(reason); }
    private static void delete(File file) throws Exception {
        if (file.isDirectory()) for (File child : file.listFiles()) delete(child);
        Files.deleteIfExists(file.toPath());
    }
}
