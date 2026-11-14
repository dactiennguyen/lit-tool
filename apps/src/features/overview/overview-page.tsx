import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  Loader2Icon,
  MessagesSquareIcon,
  PlayIcon,
  UserCheckIcon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/api";
import { useActiveAccount } from "@/lib/active-account";
import { litQueries, useAccounts } from "@/lib/queries";
import { summarize, type AccountSummary } from "./overview-view";

const numberFmt = new Intl.NumberFormat("vi-VN");
const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short" });

/** Read the cache only: nothing is fetched until "Kiểm tra tất cả" is pressed. */
const cached = <T,>(q: T) => ({ ...q, enabled: false });

export function OverviewPage() {
  const { data: accounts, isPending } = useAccounts();
  const list = accounts ?? [];
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const me = useQueries({ queries: list.map((a) => cached(litQueries.userInfoMe(a.id))) });
  const wallets = useQueries({ queries: list.map((a) => cached(litQueries.accountInfo(a.id))) });
  const convs = useQueries({ queries: list.map((a) => cached(litQueries.conversations(a.id))) });

  /**
   * One account at a time, so a batch of accounts never hits the server in a
   * burst. Errors are stored per query and shown in the table.
   */
  async function checkAll() {
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    const run = async (request: Promise<unknown>) => {
      try {
        await request;
      } catch {
        failed++;
      }
    };
    for (const [i, a] of list.entries()) {
      // staleTime 0: always ask the server, even when the cache is fresh.
      await run(qc.fetchQuery({ ...litQueries.userInfoMe(a.id), staleTime: 0 }));
      await run(qc.fetchQuery({ ...litQueries.accountInfo(a.id), staleTime: 0 }));
      await run(qc.fetchQuery({ ...litQueries.conversations(a.id), staleTime: 0 }));
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (failed) toast.error(`${failed} request lỗi, xem chi tiết trong bảng`);
    else toast.success(`Đã kiểm tra ${list.length} account`);
  }

  const rows = list.map((a, i) => ({
    account: a,
    summary: summarize(me[i]!, wallets[i]!, convs[i]!),
  }));
  const ok = rows.filter((r) => r.summary.session.state === "ok").length;
  const checked = rows.filter((r) => r.summary.session.state !== "unknown").length;

  return (
    <>
      <PageHeader
        title="Tổng quan"
        description={accounts ? `${list.length} account${checked ? ` · ${ok}/${checked} session dùng được` : ""}` : undefined}
        actions={
          <Button onClick={checkAll} disabled={list.length === 0 || progress !== null}>
            {progress ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlayIcon aria-hidden />}
            {progress ? `Đang kiểm tra ${progress.done}/${progress.total}` : "Kiểm tra tất cả"}
          </Button>
        }
      />
      {isPending ? (
        <div className="space-y-2 p-5" aria-busy="true" aria-label="Đang tải">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Chưa có account nào"
          action={<Button render={<Link to="/accounts" />}>Thêm account</Button>}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-5 pt-3 text-xs text-muted-foreground">
            Mỗi account gọi 3 request (hồ sơ, ví, hội thoại), lần lượt từng account.
          </p>
          <OverviewTable rows={rows} />
        </div>
      )}
    </>
  );
}

function OverviewTable({ rows }: { rows: { account: Account; summary: AccountSummary }[] }) {
  const { active, setActiveId } = useActiveAccount();
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-background text-left text-xs text-muted-foreground">
        <tr className="border-b">
          <th scope="col" className="px-5 py-2 font-medium">Account</th>
          <th scope="col" className="px-3 py-2 font-medium">Session</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">Kim cương</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">Hội thoại</th>
          <th scope="col" className="px-3 py-2 font-medium">Chat</th>
          <th scope="col" className="px-3 py-2"><span className="sr-only">Thao tác</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ account: a, summary: s }) => {
          const isActive = a.id === active?.id;
          return (
            <tr key={a.id} className="border-b transition-colors duration-150 hover:bg-muted/40">
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <AccountAvatar label={a.label} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {a.label}
                      {isActive && <Badge variant="secondary">Đang dùng</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{s.nickname ?? (a.userId ? `ID ${a.userId}` : "—")}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 text-xs">
                <SessionBadge session={s.session} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                <Metric value={s.diamonds} error={s.walletError} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                <Metric value={s.conversations} error={s.conversationsError} />
              </td>
              <td className="px-3 py-2.5 text-xs">
                {a.hx ? (
                  <span className="font-mono">{a.hx.username}</span>
                ) : (
                  <span className="text-muted-foreground">Chưa cấu hình</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={isActive}
                    onClick={() => setActiveId(a.id)}
                    aria-label={`Dùng ${a.label}`}
                    title="Đặt làm đang dùng"
                  >
                    <UserCheckIcon aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    render={<Link to="/chat" onClick={() => setActiveId(a.id)} />}
                    aria-label={`Mở tin nhắn của ${a.label}`}
                    title="Mở tin nhắn"
                  >
                    <MessagesSquareIcon aria-hidden />
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SessionBadge({ session }: { session: AccountSummary["session"] }) {
  switch (session.state) {
    case "unknown":
      return <span className="text-muted-foreground">Chưa kiểm tra</span>;
    case "loading":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
          Đang kiểm tra…
        </span>
      );
    case "ok":
      return (
        <span className="flex items-center gap-1 text-success">
          <CheckCircle2Icon className="size-3" aria-hidden />
          Dùng được · {timeFmt.format(session.at)}
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-destructive" title={session.message}>
          <XCircleIcon className="size-3 shrink-0" aria-hidden />
          <span className="max-w-56 truncate">{session.message}</span>
        </span>
      );
  }
}

function Metric({ value, error }: { value: number | null; error: string | null }) {
  if (error) {
    return (
      <span className="text-xs text-destructive" title={error}>
        Lỗi
      </span>
    );
  }
  return value === null ? <span className="text-muted-foreground">—</span> : <>{numberFmt.format(value)}</>;
}
