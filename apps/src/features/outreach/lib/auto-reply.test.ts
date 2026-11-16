import { describe, expect, it } from "vitest";
import type { LiveMessageEvent } from "@/lib/api";
import type { ChatMessage } from "@/lib/lit/lit-types";
import { incomingText, messageText } from "./auto-reply";

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "1",
  from: "peer1",
  to: "me1",
  timestamp: 1000,
  contents: [{ type: 0, text: "hello", fileName: null, address: null, duration: null, customEvent: null }],
  sender: { name: "Linh", avatar: null },
  ...over,
});

const event = (over: Partial<LiveMessageEvent>): LiveMessageEvent => ({
  accountId: "acc1",
  conversationId: "peer1",
  conversationType: 0,
  message: msg({}),
  ...over,
});

describe("messageText", () => {
  it("returns the text of a plain text message", () => {
    expect(messageText(msg({}))).toBe("hello");
  });
  it("ignores non-text and empty content", () => {
    expect(messageText(msg({ contents: [{ type: 1, text: null, fileName: "a.jpg", address: null, duration: null, customEvent: null }] }))).toBeNull();
    expect(messageText(msg({ contents: [{ type: 0, text: "   ", fileName: null, address: null, duration: null, customEvent: null }] }))).toBeNull();
  });
});

describe("incomingText", () => {
  it("accepts a 1-1 text from the peer", () => {
    expect(incomingText(event({}))).toEqual({ peerId: "peer1", text: "hello", senderName: "Linh", at: 1000 });
  });
  it("rejects our own echo (from = us, not the peer)", () => {
    expect(incomingText(event({ message: msg({ from: "me1" }) }))).toBeNull();
  });
  it("rejects group messages", () => {
    expect(incomingText(event({ conversationType: 1 }))).toBeNull();
  });
  it("rejects non-text messages", () => {
    expect(
      incomingText(event({ message: msg({ contents: [{ type: 2, text: null, fileName: null, address: null, duration: 3, customEvent: null }] }) })),
    ).toBeNull();
  });
});
