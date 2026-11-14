import { queryOptions, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage, Conversation } from "./lit-types";
import { rememberPeers, rememberSender } from "./peer-directory";
import { compareIds } from "./read-markers";
import { connectTcp, isTcpError, setTcpStatus } from "./tcp-status";
import { api, type Account, type AccountPatch, type AppSettings, type NewAccount, type SettingsPatch } from "./api";

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
export const latestKey = (accountId: string | undefined, conversationId: string) =>
  [...queryKeys.hx, "latest", accountId, conversationId] as const;

/** Newest message of a page (by time, then id), whatever order the server used. */
export function newestMessage(messages: readonly ChatMessage[]): ChatMessage | null {
  let best: ChatMessage | null = null;
  for (const m of messages) {
    const d = best ? (m.timestamp ?? 0) - (best.timestamp ?? 0) || compareIds(m.id, best.id) : 1;
    if (d > 0) best = m;
  }
  return best;
}

export const settingsQuery = queryOptions({ queryKey: queryKeys.settings, queryFn: api.settings.get });

export const useSettings = () => useQuery(settingsQuery);

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.settings.update(patch),
    onSuccess: (settings, patch) => {
      qc.setQueryData(queryKeys.settings, settings);
      // Data from the old server must not be shown as fresh.
      return Promise.all([
        patch.apiBaseUrl !== undefined && qc.resetQueries({ queryKey: queryKeys.lit }),
        Object.keys(patch).some((k) => k.startsWith("im")) && qc.resetQueries({ queryKey: queryKeys.hx }),
      ]);
    },
  });
}

export function useRefreshImServers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.settings.refreshImServers(),
    onSuccess: (settings: AppSettings) => {
      qc.setQueryData(queryKeys.settings, settings);
      return qc.resetQueries({ queryKey: queryKeys.hx });
    },
  });
}

/** Path of an unreadable sky.db that was moved aside at startup, if any. */
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
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: historyKey(accountId, conversation?.id),
    queryFn: async ({ pageParam }) => {
      const page = await api.hx.history(accountId!, conversation!.id, conversation!.type, pageParam, HISTORY_PAGE);
      if (conversation!.type === 0) rememberSender(conversation!.id, page.messages);
      // The newest page also tells the conversation list what the last message is.
      if (pageParam === null) qc.setQueryData(latestKey(accountId, conversation!.id), newestMessage(page.messages));
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.isLast ? undefined : (page.cursor ?? undefined)),
    enabled: !!accountId && !!conversation,
    retry: false,
    staleTime: 10_000,
    // Polling refetches every loaded page, so keep it to the first one.
    // Not after an error either, so a broken login is not retried every 20 s.
    refetchInterval: (q) =>
      options.poll && q.state.status !== "error" && (q.state.data?.pages.length ?? 0) <= 1 ? 20_000 : false,
    refetchIntervalInBackground: false,
  });
}

/** Previews are fetched for at most this many conversations (one request each). */
export const PREVIEW_LIMIT = 30;
/** A few messages, not one: the newest entry may be a non-chat record, which is filtered out. */
const PREVIEW_PAGE = 5;
const LIST_POLL_MS = 60_000;

/**
 * Last message of each conversation (`null` when there is none), for previews
 * and unread dots. One small `messageroaming` request per conversation,
 * refreshed every minute while the window is focused.
 */
export function useLatestMessages(accountId: string | undefined, conversations: readonly Conversation[], enabled: boolean) {
  const list = conversations
    .filter((c) => c.conversationType === 0 || c.conversationType === 1)
    .slice(0, PREVIEW_LIMIT);
  return useQueries({
    queries: list.map((c) => ({
      queryKey: latestKey(accountId, c.conversationId),
      queryFn: async () => {
        const { messages } = await api.hx.history(accountId!, c.conversationId, c.conversationType, null, PREVIEW_PAGE);
        if (c.conversationType === 0) rememberSender(c.conversationId, messages);
        return newestMessage(messages);
      },
      enabled: enabled && !!accountId,
      retry: false,
      staleTime: 30_000,
      // Stop polling after an error (e.g. bad IM credentials); "Tải lại" or a new mount retries.
      refetchInterval: (q: { state: { status: string } }) => (q.state.status === "error" ? false : LIST_POLL_MS),
      refetchIntervalInBackground: false,
    })),
    combine: (results) => {
      const byId = new Map<string, { message: ChatMessage | null | undefined; error: Error | null }>();
      list.forEach((c, i) => byId.set(c.conversationId, { message: results[i]!.data, error: results[i]!.error }));
      return byId;
    },
  });
}

/** Sends one message. Refreshes the conversation and the list afterwards. */
export function useSendText(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { to: string; text: string; firstContact: boolean }) =>
      api.hx.sendText(accountId, v.to, v.text, v.firstContact),
    // A send logs in over TCP too: its outcome updates the connection status.
    onSuccess: () => setTcpStatus(accountId, { state: "ok", at: Date.now(), via: "send" }),
    onError: (error) => {
      if (isTcpError(error.message)) setTcpStatus(accountId, { state: "error", at: Date.now(), message: error.message });
    },
    onSettled: (_data, _error, v) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: historyKey(accountId, v.to) }),
        qc.invalidateQueries({ queryKey: latestKey(accountId, v.to) }),
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

/** An action, not cached data: each run opens a fresh TCP login. The result is kept in tcp-status. */
export const useCheckHxConnection = () => useMutation({ mutationFn: connectTcp });

/** Reachability of every saved chat server, checked fresh each time it is shown. */
export function useServerProbe(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: [...queryKeys.hx, "probe"],
    queryFn: async () => {
      const report = await api.hx.probeServers();
      // The list may have just been fetched and saved: show it in Cài đặt too.
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
      return report;
    },
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}
