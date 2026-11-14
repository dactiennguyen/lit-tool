// The connection log of each account for this app run, in two channels: TCP
// (each frame of its live connection, "hx-log", and each state change,
// "hx-status") and HTTP (each request, "http-log"). Memory only, newest last,
// the oldest dropped past MAX. HTTP requests of no account (the server list)
// show in every account's HTTP log.

import { useMemo, useSyncExternalStore } from "react";
import type { HttpLogEvent, LiveLogEvent, LiveState } from "./api";

export type TcpEntry =
  | ({ id: number; dir: "in" | "out" } & Omit<LiveLogEvent, "accountId" | "dir">)
  | { id: number; at: number; dir: "state"; state: LiveState };

export type HttpEntry = { id: number } & Omit<HttpLogEvent, "accountId">;

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const MAX = 300;
/** Key of the requests of no account. */
const SHARED = "*";

function channel<E extends { id: number }>() {
  const EMPTY: readonly E[] = [];
  const logs = new Map<string, readonly E[]>();
  const listeners = new Set<() => void>();
  let nextId = 0;
  const publish = () => listeners.forEach((l) => l());
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const get = (key: string) => logs.get(key) ?? EMPTY;
  return {
    add(key: string, entry: Without<E, "id">) {
      const old = get(key);
      logs.set(key, [...old.slice(Math.max(0, old.length - MAX + 1)), { ...entry, id: nextId++ } as unknown as E]);
      publish();
    },
    clear(key: string) {
      if (logs.delete(key)) publish();
    },
    get,
    use: (key: string) => useSyncExternalStore(subscribe, () => get(key), () => EMPTY),
  };
}

const tcp = channel<TcpEntry>();
const http = channel<HttpEntry>();

export const addTcpLog = tcp.add;
export const getTcpLog = tcp.get;
export const useTcpLog = tcp.use;

export function addHttpLog({ accountId, ...entry }: HttpLogEvent): void {
  http.add(accountId ?? SHARED, entry);
}

/** The account's requests and those of no account, in order. */
export function mergeHttpLog(own: readonly HttpEntry[], shared: readonly HttpEntry[]): HttpEntry[] {
  return shared.length ? [...own, ...shared].sort((a, b) => a.id - b.id).slice(-MAX) : [...own];
}

export const getHttpLog = (accountId: string) => mergeHttpLog(http.get(accountId), http.get(SHARED));

export function useHttpLog(accountId: string): HttpEntry[] {
  const own = http.use(accountId);
  const shared = http.use(SHARED);
  return useMemo(() => mergeHttpLog(own, shared), [own, shared]);
}

export function clearLogs(accountId: string): void {
  tcp.clear(accountId);
  http.clear(accountId);
  http.clear(SHARED);
}
