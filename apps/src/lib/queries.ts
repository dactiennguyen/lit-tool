import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Account, type AccountPatch, type AppSettings, type NewAccount } from "./api";

export const queryKeys = {
  accounts: ["accounts"] as const,
  settings: ["settings"] as const,
  /** Prefix of every query that calls the Litmatch API. */
  lit: ["lit"] as const,
};

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

export function useAccountInfo(accountId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.lit, "account_info", accountId],
    queryFn: () => api.lit.accountInfo(accountId!),
    enabled: !!accountId,
    retry: false, // don't hammer the server with a bad session
    staleTime: 60_000,
  });
}

export function useUserInfo(accountId: string | undefined, targetId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.lit, "user_info", accountId, targetId],
    queryFn: () => api.lit.userInfo(accountId!, targetId!),
    enabled: !!accountId && !!targetId,
    retry: false,
    staleTime: 60_000,
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
        // sid / user ID / device tokens may have changed: refetch API data too.
        qc.invalidateQueries({ queryKey: queryKeys.lit }),
      ]),
  });
}

export const useAddAccount = () => useAccountsMutation((input: NewAccount) => api.accounts.add(input));

export const useUpdateAccount = () =>
  useAccountsMutation(({ id, patch }: { id: string; patch: AccountPatch }) => api.accounts.update(id, patch));

export const useRemoveAccount = () => useAccountsMutation((account: Account) => api.accounts.remove(account.id));
