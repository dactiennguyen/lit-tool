import { beforeEach, describe, expect, it } from "vitest";
import { clearSentLog, logSent, sentContacts, type SentEntry } from "./sent-log";

// A minimal in-memory localStorage for the node test environment.
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return store.size;
    },
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
  } as Storage;
  clearSentLog();
});

const row = (over: Partial<SentEntry>): SentEntry => ({
  sentAt: Date.now(),
  accountId: "a1",
  accountLabel: "Acc 1",
  peerUid: "u?",
  peerImId: "im",
  peerName: "U",
  text: "hi",
  ok: false,
  error: null,
  note: null,
  ...over,
});

describe("sentContacts", () => {
  it("counts confirmed sends, holds unknown ones, and ignores clean failures", () => {
    logSent(row({ peerUid: "confirmed", ok: true }));
    logSent(row({ peerUid: "unknown", ok: false, uncertain: true }));
    logSent(row({ peerUid: "failed", ok: false }));

    const byUid = new Map(sentContacts().map((c) => [c.peerUid, c]));
    expect(byUid.get("confirmed")).toMatchObject({ count: 1, uncertain: 0 });
    // An unknown-ACK send is treated as contacted so a re-run won't resend it.
    expect(byUid.get("unknown")).toMatchObject({ count: 0, uncertain: 1 });
    // A clean failure is retryable, so it is not a contact.
    expect(byUid.has("failed")).toBe(false);
  });

  it("does not count legacy dry-run rows", () => {
    logSent(row({ peerUid: "dry", ok: false, dryRun: true }));
    expect(sentContacts()).toHaveLength(0);
  });
});
