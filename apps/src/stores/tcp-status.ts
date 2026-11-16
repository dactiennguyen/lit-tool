// Chat connection status per account, for this app run. "connecting", "live"
// and "retrying" come from the account's live connection (chat/listen, through
// the "hx-status" event, see hx-live.ts). Without one, a message is sent over
// a one-off login, and "ok"/"error" say how the latest send went.

import { api, type LiveState } from "@/lib/api";
import { persistedMap } from "./persisted-map";

export type TcpStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "live"; since: number }
  | { state: "retrying"; at: number; message: string; retryAt: number }
  | { state: "ok"; at: number; via: "send" }
  | { state: "error"; at: number; message: string };

type Stored = Exclude<TcpStatus, { state: "idle" }>;

const statuses = persistedMap<Stored>(null, (v): v is Stored => typeof v === "object" && v !== null, 1000);

export function setTcpStatus(accountId: string, status: Stored | null): void {
  statuses.update((draft) => {
    if (status) draft.set(accountId, status);
    else if (!draft.delete(accountId)) return false;
    return true;
  });
}

export const getTcpStatus = (accountId: string): TcpStatus => statuses.get().get(accountId) ?? { state: "idle" };

export function useTcpStatus(accountId: string): TcpStatus {
  return statuses.use().get(accountId) ?? { state: "idle" };
}

/** A live connection is open or being opened: sends go through it. */
export const isLive = (s: TcpStatus) => s.state === "connecting" || s.state === "live" || s.state === "retrying";

/** Records a state of the live connection; stopped by the user = idle. */
export function applyLiveState(accountId: string, s: LiveState): void {
  if (s.state !== "stopped") setTcpStatus(accountId, s);
  else if (s.message !== null) setTcpStatus(accountId, { state: "error", at: s.at, message: s.message });
  else setTcpStatus(accountId, null);
}

/**
 * Errors that come from the TCP login itself (hx.rs `HxError` texts), as
 * opposed to e.g. an invalid message text rejected before connecting.
 */
export function isTcpError(message: string): boolean {
  return /^(Kết nối TCP thất bại|Hết thời gian chờ|Server chat từ chối bước|Lấy token Hyphenate thất bại|Login template|Không lấy được danh sách server chat)/.test(
    message,
  );
}

/** Opens the live connection of the account (`hx_listen_start`); it stays open until stopped. */
export async function connectTcp(accountId: string): Promise<void> {
  setTcpStatus(accountId, { state: "connecting" });
  try {
    applyLiveState(accountId, await api.hx.listenStart(accountId));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không kết nối được";
    setTcpStatus(accountId, { state: "error", at: Date.now(), message });
    throw e;
  }
}

/** Closes the live connection of the account. */
export async function disconnectTcp(accountId: string): Promise<void> {
  await api.hx.listenStop(accountId);
  setTcpStatus(accountId, null);
}
