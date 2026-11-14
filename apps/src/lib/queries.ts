import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Account, type AccountPatch, type AppSettings, type NewAccount } from "./api";

export const queryKeys = {
  accounts: ["accounts"] as const,
  settings: ["settings"] as const,
};

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.settings.update(patch),
    onSuccess: (settings) => qc.setQueryData(queryKeys.settings, settings),
  });
}

/** Path of a corrupt accounts.json that was moved aside at startup, if any. */
export function useRecoveredBackup() {
  return useQuery({ queryKey: ["accounts", "recovered"], queryFn: api.accounts.recoveredBackup, staleTime: Infinity });
}

export function useAccounts() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: api.accounts.list });
}

function useAccountsMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export const useAddAccount = () => useAccountsMutation((input: NewAccount) => api.accounts.add(input));

export const useUpdateAccount = () =>
  useAccountsMutation(({ id, patch }: { id: string; patch: AccountPatch }) => api.accounts.update(id, patch));

export const useRemoveAccount = () => useAccountsMutation((account: Account) => api.accounts.remove(account.id));
