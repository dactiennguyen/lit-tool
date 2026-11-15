package vn.lit.eyemodule;

import android.content.Context;
import android.media.MediaDrm;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import java.util.UUID;
import org.json.JSONObject;

final class DeviceReport {
    static JSONObject read(Context context) throws Exception {
        JSONObject json = new JSONObject();
        json.put("android_id", Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID));
        json.put("brand", Build.BRAND); json.put("manufacturer", Build.MANUFACTURER); json.put("model", Build.MODEL);
        json.put("device", Build.DEVICE); json.put("product", Build.PRODUCT); json.put("board", Build.BOARD); json.put("hardware", Build.HARDWARE);
        MediaDrm drm = null;
        try {
            drm = new MediaDrm(UUID.fromString("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"));
            json.put("drm_base64", Base64.encodeToString(drm.getPropertyByteArray("deviceUniqueId"), Base64.NO_WRAP));
        } catch (Exception ignored) { json.put("drm_base64", JSONObject.NULL); }
        finally { if (drm != null) drm.release(); }
        return json;
    }
}
