import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  DownloadIcon,
  LogInIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  Trash2Icon,
  UploadIcon,
  UsersIcon,
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
import { SessionText } from "@/components/session-status";
import type { Account } from "@/lib/api";
import { useLogin, useSessions } from "@/stores/sessions";
import { useAccounts, useRecoveredBackup, useRemoveAccount } from "@/lib/queries";
import { AccountFormDialog } from "./account-form-dialog";
import { ExportDialog, ImportDialog } from "./transfer-dialogs";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export function AccountsPage() {
  const { data: accounts, isPending, error, refetch } = useAccounts();
  const { data: recoveredBackup } = useRecoveredBackup();
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);
  // `key` changes on each open, so a dialog starts empty (no password kept from last time).
  const [transfer, setTransfer] = useState({ kind: "import" as "import" | "export", key: 0, open: false });
  const openTransfer = (kind: "import" | "export") => setTransfer((t) => ({ kind, key: t.key + 1, open: true }));
  const setTransferOpen = (open: boolean) => setTransfer((t) => ({ ...t, open }));

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
        title="Quản lý account"
        description={accounts ? `${accounts.length} account` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => openTransfer("import")}>
              <UploadIcon aria-hidden />
              Import
            </Button>
            <Button variant="outline" disabled={!accounts?.length} onClick={() => openTransfer("export")}>
              <DownloadIcon aria-hidden />
              Export
            </Button>
            <Button onClick={openAdd}>
              <PlusIcon aria-hidden />
              Thêm account
            </Button>
          </div>
        }
      />

      {recoveredBackup && (
        <div role="alert" className="flex gap-2 border-b bg-destructive/10 px-5 py-2.5 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Cơ sở dữ liệu của app bị hỏng nên đã được cất sang{" "}
            <code className="font-mono text-xs break-all">{recoveredBackup}</code> và tạo mới. Cần thêm lại account.
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
          description="Thêm account bằng session (sid). Bạn có thể nhập hoặc tạo thông tin thiết bị trong form."
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

      <AccountFormDialog key={formKey} open={formOpen} onOpenChange={setFormOpen}
        account={editing ? accounts?.find((a) => a.id === editing.id) ?? editing : null} />
      <RemoveAccountDialog account={removing} onClose={() => setRemoving(null)} />
      {transfer.kind === "import" ? (
        <ImportDialog key={transfer.key} open={transfer.open} onOpenChange={setTransferOpen} />
      ) : (
        <ExportDialog key={transfer.key} open={transfer.open} onOpenChange={setTransferOpen} />
      )}
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
  const sessionOf = useSessions();
  const { login, logout } = useLogin();
  const navigate = useNavigate();

  async function doLogin(a: Account) {
    if (await login(a)) toast.success(`Đã đăng nhập ${a.label}`);
    else toast.error(`${a.label}: không đăng nhập được`);
  }

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
          const session = sessionOf(a);
          return (
            <tr key={a.id} className="border-b transition-colors duration-150 hover:bg-muted/40">
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <AccountAvatar label={a.label} />
                  <span className="truncate font-medium">{a.label}</span>
                  {a.proxy?.enabled && (
                    <Badge variant="outline" className="text-success" title={`Kết nối qua proxy ${a.proxy.label}`}>
                      <ShieldIcon aria-hidden />
                      Proxy
                    </Badge>
                  )}
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
                <div className="space-y-0.5">
                  <p className="text-muted-foreground tabular-nums">
                    Lưu sid {a.sessionSavedAt ? dateFmt.format(a.sessionSavedAt) : "—"}
                  </p>
                  <SessionText session={session} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label={`Thao tác với ${a.label}`} />}
                  >
                    <MoreHorizontalIcon aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() => void navigate({ to: "/account/$accountId", params: { accountId: a.id } })}
                    >
                      <ArrowRightIcon aria-hidden />
                      Mở
                    </DropdownMenuItem>
                    {session.state === "in" ? (
                      <DropdownMenuItem onClick={() => logout(a.id)}>
                        <LogOutIcon aria-hidden />
                        Đăng xuất
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled={session.state === "loading"} onClick={() => void doLogin(a)}>
                        <LogInIcon aria-hidden />
                        Đăng nhập
                      </DropdownMenuItem>
                    )}
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
            Thông tin account, session và mật khẩu chat sẽ bị xoá khỏi máy này. Không hoàn tác được.
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
