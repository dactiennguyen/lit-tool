// One row of the overview table, from the cached queries of one account.

import type { Conversation, UserProfile, Wallet } from "@/lib/lit/lit-types";

/** The parts of a query result the overview reads. */
export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  isFetching: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export interface AccountSummary {
  nickname: string | null;
  diamonds: number | null;
  walletError: string | null;
  conversations: number | null;
  conversationsError: string | null;
}

/** The newer of data and error wins, so a later success clears an old error and vice versa. */
function latest<T>(q: QueryState<T>): { data: T } | { error: Error } | null {
  if (q.error && q.errorUpdatedAt >= q.dataUpdatedAt) return { error: q.error };
  if (q.data !== undefined) return { data: q.data };
  return null;
}

/** Profile, wallet and conversation count; the login state lives in stores/sessions.ts. */
export function summarize(
  me: QueryState<UserProfile>,
  wallet: QueryState<Wallet>,
  conversations: QueryState<Conversation[]>,
): AccountSummary {
  const m = latest(me);
  const w = latest(wallet);
  const c = latest(conversations);
  return {
    nickname: m && "data" in m ? m.data.nickname : null,
    diamonds: w && "data" in w ? w.data.diamonds : null,
    walletError: w && "error" in w ? w.error.message : null,
    conversations: c && "data" in c ? c.data.length : null,
    conversationsError: c && "error" in c ? c.error.message : null,
  };
}
