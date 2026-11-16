import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from "lucide-react";
import type { SessionState } from "@/stores/sessions";
import { cn } from "@/lib/utils";

const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeStyle: "short" });

/** Short label for lists. */
export function sessionLabel(s: SessionState): string {
  switch (s.state) {
    case "out":
      return "Chưa đăng nhập";
    case "loading":
      return "Đang đăng nhập…";
    case "in":
      return "Đã đăng nhập";
    case "error":
      return s.expired ? "Session hết hạn" : "Lỗi đăng nhập";
  }
}

/** Small status dot, e.g. on an avatar. */
export function SessionDot({ session, className }: { session: SessionState; className?: string }) {
  return (
    <span
      role="img"
      aria-label={sessionLabel(session)}
      className={cn(
        "block size-2.5 rounded-full ring-2 ring-sidebar",
        session.state === "in" && "bg-success",
        session.state === "loading" && "animate-pulse bg-warning",
        session.state === "error" && "bg-destructive",
        session.state === "out" && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

/** Icon + text, for tables. */
export function SessionText({ session }: { session: SessionState }) {
  switch (session.state) {
    case "out":
      return <span className="text-muted-foreground">Chưa đăng nhập</span>;
    case "loading":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
          Đang đăng nhập…
        </span>
      );
    case "in":
      return (
        <span className="flex items-center gap-1 text-success">
          <CheckCircle2Icon className="size-3" aria-hidden />
          Đã đăng nhập · {timeFmt.format(session.at)}
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-destructive" title={session.message}>
          <XCircleIcon className="size-3 shrink-0" aria-hidden />
          <span className="max-w-56 truncate">{session.expired ? "Session hết hạn, cần sid mới" : session.message}</span>
        </span>
      );
  }
}
