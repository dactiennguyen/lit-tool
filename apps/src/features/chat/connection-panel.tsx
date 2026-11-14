import { useState } from "react";
import { Settings2Icon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectTcpButton } from "@/components/connect-tcp-button";
import type { Account } from "@/lib/api";
import { isLive, useTcpStatus } from "@/lib/tcp-status";
import { TcpText } from "@/components/tcp-status";
import { ServerDialog } from "./server-dialog";

/**
 * Live connection status with a server details button, and the connect button
 * while not connected (disconnecting and the log are in the account header).
 */
export function ConnectionPanel({ account }: { account: Account }) {
  const tcp = useTcpStatus(account.id);
  const [serversOpen, setServersOpen] = useState(false);
  const problem = tcp.state === "error" || tcp.state === "retrying" ? tcp.message : null;

  return (
    <section aria-label="Kết nối chat" className="space-y-2 border-b p-3">
      <div className="flex items-center justify-between gap-2">
        <TcpText status={tcp} className="min-w-0 flex-1 text-[11px]" />
        <Button variant="ghost" size="icon-xs" aria-label="Thông tin server chat" title="Thông tin server chat" onClick={() => setServersOpen(true)}>
          <Settings2Icon aria-hidden />
        </Button>
      </div>
      <ServerDialog account={account} open={serversOpen} onOpenChange={setServersOpen} />

      {!isLive(tcp) && (
        <>
          <ConnectTcpButton account={account} status={tcp} size="default" className="w-full" />
          <p className="text-[11px] text-muted-foreground">
            Giữ kết nối để nhận tin mới ngay. Có thể làm app trên điện thoại bị đăng xuất.
          </p>
        </>
      )}

      <div aria-live="polite">
        {problem && (
          <p className={`flex items-start gap-1.5 text-xs break-words ${tcp.state === "error" ? "text-destructive" : "text-warning"}`}>
            <XCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}
