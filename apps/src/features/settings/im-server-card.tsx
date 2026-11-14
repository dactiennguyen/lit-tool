import { useState, type FormEvent } from "react";
import { CheckCircle2Icon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_IM_HOST, DEFAULT_IM_PORT, DEFAULT_IM_REST_BASE, type AppSettings } from "@/lib/api";
import { useClearImTemplate, useSettings, useUpdateSettings } from "@/lib/queries";

/** The IM (chat) server shared by every account. */
export function ImServerCard() {
  const { data: settings, isPending, error } = useSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server chat</CardTitle>
        <CardDescription>
          Dùng chung cho mọi account. IM username và mật khẩu chat của từng account được lấy từ hồ sơ khi đăng nhập.
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
            {/* key: a fresh form whenever the saved values change */}
            <ImServerForm key={`${settings.imHost}:${settings.imPort}:${settings.imRestBase}`} settings={settings} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Saved at once, independently of the server form below. */
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

function ImServerForm({ settings }: { settings: AppSettings }) {
  const update = useUpdateSettings();
  const clear = useClearImTemplate();
  const [host, setHost] = useState(settings.imHost);
  const [port, setPort] = useState(String(settings.imPort));
  const [restBase, setRestBase] = useState(settings.imRestBase);
  const [template, setTemplate] = useState("");

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const dirty =
    host.trim() !== settings.imHost ||
    portNumber !== settings.imPort ||
    restBase.trim() !== settings.imRestBase ||
    template.trim() !== "";
  const needsTemplate = !settings.imTemplate && template.trim() === "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!portValid) return;
    try {
      await update.mutateAsync({
        imHost: host.trim(),
        imPort: portNumber,
        imRestBase: restBase.trim(),
        ...(template.trim() ? { imTemplateB64: template.trim() } : {}),
      });
      setTemplate("");
      toast.success("Đã lưu server chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được server chat");
    }
  }

  async function removeTemplate() {
    try {
      await clear.mutateAsync();
      toast.success("Đã xoá login template");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không xoá được template");
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="im-host">IM host</Label>
          <Input
            id="im-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={DEFAULT_IM_HOST}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="im-port">Port</Label>
          <Input
            id="im-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
            placeholder={String(DEFAULT_IM_PORT)}
            className="font-mono"
            aria-invalid={!portValid}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="im-rest">REST base</Label>
        <Input
          id="im-rest"
          value={restBase}
          onChange={(e) => setRestBase(e.target.value)}
          placeholder={DEFAULT_IM_REST_BASE}
          spellCheck={false}
          autoComplete="off"
          inputMode="url"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Mặc định: <code className="font-mono">{DEFAULT_IM_HOST}:{DEFAULT_IM_PORT}</code>,{" "}
          <code className="font-mono">{DEFAULT_IM_REST_BASE}</code>
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="im-template">Login template (base64)</Label>
        {settings.imTemplate && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
            <CheckCircle2Icon className="size-3.5 shrink-0 text-success" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              Đã lưu · app key <code className="font-mono">{settings.imTemplate.appKey}</code> · bắt từ{" "}
              <code className="font-mono">{settings.imTemplate.username}</code>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void removeTemplate()}
              disabled={clear.isPending}
            >
              <Trash2Icon aria-hidden />
              Xoá
            </Button>
          </div>
        )}
        <Textarea
          id="im-template"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder={settings.imTemplate ? "Để trống để giữ template đã lưu" : "Dán frame đăng nhập TCP bắt từ máy thật"}
          spellCheck={false}
          autoComplete="off"
          rows={3}
          className="font-mono text-xs break-all"
        />
        <p className="text-xs text-muted-foreground">
          Lưu trong Keychain. Khi đăng nhập chat, username trong template được thay bằng IM username của từng account.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || !portValid || needsTemplate || update.isPending}>
          {update.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
          Lưu
        </Button>
      </div>
    </form>
  );
}
