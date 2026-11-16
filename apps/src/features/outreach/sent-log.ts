// A log of outreach sends, kept in localStorage (per machine). The Litmatch
// desktop app has no server-side sent log, so this powers "ẩn đã nhắn", the
// per-person sent badge and the history dialog without a backend.

const KEY = "sky-manager:outreach-sent";
/** Keep at most this many rows; the oldest are dropped. */
const MAX_ROWS = 2000;

export interface SentEntry {
  sentAt: number;
  accountId: string;
  accountLabel: string;
  /** The collected person's identity (user id, or IM id as a fallback). */
  peerUid: string;
  /** The IM id the message was sent to. */
  peerImId: string;
  peerName: string;
  text: string;
  /** A real send the server accepted. Failures are false. */
  ok: boolean;
  /**
   * The frame was written but no ACK came back (hx.rs SendUnknown): the message
   * MAY have been delivered. Such a person is treated as contacted so a re-run
   * doesn't blindly send again, until it can be reconciled against history.
   */
  uncertain?: boolean;
  /** Legacy: rows written by the old "chế độ thử" (dry run); never a contact. */
  dryRun?: boolean;
  error: string | null;
  note: string | null;
}

export interface SentRow extends SentEntry {
  id: number;
}

/** One peer and sending account: confirmed sends, unknown-outcome sends, and the last time. */
export interface Contact {
  peerUid: string;
  accountId: string;
  accountLabel: string;
  /** Sends the server confirmed. */
  count: number;
  /** Sends with an unknown outcome (maybe delivered), held so they aren't blindly resent. */
  uncertain: number;
  lastSentAt: number;
}

const listeners = new Set<() => void>();

function allRows(): SentRow[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as SentRow[]) : [];
  } catch {
    return [];
  }
}

export function logSent(entry: SentEntry): void {
  try {
    const rows = allRows();
    rows.push({ ...entry, id: (rows.at(-1)?.id ?? 0) + 1 });
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX_ROWS)));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function recentSent(limit = 100): SentRow[] {
  return allRows()
    .sort((a, b) => b.sentAt - a.sentAt || b.id - a.id)
    .slice(0, limit);
}

/**
 * Per peer + account: confirmed sends plus unknown-outcome sends (both count as
 * "contacted" so they aren't blindly resent). Clean failures and legacy dry runs
 * are excluded, so a genuine failure can still be retried.
 */
export function sentContacts(): Contact[] {
  const byKey = new Map<string, Contact>();
  for (const r of allRows()
    .filter((r) => (r.ok || r.uncertain) && !r.dryRun)
    .sort((a, b) => a.sentAt - b.sentAt)) {
    const key = `${r.peerUid}|${r.accountId}`;
    const c = byKey.get(key);
    byKey.set(key, {
      peerUid: r.peerUid,
      accountId: r.accountId,
      accountLabel: r.accountLabel,
      count: (c?.count ?? 0) + (r.ok ? 1 : 0),
      uncertain: (c?.uncertain ?? 0) + (r.ok ? 0 : 1),
      lastSentAt: r.sentAt,
    });
  }
  return [...byKey.values()];
}

export function clearSentLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

/** Called after every logged send; returns the unsubscribe function. */
export function onSentLogged(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
