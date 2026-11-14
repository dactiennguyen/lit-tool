import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Account } from "@/lib/api";
import { useClearHx, useSetHx } from "@/lib/queries";

const DEFAULT_PORT = 6717;
const DEFAULT_REST = "https://a1-sgp-ga.easemob.com";

/** IM login settings for one account. Give it a new `key` per open. */
export function HxSettingsDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const saved = account.hx;
  const [host, setHost] = useState(saved?.host ?? "");
  const [port, setPort] = useState(String(saved?.port ?? DEFAULT_PORT));
  const [restBase, setRestBase] = useState(saved?.restBase ?? "");
  const [template, setTemplate] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setHx = useSetHx();
  const clearHx = useClearHx();
  const pending = setHx.isPending || clearHx.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const portNum = Number(port);
    if (!host.trim()) return setError("Nhập IM host");
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return setError("Port từ 1 đến 65535");
    if (!saved && !template.trim()) return setError("Nhập login template (base64)");
    if (!saved && !password.trim() && !token.trim()) return setError("Nhập hxPwd hoặc access token");
    setError(null);
    try {
      await setHx.mutateAsync({
        id: account.id,
        input: {
          host,
          port: portNum,
          restBase: restBase.trim() || null,
          templateB64: template.trim() || null,
          password: password.trim() || null,
          accessToken: token.trim() || null,
        },
      });
      toast.success("Đã lưu cấu hình chat");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được");
    }
  }

  async function onClear() {
    try {
      await clearHx.mutateAsync(account.id);
      toast.success("Đã xoá cấu hình chat");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xoá được");
    }
  }

  const keepHint = saved ? "Để trống để giữ giá trị đã lưu" : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Cấu hình chat · {account.label}</DialogTitle>
            <DialogDescription>
              Thông tin đăng nhập Hyphenate lấy từ máy thật. Template, hxPwd và token được cất trong Keychain.
            </DialogDescription>
          </DialogHeader>

          {saved && (
            <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xs">
              {saved.username} · {saved.appKey}
            </p>
          )}

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="IM host">
              {(id) => (
                <Input id={id} value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} className="font-mono" />
              )}
            </Field>
            <Field label="Port">
              {(id) => (
                <Input id={id} value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" className="font-mono" />
              )}
            </Field>
          </div>

          <Field label="REST base" optional hint={`Mặc định ${DEFAULT_REST}`}>
            {(id, d) => (
              <Input
                id={id}
                value={restBase}
                onChange={(e) => setRestBase(e.target.value)}
                placeholder={DEFAULT_REST}
                spellCheck={false}
                className="font-mono"
                aria-describedby={d}
              />
            )}
          </Field>

          <Field label="Login template (base64)" hint={keepHint}>
            {(id, d) => (
              <Textarea
                id={id}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-xs break-all"
                aria-describedby={d}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="hxPwd" hint={keepHint}>
              {(id, d) => (
                <Input
                  id={id}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  aria-describedby={d}
                />
              )}
            </Field>
            <Field label="Access token" optional hint="Có token thì dùng token thay hxPwd">
              {(id, d) => (
                <Input
                  id={id}
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  aria-describedby={d}
                />
              )}
            </Field>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="sm:justify-between">
            {saved ? (
              <Button type="button" variant="destructive" onClick={onClear} disabled={pending}>
                <Trash2Icon aria-hidden />
                Xoá cấu hình
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Huỷ
              </Button>
              <Button type="submit" disabled={pending}>
                {setHx.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
                Lưu
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  optional,
  hint,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string | undefined;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(không bắt buộc)</span>}
      </Label>
      {children(id, hint ? `${id}-hint` : undefined)}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
