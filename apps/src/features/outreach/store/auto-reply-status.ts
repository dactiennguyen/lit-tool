// Runtime counters for auto-reply (zustand, memory only — resets on restart).
// The engine writes here; the settings dialog shows it so you can see activity.

import { create } from "zustand";

interface AutoReplyStatus {
  /** Replies actually sent this app run. */
  replied: number;
  /** When the last reply went out. */
  lastAt: number | null;
  /** Who it answered (name or IM id), for the dialog. */
  lastPeer: string | null;
  /** The last send error, if any. */
  lastError: string | null;
}

export const useAutoReplyStatusStore = create<AutoReplyStatus>(() => ({
  replied: 0,
  lastAt: null,
  lastPeer: null,
  lastError: null,
}));

export const useAutoReplyStatus = (): AutoReplyStatus => useAutoReplyStatusStore();
