// Which accounts are "logged in" in this app run (a zustand store). Nothing is fetched for an
// account until the user presses "Đăng nhập"; logging in checks the stored sid
// with `user/get_info/me`. Memory only: every app start begins logged out.
//
// Each state remembers the account's `sessionSavedAt`, so saving a new sid
// makes the old state stale and the account shows as logged out again.

import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { Account } from "@/lib/api";
import { litQueries, queryKeys, settingsQuery } from "@/lib/queries";
import { connectTcp, disconnectTcp, setTcpStatus } from "./tcp-status";

export type SessionState =
  | { state: "out" }
  | { state: "loading" }
  | { state: "in"; at: number }
  | { state: "error"; message: string; expired: boolean };

type Stored = Exclude<SessionState, { state: "out" }> & { savedAt: number | null };

/** Login state by account id. Memory only. */
export const useSessionStore = create<{ sessions: ReadonlyMap<string, Stored> }>(() => ({ sessions: new Map() }));

const sessions = () => useSessionStore.getState().sessions;
const selectSessions = (s: { sessions: ReadonlyMap<string, Stored> }) => s.sessions;

function set(accountId: string, value: Stored | null) {
  useSessionStore.setState((s) => {
    const next = new Map(s.sessions);
    if (value) next.set(accountId, value);
    else next.delete(accountId);
    return { sessions: next };
  });
}

/** The server says the sid is no longer valid ("login time out, please relogin"). */
export const isSessionExpired = (message: string) => /\bresult -10\b/.test(message);

function current(account: Pick<Account, "id" | "sessionSavedAt">, map: ReadonlyMap<string, Stored>): SessionState {
  const s = map.get(account.id);
  if (!s || s.savedAt !== account.sessionSavedAt) return { state: "out" };
  const { savedAt: _, ...state } = s;
  return state;
}

/** Current state outside React. */
export const getSession = (account: Pick<Account, "id" | "sessionSavedAt">) => current(account, sessions());

/**
 * Whether this account is logged in right now, by id alone — a logout removes the
 * entry and an auth error flips it, so both make this false. For background jobs
 * (e.g. the outreach send loop) that must re-check login between steps.
 */
export const isAccountLoggedIn = (accountId: string): boolean => sessions().get(accountId)?.state === "in";

export function useSession(account: Pick<Account, "id" | "sessionSavedAt">): SessionState {
  return current(account, useSessionStore(selectSessions));
}

/** All accounts' states, for lists. */
export function useSessions(): (account: Pick<Account, "id" | "sessionSavedAt">) => SessionState {
  const map = useSessionStore(selectSessions);
  return useCallback((account) => current(account, map), [map]);
}

/**
 * Checks the sid with `user/get_info/me`; the profile stays cached for the Hồ sơ
 * tab, and the backend saves the IM username/password found in it for chat.
 * Then connects over TCP when auto-connect is on.
 */
export async function login(qc: QueryClient, account: Account): Promise<boolean> {
  const savedAt = account.sessionSavedAt;
  set(account.id, { state: "loading", savedAt });
  try {
    await qc.fetchQuery({ ...litQueries.userInfoMe(account.id), staleTime: 0 });
    set(account.id, { state: "in", at: Date.now(), savedAt });
    // The backend may have saved the IM identity from the profile.
    await qc.invalidateQueries({ queryKey: queryKeys.accounts });
    await autoConnect(qc, account.id);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đăng nhập được";
    set(account.id, { state: "error", message, expired: isSessionExpired(message), savedAt });
    return false;
  }
}

/**
 * With "Tự động kết nối TCP" on, opens the live connection right after login
 * (it connects in the background). A failure only shows in the TCP status;
 * the login itself succeeded.
 */
async function autoConnect(qc: QueryClient, accountId: string): Promise<void> {
  try {
    const settings = await qc.ensureQueryData(settingsQuery);
    if (settings.autoConnectTcp) await connectTcp(accountId);
  } catch {
    /* recorded in tcp-status by connectTcp */
  }
}

/** Closes the live connection and forgets the state and every cached response of the account. */
export function logout(qc: QueryClient, accountId: string): void {
  set(accountId, null);
  void disconnectTcp(accountId).catch(() => {});
  setTcpStatus(accountId, null);
  qc.removeQueries({ predicate: (q) => q.queryKey.includes(accountId) });
}

/**
 * Called for every failed query: a request that finds the sid expired after
 * login moves the account back to the login screen with that error.
 */
export function noteQueryError(queryKey: readonly unknown[], error: Error): void {
  if (queryKey[0] !== "lit" || typeof queryKey[2] !== "string" || !isSessionExpired(error.message)) return;
  const s = sessions().get(queryKey[2]);
  if (s?.state === "in") set(queryKey[2], { state: "error", message: error.message, expired: true, savedAt: s.savedAt });
}

export function useLogin() {
  const qc = useQueryClient();
  return {
    login: useCallback((account: Account) => login(qc, account), [qc]),
    logout: useCallback((accountId: string) => logout(qc, accountId), [qc]),
  };
}
