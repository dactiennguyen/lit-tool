import { MessageCircleQuestionIcon, MinimizeIcon, PowerIcon, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { OnClose } from "@/lib/api";
import { useSettings, useUpdateSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";

const OPTIONS: { value: OnClose; label: string; text: string; icon: LucideIcon }[] = [
  { value: "ask", label: "Hỏi mỗi lần", text: "Chọn chạy nền hay tắt hẳn khi bấm đóng", icon: MessageCircleQuestionIcon },
  { value: "tray", label: "Chạy nền", text: "Ẩn xuống khay, app vẫn chạy", icon: MinimizeIcon },
  { value: "quit", label: "Tắt hẳn", text: "Đóng ứng dụng", icon: PowerIcon },
];

/** What the window's close button does (Settings::on_close). */
export function WindowCard() {
  const { data: settings, isPending, error } = useSettings();
  const update = useUpdateSettings();

  function select(value: OnClose) {
    if (value === settings?.onClose || update.isPending) return;
    update.mutate(
      { onClose: value },
      { onError: (err) => toast.error(err instanceof Error ? err.message : "Không lưu được cài đặt") },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cửa sổ</CardTitle>
        <CardDescription>Khi bấm nút đóng cửa sổ.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div role="radiogroup" aria-label="Khi bấm nút đóng cửa sổ" className="grid grid-cols-3 gap-2">
            {OPTIONS.map(({ value, label, text, icon: Icon }) => {
              const selected = settings.onClose === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => select(value)}
                  disabled={update.isPending}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center text-sm outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60",
                    selected && "border-primary bg-primary/5 font-medium",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {label}
                  <span className="text-xs font-normal text-muted-foreground">{text}</span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
