// The connection log of each account for this app run (zustand stores), in two channels: TCP
// (each frame of its live connection, "hx-log", and each state change,
// "hx-status") and HTTP (each request, "http-log"). Memory only, newest last,
// the oldest dropped past MAX. HTTP requests of no account (the server list)
// show in every account's HTTP log.

import { useMemo } from "react";
import { createStore, useStore } from "zustand";
import type { HttpLogEvent, LiveLogEvent, LiveState } from "@/lib/api";

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
  const store = createStore<{ logs: Readonly<Record<string, readonly E[]>> }>(() => ({ logs: {} }));
  let nextId = 0;
  const get = (key: string) => store.getState().logs[key] ?? EMPTY;
  return {
    add(key: string, entry: Without<E, "id">) {
      const old = get(key);
      const next = [...old.slice(Math.max(0, old.length - MAX + 1)), { ...entry, id: nextId++ } as unknown as E];
      store.setState((s) => ({ logs: { ...s.logs, [key]: next } }));
    },
    clear(key: string) {
      if (!(key in store.getState().logs)) return;
      store.setState((s) => {
        const { [key]: _, ...rest } = s.logs;
        return { logs: rest };
      });
    },
    get,
    use: (key: string) => useStore(store, (s) => s.logs[key] ?? EMPTY),
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
