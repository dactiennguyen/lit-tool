package vn.lit.eyemodule;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.CRC32;

/** Read-only decoder for unencrypted MMKV, without expiry flags. Never recovers stale data. */
final class MmkvSnapshot {
    private final byte[] data;
    private final Map<String, int[]> values = new HashMap<>();

    MmkvSnapshot(byte[] data, byte[] meta) {
        this.data = data;
        if (data.length < 4 || meta.length < 32) throw invalid();
        long version = uint32(meta, 4);
        if (version > 4) throw unsupported();
        if (version >= 4) {
            if (meta.length < 112) throw invalid();
            for (int i = 104; i < 112; i++) if (meta[i] != 0) throw unsupported();
        }
        long size = version >= 3 ? uint32(meta, 28) : uint32(data, 0);
        // A disagreement may mean we caught a write. Do not use MMKV's recovery path.
        if (size != uint32(data, 0) || size > data.length - 4) throw invalid();
        CRC32 crc = new CRC32();
        crc.update(data, 4, (int) size);
        if (crc.getValue() != uint32(meta, 0)) throw invalid();
        if (size == 0) return;
        Cursor in = new Cursor(data, 4, 4 + (int) size);
        in.varint(); // Initial map length is deliberately not maintained on append.
        while (in.pos < in.end) {
            int keySize = in.length();
            String key = utf8(data, in.pos, keySize);
            in.pos += keySize;
            if (keySize == 0) continue;
            int valueSize = in.length();
            if (valueSize == 0) values.remove(key); // MMKV deletion tombstone.
            else values.put(key, new int[]{in.pos, in.pos + valueSize});
            in.pos += valueSize;
        }
    }

    String string(String key) {
        int[] range = values.get(key);
        if (range == null) return "";
        Cursor in = new Cursor(data, range[0], range[1]);
        int length = in.length();
        if (length != in.end - in.pos) throw invalid();
        return utf8(data, in.pos, length);
    }

    private static long uint32(byte[] bytes, int start) {
        long value = 0;
        for (int i = 0; i < 4; i++) value |= (long) (bytes[start + i] & 255) << (8 * i);
        return value;
    }

    private static String utf8(byte[] bytes, int offset, int length) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, offset, length)).toString();
        } catch (CharacterCodingException error) { throw invalid(); }
    }

    private static IllegalStateException invalid() {
        return new IllegalStateException("Dữ liệu MMKV chưa nhất quán hoặc không đúng định dạng hỗ trợ. Chờ Litmatch lưu xong rồi lấy lại.");
    }

    private static IllegalStateException unsupported() {
        return new IllegalStateException("Định dạng MMKV này chưa được Eye hỗ trợ.");
    }

    private static final class Cursor {
        final byte[] bytes;
        final int end;
        int pos;
        Cursor(byte[] bytes, int start, int end) { this.bytes = bytes; this.pos = start; this.end = end; }
        long varint() {
            long value = 0;
            for (int shift = 0; shift < 35; shift += 7) {
                if (pos >= end) throw invalid();
                int next = bytes[pos++] & 255;
                if (shift == 28 && (next & 240) != 0) throw invalid();
                value |= (long) (next & 127) << shift;
                if ((next & 128) == 0) return value;
            }
            throw invalid();
        }
        int length() {
            long value = varint();
            if (value > end - pos) throw invalid();
            return (int) value;
        }
    }
}
