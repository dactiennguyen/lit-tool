import { useId, useState, type ClipboardEvent } from "react";
import { CheckCircle2Icon, Loader2Icon, ShieldIcon, ZapIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, type ProxyForm, type ProxyView } from "@/lib/api";
import { PROXY_FORMATS, parseProxyText } from "@/lib/proxy-text";
import { PROXY_KINDS, defaultPort, proxyLabel } from "./proxy-form";

type Check = { state: "idle" } | { state: "testing" } | { state: "ok"; ms: number } | { state: "fail"; text: string };

const msFmt = new Intl.NumberFormat("vi-VN");

/**
 * The proxy of the add and edit form: on or off (saved either way), type, address, port, username, password. A pasted
 * proxy string fills them all (lib/proxy-text.ts). Kiểm tra reaches the Litmatch server through it; Lưu does the same
 * before saving a proxy turned on or changed.
 */
export function ProxyFields({
  value: p,
  onChange,
  saved,
  accountId,
  disabled,
}: {
  value: ProxyForm;
  onChange: (proxy: ProxyForm) => void;
  /** The proxy saved for the account being edited. */
  saved?: ProxyView | null | undefined;
  accountId?: string | undefined;
  disabled?: boolean;
}) {
  const ids = { on: useId(), paste: useId(), host: useId(), port: useId(), user: useId(), pass: useId() };
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [paste, setPaste] = useState("");
  const [pasted, setPasted] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (patch: Partial<ProxyForm>) => {
    onChange({ ...p, ...patch });
    setCheck({ state: "idle" });
  };

  /** Fills the fields from a proxy string; false when it is none. */
  const fill = (text: string) => {
    const r = parseProxyText(text);
    if (r == null) {
      setPasted({ ok: false, text: "Không nhận ra chuỗi proxy này. Các dạng đọc được ở dưới." });
      return false;
    }
    if (typeof r === "string") {
      setPasted({ ok: false, text: r });
      return false;
    }
    set({ ...r, kind: r.kind ?? p.kind });
    setPaste("");
    const kind = r.kind ? "" : ` (loại ${p.kind === "http" ? "HTTP" : "SOCKS5"} như đang chọn: đổi nếu sai)`;
    const who = r.username ? `, tài khoản ${r.username}` : ", không tài khoản";
    setPasted({ ok: true, text: `Đã điền ${r.host}:${r.port}${who}${kind}` });
    return true;
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (fill(e.clipboardData.getData("text"))) e.preventDefault();
  };

  const test = () => {
    setCheck({ state: "testing" });
    api.accounts.testProxy(p, accountId).then(
      (ms) => setCheck({ state: "ok", ms }),
      (err: unknown) => setCheck({ state: "fail", text: err instanceof Error ? err.message : String(err) }),
    );
  };
  const keepsPassword = !!saved?.hasPassword && !!p.username.trim() && p.username.trim() === saved.username;

  return (
    <fieldset disabled={disabled} className={cn("grid min-w-0 gap-3 rounded-lg border p-3", p.enabled && "border-success/50")}>
      <legend className="px-1 text-xs text-muted-foreground">Proxy</legend>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={ids.on} className="flex items-center gap-1.5">
          <ShieldIcon className="size-3.5" aria-hidden />
          Kết nối qua proxy
        </Label>
        <Switch id={ids.on} checked={p.enabled} onCheckedChange={(enabled) => set({ enabled })} />
      </div>

      {!p.enabled && (
        <p className="text-xs text-muted-foreground">
          {p.host.trim()
            ? `Đã có ${proxyLabel(p)}, đang tắt: account kết nối thẳng tới server. Bật lại để dùng.`
            : "Account kết nối thẳng tới server. Bật để đi qua proxy SOCKS5 hoặc HTTP (cả API lẫn kết nối chat)."}
        </p>
      )}

      {p.enabled && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.paste}>Dán proxy</Label>
            <div className="flex gap-2">
              <Input
                id={ids.paste}
                placeholder="vd. 1.2.3.4:8080:user:pass"
                value={paste}
                onPaste={onPaste}
                onChange={(e) => setPaste(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    fill(paste);
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={() => fill(paste)} disabled={!paste.trim()}>
                Điền
              </Button>
            </div>
            {pasted && (
              <p role="status" className={cn("text-xs break-words", pasted.ok ? "text-success" : "text-destructive")}>
                {pasted.text}
              </p>
            )}
            {pasted && !pasted.ok && (
              <ul className="flex flex-wrap gap-1" aria-label="Các dạng proxy đọc được">
                {PROXY_FORMATS.map((f) => (
                  <li key={f} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-1.5" role="radiogroup" aria-label="Loại proxy">
            {PROXY_KINDS.map((k) => (
              <Button
                key={k.kind}
                type="button"
                size="sm"
                role="radio"
                aria-checked={p.kind === k.kind}
                variant={p.kind === k.kind ? "default" : "outline"}
                // With nothing typed in yet, the port follows the kind.
                onClick={() => set({ kind: k.kind, port: !p.host && p.port === defaultPort(p.kind) ? k.port : p.port })}
              >
                {k.name}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.host}>Địa chỉ proxy</Label>
              <Input
                id={ids.host}
                placeholder="vd. 1.2.3.4"
                value={p.host}
                onPaste={onPaste}
                onChange={(e) => set({ host: e.target.value })}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.port}>Cổng</Label>
              <Input
                id={ids.port}
                type="number"
                min={1}
                max={65535}
                value={p.port || ""}
                onChange={(e) => set({ port: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={ids.user}>Tài khoản (tuỳ chọn)</Label>
              <Input
                id={ids.user}
                value={p.username}
                onChange={(e) => set({ username: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={ids.pass}>Mật khẩu</Label>
              <Input
                id={ids.pass}
                type="password"
                placeholder={keepsPassword ? "Để trống nếu không đổi" : ""}
                disabled={!p.username.trim()}
                value={p.password}
                onChange={(e) => set({ password: e.target.value })}
                autoComplete="new-password"
                className="disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex min-h-8 items-center gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={test}
              disabled={!p.host.trim() || !p.port || check.state === "testing"}
            >
              {check.state === "testing" ? <Loader2Icon className="animate-spin" aria-hidden /> : <ZapIcon aria-hidden />}
              {check.state === "testing" ? "Đang kiểm tra…" : "Kiểm tra"}
            </Button>
            <span
              role="status"
              className={cn(
                "inline-flex min-w-0 items-center gap-1 text-xs break-words text-muted-foreground",
                check.state === "ok" && "font-medium text-success",
                check.state === "fail" && "text-destructive",
              )}
            >
              {check.state === "ok" && (
                <>
                  <CheckCircle2Icon className="size-3.5 shrink-0" aria-hidden /> Tới được server Litmatch qua proxy,{" "}
                  {msFmt.format(check.ms)} ms
                </>
              )}
              {check.state === "fail" && check.text}
              {check.state === "idle" && "Bấm Lưu cũng kiểm tra trước khi lưu."}
            </span>
          </div>
        </>
      )}
    </fieldset>
  );
}
