import { useState, type FormEvent } from "react";
import { Loader2Icon, RefreshCwIcon, RotateCcwIcon, ServerIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { chatServer, DEFAULT_IM_APP_KEY, DEFAULT_IM_REST_BASE, type AppSettings } from "@/lib/api";
import { useRefreshImServers, useSettings, useUpdateSettings } from "@/lib/queries";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

/** The chat server shared by every account: only its Easemob app key is set here. */
export function ImServerCard() {
  const { data: settings, isPending, error } = useSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server chat</CardTitle>
        <CardDescription>
          Dùng chung cho mọi account. Server được tìm theo app key ở lần kết nối đầu rồi lưu lại. IM username và mật
          khẩu chat của từng account được lấy từ hồ sơ khi đăng nhập.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="grid gap-5">
            <AutoConnectSwitch settings={settings} />
            {/* key: a fresh form whenever the saved key changes */}
            <AppKeyForm key={settings.imAppKey} settings={settings} />
            <SavedServers settings={settings} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Saved at once, independently of the form below. */
function AutoConnectSwitch({ settings }: { settings: AppSettings }) {
  const update = useUpdateSettings();
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label htmlFor="auto-connect-tcp">Tự động kết nối TCP khi đăng nhập</Label>
        <p className="text-xs text-muted-foreground">
          Bấm Đăng nhập là kết nối server chat luôn. Tắt thì dùng nút Kết nối trên đầu trang account. Mỗi lần kết nối
          có thể làm app Litmatch trên điện thoại bị đăng xuất.
        </p>
      </div>
      <Switch
        id="auto-connect-tcp"
        checked={settings.autoConnectTcp}
        disabled={update.isPending}
        onCheckedChange={(checked) =>
          update.mutate(
            { autoConnectTcp: checked },
            {
              onSuccess: () => toast.success(checked ? "Đã bật tự động kết nối" : "Đã tắt tự động kết nối"),
              onError: (e) => toast.error(e.message),
            },
          )
        }
      />
    </div>
  );
}

const isAppKey = (v: string) => /^[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$/.test(v);

function AppKeyForm({ settings }: { settings: AppSettings }) {
  const update = useUpdateSettings();
  const [appKey, setAppKey] = useState(settings.imAppKey);
  const value = appKey.trim();
  const valid = isAppKey(value);
  const dirty = value !== settings.imAppKey;

  async function save(next: string) {
    try {
      await update.mutateAsync({ imAppKey: next });
      setAppKey(next);
      toast.success("Đã lưu app key");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được app key");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid && dirty) void save(value);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-1.5">
      <Label htmlFor="im-app-key">App key</Label>
      <div className="flex gap-2">
        <Input
          id="im-app-key"
          value={appKey}
          onChange={(e) => setAppKey(e.target.value)}
          placeholder={DEFAULT_IM_APP_KEY}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          aria-invalid={!valid}
          aria-describedby="im-app-key-help"
        />
        <Button type="submit" disabled={!dirty || !valid || update.isPending}>
          {update.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
          Lưu
        </Button>
      </div>
      <p id="im-app-key-help" className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        Dạng <code className="font-mono">org#app</code>. Mặc định <code className="font-mono">{DEFAULT_IM_APP_KEY}</code>.
        {settings.imAppKey !== DEFAULT_IM_APP_KEY && (
          <Button type="button" variant="ghost" size="xs" disabled={update.isPending} onClick={() => void save(DEFAULT_IM_APP_KEY)}>
            <RotateCcwIcon aria-hidden />
            Dùng mặc định
          </Button>
        )}
      </p>
    </form>
  );
}

/** The server list saved for the app key, and a button to fetch it again. */
function SavedServers({ settings }: { settings: AppSettings }) {
  const refresh = useRefreshImServers();
  const saved = chatServer(settings);
  const first = saved?.endpoints[0];

  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3 text-xs">
      <ServerIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {saved && first ? (
          <>
            <p>
              TCP <code className="font-mono">{first.host}:{first.port}</code> · REST{" "}
              <code className="font-mono break-all">{saved.restBase ?? DEFAULT_IM_REST_BASE}</code>
            </p>
            <p className="text-muted-foreground">
              Lấy lúc {dateFmt.format(saved.fetchedAt)}
              {saved.cluster && ` · cụm ${saved.cluster}`}
              {saved.endpoints.length > 1 && ` · ${saved.endpoints.length} server, dùng server đầu`}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Chưa có danh sách server: app tự lấy ở lần kết nối chat đầu tiên.</p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={refresh.isPending}
        onClick={() =>
          refresh.mutate(undefined, {
            onSuccess: () => toast.success("Đã lấy lại danh sách server"),
            onError: (e) => toast.error(e.message),
          })
        }
      >
        {refresh.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
        {saved ? "Lấy lại" : "Lấy ngay"}
      </Button>
    </div>
  );
}
