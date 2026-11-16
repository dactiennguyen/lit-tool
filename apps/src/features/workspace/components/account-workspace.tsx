import { createContext, useContext, useState } from "react";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon, Loader2Icon, LogInIcon, LogOutIcon, ScrollTextIcon, UserXIcon } from "lucide-react";
import { AccountAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { SessionText } from "@/components/session-status";
import { ConnectTcpButton } from "@/components/connect-tcp-button";
import { TcpText } from "@/components/tcp-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountFormDialog } from "@/features/accounts/components/account-form-dialog";
import { ChatTab } from "@/features/chat/components/chat-tab";
import { DiscoverTab } from "@/features/online/components/discover-tab";
import { FeedTab } from "@/features/feed/components/feed-tab";
import { ProfileTab } from "@/features/profile/components/profile-tab";
import { LogDialog } from "./log-dialog";
import type { Account } from "@/lib/api";
import { litQueries, useAccounts } from "@/lib/queries";
import { useLogin, useSession, type SessionState } from "@/stores/sessions";
import { useTcpStatus } from "@/stores/tcp-status";

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

export function FeedRoute() {
  const account = useWorkspaceAccount();
  return <FeedTab key={account.id} account={account} />;
}

export function ProfileRoute() {
  const account = useWorkspaceAccount();
  return <ProfileTab key={account.id} account={account} />;
}

const TABS = [
  { to: "/account/$accountId/chat", label: "Tin nhắn" },
  { to: "/account/$accountId/discover", label: "Người mới" },
  { to: "/account/$accountId/feed", label: "Bảng tin" },
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
        action={<Button nativeButton={false} render={<Link to="/accounts" />}>Quản lý account</Button>}
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
  const [logOpen, setLogOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  return (
    <AccountContext.Provider value={account}>
      <header className="shrink-0 border-b">
        <div className="flex h-14 items-center gap-3 px-5">
          <AccountAvatar label={account.label} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">
              {account.label}
              {loggedIn && me.data?.nickname && (
                <span className="font-normal text-muted-foreground"> · {me.data.nickname}</span>
              )}
            </h1>
            <div className="flex min-w-0 items-center gap-3 text-xs">
              <SessionText session={session} />
              {loggedIn && <TcpText status={tcp} />}
            </div>
          </div>
          {loggedIn && (
            <div className="flex items-center gap-1.5">
              <ConnectTcpButton account={account} status={tcp} size="sm" />
              <Button variant="ghost" size="sm" title="Log TCP và HTTP của account" onClick={() => setLogOpen(true)}>
                <ScrollTextIcon aria-hidden />
                Log
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmLogout(true)}>
                <LogOutIcon aria-hidden />
                Đăng xuất
              </Button>
            </div>
          )}
          <LogDialog account={account} open={logOpen} onOpenChange={setLogOpen} />
          <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Đăng xuất {account.label}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Kết nối chat sẽ đóng và dữ liệu đã tải của account trong app bị xoá. Session vẫn được lưu, bấm Đăng nhập
                  là dùng tiếp.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Huỷ</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmLogout(false);
                    logout(account.id);
                  }}
                >
                  Đăng xuất
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
              {error.expired ? "Session không được chấp nhận" : "Không đăng nhập được"}
            </p>
            <p className="mt-0.5 text-xs break-words text-destructive/90">
              {error.expired
                ? "Server trả result=-10 và yêu cầu đăng nhập lại. Kiểm tra sid cùng UUID của phiên gốc; nếu vừa bật hoặc xoay Thiết bị, hãy tắt và kiểm tra lại UUID. Mã này chưa xác định được nguyên nhân."
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
              Cập nhật sid / UUID
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

