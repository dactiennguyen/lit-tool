import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { applyLiveMessage } from "./hx-live";
import type { ChatMessage, HistoryPage } from "./lit-types";
import { conversationsKey, historyKey, latestKey } from "./queries";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const msg = (id: string, timestamp: number, from = "peer1"): ChatMessage => ({
  id,
  from,
  to: "me",
  timestamp,
  contents: [{ type: 0, text: `tin ${id}`, fileName: null, address: null, duration: null, customEvent: null }],
  sender: null,
});
const event = (message: ChatMessage, conversationId = "peer1") => ({
  accountId: "a1",
  conversationId,
  conversationType: 0 as const,
  message,
});

describe("applyLiveMessage", () => {
  it("adds a heard message to the open conversation once and updates its preview", () => {
    const qc = new QueryClient();
    const page: HistoryPage = { messages: [msg("10", 100)], cursor: "5", isLast: false };
    qc.setQueryData(historyKey("a1", "peer1"), { pages: [page, { ...page, messages: [] }], pageParams: [null, "5"] });
    qc.setQueryData(latestKey("a1", "peer1"), msg("10", 100));
    qc.setQueryData(conversationsKey("a1"), [{ conversationId: "peer1" }]);

    applyLiveMessage(qc, event(msg("11", 200)));
    applyLiveMessage(qc, event(msg("11", 200)));

    const history = qc.getQueryData<InfiniteData<HistoryPage>>(historyKey("a1", "peer1"))!;
    expect(history.pages[0]!.messages.map((m) => m.id)).toEqual(["11", "10"]);
    expect(history.pages).toHaveLength(2);
    expect(qc.getQueryData<ChatMessage>(latestKey("a1", "peer1"))?.id).toBe("11");
    expect(qc.getQueryState(conversationsKey("a1"))?.isInvalidated).toBe(false);
  });

  it("keeps the newer preview, leaves unopened history alone and refreshes the list for a new peer", () => {
    const qc = new QueryClient();
    qc.setQueryData(latestKey("a1", "peer2"), msg("20", 500, "peer2"));
    qc.setQueryData(conversationsKey("a1"), [{ conversationId: "peer1" }]);

    applyLiveMessage(qc, event(msg("19", 400, "peer2"), "peer2"));

    expect(qc.getQueryData<ChatMessage>(latestKey("a1", "peer2"))?.id).toBe("20");
    expect(qc.getQueryData(historyKey("a1", "peer2"))).toBeUndefined();
    expect(qc.getQueryState(conversationsKey("a1"))?.isInvalidated).toBe(true);
  });
});
