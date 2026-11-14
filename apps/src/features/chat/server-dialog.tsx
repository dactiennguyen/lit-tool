import { CheckCircle2Icon, Loader2Icon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Account } from "@/lib/api";
import { useServerProbe } from "@/lib/queries";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

/**
 * The account's chat identity and the saved server list, each server checked
 * by opening and closing a TCP connection (no login, so the phone app is not
 * logged out).
 */
export function ServerDialog({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange: (open: boolean) => void }) {
  const probe = useServerProbe(open);
  const report = probe.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Server chat</DialogTitle>
          <DialogDescription>
            Mở kết nối TCP tới từng server rồi đóng ngay, không đăng nhập nên không ảnh hưởng app trên điện thoại.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">IM username</dt>
          <dd className="truncate font-mono text-xs leading-5">{account.im?.username ?? "—"}</dd>
          <dt className="text-muted-foreground">App key</dt>
          <dd className="truncate font-mono text-xs leading-5">{report?.appKey ?? "…"}</dd>
          <dt className="text-muted-foreground">REST</dt>
          <dd className="truncate font-mono text-xs leading-5">{report?.restBase ?? "…"}</dd>
          {report?.fetchedAt != null && (
            <>
              <dt className="text-muted-foreground">Danh sách lấy lúc</dt>
              <dd className="text-xs leading-5 tabular-nums">
                {dateFmt.format(report.fetchedAt)}
                {report.cluster && ` · cụm ${report.cluster}`}
              </dd>
            </>
          )}
        </dl>

        <section aria-label="Danh sách server" aria-busy={probe.isFetching} aria-live="polite">
          {probe.error ? (
            <p className="flex items-start gap-1.5 text-sm break-words text-destructive">
              <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {probe.error.message}
            </p>
          ) : !report ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              Đang kiểm tra…
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {report.servers.map((s) => (
                <li key={`${s.host}:${s.port}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">
                    {s.host}:{s.port}
                  </code>
                  {s.inUse && <Badge variant="secondary">Đang dùng</Badge>}
                  {probe.isFetching ? (
                    <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Đang kiểm tra" />
                  ) : s.reachable ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success tabular-nums">
                      <CheckCircle2Icon className="size-4" aria-hidden />
                      {s.ms} ms
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive" title={s.error ?? undefined}>
                      <XCircleIcon className="size-4" aria-hidden />
                      {s.error ?? "Không kết nối được"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => void probe.refetch()} disabled={probe.isFetching}>
            <RefreshCwIcon className={probe.isFetching ? "animate-spin" : undefined} aria-hidden />
            Kiểm tra lại
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
