// Names and avatars of people seen in the online list or a profile, by IM ID.
// The conversation list only carries IM IDs, so this is how the chat page can
// show a name instead of `love123…`. Public profile fields only.

import { safeImageUrl } from "./lit-format";
import type { UserProfile } from "./lit-types";
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

export const usePeers = peers.use;
