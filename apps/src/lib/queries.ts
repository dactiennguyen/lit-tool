import { queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rememberPeers } from "./peer-directory";
import { api, type Account, type AccountPatch, type AppSettings, type HxInput, type NewAccount } from "./api";

export const queryKeys = {
  accounts: ["accounts"] as const,
  settings: ["settings"] as const,
  /** Prefix of every query that calls the Litmatch API. */
  lit: ["lit"] as const,
  /** Prefix of IM history queries (their own server, unaffected by the API base URL). */
  hx: ["hx"] as const,
};

export const conversationsKey = (accountId: string | undefined) => [...queryKeys.lit, "conversations", accountId] as const;
export const historyKey = (accountId: string | undefined, conversationId: string | undefined) =>
  [...queryKeys.hx, "history", accountId, conversationId] as const;

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.settings.update(patch),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.settings, settings);
      // Data from the old server must not be shown as fresh.
      return qc.resetQueries({ queryKey: queryKeys.lit });
    },
  });
}

/** Path of a corrupt accounts.json that was moved aside at startup, if any. */
export function useRecoveredBackup() {
  return useQuery({ queryKey: ["accounts", "recovered"], queryFn: api.accounts.recoveredBackup, staleTime: Infinity });
}

/** Shared by the hooks below and by pages that fetch for many accounts at once. */
export const litQueries = {
  accountInfo: (accountId: string | undefined) =>
    queryOptions({
      queryKey: [...queryKeys.lit, "account_info", accountId],
      queryFn: () => api.lit.accountInfo(accountId!),
      enabled: !!accountId,
      retry: false, // don't hammer the server with a bad session
      staleTime: 60_000,
    }),
  userInfoMe: (accountId: string | undefined) =>
    queryOptions({
      queryKey: [...queryKeys.lit, "user_info_me", accountId],
      queryFn: () => api.lit.userInfoMe(accountId!),
      enabled: !!accountId,
      retry: false,
      staleTime: 60_000,
    }),
  conversations: (accountId: string | undefined) =>
    queryOptions({
      queryKey: conversationsKey(accountId),
      queryFn: () => api.lit.conversations(accountId!),
      enabled: !!accountId,
      retry: false,
      staleTime: 30_000,
    }),
};

export const useAccountInfo = (accountId: string | undefined) => useQuery(litQueries.accountInfo(accountId));
export const useUserInfoMe = (accountId: string | undefined) => useQuery(litQueries.userInfoMe(accountId));
export const useConversations = (accountId: string | undefined) => useQuery(litQueries.conversations(accountId));

export function useUserInfo(accountId: string | undefined, targetId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.lit, "user_info", accountId, targetId],
    queryFn: async () => {
      const profile = await api.lit.userInfo(accountId!, targetId!);
      rememberPeers([profile]);
      return profile;
    },
    enabled: !!accountId && !!targetId,
    retry: false,
    staleTime: 60_000,
  });
}

const HISTORY_PAGE = 20;

/**
 * Message history of one conversation, newest page first; `fetchNextPage` loads
 * older messages. Polls the newest page while the window is focused, since
 * there is no live connection for incoming messages.
 */
export function useHistory(
  accountId: string | undefined,
  conversation: { id: string; type: number } | null,
  options: { poll?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: historyKey(accountId, conversation?.id),
    queryFn: ({ pageParam }) =>
      api.hx.history(accountId!, conversation!.id, conversation!.type, pageParam, HISTORY_PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.isLast ? undefined : (page.cursor ?? undefined)),
    enabled: !!accountId && !!conversation,
    retry: false,
    staleTime: 10_000,
    // Polling refetches every loaded page, so keep it to the first one.
    refetchInterval: (q) => (options.poll && (q.state.data?.pages.length ?? 0) <= 1 ? 20_000 : false),
    refetchIntervalInBackground: false,
  });
}

/** Sends one message. Refreshes the conversation and the list afterwards. */
export function useSendText(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { to: string; text: string; firstContact: boolean }) =>
      api.hx.sendText(accountId, v.to, v.text, v.firstContact),
    onSettled: (_data, _error, v) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: historyKey(accountId, v.to) }),
        qc.invalidateQueries({ queryKey: conversationsKey(accountId) }),
      ]),
  });
}

export function useAccounts() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: api.accounts.list });
}

function useAccountsMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.accounts }),
        // sid / user ID / device tokens / IM login may have changed: refetch API data too.
        qc.invalidateQueries({ queryKey: queryKeys.lit }),
        qc.invalidateQueries({ queryKey: queryKeys.hx }),
      ]),
  });
}

export const useAddAccount = () => useAccountsMutation((input: NewAccount) => api.accounts.add(input));

export const useUpdateAccount = () =>
  useAccountsMutation(({ id, patch }: { id: string; patch: AccountPatch }) => api.accounts.update(id, patch));

export const useRemoveAccount = () => useAccountsMutation((account: Account) => api.accounts.remove(account.id));

export const useSetHx = () => useAccountsMutation(({ id, input }: { id: string; input: HxInput }) => api.accounts.setHx(id, input));

export const useClearHx = () => useAccountsMutation((id: string) => api.accounts.clearHx(id));

/** An action, not cached data: each run opens a fresh TCP login. */
export const useCheckHxConnection = () => useMutation({ mutationFn: (accountId: string) => api.hx.checkConnection(accountId) });
