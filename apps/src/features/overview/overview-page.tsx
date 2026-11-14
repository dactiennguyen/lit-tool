import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, Loader2Icon, LogInIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/api";
import { SessionText } from "@/components/session-status";
import { TcpText } from "@/components/tcp-status";
import { litQueries, useAccounts } from "@/lib/queries";
import { login, useSessions } from "@/lib/sessions";
import { useTcpStatus } from "@/lib/tcp-status";
import { summarize, type AccountSummary } from "./overview-view";

const numberFmt = new Intl.NumberFormat("vi-VN");

/** Read the cache only: nothing is fetched until an account is logged in. */
const cached = <T,>(q: T) => ({ ...q, enabled: false });

export function OverviewPage() {
  const { data: accounts, isPending } = useAccounts();
  const list = accounts ?? [];
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const me = useQueries({ queries: list.map((a) => cached(litQueries.userInfoMe(a.id))) });
  const wallets = useQueries({ queries: list.map((a) => cached(litQueries.accountInfo(a.id))) });
  const convs = useQueries({ queries: list.map((a) => cached(litQueries.conversations(a.id))) });

  const sessionOf = useSessions();

  /**
   * Logs in every account that is not logged in yet, one at a time so a batch
   * never hits the server in a burst, then loads wallet and conversations.
   */
  async function loginAll() {
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    const run = async (request: Promise<unknown>) => {
      try {
        await request;
      } catch {
        /* stored per query, shown in the table */
      }
    };
    for (const [i, a] of list.entries()) {
      const ok = sessionOf(a).state === "in" || (await login(qc, a));
      if (ok) {
        await run(qc.fetchQuery({ ...litQueries.accountInfo(a.id), staleTime: 0 }));
        await run(qc.fetchQuery({ ...litQueries.conversations(a.id), staleTime: 0 }));
      } else {
        failed++;
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (failed) toast.error(`${failed} account không đăng nhập được, xem chi tiết trong bảng`);
    else toast.success(`Đã đăng nhập ${list.length} account`);
  }

  const rows = list.map((a, i) => ({
    account: a,
    summary: summarize(me[i]!, wallets[i]!, convs[i]!),
  }));
  const loggedIn = list.filter((a) => sessionOf(a).state === "in").length;

  return (
    <>
      <PageHeader
        title="Tổng quan"
        description={accounts ? `${list.length} account · ${loggedIn} đã đăng nhập` : undefined}
        actions={
          <Button onClick={loginAll} disabled={list.length === 0 || progress !== null}>
            {progress ? <Loader2Icon className="animate-spin" aria-hidden /> : <LogInIcon aria-hidden />}
            {progress ? `Đang đăng nhập ${progress.done}/${progress.total}` : "Đăng nhập tất cả"}
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
            Đăng nhập kiểm tra session, rồi tải ví và hội thoại; lần lượt từng account.
          </p>
          <OverviewTable rows={rows} />
        </div>
      )}
    </>
  );
}

function OverviewTable({ rows }: { rows: { account: Account; summary: AccountSummary }[] }) {
  const sessionOf = useSessions();
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
          return (
            <tr key={a.id} className="border-b transition-colors duration-150 hover:bg-muted/40">
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <AccountAvatar label={a.label} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.nickname ?? (a.userId ? `ID ${a.userId}` : "—")}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 text-xs">
                <SessionText session={sessionOf(a)} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                <Metric value={s.diamonds} error={s.walletError} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                <Metric value={s.conversations} error={s.conversationsError} />
              </td>
              <td className="px-3 py-2.5 text-xs">
                {a.im ? (
                  <div className="space-y-0.5">
                    <p className="font-mono">{a.im.username}</p>
                    <AccountTcp accountId={a.id} />
                  </div>
                ) : (
                  <span className="text-muted-foreground">Chưa có (lấy khi đăng nhập)</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<Link to="/account/$accountId" params={{ accountId: a.id }} />}
                    aria-label={`Mở ${a.label}`}
                  >
                    Mở
                    <ArrowRightIcon aria-hidden />
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

function AccountTcp({ accountId }: { accountId: string }) {
  return <TcpText status={useTcpStatus(accountId)} />;
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
