import { useEffect, useState, type FormEvent } from "react";
import { Loader2Icon, MonitorIcon, MoonIcon, RotateCcwIcon, SunIcon, type LucideIcon } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_API_BASE_URL } from "@/lib/api";
import { useSettings, useUpdateSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { checkBaseUrl } from "@/lib/validation";
import { ImServerCard } from "./im-server-card";

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Sáng", icon: SunIcon },
  { value: "dark", label: "Tối", icon: MoonIcon },
  { value: "system", label: "Theo hệ thống", icon: MonitorIcon },
];

export function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <PageHeader title="Cài đặt" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-2xl gap-4 p-5">
          <ServerApiCard />
          <ImServerCard />

          <Card>
            <CardHeader>
              <CardTitle>Giao diện</CardTitle>
              <CardDescription>Chọn chế độ sáng, tối hoặc theo hệ điều hành.</CardDescription>
            </CardHeader>
            <CardContent>
              <div role="radiogroup" aria-label="Chế độ giao diện" className="grid grid-cols-3 gap-2">
                {THEMES.map(({ value, label, icon: Icon }) => {
                  const selected = theme === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setTheme(value)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-lg border p-3 text-sm outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                        selected && "border-primary bg-primary/5 font-medium",
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                      {label}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dữ liệu</CardTitle>
              <CardDescription>Mọi thứ chỉ lưu trên máy này.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Account, session (sid), mật khẩu chat, danh sách server chat và cài đặt chung nằm trong cơ sở dữ liệu SQLite{" "}
                <code className="font-mono text-xs text-foreground">sky.db</code> ở thư mục dữ liệu của app.
              </p>
              <p>File chỉ user của máy đọc được, nhưng không mã hoá.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function ServerApiCard() {
  const { data: settings, isPending, error } = useSettings();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings.apiBaseUrl);
  }, [settings]);

  const saved = settings?.apiBaseUrl ?? "";
  const dirty = draft.trim() !== saved;
  const isDefault = saved === DEFAULT_API_BASE_URL;

  async function save(value: string) {
    const checked = checkBaseUrl(value);
    if (!checked.ok) {
      setFieldError(checked.error);
      return;
    }
    setFieldError(null);
    try {
      const next = await update.mutateAsync({ apiBaseUrl: checked.value });
      setDraft(next.apiBaseUrl);
      toast.success("Đã lưu Server API URL");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được cài đặt");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save(draft);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server API</CardTitle>
        <CardDescription>Địa chỉ gốc (base URL) mà app gửi request tới.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <form onSubmit={onSubmit} noValidate className="grid gap-1.5">
            <Label htmlFor="api-base-url">Base URL</Label>
            <div className="flex gap-2">
              <Input
                id="api-base-url"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setFieldError(null);
                }}
                placeholder={DEFAULT_API_BASE_URL}
                spellCheck={false}
                autoComplete="off"
                inputMode="url"
                className="flex-1 font-mono"
                aria-invalid={!!fieldError}
                aria-describedby="api-base-url-msg"
              />
              <Button type="submit" disabled={!dirty || update.isPending}>
                {update.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
                Lưu
              </Button>
            </div>
            <div id="api-base-url-msg" className="flex min-h-5 items-center justify-between gap-2 text-xs">
              {fieldError ? (
                <span className="text-destructive">{fieldError}</span>
              ) : (
                <span className="text-muted-foreground">
                  Mặc định: <code className="font-mono">{DEFAULT_API_BASE_URL}</code>
                </span>
              )}
              {!isDefault && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void save(DEFAULT_API_BASE_URL)}
                  disabled={update.isPending}
                >
                  <RotateCcwIcon aria-hidden />
                  Khôi phục mặc định
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
