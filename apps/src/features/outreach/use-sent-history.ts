import { useCallback, useEffect, useState } from "react";
import { onSentLogged, recentSent, sentContacts, type Contact, type SentRow } from "./sent-log";

/** How many recent rows the history dialog shows. */
const RECENT_LIMIT = 200;

export interface SentHistory {
  /** peerUid → per-account contact summary (real sends only, not dry runs). */
  contacts: Map<string, Contact[]>;
  /** Newest sent rows. */
  recent: SentRow[];
}

/** The localStorage sent log, reloaded after every logged send. */
export function useSentHistory(): SentHistory {
  const [contacts, setContacts] = useState<Map<string, Contact[]>>(new Map());
  const [recent, setRecent] = useState<SentRow[]>([]);

  const reload = useCallback(() => {
    const map = new Map<string, Contact[]>();
    for (const c of sentContacts()) map.set(c.peerUid, [...(map.get(c.peerUid) ?? []), c]);
    setContacts(map);
    setRecent(recentSent(RECENT_LIMIT));
  }, []);

  useEffect(() => {
    reload();
    return onSentLogged(reload);
  }, [reload]);

  return { contacts, recent };
}
