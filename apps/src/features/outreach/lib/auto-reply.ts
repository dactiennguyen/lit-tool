// Pure helpers for auto-reply: deciding whether a heard message is a genuine
// incoming 1-1 text we should answer. No React, no network — unit-testable.

import type { LiveMessageEvent } from "@/lib/api";
import type { ChatMessage } from "@/lib/lit/lit-types";

/** Message content type 0 is plain text. */
const TEXT = 0;

/** The trimmed text of a plain-text message, or null when it has none. */
export function messageText(message: ChatMessage): string | null {
  const text = message.contents.find((c) => c.type === TEXT && c.text && c.text.trim())?.text;
  return text && text.trim() ? text : null;
}

export interface Incoming {
  /** The peer's IM id (who to reply to). */
  peerId: string;
  /** The text they sent. */
  text: string;
  /** Their display name from the push payload, when present. */
  senderName: string | null;
  /** When they sent it (ms). */
  at: number;
}

/**
 * A heard event is a message to answer only when it is a one-to-one text from
 * the PEER. The live connection echoes our own sent messages too, but for a 1-1
 * conversation `conversationId` is always the peer, so an incoming message has
 * `from === conversationId` while our own echo has `from === our IM id`. That
 * tells the two apart without needing to look up our own id, and prevents the
 * bot from answering its own replies (an infinite loop).
 */
export function incomingText(e: LiveMessageEvent): Incoming | null {
  if (e.conversationType !== 0) return null; // groups are not answered
  const { message, conversationId } = e;
  if (!message.from || message.from !== conversationId) return null; // our own echo, or malformed
  const text = messageText(message);
  if (!text) return null; // image / sticker / gift / control — ignore
  return { peerId: conversationId, text, senderName: message.sender?.name ?? null, at: message.timestamp ?? Date.now() };
}
