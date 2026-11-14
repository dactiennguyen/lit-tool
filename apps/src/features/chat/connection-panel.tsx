import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, SettingsIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Account, HxConfig } from "@/lib/api";
import { useCheckHxConnection } from "@/lib/queries";

const STEP_LABEL = { login: "Đăng nhập", followup: "Followup" } as const;

/** Shows the account's IM settings and runs a one-off TCP login check. */
export function ConnectionPanel({
  account,
  hx,
  onConfigure,
}: {
  account: Account;
  hx: HxConfig;
  onConfigure: () => void;
}) {
  const check = useCheckHxConnection();

  return (
    <section aria-label="Kết nối chat" className="space-y-2 border-b p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs">{hx.username}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {hx.host}:{hx.port} · {hx.auth === "access_token" ? "token" : "hxPwd"}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onConfigure} aria-label="Cấu hình chat">
          <SettingsIcon aria-hidden />
        </Button>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => check.mutate(account.id)}
        disabled={check.isPending}
      >
        {check.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlugZapIcon aria-hidden />}
        Kiểm tra kết nối TCP
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Đăng nhập rồi ngắt ngay, không gửi tin. Có thể làm app trên điện thoại bị đăng xuất.
      </p>

      <div aria-live="polite">
        {check.error && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <XCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {check.error.message}
          </p>
        )}
        {check.data && (
          <ul className="space-y-1 text-xs">
            {check.data.tokenSource === "password" && (
              <li className="flex items-center gap-1.5">
                <CheckCircle2Icon className="size-3.5 text-success" aria-hidden />
                Lấy token
                {check.data.tokenExpiresIn !== null && (
                  <span className="text-muted-foreground">(hết hạn sau {check.data.tokenExpiresIn}s)</span>
                )}
              </li>
            )}
            {check.data.steps.map((s) => (
              <li key={s.step} className="flex items-center gap-1.5">
                <CheckCircle2Icon className="size-3.5 text-success" aria-hidden />
                {STEP_LABEL[s.step]}
                <span className="font-mono text-muted-foreground">
                  type={s.type} code={s.code}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
