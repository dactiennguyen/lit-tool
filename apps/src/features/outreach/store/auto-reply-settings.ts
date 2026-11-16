// Auto-reply settings (zustand, kept in localStorage). One global switch answers
// incoming 1-1 text messages on every logged-in account, with a message built
// from the same templates/variables as "Lấy & gửi", and rate limits so it never
// floods a person or the account. Runtime counters live in auto-reply-status.ts.

import { create } from "zustand";
import { readStored, writeStored } from "@/lib/storage";

export interface AutoReplySettings {
  /** Master switch: answer incoming messages on all logged-in accounts. */
  enabled: boolean;
  /** One fixed reply, or a random pick from the shared "Mẫu tin" templates. */
  mode: "single" | "random";
  /** The single-mode reply text (supports {ten}… variables). */
  text: string;
  /** Random wait before replying, lower and upper bound (seconds), so it looks human. */
  delayMinSec: number;
  delayMaxSec: number;
  /** Reply to one person at most this many times (0 = no limit). */
  maxPerPerson: number;
  /** Minimum seconds between two replies to the same person. */
  minGapSec: number;
  /** Reply at most this many times per account per hour (0 = no limit). */
  maxPerHour: number;
}

const KEY = "sky-manager:auto-reply";

const DEFAULTS: AutoReplySettings = {
  enabled: false,
  mode: "single",
  text: "",
  delayMinSec: 5,
  delayMaxSec: 15,
  maxPerPerson: 1,
  minGapSec: 60,
  maxPerHour: 30,
};

function parse(text: string): AutoReplySettings {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    const r = raw as Record<string, unknown>;
    const num = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && Number.isFinite(v) ? v : d);
    return {
      enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULTS.enabled,
      mode: r.mode === "random" ? "random" : "single",
      text: typeof r.text === "string" ? r.text : DEFAULTS.text,
      delayMinSec: num(r.delayMinSec, DEFAULTS.delayMinSec),
      delayMaxSec: num(r.delayMaxSec, DEFAULTS.delayMaxSec),
      maxPerPerson: num(r.maxPerPerson, DEFAULTS.maxPerPerson),
      minGapSec: num(r.minGapSec, DEFAULTS.minGapSec),
      maxPerHour: num(r.maxPerHour, DEFAULTS.maxPerHour),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const useAutoReplyStore = create<{ settings: AutoReplySettings }>(() => ({
  settings: readStored(KEY, parse, { ...DEFAULTS }),
}));

export function patchAutoReply(patch: Partial<AutoReplySettings>): void {
  const settings = { ...useAutoReplyStore.getState().settings, ...patch };
  useAutoReplyStore.setState({ settings });
  writeStored(KEY, JSON.stringify(settings));
}

/** Current settings, read outside React (the engine). */
export const getAutoReply = (): AutoReplySettings => useAutoReplyStore.getState().settings;

/** Current settings; re-renders when they change (the dialog). */
export const useAutoReply = (): AutoReplySettings => useAutoReplyStore((s) => s.settings);
