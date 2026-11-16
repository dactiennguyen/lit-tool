// The auto-reply engine. Started once at the app root (main.tsx), it listens to
// every heard message on every live connection and, when enabled, answers an
// incoming 1-1 text. It runs app-wide regardless of which screen is open, the
// same as the live-event subscriber it hooks into.
//
// Guards (so it never loops or floods): it only answers the PEER's text (never
// its own echoed replies — see incomingText), de-dups by message id, ignores
// messages older than 10 min (reconnect replays), waits a random delay, and
// enforces the per-person / per-hour limits from the settings. All counters are
// in memory, so limits reset on restart.

import type { QueryClient } from "@tanstack/react-query";
import { api, type LiveMessageEvent } from "@/lib/api";
import { onLiveMessage } from "@/lib/hx-live";
import { conversationsKey } from "@/lib/queries";
import { getPeers } from "@/stores/peer-directory";
import { canSend } from "@/features/chat/lib/chat-view";
import { fillTemplate, type TemplateUser } from "./outreach-view";
import { incomingText } from "./auto-reply";
import { getAutoReply } from "../store/auto-reply-settings";
import { useTemplateStore } from "../store/templates";
import { useAutoReplyStatusStore } from "../store/auto-reply-status";

const MAX_AGE_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SEEN_LIMIT = 2000;

/** `${accountId}|${messageId}` of messages already handled (de-dup). */
const seen = new Set<string>();
/** `${accountId}|${peerId}` → how many replies and when the last one went out. */
const perPeer = new Map<string, { count: number; lastAt: number }>();
/** accountId → timestamps of replies in the last hour. */
const perHour = new Map<string, number[]>();

const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function remember(key: string) {
  seen.add(key);
  if (seen.size > SEEN_LIMIT) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

/** A template user carrying just the name; other {variables} fall back to "". */
const asUser = (name: string | null): TemplateUser => ({
  nickname: name,
  age: null,
  gender: null,
  ipCity: null,
  country: null,
  ipCountry: null,
  litId: null,
});

/** The reply text for one peer, variables filled, or null when there is nothing sendable. */
function buildReply(name: string | null): string | null {
  const s = getAutoReply();
  const raw =
    s.mode === "single"
      ? s.text.trim()
      : (() => {
          const pool = useTemplateStore
            .getState()
            .templates.map((t) => t.trim())
            .filter((t) => canSend(t));
          return pool.length ? pool[Math.floor(Math.random() * pool.length)]! : "";
        })();
  if (!raw) return null;
  const reply = fillTemplate(raw, asUser(name));
  return canSend(reply) ? reply : null;
}

async function handle(qc: QueryClient, e: LiveMessageEvent): Promise<void> {
  const s = getAutoReply();
  if (!s.enabled) return;

  const hit = incomingText(e);
  if (!hit) return;
  const { accountId } = e;
  const { peerId, senderName, at } = hit;

  const seenKey = `${accountId}|${e.message.id}`;
  if (seen.has(seenKey)) return;
  remember(seenKey);

  if (Date.now() - at > MAX_AGE_MS) return; // stale replay after a reconnect

  // ---- rate limits
  const now = Date.now();
  const peerKey = `${accountId}|${peerId}`;
  const pp = perPeer.get(peerKey);
  if (s.maxPerPerson > 0 && (pp?.count ?? 0) >= s.maxPerPerson) return;
  if (pp && now - pp.lastAt < s.minGapSec * 1000) return;
  const recent = (perHour.get(accountId) ?? []).filter((t) => now - t < HOUR_MS);
  if (s.maxPerHour > 0 && recent.length >= s.maxPerHour) return;

  const reply = buildReply(senderName ?? getPeers().get(peerId)?.name ?? null);
  if (!reply) return;

  // Reserve the slot before the wait, so a second message arriving during the
  // delay cannot also claim a reply to the same person.
  perPeer.set(peerKey, { count: (pp?.count ?? 0) + 1, lastAt: now });
  recent.push(now);
  perHour.set(accountId, recent);

  await sleep(rand(s.delayMinSec, s.delayMaxSec) * 1000);
  if (!getAutoReply().enabled) return; // switched off during the wait

  try {
    await api.hx.sendText(accountId, peerId, reply, false);
    const st = useAutoReplyStatusStore.getState();
    useAutoReplyStatusStore.setState({
      replied: st.replied + 1,
      lastAt: Date.now(),
      lastPeer: senderName ?? peerId,
      lastError: null,
    });
    void qc.invalidateQueries({ queryKey: conversationsKey(accountId) });
  } catch (err) {
    useAutoReplyStatusStore.setState({ lastError: (err as Error).message });
  }
}

let started = false;

/** Subscribe the engine to the live message stream. Idempotent. */
export function startAutoReply(qc: QueryClient): void {
  if (started) return;
  started = true;
  onLiveMessage((e) => void handle(qc, e));
}
