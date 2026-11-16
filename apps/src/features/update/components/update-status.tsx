import { useEffect, useRef, useState } from "react";
import { DownloadIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkUpdate, installUpdate, isBlocking, mb, useUpdate } from "@/stores/update";
import { cn } from "@/lib/utils";

const clock = (at: number) => new Date(at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/**
 * From the moment a version is being downloaded (found when the app opened,
 * or the update button pressed) until the app opens again on it, this covers
 * the window and cannot be closed. A failed check shows nothing, so the app
 * stays usable offline; a failed download or install is told in a toast.
 */
export function UpdateGate() {
  const u = useUpdate();
  const wasBlocking = useRef(false);
  useEffect(() => {
    if (wasBlocking.current && u?.state === "failed") toast.error(`Cập nhật không thành công: ${u.message}`);
    wasBlocking.current = isBlocking(u);
  }, [u]);
  if (!u || !isBlocking(u)) return null;
  const part = u.state === "downloading" && u.total ? u.got / u.total : null;
  const notes = u.state === "installing" ? "" : u.notes.trim();

  return (
    <Dialog open disablePointerDismissal onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} aria-live="polite" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadIcon className="size-4 text-primary" aria-hidden />
            Đang cập nhật
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

/**
 * The update button at the bottom of the sidebar, only while a newer version
 * found by a later check (every 10 minutes, or Kiểm tra in Cài đặt) waits.
 */
export function UpdateButton({ collapsed }: { collapsed: boolean }) {
  const u = useUpdate();
  const [starting, setStarting] = useState(false);
  if (u?.state !== "available") return null;
  const label = `Cập nhật lên v${u.version}`;
  const install = () => {
    setStarting(true);
    installUpdate()
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setStarting(false));
  };
  const icon = starting ? <Loader2Icon className="animate-spin" aria-hidden /> : <DownloadIcon aria-hidden />;

  return (
    <div className={cn("p-2 pb-0", collapsed && "flex justify-center")}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size={collapsed ? "icon" : "sm"}
              className={cn(!collapsed && "w-full")}
              aria-label={label}
              disabled={starting}
              onClick={install}
            />
          }
        >
          {icon}
          {!collapsed && label}
        </TooltipTrigger>
        <TooltipContent className="max-w-64 whitespace-pre-line">
          {u.notes.trim() ? `Có bản v${u.version} (đang dùng v${u.current}).\n${u.notes.trim()}` : `Có bản v${u.version} (đang dùng v${u.current})`}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** The running version and a check button, in Cài đặt. */
export function VersionCard() {
  const u = useUpdate();
  if (!u) return null;
  const status =
    u.state === "off"
      ? { text: `Không tự cập nhật: ${u.reason}` }
      : u.state === "checking"
        ? { text: "Đang kiểm tra…" }
        : u.state === "latest"
          ? { text: `Bản mới nhất · kiểm tra lúc ${clock(u.checkedAt)}` }
          : u.state === "available"
            ? { text: `Có bản v${u.version}: bấm nút Cập nhật ở cuối thanh bên` }
            : u.state === "failed"
              ? { text: `Lỗi cập nhật: ${u.message}`, error: true }
              : u.state === "idle"
                ? { text: "Tự kiểm tra khi mở app và mỗi 10 phút" }
                : { text: "Đang cập nhật…" };
  const canCheck = u.state === "idle" || u.state === "latest" || u.state === "failed";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phiên bản</CardTitle>
        <CardDescription>Tự kiểm tra khi mở app và mỗi 10 phút.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm">v{u.current}</p>
          <p className={cn("truncate text-xs text-muted-foreground", status.error && "text-destructive")} title={status.text}>
            {status.text}
          </p>
        </div>
        {u.state !== "off" && (
          <Button variant="outline" size="sm" disabled={!canCheck} onClick={() => void checkUpdate()}>
            <RefreshCwIcon className={cn(u.state === "checking" && "animate-spin")} aria-hidden />
            Kiểm tra
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
