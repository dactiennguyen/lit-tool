import { PersonAvatar } from "@/components/account-avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SentRow } from "@/features/outreach/store/sent-log";
import { cn } from "@/lib/utils";
import { ExpandableText } from "./expandable-text";

const when = (ms: number) =>
  new Date(ms).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

const STATUS = {
  ok: { label: "Đã gửi", className: "border-success/30 bg-success/10 text-success" },
  uncertain: { label: "Chưa rõ", className: "border-warning/40 bg-warning/10 text-warning" },
  fail: { label: "Lỗi", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  dryRun: { label: "Thử", className: "border-border bg-muted text-muted-foreground" },
} as const;

const statusOf = (r: SentRow) => (r.dryRun ? STATUS.dryRun : r.ok ? STATUS.ok : r.uncertain ? STATUS.uncertain : STATUS.fail);

/** Recent attempts from the sent log: who (with avatar), what (click for the full text), how it went. */
export function HistoryDialog({ open, onOpenChange, rows }: { open: boolean; onOpenChange: (open: boolean) => void; rows: SentRow[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lịch sử gửi</DialogTitle>
          <DialogDescription>
            {rows.length ? `${rows.length} lần gửi gần nhất, lưu trên máy này. Bấm vào tin dài để xem đầy đủ.` : "Các lần gửi được lưu trên máy này."}
          </DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chưa có lịch sử.</p>
        ) : (
          <ul className="-mx-1 flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-1">
            {rows.map((r) => {
              const status = statusOf(r);
              return (
                <li key={r.id} className="flex gap-3 rounded-xl border bg-card p-3">
                  <PersonAvatar name={r.peerName} src={r.peerAvatar ?? null} size="lg" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.peerName}</p>
                        {r.peerMeta && <p className="truncate text-xs text-muted-foreground">{r.peerMeta}</p>}
                      </div>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", status.className)}>
                        {status.label}
                      </span>
                    </div>
                    {r.text && (
                      <ExpandableText text={r.text} className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm" />
                    )}
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span>
                        qua <span className="font-medium text-foreground">{r.accountLabel}</span>
                      </span>
                      <span aria-hidden>·</span>
                      <time dateTime={new Date(r.sentAt).toISOString()} className="tabular-nums">
                        {when(r.sentAt)}
                      </time>
                    </p>
                    {(r.error || r.note) && (
                      <p className={cn("text-xs break-words", r.ok ? "text-warning" : "text-destructive")}>{r.error ?? r.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
