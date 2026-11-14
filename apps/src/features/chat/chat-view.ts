// Display helpers for the chat page: message text and thread ordering.

import type { ChatMessage, HistoryPage, MessageContent } from "@/lib/lit-types";

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

export interface ThreadMessage {
  id: string;
  mine: boolean;
  text: string;
  timestamp: number | null;
}

/** Numeric compare of uint64 ids kept as text (no precision loss). */
function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
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
      text: m.contents.map(contentText).filter(Boolean).join("\n") || "[Tin trống]",
      timestamp: m.timestamp,
    }));
}

/** IM IDs can be long: keep the start and the end. */
export function shortId(id: string, max = 18): string {
  return id.length <= max ? id : `${id.slice(0, max - 7)}…${id.slice(-6)}`;
}
