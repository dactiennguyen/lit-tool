import { Loader2Icon, PlugIcon, PlugZapIcon, RadioIcon, UnplugIcon } from "lucide-react";
import type { TcpStatus } from "@/lib/tcp-status";
import { cn } from "@/lib/utils";

const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short" });

export function tcpLabel(s: TcpStatus): string {
  switch (s.state) {
    case "idle":
      return "TCP: chưa kết nối";
    case "connecting":
      return "TCP: đang kết nối…";
    case "live":
      return `TCP: đang nhận tin từ ${timeFmt.format(s.since)}`;
    case "retrying":
      return `TCP: mất kết nối, thử lại lúc ${timeFmt.format(s.retryAt)}`;
    case "ok":
      return `TCP: OK lúc ${timeFmt.format(s.at)} (khi gửi tin)`;
    case "error":
      return `TCP: lỗi lúc ${timeFmt.format(s.at)}`;
  }
}

/** The error text, for a tooltip, when there is one. */
const problem = (s: TcpStatus) => (s.state === "error" || s.state === "retrying" ? s.message : undefined);

const ICONS = { idle: PlugIcon, connecting: Loader2Icon, live: RadioIcon, retrying: Loader2Icon, ok: PlugZapIcon, error: UnplugIcon };

const tone = (s: TcpStatus) =>
  cn(
    (s.state === "live" || s.state === "ok") && "text-success",
    s.state === "retrying" && "text-warning",
    s.state === "error" && "text-destructive",
    (s.state === "idle" || s.state === "connecting") && "text-muted-foreground",
  );

const spins = (s: TcpStatus) => s.state === "connecting" || s.state === "retrying";

/** Icon + text. The error message is in the tooltip. */
export function TcpText({ status, className }: { status: TcpStatus; className?: string }) {
  const Icon = ICONS[status.state];
  const message = problem(status);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", tone(status), className)} title={message}>
      <Icon className={cn("size-3 shrink-0", spins(status) && "animate-spin")} aria-hidden />
      <span className="truncate">{tcpLabel(status)}</span>
      {message && <span className="sr-only">: {message}</span>}
    </span>
  );
}

/** Icon only, for compact lists; nothing until a connection was attempted. */
export function TcpIcon({ status }: { status: TcpStatus }) {
  if (status.state === "idle") return null;
  const Icon = ICONS[status.state];
  return (
    <Icon
      role="img"
      aria-label={tcpLabel(status)}
      className={cn("size-3.5 shrink-0", tone(status), spins(status) && "animate-spin")}
    />
  );
}
