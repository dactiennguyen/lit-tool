import { useMemo } from "react";
import { recentSent, sentContacts, useSentLogStore, type Contact, type SentRow } from "@/features/outreach/store/sent-log";

/** How many recent rows the history dialog shows. */
const RECENT_LIMIT = 200;

export interface SentHistory {
  /** peerUid → per-account contact summary (real sends only, not dry runs). */
  contacts: Map<string, Contact[]>;
  /** Newest sent rows. */
  recent: SentRow[];
}

/** The sent log (sent-log.ts store), summarised; updates after every logged send. */
export function useSentHistory(): SentHistory {
  const rows = useSentLogStore((s) => s.rows);
  return useMemo(() => {
    const contacts = new Map<string, Contact[]>();
    for (const c of sentContacts(rows)) contacts.set(c.peerUid, [...(contacts.get(c.peerUid) ?? []), c]);
    return { contacts, recent: recentSent(RECENT_LIMIT, rows) };
  }, [rows]);
}
