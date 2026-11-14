// The newest message id seen per conversation (`accountId:conversationId`),
// stored on this machine. The server's unread state is not available, so
// "unread" means: the latest message is from the other side and newer than
// what was shown here.

import { persistedMap } from "./persisted-map";

const markers = persistedMap<string>("sky.readMarkers", (v): v is string => typeof v === "string", 2000);

export const markerKey = (accountId: string, conversationId: string) => `${accountId}:${conversationId}`;

/** Numeric compare of uint64 ids kept as text (no precision loss). */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Records `messageId` as seen; never moves a marker backwards. */
export function markRead(accountId: string, conversationId: string, messageId: string): void {
  const key = markerKey(accountId, conversationId);
  markers.update((draft) => {
    const old = draft.get(key);
    if (old && compareIds(messageId, old) <= 0) return false;
    draft.delete(key);
    draft.set(key, messageId);
    return true;
  });
}

export const useReadMarkers = markers.use;

export const readMarker = (accountId: string, conversationId: string) =>
  markers.get().get(markerKey(accountId, conversationId));
