package vn.lit.eyemodule;

import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

final class DeviceIdentity {
    static final String[] FIELDS = {"imei", "serial", "android_id", "advertising_id", "media_drm",
        "brand", "manufacturer", "model", "wifi_mac", "bssid", "ssid", "bt_mac",
        "sim_serial", "sub_id", "mobile_no", "sim_operator", "sim_operator_name", "sim_country"};
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String[][] MODELS = {
        {"google", "Google", "Pixel 7"}, {"google", "Google", "Pixel 6a"}, {"google", "Google", "Pixel 8 Pro"},
        {"samsung", "samsung", "SM-S918B"}, {"samsung", "samsung", "SM-A546B"}, {"samsung", "samsung", "SM-G991B"},
        {"OnePlus", "OnePlus", "CPH2449"}, {"Xiaomi", "Xiaomi", "2201123G"}, {"Redmi", "Xiaomi", "23021RAAEG"},
        {"motorola", "motorola", "moto g84 5G"}, {"Nokia", "HMD Global", "Nokia G42 5G"}
    };
    private static final String[][] CARRIERS = {
        {"310260", "T-Mobile", "us", "1"}, {"310410", "AT&T", "us", "1"}, {"311480", "Verizon", "us", "1"},
        {"302720", "Rogers", "ca", "1"}, {"23415", "Vodafone UK", "gb", "44"}, {"23410", "O2 - UK", "gb", "44"},
        {"26201", "Telekom.de", "de", "49"}, {"20801", "Orange F", "fr", "33"}, {"22210", "Vodafone IT", "it", "39"},
        {"40445", "Airtel", "in", "91"}, {"50501", "Telstra", "au", "61"}
    };
    private static final String[] SSIDS = {"TP-Link", "NETGEAR", "Linksys", "ASUS", "DIRECT", "HomeWiFi", "Tenda", "dlink"};

    static Map<String, String> create(String keepAndroidId) {
        if (keepAndroidId != null && !keepAndroidId.matches("[0-9a-fA-F]{16}"))
            throw new IllegalArgumentException("Chưa có Android ID hợp lệ để giữ nguyên. Hãy đọc lại cấu hình.");
        Map<String, String> out = new LinkedHashMap<>();
        String[] model = MODELS[RANDOM.nextInt(MODELS.length)], carrier = CARRIERS[RANDOM.nextInt(CARRIERS.length)];
        out.put("brand", model[0]); out.put("manufacturer", model[1]); out.put("model", model[2]);
        out.put("android_id", keepAndroidId == null ? characters("0123456789abcdef", 16) : keepAndroidId);
        out.put("imei", luhn("35" + characters("0123456789", 12)));
        out.put("serial", characters("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 12));
        out.put("advertising_id", UUID.randomUUID().toString());
        out.put("media_drm", characters("0123456789abcdef", 64));
        out.put("wifi_mac", mac()); out.put("bssid", mac()); out.put("bt_mac", mac().toUpperCase(Locale.ROOT));
        out.put("ssid", SSIDS[RANDOM.nextInt(SSIDS.length)] + "_" + characters("0123456789ABCDEF", 4));
        out.put("sim_serial", luhn("89" + characters("0123456789", 16)));
        out.put("sub_id", carrier[0] + characters("0123456789", 15 - carrier[0].length()));
        out.put("mobile_no", "+" + carrier[3] + (RANDOM.nextInt(8) + 2) + characters("0123456789", 9));
        out.put("sim_operator", carrier[0]); out.put("sim_operator_name", carrier[1]); out.put("sim_country", carrier[2]);
        return out;
    }
    private static String characters(String alphabet, int length) {
        StringBuilder out = new StringBuilder(length);
        for (int i = 0; i < length; i++) out.append(alphabet.charAt(RANDOM.nextInt(alphabet.length())));
        return out.toString();
    }
    private static String mac() {
        byte[] bytes = new byte[6]; RANDOM.nextBytes(bytes); bytes[0] &= (byte) 0xfc;
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i != 0) out.append(':');
            out.append(String.format(Locale.ROOT, "%02x", bytes[i] & 255));
        }
        return out.toString();
    }
    static String luhn(String digits) {
        int sum = 0; boolean twice = true;
        for (int i = digits.length() - 1; i >= 0; i--) {
            int digit = digits.charAt(i) - '0';
            if (twice) { digit *= 2; if (digit > 9) digit -= 9; }
            sum += digit; twice = !twice;
        }
        return digits + (10 - sum % 10) % 10;
    }
}
