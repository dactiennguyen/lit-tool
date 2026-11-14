import type { ReactNode } from "react";

/** Thin bar under the account tabs: an optional label on the left, actions on the right. */
export function TabToolbar({ label, children }: { label?: string; children?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-5">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
