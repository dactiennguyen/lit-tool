import { useMemo, useState } from "react";
import { CircleCheckIcon, CircleXIcon, InboxIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BlastLogEntry } from "@/features/outreach/store/outreach-store";

type Filter = "all" | "ok" | "fail";

/** The session's send log: newest first, filterable by outcome. */
export function SendLog({ entries, canClear, onClear }: { entries: BlastLogEntry[]; canClear: boolean; onClear: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const failCount = useMemo(() => entries.filter((e) => e.state === "fail").length, [entries]);
  const shown = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => (filter === "fail") === (e.state === "fail"))),
    [entries, filter],
  );
  const tabs: { v: Filter; label: string; n: number }[] = [
    { v: "all", label: "Tất cả", n: entries.length },
    { v: "ok", label: "Thành công", n: entries.length - failCount },
    { v: "fail", label: "Lỗi", n: failCount },
  ];

  return (
    <section aria-label="Nhật ký gửi" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-muted-foreground">Nhật ký gửi</span>
        <span className="flex-1" />
        <div className="inline-flex rounded-md border p-0.5">
          {tabs.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setFilter(t.v)}
              className={cn(
                "rounded px-2 py-0.5 text-xs tabular-nums",
                filter === t.v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label} {t.n}
            </button>
          ))}
        </div>
        {canClear && entries.length > 0 && (
          <Button variant="ghost" size="icon-sm" aria-label="Xoá nhật ký phiên này" onClick={onClear}>
            <Trash2Icon className="text-destructive" aria-hidden />
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <InboxIcon className="size-4 shrink-0" aria-hidden />
          Chưa gửi tin nào. Từng tin sẽ hiện ở đây kèm trạng thái.
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-md border p-1 text-sm lg:max-h-none">
          {shown.map((e) => (
            <li key={e.id} className={cn("flex items-start gap-2 rounded-md px-2 py-1.5", e.state === "fail" && "bg-destructive/5")}>
              {e.state === "fail" ? (
                <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              ) : (
                <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {e.peerName} <span className="text-muted-foreground">qua {e.senderLabel}</span>
                </span>
                {e.text && <span className="block truncate text-xs text-muted-foreground">{e.text}</span>}
                {e.note && (
                  <span className={cn("block truncate text-xs", e.state === "fail" ? "text-destructive" : "text-amber-600 dark:text-amber-500")}>
                    {e.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
