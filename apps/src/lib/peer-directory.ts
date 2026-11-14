// Names and avatars of people, by IM ID: from the online list, a profile, or
// the push payload of a message they sent. The conversation list only carries
// IM IDs, so this is how the chat page can show a name instead of `love123…`.
// Public profile fields only.

import { safeImageUrl } from "./lit-format";
import type { ChatMessage, UserProfile } from "./lit-types";
import { persistedMap } from "./persisted-map";

export interface Peer {
  name: string;
  avatarUrl: string | null;
  /** Litmatch user id, for opening the profile. */
  userId: string | null;
}

const isPeer = (v: unknown): v is Peer => typeof (v as Peer | null)?.name === "string";
const peers = persistedMap<Peer>("sky.peers", isPeer, 500);

/** Records every profile that has an IM ID and a name; the most recent entries are kept. */
export function rememberPeers(profiles: readonly UserProfile[]): void {
  peers.update((draft) => {
    let changed = false;
    for (const p of profiles) {
      if (!p.huanxinId || !p.nickname) continue;
      const peer: Peer = { name: p.nickname, avatarUrl: safeImageUrl(p.avatar), userId: p.userId };
      const old = draft.get(p.huanxinId);
      if (old && old.name === peer.name && old.avatarUrl === peer.avatarUrl && old.userId === peer.userId) continue;
      draft.delete(p.huanxinId); // re-insert at the end (most recent)
      draft.set(p.huanxinId, peer);
      changed = true;
    }
    return changed;
  });
}

/**
 * Records the peer of a one-to-one conversation from the newest message they
 * sent (`messages` newest first). An entry with a user id came from a profile
 * and is kept as is; only its missing avatar is filled in.
 */
export function rememberSender(peerId: string, messages: readonly ChatMessage[]): void {
  const sender = messages.find((m) => m.from === peerId && m.sender?.name)?.sender;
  const avatarUrl = safeImageUrl(messages.find((m) => m.from === peerId && m.sender?.avatar)?.sender?.avatar ?? null);
  if (!sender?.name && !avatarUrl) return;
  peers.update((draft) => {
    const old = draft.get(peerId);
    const peer: Peer = old?.userId
      ? { ...old, avatarUrl: old.avatarUrl ?? avatarUrl }
      : { name: sender?.name ?? old?.name ?? "", avatarUrl: avatarUrl ?? old?.avatarUrl ?? null, userId: null };
    if (!peer.name || (old && old.name === peer.name && old.avatarUrl === peer.avatarUrl)) return false;
    draft.delete(peerId);
    draft.set(peerId, peer);
    return true;
  });
}

export const usePeers = peers.use;
export const getPeers = peers.get;
