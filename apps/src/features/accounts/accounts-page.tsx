import { useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserCheckIcon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Account } from "@/lib/api";
import { useActiveAccount } from "@/lib/active-account";
import { useAccounts, useRecoveredBackup, useRemoveAccount } from "@/lib/queries";
import { AccountFormDialog } from "./account-form-dialog";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short" });

export function AccountsPage() {
  const { data: accounts, isPending, error, refetch } = useAccounts();
  const { data: recoveredBackup } = useRecoveredBackup();
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  const openForm = (a: Account | null) => {
    setEditing(a);
    setFormKey((k) => k + 1); // fresh form state on every open
    setFormOpen(true);
  };
  const openAdd = () => openForm(null);
  const openEdit = (a: Account) => openForm(a);

  return (
    <>
      <PageHeader
        title="Tài khoản"
        description={accounts ? `${accounts.length} account` : undefined}
        actions={
          <Button onClick={openAdd}>
            <PlusIcon aria-hidden />
            Thêm account
          </Button>
        }
      />

      {recoveredBackup && (
        <div role="alert" className="flex gap-2 border-b bg-destructive/10 px-5 py-2.5 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            File danh sách account bị hỏng nên đã được cất sang{" "}
            <code className="font-mono text-xs break-all">{recoveredBackup}</code>. Session vẫn còn trong Keychain.
          </p>
        </div>
      )}

      {error ? (
        <EmptyState
          icon={AlertTriangleIcon}
          title="Không tải được danh sách account"
          description={error.message}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Thử lại
            </Button>
          }
        />
      ) : isPending ? (
        <div className="space-y-2 p-5" aria-busy="true" aria-label="Đang tải">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Chưa có account nào"
          description="Thêm account bằng session (sid) và device UUID lấy từ máy đã đăng nhập."
          action={
            <Button onClick={openAdd}>
              <PlusIcon aria-hidden />
              Thêm account đầu tiên
            </Button>
          }
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <AccountTable accounts={accounts} onEdit={openEdit} onRemove={setRemoving} />
        </ScrollArea>
      )}

      <AccountFormDialog key={formKey} open={formOpen} onOpenChange={setFormOpen} account={editing} />
      <RemoveAccountDialog account={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

function AccountTable({
  accounts,
  onEdit,
  onRemove,
}: {
  accounts: Account[];
  onEdit: (a: Account) => void;
  onRemove: (a: Account) => void;
}) {
  const { active, setActiveId } = useActiveAccount();
  const { statuses, check } = useSessionChecks();

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-background text-left text-xs text-muted-foreground">
        <tr className="border-b">
          <th scope="col" className="px-5 py-2 font-medium">Account</th>
          <th scope="col" className="px-3 py-2 font-medium">User ID</th>
          <th scope="col" className="px-3 py-2 font-medium">Device UUID</th>
          <th scope="col" className="px-3 py-2 font-medium">Version</th>
          <th scope="col" className="px-3 py-2 font-medium">Session</th>
          <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">Thao tác</span></th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => {
          const isActive = a.id === active?.id;
          return (
            <tr key={a.id} className="border-b transition-colors duration-150 hover:bg-muted/40">
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <AccountAvatar label={a.label} />
                  <span className="truncate font-medium">{a.label}</span>
                  {isActive && <Badge variant="secondary">Đang dùng</Badge>}
                </div>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs">
                {a.userId ?? <span className="text-muted-foreground">—</span>}
              </td>
              <td className="max-w-48 px-3 py-2.5">
                <span className="block truncate font-mono text-xs text-muted-foreground" title={a.deviceUuid}>
                  {a.deviceUuid}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs">{a.version}</td>
              <td className="px-3 py-2.5 text-xs">
                <SessionCell savedAt={a.sessionSavedAt} status={statuses[a.id]} />
              </td>
              <td className="px-3 py-2.5 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label={`Thao tác với ${a.label}`} />}
                  >
                    <MoreHorizontalIcon aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem disabled={isActive} onClick={() => setActiveId(a.id)}>
                      <UserCheckIcon aria-hidden />
                      Đặt làm đang dùng
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={statuses[a.id]?.state === "checking" && statuses[a.id]?.savedAt === a.sessionSavedAt}
                      onClick={() => check(a)}
                    >
                      <ShieldCheckIcon aria-hidden />
                      Kiểm tra session
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(a)}>
                      <PencilIcon aria-hidden />
                      Sửa
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => onRemove(a)}>
                      <Trash2Icon aria-hidden />
                      Xoá
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** `savedAt` = the account's sessionSavedAt when checked, so a newer sid hides the old result. */
type SessionStatus = { savedAt: number | null } & (
  | { state: "checking" }
  | { state: "ok"; at: number }
  | { state: "error"; at: number; message: string }
);

/**
 * Checks a session with one cheap signed GET (`account/account_info`). Results
 * live in memory only: they describe "last time you checked", not stored state.
 */
function useSessionChecks() {
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const set = (id: string, s: SessionStatus) => setStatuses((prev) => ({ ...prev, [id]: s }));

  async function check(account: Account) {
    const savedAt = account.sessionSavedAt;
    set(account.id, { state: "checking", savedAt });
    try {
      await api.lit.accountInfo(account.id);
      set(account.id, { state: "ok", at: Date.now(), savedAt });
      toast.success(`Session của ${account.label} còn dùng được`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Không kiểm tra được";
      set(account.id, { state: "error", at: Date.now(), message, savedAt });
      toast.error(`${account.label}: ${message}`);
    }
  }

  return { statuses, check };
}

function SessionCell({ savedAt, status: raw }: { savedAt: number | null; status: SessionStatus | undefined }) {
  const status = raw && raw.savedAt === savedAt ? raw : undefined;
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground tabular-nums">Lưu {savedAt ? dateFmt.format(savedAt) : "—"}</p>
      {status?.state === "checking" && (
        <p className="flex items-center gap-1 text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
          Đang kiểm tra…
        </p>
      )}
      {status?.state === "ok" && (
        <p className="flex items-center gap-1 text-success">
          <CheckCircle2Icon className="size-3" aria-hidden />
          Còn dùng được · {timeFmt.format(status.at)}
        </p>
      )}
      {status?.state === "error" && (
        <p className="flex items-center gap-1 text-destructive" title={status.message}>
          <XCircleIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">Lỗi · {timeFmt.format(status.at)}</span>
          <span className="sr-only">: {status.message}</span>
        </p>
      )}
    </div>
  );
}

function RemoveAccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const remove = useRemoveAccount();

  async function confirm() {
    if (!account) return;
    try {
      await remove.mutateAsync(account);
      toast.success(`Đã xoá ${account.label}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không xoá được account");
    }
  }

  return (
    <AlertDialog open={account !== null} onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá {account?.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Thông tin account và session trong Keychain sẽ bị xoá khỏi máy này. Không hoàn tác được.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Huỷ</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} disabled={remove.isPending}>
            Xoá account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
