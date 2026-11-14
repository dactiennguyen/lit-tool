import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chatServer, type Account, type AppSettings } from "@/lib/api";
import { useCheckHxConnection } from "@/lib/queries";
import { useTcpStatus } from "@/lib/tcp-status";
import { TcpText } from "@/components/tcp-status";

const STEP_LABEL = { login: "Đăng nhập", followup: "Followup" } as const;

/** The account's IM username on the shared server, and a one-off TCP login check. */
export function ConnectionPanel({
  account,
  username,
  settings,
}: {
  account: Account;
  username: string;
  settings: AppSettings;
}) {
  const check = useCheckHxConnection();
  const tcp = useTcpStatus(account.id);

  return (
    <section aria-label="Kết nối chat" className="space-y-2 border-b p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-mono text-xs">{username}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {(() => {
            const server = chatServer(settings)?.endpoints[0];
            return server ? `${server.host}:${server.port}` : "Server: tự tìm khi kết nối lần đầu";
          })()}
        </p>
        <TcpText status={tcp} className="text-[11px]" />
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
        {tcp.state === "error" && (
          <p className="flex items-start gap-1.5 text-xs break-words text-destructive">
            <XCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {tcp.message}
          </p>
        )}
        {check.data && tcp.state === "ok" && tcp.via === "check" && (
          <ul className="space-y-1 text-xs">
            <li className="flex items-center gap-1.5">
              <CheckCircle2Icon className="size-3.5 text-success" aria-hidden />
              Token
              <span className="text-muted-foreground">
                {check.data.tokenExpiresIn !== null ? `(mới, hết hạn sau ${check.data.tokenExpiresIn}s)` : "(đã có)"}
              </span>
            </li>
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
