import { DownloadIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkUpdate, isBlocking, mb, useUpdate } from "@/lib/update";
import { cn } from "@/lib/utils";

const clock = (at: number) => new Date(at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/**
 * Every newer version is mandatory (update.rs): from the moment one is found
 * until the app opens again on it, this covers the window and cannot be closed.
 * A failed check or install shows nothing here, so the app stays usable offline.
 */
export function UpdateGate() {
  const u = useUpdate();
  if (!u || !isBlocking(u)) return null;
  const part = u.state === "downloading" && u.total ? u.got / u.total : null;
  const notes = u.state === "installing" ? "" : u.notes.trim();

  return (
    <Dialog open disablePointerDismissal onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} aria-live="polite" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadIcon className="size-4 text-primary" aria-hidden />
            Cập nhật bắt buộc
          </DialogTitle>
          <DialogDescription>
            Có bản <b className="text-foreground">{u.version}</b> (đang dùng {u.current}). App tự tải, cài rồi mở lại.
          </DialogDescription>
        </DialogHeader>

        {u.state === "downloading" ? (
          <div className="grid gap-1.5">
            <div
              role="progressbar"
              aria-label={`Tải bản ${u.version}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={part != null ? Math.round(part * 100) : undefined}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full bg-primary transition-[width] duration-200", part == null && "w-1/3 animate-pulse")}
                style={part != null ? { width: `${part * 100}%` } : undefined}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {part != null ? `${Math.round(part * 100)}% · ${mb(u.got)}/${mb(u.total!)} MB` : `Đã tải ${mb(u.got)} MB`}
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            Đang cài bản {u.version}…
          </p>
        )}

        {notes && (
          <div className="max-h-44 overflow-y-auto rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed select-text">
            <p className="mb-1 font-medium">Có gì mới</p>
            {notes.split(/\n\s*\n/).map((p, i) => (
              <p key={i} className="mb-1 whitespace-pre-line text-muted-foreground">
                {p}
              </p>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The running version and a check button, at the bottom of the sidebar. */
export function UpdateLine() {
  const u = useUpdate();
  if (!u) return null;
  const status =
    u.state === "off"
      ? { text: "không tự cập nhật", title: u.reason }
      : u.state === "checking"
        ? { text: "đang kiểm tra…" }
        : u.state === "latest"
          ? { text: "bản mới nhất", title: `Kiểm tra lúc ${clock(u.checkedAt)}` }
          : u.state === "failed"
            ? { text: "không kiểm tra được", title: u.message, error: true }
            : null;
  const canCheck = u.state === "idle" || u.state === "latest" || u.state === "failed";

  return (
    <div className="flex items-center gap-1 px-2.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" title={status?.title}>
        <span className="font-mono">v{u.current}</span>
        {status && <span className={cn(status.error && "text-destructive")}> · {status.text}</span>}
      </span>
      {u.state !== "off" && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Kiểm tra cập nhật"
                disabled={!canCheck}
                onClick={() => void checkUpdate()}
              />
            }
          >
            <RefreshCwIcon className={cn(u.state === "checking" && "animate-spin")} aria-hidden />
          </TooltipTrigger>
          <TooltipContent>Kiểm tra cập nhật</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
