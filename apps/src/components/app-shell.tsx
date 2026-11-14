import { Link, Outlet } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  CloudIcon,
  MessagesSquareIcon,
  MoonIcon,
  RadioIcon,
  SettingsIcon,
  SunIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { AccountAvatar } from "@/components/account-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveAccount } from "@/lib/active-account";
import { useAccounts } from "@/lib/queries";

const NAV: {
  to: "/accounts" | "/profile" | "/online" | "/chat" | "/settings";
  label: string;
  icon: LucideIcon;
  /** Only shown once at least one account exists. */
  needsAccount?: boolean;
}[] = [
  { to: "/accounts", label: "Tài khoản", icon: UsersIcon },
  { to: "/profile", label: "Hồ sơ", icon: UserRoundIcon, needsAccount: true },
  { to: "/online", label: "Đang online", icon: RadioIcon, needsAccount: true },
  { to: "/chat", label: "Tin nhắn", icon: MessagesSquareIcon, needsAccount: true },
  { to: "/settings", label: "Cài đặt", icon: SettingsIcon },
];

export function AppShell() {
  const { active } = useActiveAccount();
  const nav = NAV.filter((item) => !item.needsAccount || active);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CloudIcon className="size-4" aria-hidden />
          </div>
          <span className="text-sm font-semibold tracking-tight">Sky Manager</span>
        </div>

        <nav aria-label="Điều hướng chính" className="flex flex-1 flex-col gap-0.5 px-2 py-2">
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors duration-150 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              activeProps={{ className: "bg-sidebar-accent font-medium text-sidebar-accent-foreground" }}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1 border-t p-2">
          <AccountSwitcher />
          <ThemeToggle />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

function AccountSwitcher() {
  const { data: accounts = [] } = useAccounts();
  const { active, setActiveId } = useActiveAccount();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        disabled={accounts.length === 0}
        aria-label="Chọn account đang dùng"
      >
        {active ? (
          <>
            <AccountAvatar label={active.label} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{active.label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {active.userId ? `ID ${active.userId}` : "Chưa có user ID"}
              </span>
            </span>
          </>
        ) : (
          <span className="flex-1 truncate text-sm text-muted-foreground">Chưa có account</span>
        )}
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Account đang dùng</DropdownMenuLabel>
          {accounts.map((a) => (
            <DropdownMenuItem key={a.id} onClick={() => setActiveId(a.id)}>
              <AccountAvatar label={a.label} size="sm" />
              <span className="flex-1 truncate">{a.label}</span>
              {a.id === active?.id && <CheckIcon className="size-4" aria-label="Đang dùng" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/accounts" />}>
          <UsersIcon className="size-4" aria-hidden />
          Quản lý account
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
