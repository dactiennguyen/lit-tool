// Display helpers for the chat page: message text and thread ordering.

import { safeImageUrl } from "@/lib/lit-format";
import type { ChatMessage, Conversation, HistoryPage, MessageContent, SavedConversation } from "@/lib/lit-types";
import type { Peer } from "@/lib/peer-directory";
import { compareIds } from "@/lib/read-markers";

/** Same limit as hx.rs MAX_TEXT_BYTES. */
export const MAX_TEXT_BYTES = 4096;

export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** Mirrors hx.rs `validate_text`, so the send button can be disabled up front. */
export function canSend(text: string): boolean {
  return text.trim() !== "" && utf8Bytes(text) <= MAX_TEXT_BYTES && !text.includes("\0");
}

const KIND_LABEL: Record<number, string> = {
  1: "Ảnh",
  2: "Video",
  3: "Vị trí",
  4: "Tin thoại",
  5: "Tệp",
  6: "Lệnh",
  7: "Tin đặc biệt",
  8: "Tin gộp",
};

/** Text of one content part; non-text parts get a short bracketed label. */
export function contentText(c: MessageContent): string {
  if (c.type === 0) return c.text ?? "";
  const label = KIND_LABEL[c.type] ?? "Tin không hỗ trợ";
  const detail =
    c.type === 3 ? c.address : c.type === 7 ? c.customEvent : c.fileName;
  const duration = (c.type === 2 || c.type === 4) && c.duration ? ` ${c.duration}s` : "";
  return `[${label}${duration}]${detail ? ` ${detail}` : ""}`;
}

export const messageText = (m: ChatMessage) => m.contents.map(contentText).filter(Boolean).join("\n") || "[Tin trống]";

/** One line for the conversation list, prefixed when the account sent it. */
export function previewText(m: ChatMessage, me: string | null): string {
  const text = messageText(m).replace(/\s+/g, " ").trim();
  return m.from !== null && m.from === me ? `Bạn: ${text}` : text;
}

/**
 * Unread: the latest message is from the other side and newer than the read
 * marker. Without a marker, any latest message from the other side counts
 * (they wrote last and it was never opened here).
 */
export function isUnread(latest: ChatMessage | null | undefined, me: string | null, marker: string | undefined): boolean {
  if (!latest || !me || latest.from === me) return false;
  return marker === undefined || compareIds(latest.id, marker) > 0;
}

/**
 * Newest activity first. Conversations without a known last message keep the
 * server order, after those with one.
 */
/**
 * The server's list, then the saved conversations it does not have (in their
 * saved order). Either may still be missing: then the other is the list.
 */
export function mergeConversations(
  listed: readonly Conversation[] | undefined,
  saved: readonly SavedConversation[] | undefined,
): Conversation[] {
  const out: Conversation[] = (listed ?? []).map(({ conversationId, conversationType }) => ({ conversationId, conversationType }));
  const known = new Set(out.map((c) => c.conversationId));
  for (const s of saved ?? []) {
    if (!known.has(s.conversationId)) out.push({ conversationId: s.conversationId, conversationType: s.conversationType });
  }
  return out;
}

/** The peer as saved with the conversation, for when nothing fresher is known. */
export function savedPeer(s: SavedConversation | undefined): Peer | undefined {
  if (!s?.peerName) return undefined;
  return { name: s.peerName, avatarUrl: safeImageUrl(s.peerAvatar), userId: null };
}

export function sortByLatest<C extends Conversation>(
  list: readonly C[],
  latest: ReadonlyMap<string, { message: ChatMessage | null | undefined }>,
): C[] {
  const time = (c: C) => latest.get(c.conversationId)?.message?.timestamp ?? null;
  return list
    .map((c, i) => ({ c, i, t: time(c) }))
    .sort((a, b) => (a.t === null ? (b.t === null ? a.i - b.i : 1) : b.t === null ? -1 : b.t - a.t || a.i - b.i))
    .map((x) => x.c);
}

export interface ThreadMessage {
  id: string;
  mine: boolean;
  text: string;
  timestamp: number | null;
}

/**
 * Pages arrive newest first; the thread reads oldest first. Messages repeated
 * across pages (new messages shift the window) appear once.
 */
export function toThread(pages: readonly HistoryPage[], me: string): ThreadMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const page of pages) for (const m of page.messages) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()]
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0) || compareIds(a.id, b.id))
    .map((m) => ({
      id: m.id,
      mine: m.from === me,
      text: messageText(m),
      timestamp: m.timestamp,
    }));
}

/** IM IDs can be long: keep the start and the end. */
export function shortId(id: string, max = 18): string {
  return id.length <= max ? id : `${id.slice(0, max - 7)}…${id.slice(-6)}`;
}

const timeOnly = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short" });

/** "14:05" today, "13/11" otherwise. */
export function shortTime(ms: number, now = new Date()): string {
  const d = new Date(ms);
  if (d.toDateString() === now.toDateString()) return timeOnly.format(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; // ICU output varies ("13/11", "13-11")
}
