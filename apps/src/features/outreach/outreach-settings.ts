// Remembered settings for the "Lấy & gửi" view, kept in localStorage so the
// options are the same next time the app opens. Account selections are not kept
// here: accounts start logged out each run, so they default to all online.

import { useSyncExternalStore } from "react";

export interface OutreachSettings {
  /** How many people to collect. */
  target: number;
  /** Seconds between online_users page requests while collecting. */
  collectDelaySec: number;
  /** Recipient-list filter: hide people already messaged. */
  hideContacted: boolean;
  /** Skip already-messaged people when sending. */
  skipContacted: boolean;
  /** Send at most this many (0 = everyone). */
  cap: number;
  /** One text, or a random pick from the ticked templates. */
  mode: "single" | "random";
  /** The single-message draft. */
  text: string;
  /** Seconds between messages. */
  delaySec: number;
  /** Write Litmatch new-conversation metadata (bắt chuyện). */
  firstContact: boolean;
}

const KEY = "sky-manager:outreach-settings";

const DEFAULTS: OutreachSettings = {
  target: 100,
  collectDelaySec: 0.4,
  hideContacted: false,
  skipContacted: true,
  cap: 0,
  mode: "single",
  text: "",
  delaySec: 2,
  firstContact: true,
};

function load(): OutreachSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    const r = raw as Record<string, unknown>;
    return {
      target: typeof r.target === "number" && r.target >= 1 ? Math.min(5000, Math.floor(r.target)) : DEFAULTS.target,
      collectDelaySec:
        typeof r.collectDelaySec === "number" && r.collectDelaySec >= 0 ? r.collectDelaySec : DEFAULTS.collectDelaySec,
      hideContacted: typeof r.hideContacted === "boolean" ? r.hideContacted : DEFAULTS.hideContacted,
      skipContacted: typeof r.skipContacted === "boolean" ? r.skipContacted : DEFAULTS.skipContacted,
      cap: typeof r.cap === "number" && r.cap >= 0 ? Math.floor(r.cap) : DEFAULTS.cap,
      mode: r.mode === "random" ? "random" : "single",
      text: typeof r.text === "string" ? r.text : DEFAULTS.text,
      delaySec: typeof r.delaySec === "number" && r.delaySec >= 0 ? r.delaySec : DEFAULTS.delaySec,
      firstContact: typeof r.firstContact === "boolean" ? r.firstContact : DEFAULTS.firstContact,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings: OutreachSettings = load();
const listeners = new Set<() => void>();

export function patchOutreachSettings(patch: Partial<OutreachSettings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: memory only */
  }
  for (const l of listeners) l();
}

/** The remembered settings; re-renders when they change. */
export function useOutreachSettings(): OutreachSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => settings,
  );
}
