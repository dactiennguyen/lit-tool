import { describe, expect, it } from "vitest";
import type { ChatMessage, HistoryPage, MessageContent, SavedConversation } from "@/lib/lit-types";
import {
  canSend,
  contentText,
  isUnread,
  MAX_TEXT_BYTES,
  mergeConversations,
  previewText,
  savedPeer,
  shortId,
  shortTime,
  sortByLatest,
  toThread,
} from "./chat-view";

const content = (o: Partial<MessageContent>): MessageContent => ({
  type: 0, text: null, fileName: null, address: null, duration: null, customEvent: null, ...o,
});
const msg = (id: string, from: string, timestamp: number | null, text = id): ChatMessage => ({
  id, from, to: null, timestamp, contents: [content({ text })], sender: null,
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

describe("conversation list helpers", () => {
  const latest = (entries: [string, ChatMessage | null][]) =>
    new Map(entries.map(([id, message]) => [id, { message }]));

  it("previews one line and marks own messages", () => {
    expect(previewText(msg("1", "peer", 1, "chào\n  bạn"), "me")).toBe("chào bạn");
    expect(previewText(msg("1", "me", 1, "ok"), "me")).toBe("Bạn: ok");
    expect(previewText(msg("1", "me", 1, "ok"), null)).toBe("ok");
  });

  it("is unread only for a newer message from the other side", () => {
    const fromPeer = msg("20", "peer", 2);
    expect(isUnread(fromPeer, "me", undefined)).toBe(true);
    expect(isUnread(fromPeer, "me", "10")).toBe(true);
    expect(isUnread(fromPeer, "me", "20")).toBe(false);
    expect(isUnread(fromPeer, "me", "100")).toBe(false); // "100" > "20" numerically
    expect(isUnread(msg("30", "me", 3), "me", undefined)).toBe(false);
    expect(isUnread(null, "me", undefined)).toBe(false);
    expect(isUnread(fromPeer, null, undefined)).toBe(false);
  });

  it("sorts by latest activity, unknown ones last in server order", () => {
    const convs = ["a", "b", "c", "d"].map((conversationId) => ({ conversationId, conversationType: 0 }));
    const sorted = sortByLatest(convs, latest([["b", msg("1", "x", 100)], ["d", msg("2", "x", 300)], ["c", null]]));
    expect(sorted.map((c) => c.conversationId)).toEqual(["d", "b", "a", "c"]);
  });

  it("formats short times", () => {
    const now = new Date(2026, 10, 14, 15, 0);
    expect(shortTime(new Date(2026, 10, 14, 9, 5).getTime(), now)).toMatch(/0?9:05/);
    expect(shortTime(new Date(2026, 10, 13, 9, 5).getTime(), now)).toBe("13/11");
  });
});

describe("saved conversations", () => {
  const saved = (conversationId: string, peerName: string | null = null): SavedConversation => ({
    conversationId,
    conversationType: 0,
    peerName,
    peerAvatar: null,
    lastMessage: null,
    updatedAt: 1,
  });

  it("keeps the server order and adds the saved ones it lacks", () => {
    const listed = [{ conversationId: "b", conversationType: 0 }, { conversationId: "g", conversationType: 1 }];
    expect(mergeConversations(listed, [saved("a"), saved("b")]).map((c) => c.conversationId)).toEqual(["b", "g", "a"]);
    expect(mergeConversations(undefined, [saved("a")])).toEqual([{ conversationId: "a", conversationType: 0 }]);
    expect(mergeConversations(listed, undefined)).toHaveLength(2);
  });

  it("names a peer from the saved row only when it has a name", () => {
    expect(savedPeer(saved("a", "Lan"))).toEqual({ name: "Lan", avatarUrl: null, userId: null });
    expect(savedPeer(saved("a"))).toBeUndefined();
    expect(savedPeer(undefined)).toBeUndefined();
  });
});
