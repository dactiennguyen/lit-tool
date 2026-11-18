package vn.lit.eyemodule;

import org.junit.Test;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.CRC32;
import static org.junit.Assert.*;

/** Synthetic storage only: regression cases must never contain real credentials. */
public final class AccountStorageTest {
    private static final String BASE = "/data/user/0/com.litatom.app/";
    private static final String KEY = "litmatch_key_info";
    private static final String ACCOUNT = "{\"userId\":\"test-user\",\"session\":\"test-session\",\"hxPwd\":\"test-password\"}";
    private static final String PROFILE = "{\"user_id\":\"test-user\",\"nickname\":\"Tên thử\",\"huanxin_id\":\"test-im\"}";

    @Test public void lastWriteWinsAndPaddingIsIgnored() {
        byte[] data = file(entry(KEY, "old"), entry(KEY, "current"));
        byte[] stale = entry(KEY, "stale-padding");
        int end = 4 + ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).getInt();
        System.arraycopy(stale, 0, data, end, stale.length);
        assertEquals("current", parse(data).string(KEY));
    }

    @Test public void embeddedFakeEntryCannotOverrideAccount() {
        byte[] data = file(entry(KEY, "current"), rawEntry("other-key", entry(KEY, "fake")));
        assertEquals("current", parse(data).string(KEY));
    }

    @Test public void deletionAndEmptyStringDoNotResurrectOldSession() {
        assertEquals("", parse(file(entry(KEY, "old"), rawEntry(KEY, new byte[0]))).string(KEY));
        assertEquals("", parse(file(entry(KEY, "old"), entry(KEY, ""))).string(KEY));
    }

    @Test public void clearedStoreIgnoresOldBytes() {
        byte[] data = file(entry(KEY, "old"));
        ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(0);
        assertEquals("", parse(data).string(KEY));
    }

    @Test public void unicodeAndMultibyteLengthsWork() {
        String value = "Tiếng Việt 😀 ".repeat(40);
        String key = "long-key".repeat(20);
        assertEquals(value, parse(file(entry(key, value))).string(key));
    }

    @Test public void invalidChecksumAndSizeFailClosed() {
        byte[] data = file(entry(KEY, "current"));
        byte[] meta = meta(data);
        data[10] ^= 1;
        assertThrows(IllegalStateException.class, () -> new MmkvSnapshot(data, meta));
        byte[] valid = file(entry(KEY, "current"));
        byte[] wrongSize = meta(valid);
        ByteBuffer.wrap(wrongSize).order(ByteOrder.LITTLE_ENDIAN).putInt(28, valid.length + 1);
        assertThrows(IllegalStateException.class, () -> new MmkvSnapshot(valid, wrongSize));
    }

    @Test public void truncatedEntriesAndOverflowFailClosed() {
        byte[] truncated = file(new byte[]{3, 'a'});
        assertThrows(IllegalStateException.class, () -> parse(truncated));
        byte[] overflow = file(new byte[]{(byte)255, (byte)255, (byte)255, (byte)255, 16});
        assertThrows(IllegalStateException.class, () -> parse(overflow));
    }

    @Test public void malformedCurrentStringNeverFallsBack() {
        MmkvSnapshot data = parse(file(entry(KEY, "old"), rawEntry(KEY, new byte[]{9, 'x'})));
        assertThrows(IllegalStateException.class, () -> data.string(KEY));
        MmkvSnapshot invalidUtf8 = parse(file(rawEntry(KEY, new byte[]{1, (byte)255})));
        assertThrows(IllegalStateException.class, () -> invalidUtf8.string(KEY));
    }

    @Test public void unknownMetadataAndExpiryFlagsAreRejected() {
        byte[] data = file(entry(KEY, "current"));
        byte[] meta = meta(data);
        ByteBuffer.wrap(meta).order(ByteOrder.LITTLE_ENDIAN).putInt(4, 5);
        assertThrows(IllegalStateException.class, () -> new MmkvSnapshot(data, meta));
        ByteBuffer.wrap(meta).order(ByteOrder.LITTLE_ENDIAN).putInt(4, 4).putLong(104, 1);
        assertThrows(IllegalStateException.class, () -> new MmkvSnapshot(data, meta));
    }

    @Test public void completeSnapshotKeepsAccountAndEnv() throws Exception {
        JSONObject snapshot = read(storage());
        assertFalse("profile must not be exported", snapshot.has("profile"));
        assertEquals("test-session", snapshot.getJSONObject("env").getString("LIT_SID"));
        assertEquals("test-im", snapshot.getJSONObject("env").getString("HX_USERNAME"));
        assertEquals("persisted-storage", snapshot.getString("captureMode"));
        assertEquals(0, snapshot.getJSONArray("missing").length());
    }

    @Test public void deletedAccountAndMismatchedProfileAreRejected() {
        Map<String, byte[]> files = storage();
        store(files, "mmkv.default", file(entry(KEY, ACCOUNT), rawEntry(KEY, new byte[0])));
        assertThrows(IllegalStateException.class, () -> read(files));
        store(files, "mmkv.default", file(entry(KEY, ACCOUNT)));
        store(files, "lit_app_default_kv", file(entry("sp_user_info", "{\"user_id\":\"other-user\"}")));
        assertThrows(IllegalStateException.class, () -> read(files));
    }

    @Test public void changedMetadataDuringReadIsRejected() {
        Map<String, byte[]> files = storage();
        AtomicInteger reads = new AtomicInteger();
        RootAccountReader.Storage source = path -> {
            byte[] value = files.getOrDefault(path, new byte[0]);
            if (path.endsWith("mmkv.default.crc") && reads.incrementAndGet() == 2) {
                value = value.clone(); value[8] ^= 1;
            }
            return value;
        };
        assertThrows(IllegalStateException.class, () -> RootAccountReader.read(source, 0, "test-version", "test-appkey"));
    }

    @Test public void accountSwitchBetweenStoresIsRejected() {
        Map<String, byte[]> files = storage();
        AtomicInteger profiles = new AtomicInteger();
        RootAccountReader.Storage source = path -> {
            byte[] value = files.getOrDefault(path, new byte[0]);
            if (path.endsWith("lit_app_default_kv.crc") && profiles.incrementAndGet() == 2) {
                store(files, "mmkv.default", file(entry(KEY, ACCOUNT.replace("test-session", "new-session")), entry("device_id", "test-device")));
            }
            return value;
        };
        assertThrows(IllegalStateException.class, () -> RootAccountReader.read(source, 0, "test-version", "test-appkey"));
    }

    @Test public void missingPreferencesAreOptionalAndBackupXmlIsDecoded() throws Exception {
        Map<String, byte[]> files = storage();
        store(files, "mmkv.default", file(entry(KEY, ACCOUNT)));
        JSONObject missing = read(files);
        assertEquals("LIT_UUID", missing.getJSONArray("missing").getString(0));
        assertFalse(missing.getJSONObject("env").has("LIT_UUID"));
        files.put(BASE + "shared_prefs/prefs_device_id_bak.xml", bytes("<map><string name='device_id_bak'>&#65;&amp;B</string></map>"));
        assertEquals("A&B", read(files).getJSONObject("env").getString("LIT_UUID"));
    }

    @Test public void unreadableOptionalFileIsNotTreatedAsMissing() {
        Map<String, byte[]> files = storage();
        store(files, "mmkv.default", file(entry(KEY, ACCOUNT)));
        RootAccountReader.Storage source = path -> {
            if (path.contains("shared_prefs")) throw new IllegalStateException("read denied");
            return files.getOrDefault(path, new byte[0]);
        };
        assertThrows(IllegalStateException.class, () -> RootAccountReader.read(source, 0, "test-version", "test-appkey"));
    }

    @Test public void wrongAndroidUserNeverReadsStorage() {
        assertThrows(IllegalStateException.class, () -> RootAccountReader.read(path -> {
            fail("Must not read another Android user's storage"); return null;
        }, 10, "", ""));
    }

    @Test public void missingStoreAndInvalidJsonAreRejected() {
        assertThrows(IllegalStateException.class, () -> read(new HashMap<>()));
        Map<String, byte[]> files = storage();
        store(files, "mmkv.default", file(entry(KEY, "broken-json")));
        assertThrows(IllegalStateException.class, () -> read(files));
    }

    @Test public void xmlDtdIsRejected() {
        assertThrows(IllegalStateException.class, () -> RootAccountReader.prefString(
            bytes("<!DOCTYPE map [<!ENTITY token SYSTEM 'file:///not-read'>]><map><string name='device_id'>&token;</string></map>"), "device_id"));
    }

    @Test public void nullCredentialsAreNotExportedAsLiteralNull() {
        Map<String, byte[]> files = storage();
        store(files, "mmkv.default", file(entry(KEY, "{\"userId\":\"test-user\",\"session\":null}")));
        assertThrows(IllegalStateException.class, () -> read(files));
    }

    @Test public void oversizedJsonCannotReachClipboard() {
        Map<String, byte[]> files = storage();
        String bigAccount = "{\"userId\":\"test-user\",\"session\":\"test-session\",\"hxPwd\":\"test-password\",\"pad\":\""
            + "x".repeat(180000) + "\"}";
        store(files, "mmkv.default", file(entry(KEY, bigAccount)));
        assertThrows(IllegalStateException.class, () -> read(files));
    }

    private static JSONObject read(Map<String, byte[]> files) throws Exception {
        return RootAccountReader.read(path -> files.getOrDefault(path, new byte[0]), 0, "test-version", "test-appkey");
    }
    private static Map<String, byte[]> storage() {
        Map<String, byte[]> files = new HashMap<>();
        store(files, "mmkv.default", file(entry(KEY, ACCOUNT), entry("device_id", "test-device")));
        store(files, "lit_app_default_kv", file(entry("sp_user_info", PROFILE)));
        return files;
    }
    private static void store(Map<String, byte[]> files, String name, byte[] data) {
        files.put(BASE + "files/mmkv/" + name, data);
        files.put(BASE + "files/mmkv/" + name + ".crc", meta(data));
    }
    private static MmkvSnapshot parse(byte[] data) { return new MmkvSnapshot(data, meta(data)); }
    private static byte[] file(byte[]... entries) {
        ByteArrayOutputStream payload = new ByteArrayOutputStream();
        // MMKV's initial length prefix need not match the final appended payload length.
        varint(payload, 0x0fffffff);
        for (byte[] entry : entries) payload.write(entry, 0, entry.length);
        byte[] data = new byte[payload.size() + 1024];
        ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(payload.size()).put(payload.toByteArray());
        return data;
    }
    private static byte[] meta(byte[] data) {
        int size = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).getInt();
        CRC32 crc = new CRC32(); crc.update(data, 4, size);
        return ByteBuffer.allocate(4096).order(ByteOrder.LITTLE_ENDIAN)
            .putInt((int) crc.getValue()).putInt(3).putInt(1).putInt(28, size).array();
    }
    private static byte[] entry(String key, String value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] encoded = bytes(value); varint(out, encoded.length); out.write(encoded, 0, encoded.length);
        return rawEntry(key, out.toByteArray());
    }
    private static byte[] rawEntry(String key, byte[] value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] encoded = bytes(key); varint(out, encoded.length); out.write(encoded, 0, encoded.length);
        varint(out, value.length); out.write(value, 0, value.length); return out.toByteArray();
    }
    private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }
    private static void varint(ByteArrayOutputStream out, int value) {
        while ((value & ~127) != 0) { out.write((value & 127) | 128); value >>>= 7; }
        out.write(value);
    }
}
