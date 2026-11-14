import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import type { Account } from "@/lib/api";
import { useActiveAccount } from "@/lib/active-account";
import { useAccounts } from "@/lib/queries";

/**
 * Renders children only when an account is selected. With no accounts the
 * page isn't in the nav at all, so send the user to the Accounts page.
 */
export function RequireAccount({ children }: { children: (account: Account) => ReactNode }) {
  const { isPending } = useAccounts();
  const { active } = useActiveAccount();
  if (isPending) return null;
  if (!active) return <Navigate to="/accounts" replace />;
  return <>{children(active)}</>;
}
