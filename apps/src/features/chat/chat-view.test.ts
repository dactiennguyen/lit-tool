import { describe, expect, it } from "vitest";
import type { ChatMessage, HistoryPage, MessageContent } from "@/lib/lit-types";
import { canSend, contentText, MAX_TEXT_BYTES, shortId, toThread } from "./chat-view";

const content = (o: Partial<MessageContent>): MessageContent => ({
  type: 0, text: null, fileName: null, address: null, duration: null, customEvent: null, ...o,
});
const msg = (id: string, from: string, timestamp: number | null, text = id): ChatMessage => ({
  id, from, to: null, timestamp, contents: [content({ text })],
});
const page = (messages: ChatMessage[], isLast = false): HistoryPage => ({ messages, cursor: isLast ? null : "1", isLast });

describe("chat-view", () => {
  it("labels non-text contents", () => {
    expect(contentText(content({ text: "hi" }))).toBe("hi");
    expect(contentText(content({ type: 1, fileName: "a.jpg" }))).toBe("[Ảnh] a.jpg");
    expect(contentText(content({ type: 4, duration: 5 }))).toBe("[Tin thoại 5s]");
    expect(contentText(content({ type: 3, address: "Huế" }))).toBe("[Vị trí] Huế");
    expect(contentText(content({ type: 7, customEvent: "gift" }))).toBe("[Tin đặc biệt] gift");
    expect(contentText(content({ type: 42 }))).toBe("[Tin không hỗ trợ]");
  });

  it("orders oldest first, dedupes across pages and marks own messages", () => {
    const newest = page([msg("30", "me", 3000), msg("20", "peer", 2000)]);
    const older = page([msg("20", "peer", 2000), msg("10", "me", 1000)], true);
    const thread = toThread([newest, older], "me");
    expect(thread.map((m) => [m.id, m.mine])).toEqual([["10", true], ["20", false], ["30", true]]);
  });

  it("breaks timestamp ties by uint64 id without losing precision", () => {
    const thread = toThread([page([msg("18446744073709551615", "a", 5), msg("9007199254740993", "a", 5)])], "me");
    expect(thread.map((m) => m.id)).toEqual(["9007199254740993", "18446744073709551615"]);
  });

  it("checks text like the backend", () => {
    expect(canSend("hi")).toBe(true);
    expect(canSend("   ")).toBe(false);
    expect(canSend("a\0b")).toBe(false);
    expect(canSend("é".repeat(MAX_TEXT_BYTES / 2))).toBe(true);
    expect(canSend("é".repeat(MAX_TEXT_BYTES / 2 + 1))).toBe(false);
  });

  it("shortens long ids", () => {
    expect(shortId("love_1")).toBe("love_1");
    expect(shortId("love147707828357186000")).toBe("love1477078…186000");
  });
});
