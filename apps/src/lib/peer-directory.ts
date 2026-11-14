// Names and avatars of people seen in the online list or a profile, by IM ID.
// The conversation list only carries IM IDs, so this is how the chat page can
// show a name instead of `love123…`. Kept in memory and, best effort, in
// localStorage (public profile fields only).

import { useSyncExternalStore } from "react";
import { safeImageUrl } from "./lit-format";
import type { UserProfile } from "./lit-types";

export interface Peer {
  name: string;
  avatarUrl: string | null;
  /** Litmatch user id, for opening the profile. */
  userId: string | null;
}

const STORAGE_KEY = "sky.peers";
const MAX_PEERS = 500;

let peers: ReadonlyMap<string, Peer> = load();
const listeners = new Set<() => void>();

function load(): Map<string, Peer> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return new Map();
    return new Map(
      raw.filter(
        (e): e is [string, Peer] =>
          Array.isArray(e) && typeof e[0] === "string" && typeof e[1]?.name === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...peers]));
  } catch {
    /* storage unavailable: memory only */
  }
}

/** Records every profile that has an IM ID and a name. Newest entries win; oldest are dropped past the cap. */
export function rememberPeers(profiles: readonly UserProfile[]): void {
  const next = new Map(peers);
  let changed = false;
  for (const p of profiles) {
    if (!p.huanxinId || !p.nickname) continue;
    const peer: Peer = { name: p.nickname, avatarUrl: safeImageUrl(p.avatar), userId: p.userId };
    const old = next.get(p.huanxinId);
    if (old && old.name === peer.name && old.avatarUrl === peer.avatarUrl && old.userId === peer.userId) continue;
    next.delete(p.huanxinId); // re-insert at the end (most recent)
    next.set(p.huanxinId, peer);
    changed = true;
  }
  if (!changed) return;
  while (next.size > MAX_PEERS) next.delete(next.keys().next().value!);
  peers = next;
  save();
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The whole directory; re-renders when it changes. */
export function usePeers(): ReadonlyMap<string, Peer> {
  return useSyncExternalStore(subscribe, () => peers);
}
