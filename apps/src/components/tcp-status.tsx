import { Loader2Icon, PlugIcon, PlugZapIcon, UnplugIcon } from "lucide-react";
import type { TcpStatus } from "@/lib/tcp-status";
import { cn } from "@/lib/utils";

const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short" });

export function tcpLabel(s: TcpStatus): string {
  switch (s.state) {
    case "idle":
      return "TCP: chưa kết nối";
    case "connecting":
      return "TCP: đang kết nối…";
    case "ok":
      return `TCP: OK lúc ${timeFmt.format(s.at)}${s.via === "send" ? " (khi gửi tin)" : ""}`;
    case "error":
      return `TCP: lỗi lúc ${timeFmt.format(s.at)}`;
  }
}

/** Icon + text. The error message is in the tooltip. */
export function TcpText({ status, className }: { status: TcpStatus; className?: string }) {
  const Icon =
    status.state === "connecting" ? Loader2Icon : status.state === "ok" ? PlugZapIcon : status.state === "error" ? UnplugIcon : PlugIcon;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1",
        status.state === "ok" && "text-success",
        status.state === "error" && "text-destructive",
        (status.state === "idle" || status.state === "connecting") && "text-muted-foreground",
        className,
      )}
      title={status.state === "error" ? status.message : undefined}
    >
      <Icon className={cn("size-3 shrink-0", status.state === "connecting" && "animate-spin")} aria-hidden />
      <span className="truncate">{tcpLabel(status)}</span>
      {status.state === "error" && <span className="sr-only">: {status.message}</span>}
    </span>
  );
}

/** Icon only, for compact lists; nothing until a connection was attempted. */
export function TcpIcon({ status }: { status: TcpStatus }) {
  if (status.state === "idle") return null;
  const Icon = status.state === "connecting" ? Loader2Icon : status.state === "ok" ? PlugZapIcon : UnplugIcon;
  return (
    <Icon
      role="img"
      aria-label={tcpLabel(status)}
      className={cn(
        "size-3.5 shrink-0",
        status.state === "connecting" && "animate-spin text-muted-foreground",
        status.state === "ok" && "text-success",
        status.state === "error" && "text-destructive",
      )}
    />
  );
}
