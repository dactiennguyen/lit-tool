import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SentRow } from "@/features/outreach/store/sent-log";

const when = (ms: number) => new Date(ms).toLocaleString("vi-VN");

/** Recent attempts from the localStorage log: sent, failed, and legacy dry runs. */
export function HistoryDialog({ open, onOpenChange, rows }: { open: boolean; onOpenChange: (open: boolean) => void; rows: SentRow[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Lịch sử gửi</DialogTitle>
          <DialogDescription>{rows.length} lần gần đây, lưu trên máy này.</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chưa có lịch sử.</p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md border p-2 text-sm">
                <p className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.peerName}</span>
                  {r.dryRun ? (
                    <Badge variant="outline">thử</Badge>
                  ) : r.ok ? (
                    <Badge variant="secondary">đã gửi</Badge>
                  ) : r.uncertain ? (
                    <Badge variant="outline">chưa rõ</Badge>
                  ) : (
                    <Badge variant="destructive">lỗi</Badge>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{when(r.sentAt)}</span>
                </p>
                {r.text && <p className="truncate text-muted-foreground">{r.text}</p>}
                <p className="truncate text-xs text-muted-foreground">
                  qua {r.accountLabel}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
