// Events of the live chat connections (src-tauri/src/listen/): "hx-status"
// keeps tcp-status current, "hx-message" puts each new message straight into
// the cached conversation and list preview, so it shows without polling, and
// "hx-log" (with the status changes) and "http-log" fill the connection log.

import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, type HttpLogEvent, type LiveLogEvent, type LiveMessageEvent, type LiveStatusEvent } from "./api";
import { addHttpLog, addTcpLog } from "@/stores/hx-log";
import type { ChatMessage, Conversation, HistoryPage } from "@/lib/lit/lit-types";
import { rememberSender } from "@/stores/peer-directory";
import { conversationsKey, historyKey, latestKey, newestMessage } from "./queries";
import { applyLiveState } from "@/stores/tcp-status";

/** Adds one heard message to the caches of its conversation. */
export function applyLiveMessage(qc: QueryClient, e: LiveMessageEvent): void {
  const { accountId, conversationId, message } = e;
  // Only a conversation already open has history to add to; the next fetch brings the rest.
  qc.setQueryData<InfiniteData<HistoryPage, string | null>>(historyKey(accountId, conversationId), (old) => {
    const [first, ...rest] = old?.pages ?? [];
    if (!old || !first || old.pages.some((p) => p.messages.some((m) => m.id === message.id))) return old;
    return { ...old, pages: [{ ...first, messages: [message, ...first.messages] }, ...rest] };
  });
  qc.setQueryData<ChatMessage | null>(latestKey(accountId, conversationId), (old) =>
    newestMessage(old ? [old, message] : [message]),
  );
  if (e.conversationType === 0) rememberSender(conversationId, [message]);
  // A first message from someone new: the conversation list does not have them yet.
  const list = qc.getQueryData<Conversation[]>(conversationsKey(accountId));
  if (list && !list.some((c) => c.conversationId === conversationId)) {
    void qc.invalidateQueries({ queryKey: conversationsKey(accountId) });
  }
}

let started = false;

/** Subscribes once for the app run, then reads the connections already open (e.g. after a reload). */
export function startLiveEvents(qc: QueryClient): void {
  if (started || !isTauri()) return;
  started = true;
  // Listen first, so no event between the read and the subscription is lost.
  void Promise.all([
    listen<LiveStatusEvent>("hx-status", ({ payload: { accountId, ...state } }) => {
      applyLiveState(accountId, state);
      addTcpLog(accountId, { at: Date.now(), dir: "state", state });
    }),
    listen<LiveMessageEvent>("hx-message", ({ payload }) => applyLiveMessage(qc, payload)),
    listen<LiveLogEvent>("hx-log", ({ payload: { accountId, ...line } }) => addTcpLog(accountId, line)),
    listen<HttpLogEvent>("http-log", ({ payload }) => addHttpLog(payload)),
  ])
    .then(() => api.hx.listenStatus())
    .then((running) => {
      for (const [accountId, state] of Object.entries(running)) applyLiveState(accountId, state);
    })
    .catch((e: unknown) => console.error("hx live events", e));
}
