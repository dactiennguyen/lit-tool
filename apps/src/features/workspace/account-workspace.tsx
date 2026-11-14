import { createContext, useContext, useState } from "react";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon, Loader2Icon, LogInIcon, LogOutIcon, PlugZapIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { SessionText } from "@/components/session-status";
import { TcpText } from "@/components/tcp-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { ChatTab } from "@/features/chat/chat-tab";
import { DiscoverTab } from "@/features/online/discover-tab";
import { ProfileTab } from "@/features/profile/profile-tab";
import type { Account } from "@/lib/api";
import { litQueries, useAccounts, useCheckHxConnection } from "@/lib/queries";
import { useLogin, useSession, type SessionState } from "@/lib/sessions";
import { useTcpStatus, type TcpStatus } from "@/lib/tcp-status";

const AccountContext = createContext<Account | null>(null);

function useWorkspaceAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) throw new Error("tab rendered outside an account workspace");
  return account;
}

// Tab route components: `key` resets all tab state when switching accounts.
export function ChatRoute() {
  const account = useWorkspaceAccount();
  return <ChatTab key={account.id} account={account} />;
}

export function DiscoverRoute() {
  const account = useWorkspaceAccount();
  return <DiscoverTab key={account.id} account={account} />;
}

export function ProfileRoute() {
  const account = useWorkspaceAccount();
  return <ProfileTab key={account.id} account={account} />;
}

const TABS = [
  { to: "/account/$accountId/chat", label: "Tin nhắn" },
  { to: "/account/$accountId/discover", label: "Người mới" },
  { to: "/account/$accountId/profile", label: "Hồ sơ" },
] as const;

/** `/account/$accountId`: header, tabs, and the tab content once logged in. */
export function AccountWorkspace() {
  const { accountId } = useParams({ from: "/account/$accountId" });
  const { data: accounts, isPending } = useAccounts();
  const account = accounts?.find((a) => a.id === accountId);

  if (isPending) {
    return (
      <div className="space-y-3 p-5" aria-busy="true" aria-label="Đang tải">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!account) {
    return (
      <EmptyState
        icon={UserXIcon}
        title="Không tìm thấy account"
        description="Account có thể đã bị xoá."
        action={<Button render={<Link to="/accounts" />}>Quản lý account</Button>}
      />
    );
  }
  return <Workspace key={account.id} account={account} />;
}

function Workspace({ account }: { account: Account }) {
  const session = useSession(account);
  const { login, logout } = useLogin();
  // Filled by the login request; read from the cache only.
  const me = useQuery({ ...litQueries.userInfoMe(account.id), enabled: false });
  const loggedIn = session.state === "in";
  const tcp = useTcpStatus(account.id);

  return (
    <AccountContext.Provider value={account}>
      <header className="shrink-0 border-b">
        <div className="flex h-14 items-center gap-3 px-5">
          <AccountAvatar label={account.label} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">
              {account.label}
              {loggedIn && me.data?.nickname && (
                <span className="font-normal text-muted-foreground"> · {me.data.nickname}</span>
              )}
            </h1>
            <div className="flex min-w-0 items-center gap-3 text-xs">
              <SessionText session={session} />
              {loggedIn && <TcpText status={tcp} />}
              {loggedIn && <ConnectTcpButton account={account} status={tcp} />}
            </div>
          </div>
          {loggedIn && (
            <Button variant="ghost" size="sm" onClick={() => logout(account.id)}>
              <LogOutIcon aria-hidden />
              Đăng xuất
            </Button>
          )}
        </div>
        <nav aria-label="Mục của account" className="flex gap-1 px-4">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              params={{ accountId: account.id }}
              className="relative px-3 pt-1 pb-2.5 text-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:text-foreground"
              activeProps={{
                className: "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
              }}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {loggedIn ? (
        <Outlet />
      ) : (
        <LoginPanel account={account} session={session} onLogin={() => login(account)} />
      )}
    </AccountContext.Provider>
  );
}

/**
 * One TCP login + followup, then disconnect (see `hx_check_connection`). Says
 * what is missing instead when chat is not set up yet.
 */
function ConnectTcpButton({ account, status }: { account: Account; status: TcpStatus }) {
  const connecting = status.state === "connecting";
  const check = useCheckHxConnection();
  const missing = !account.im ? "Hồ sơ chưa có thông tin chat: đăng xuất rồi đăng nhập lại" : null;

  return (
    <Button
      variant="outline"
      size="xs"
      disabled={!!missing || connecting || check.isPending}
      title={missing ?? "Đăng nhập TCP rồi ngắt ngay, không gửi tin. Có thể làm app điện thoại bị đăng xuất."}
      onClick={() =>
        check.mutate(account.id, {
          onSuccess: () => toast.success(`${account.label}: kết nối TCP thành công`),
          onError: (e) => toast.error(`${account.label}: ${e.message}`),
        })
      }
    >
      {connecting || check.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlugZapIcon aria-hidden />}
      {missing ? "Chưa có thông tin chat" : status.state === "idle" ? "Kết nối" : "Kết nối lại"}
    </Button>
  );
}

function LoginPanel({
  account,
  session,
  onLogin,
}: {
  account: Account;
  session: SessionState;
  onLogin: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const loading = session.state === "loading";
  const error = session.state === "error" ? session : null;

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <LogInIcon className="size-5" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Đăng nhập {account.label}</p>
          <p className="text-sm text-muted-foreground">
            Kiểm tra session đã lưu với server. Chưa đăng nhập thì app không gửi request nào cho account này.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-left text-sm">
            <p className="font-medium text-destructive">
              {error.expired ? "Session đã hết hạn" : "Không đăng nhập được"}
            </p>
            <p className="mt-0.5 text-xs break-words text-destructive/90">
              {error.expired
                ? "Server yêu cầu đăng nhập lại. Lấy sid mới (cùng device UUID) từ máy đang đăng nhập rồi cập nhật cho account."
                : error.message}
            </p>
          </div>
        )}

        <div className="flex justify-center gap-2">
          {error?.expired && (
            <Button
              variant="outline"
              onClick={() => {
                setEditKey((k) => k + 1);
                setEditOpen(true);
              }}
            >
              <KeyRoundIcon aria-hidden />
              Cập nhật sid
            </Button>
          )}
          <Button onClick={onLogin} disabled={loading}>
            {loading ? <Loader2Icon className="animate-spin" aria-hidden /> : <LogInIcon aria-hidden />}
            {error ? "Thử lại" : "Đăng nhập"}
          </Button>
        </div>
      </div>
      <AccountFormDialog key={editKey} open={editOpen} onOpenChange={setEditOpen} account={account} />
    </div>
  );
}

