import { useMutation } from "@tanstack/react-query";
import { Loader2Icon, PlugZapIcon, UnplugIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/api";
import { useConnectTcp } from "@/lib/queries";
import { disconnectTcp, isLive, type TcpStatus } from "@/lib/tcp-status";

/**
 * Opens the live chat connection, or closes it while it is open. Says what is
 * missing instead when chat is not set up yet.
 */
export function ConnectTcpButton({
  account,
  status,
  size = "xs",
  className,
}: {
  account: Account;
  status: TcpStatus;
  size?: "xs" | "sm" | "default";
  className?: string;
}) {
  const connect = useConnectTcp();
  const stop = useMutation({ mutationFn: disconnectTcp });
  const missing = !account.im ? "Hồ sơ chưa có thông tin chat: đăng xuất rồi đăng nhập lại" : null;

  if (isLive(status)) {
    return (
      <Button
        variant="outline"
        size={size}
        className={className}
        disabled={stop.isPending}
        title="Đóng kết nối, không nhận tin mới nữa"
        onClick={() => stop.mutate(account.id, { onError: (e) => toast.error(`${account.label}: ${e.message}`) })}
      >
        <UnplugIcon aria-hidden />
        Ngắt kết nối
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size={size}
      className={className}
      disabled={!!missing || connect.isPending}
      title={missing ?? "Giữ kết nối tới server chat để nhận tin mới ngay. Có thể làm app điện thoại bị đăng xuất."}
      onClick={() => connect.mutate(account.id, { onError: (e) => toast.error(`${account.label}: ${e.message}`) })}
    >
      {connect.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlugZapIcon aria-hidden />}
      {missing ? "Chưa có thông tin chat" : status.state === "error" ? "Kết nối lại" : "Kết nối"}
    </Button>
  );
}
