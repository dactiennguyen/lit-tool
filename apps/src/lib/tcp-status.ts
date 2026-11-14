// Result of the last TCP login to the chat server, per account, for this app
// run. There is no long-lived connection yet: each check or send logs in and
// disconnects, so this says how the latest attempt went, not "connected now".

import { api, type HxCheckResult } from "./api";
import { persistedMap } from "./persisted-map";

export type TcpStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "ok"; at: number; via: "check" | "send" }
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

/**
 * Errors that come from the TCP login itself (hx.rs `HxError` texts), as
 * opposed to e.g. an invalid message text rejected before connecting.
 */
export function isTcpError(message: string): boolean {
  return /^(Kết nối TCP thất bại|Hết thời gian chờ|Server chat từ chối bước|Lấy token Hyphenate thất bại|Login template)/.test(
    message,
  );
}

/**
 * One TCP login + followup, then disconnect (`hx_check_connection`); sends no
 * message. The outcome is recorded as the account's status either way.
 */
export async function connectTcp(accountId: string): Promise<HxCheckResult> {
  setTcpStatus(accountId, { state: "connecting" });
  try {
    const result = await api.hx.checkConnection(accountId);
    setTcpStatus(accountId, { state: "ok", at: Date.now(), via: "check" });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không kết nối được";
    setTcpStatus(accountId, { state: "error", at: Date.now(), message });
    throw e;
  }
}
