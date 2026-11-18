package vn.lit.eyemodule;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class RootShell {
    interface Runner { String run(String script) throws Exception; }

    static String run(String script) throws Exception {
        return run(script, 262144, 90, false);
    }

    static String runReadOnly(String script) throws Exception {
        return run(script, 12 * 1024 * 1024, 30, true);
    }

    private static String run(String script, int maxOutput, int timeoutSeconds, boolean readOnly) throws Exception {
        java.lang.Process process = null;
        java.io.IOException lastError = null;
        // Read-only reads need the global mount namespace: su launched from an app runs in the
        // app's namespace, where another app's /data/data is not visible. --mount-master (magisk/
        // APatch/KernelSU) joins the init namespace so Litmatch's files are readable.
        for (String executable : new String[]{"su", "/system/bin/su", "/system/xbin/su"}) {
            try {
                process = (readOnly
                    ? new ProcessBuilder(executable, "--mount-master", "-c", script)
                    : new ProcessBuilder(executable, "-c", script)).redirectErrorStream(true).start();
                break;
            } catch (java.io.IOException error) { lastError = error; }
        }
        if (process == null) {
            throw new IllegalStateException("Eye chưa chạy được su. Mở trình quản lý root (APatch/KernelSU/Magisk), cấp root cho Eye ở user 0 rồi đóng/mở lại Eye.", lastError);
        }
        final java.lang.Process rootProcess = process;
        AtomicReference<String> output = new AtomicReference<>("");
        AtomicReference<Exception> failure = new AtomicReference<>();
        Thread reader = new Thread(() -> {
            try (InputStream in = rootProcess.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int n;
                while ((n = in.read(buffer)) != -1) {
                    if (bytes.size() + n > maxOutput) throw new IllegalStateException("Phản hồi root vượt giới hạn.");
                    bytes.write(buffer, 0, n);
                }
                output.set(bytes.toString(StandardCharsets.UTF_8.name()));
            } catch (Exception e) { failure.set(e); rootProcess.destroy(); }
        }, "eye-root-output");
        reader.setDaemon(true); reader.start();
        // TERM lets the shell run its rollback trap; completion must still be checked after a timeout.
        boolean exited = rootProcess.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        if (!exited) {
            rootProcess.destroy();
            if (readOnly) throw new IllegalStateException("Đọc dữ liệu quá thời gian. Kiểm tra quyền root cho Eye rồi lấy lại.");
            throw new IllegalStateException("Lệnh root quá thời gian; kết quả thay đổi hoặc xóa dữ liệu chưa xác định. Kiểm tra lại Litmatch và cấu hình trước khi thử lại.");
        }
        reader.join(3000);
        if (failure.get() != null) throw failure.get();
        if (reader.isAlive()) throw new IllegalStateException("Không đọc được phản hồi root.");
        if (rootProcess.exitValue() != 0) {
            String value = output.get();
            if (value.contains("EYE_ROLLBACK_FAILED")) throw new IllegalStateException("Khôi phục cấu hình chưa hoàn tất. Đã giữ bản sao và khóa thao tác để tránh ghi tiếp. Cần kiểm tra các file ids.xml và bản sao .eye-*.backup trước khi mở lại Litmatch.");
            if (value.contains("EYE_CONFIG_CHANGED")) throw new IllegalStateException("Cấu hình đã đổi. Đọc lại thiết bị rồi thử lại.");
            if (value.contains("EYE_CLEAR_FAILED")) throw new IllegalStateException("Chưa xác nhận xóa dữ liệu Litmatch. " + (value.contains("EYE_ROLLED_BACK") ? "Cấu hình thiết bị đã được khôi phục." : "Đọc lại cấu hình trước khi thử lại."));
            if (value.contains("EYE_BUSY")) throw new IllegalStateException("Một thao tác thiết bị đang chạy. Hãy chờ rồi đọc lại.");
            throw new IllegalStateException("Không thực hiện được thao tác root. Kiểm tra quyền Eye trong trình quản lý root và cấu hình Vector.");
        }
        return output.get().trim();
    }
    static String quote(String value) { return "'" + value.replace("'", "'\\''") + "'"; }
}
