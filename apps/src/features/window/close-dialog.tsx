import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, MinimizeIcon, PowerIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, type OnClose } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Choice = Exclude<OnClose, "ask">;

/**
 * Listens for the window's close button (window.rs sends "close-asked" when the
 * setting is "ask") and shows the close dialog. Mount once, in the app shell.
 */
export function CloseRequestHandler() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void api.window.onCloseAsked(() => {
      setKey((k) => k + 1); // fresh dialog state each time
      setOpen(true);
    }).then((unlisten) => (cancelled ? unlisten() : (off = unlisten)));
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  return <CloseDialog key={key} open={open} onOpenChange={setOpen} />;
}

function CloseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const rememberId = useId();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(action: Choice) {
    setBusy(action);
    setError(null);
    try {
      await api.window.close(action, remember);
      // The saved choice changed: keep Cài đặt in sync.
      if (remember) await qc.invalidateQueries({ queryKey: queryKeys.settings });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thực hiện được");
    } finally {
      setBusy(null);
    }
  }

  const option = (action: Choice, Icon: LucideIcon, title: string, text: string, tone: string) => (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => choose(action)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors duration-150",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60",
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone)}>
        {busy === action ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{text}</span>
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => busy === null && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Đóng cửa sổ</DialogTitle>
          <DialogDescription>Bạn muốn để app chạy nền hay tắt hẳn?</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {option(
            "tray",
            MinimizeIcon,
            "Chạy nền",
            "Ẩn cửa sổ xuống khay. Kết nối chat và các tác vụ nền vẫn chạy. Mở lại bằng icon ở khay.",
            "bg-primary/10 text-primary",
          )}
          {option(
            "quit",
            PowerIcon,
            "Tắt hẳn",
            "Đóng ứng dụng. Các kết nối chat đang mở sẽ ngắt.",
            "bg-destructive/10 text-destructive",
          )}
        </div>

        <div className="flex items-center gap-2">
          <Switch id={rememberId} checked={remember} onCheckedChange={setRemember} disabled={busy !== null} />
          <Label htmlFor={rememberId} className="font-normal">
            Ghi nhớ lựa chọn, không hỏi lại
          </Label>
        </div>
        {remember && <p className="-mt-2 text-xs text-muted-foreground">Đổi lại trong Cài đặt → Cửa sổ.</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Huỷ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
