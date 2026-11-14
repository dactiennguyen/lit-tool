import { useState } from "react";
import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, Settings2Icon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/api";
import { useCheckHxConnection } from "@/lib/queries";
import { useTcpStatus } from "@/lib/tcp-status";
import { TcpText } from "@/components/tcp-status";
import { ServerDialog } from "./server-dialog";

const STEP_LABEL = { login: "Đăng nhập", followup: "Followup" } as const;

/** TCP status with a server details button, and a one-off TCP login check. */
export function ConnectionPanel({ account }: { account: Account }) {
  const check = useCheckHxConnection();
  const tcp = useTcpStatus(account.id);
  const [serversOpen, setServersOpen] = useState(false);

  return (
    <section aria-label="Kết nối chat" className="space-y-2 border-b p-3">
      <div className="flex items-center justify-between gap-2">
        <TcpText status={tcp} className="text-[11px]" />
        <Button variant="ghost" size="icon-xs" aria-label="Thông tin server chat" title="Thông tin server chat" onClick={() => setServersOpen(true)}>
          <Settings2Icon aria-hidden />
        </Button>
      </div>
      <ServerDialog account={account} open={serversOpen} onOpenChange={setServersOpen} />

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
