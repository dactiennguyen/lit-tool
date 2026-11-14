import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Account } from "./api";
import { useAccounts } from "./queries";

const STORAGE_KEY = "sky.activeAccountId";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface ActiveAccountValue {
  active: Account | null;
  setActiveId: (id: string | null) => void;
}

const ActiveAccountContext = createContext<ActiveAccountValue | null>(null);

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const { data: accounts } = useAccounts();
  const [storedId, setStoredId] = useState<string | null>(readStored);

  const setActiveId = useCallback((id: string | null) => {
    setStoredId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: keep in memory only */
    }
  }, []);

  // Fall back to the first account when the stored one was removed.
  const active = useMemo(
    () => accounts?.find((a) => a.id === storedId) ?? accounts?.[0] ?? null,
    [accounts, storedId],
  );

  const value = useMemo(() => ({ active, setActiveId }), [active, setActiveId]);
  return <ActiveAccountContext.Provider value={value}>{children}</ActiveAccountContext.Provider>;
}

export function useActiveAccount(): ActiveAccountValue {
  const ctx = useContext(ActiveAccountContext);
  if (!ctx) throw new Error("useActiveAccount must be used inside ActiveAccountProvider");
  return ctx;
}
