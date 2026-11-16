import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboardIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/stores/theme";
import { AccountAvatar } from "@/components/account-avatar";
import { SessionDot, sessionLabel } from "@/components/session-status";
import { TcpIcon } from "@/components/tcp-status";
import { UpdateButton, UpdateGate } from "@/features/update/components/update-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Account } from "@/lib/api";
import { litQueries, useAccounts } from "@/lib/queries";
import { useSession } from "@/stores/sessions";
import { useTcpStatus } from "@/stores/tcp-status";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { CloseRequestHandler } from "@/features/window/components/close-dialog";

const NAV: { to: "/overview" | "/accounts" | "/outreach"; label: string; icon: LucideIcon }[] = [
  { to: "/overview", label: "Tổng quan", icon: LayoutDashboardIcon },
  { to: "/accounts", label: "Quản lý account", icon: UsersIcon },
  { to: "/outreach", label: "Lấy & gửi", icon: SendIcon },
];

const itemClass =
  "flex items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50";
const activeClass = "bg-sidebar-accent font-medium text-sidebar-accent-foreground";

export function AppShell() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-150",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-2", collapsed ? "justify-center px-2" : "px-4")}>
          {!collapsed && <img src="/lit-tool-icon.png" alt="" className="size-7 shrink-0 rounded-lg" />}
          {!collapsed && <span className="flex-1 truncate text-sm font-semibold tracking-tight">Sky Manager</span>}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            title={collapsed ? "Mở rộng thanh bên" : "Thu nhỏ thanh bên"}
            aria-label={collapsed ? "Mở rộng thanh bên" : "Thu nhỏ thanh bên"}
            aria-pressed={collapsed}
          >
            {collapsed ? <PanelLeftOpenIcon aria-hidden /> : <PanelLeftCloseIcon aria-hidden />}
          </Button>
        </div>

        <nav aria-label="Điều hướng chính" className="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={cn(itemClass, "h-9", collapsed && "justify-center px-0")}
              activeProps={{ className: activeClass }}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && label}
            </Link>
          ))}
        </nav>

        <AccountList collapsed={collapsed} />

        <div className="shrink-0 border-t">
          <UpdateButton collapsed={collapsed} />
          <div className={cn("flex items-center gap-1 p-2", collapsed ? "flex-col" : "")}>
            <Link
              to="/settings"
              title={collapsed ? "Cài đặt" : undefined}
              className={cn(itemClass, "h-9", collapsed ? "w-full justify-center px-0" : "flex-1")}
              activeProps={{ className: activeClass }}
            >
              <SettingsIcon className="size-4 shrink-0" aria-hidden />
              {!collapsed && "Cài đặt"}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      <UpdateGate />
      <CloseRequestHandler />
    </div>
  );
}

/** Every account, vertically; the open one is highlighted. Icons only when collapsed. */
function AccountList({ collapsed }: { collapsed: boolean }) {
  const { data: accounts, isPending } = useAccounts();
  const { accountId } = useParams({ strict: false });

  return (
    <section aria-labelledby="account-list-title" className="flex min-h-0 flex-1 flex-col border-t">
      <div className={cn("flex h-9 shrink-0 items-center", collapsed ? "justify-center px-1" : "justify-between pr-2 pl-4")}>
        <h2 id="account-list-title" className={cn("text-xs font-medium text-muted-foreground", collapsed && "sr-only")}>
          Account{accounts ? ` (${accounts.length})` : ""}
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/accounts" />} aria-label="Thêm account" />}
          >
            <PlusIcon aria-hidden />
          </TooltipTrigger>
          <TooltipContent>Thêm account</TooltipContent>
        </Tooltip>
      </div>
      {isPending ? (
        <div className="space-y-1 px-2" aria-busy="true" aria-label="Đang tải account">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className={cn("h-11", collapsed ? "mx-auto w-10" : "w-full")} />
          ))}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {accounts?.map((a) => (
            <li key={a.id}>
              <AccountItem account={a} active={a.id === accountId} collapsed={collapsed} />
            </li>
          ))}
          {accounts?.length === 0 && !collapsed && (
            <li className="px-2 py-3 text-xs text-muted-foreground">
              Chưa có account.{" "}
              <Link to="/accounts" className="text-primary underline-offset-2 hover:underline">
                Thêm account
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function AccountItem({ account, active, collapsed }: { account: Account; active: boolean; collapsed: boolean }) {
  const session = useSession(account);
  const tcp = useTcpStatus(account.id);
  // Nickname from the login request, cache only.
  const me = useQuery({ ...litQueries.userInfoMe(account.id), enabled: false });
  const subtitle = session.state === "in" ? (me.data?.nickname ?? sessionLabel(session)) : sessionLabel(session);

  return (
    <Link
      to="/account/$accountId"
      params={{ accountId: account.id }}
      title={collapsed ? `${account.label} · ${subtitle}` : undefined}
      className={cn(itemClass, "h-11", collapsed ? "justify-center px-0" : "", active && activeClass)}
      aria-current={active ? "page" : undefined}
    >
      <span className="relative shrink-0">
        <AccountAvatar label={account.label} size="sm" />
        <SessionDot session={session} className="absolute -right-0.5 -bottom-0.5" />
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-foreground">{account.label}</span>
            <span
              className={cn(
                "block truncate text-[11px]",
                session.state === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {subtitle}
            </span>
          </span>
          {session.state === "in" && <TcpIcon status={tcp} />}
        </>
      )}
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" aria-label={label} onClick={() => setTheme(isDark ? "light" : "dark")} />}
      >
        {isDark ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
