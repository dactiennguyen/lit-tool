import { useState } from "react";
import { InboxIcon, MessageSquareIcon, PlugIcon, SendIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequireAccount } from "@/components/require-account";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Account } from "@/lib/api";
import { ConnectionPanel } from "./connection-panel";
import { HxSettingsDialog } from "./hx-settings-dialog";

export function ChatPage() {
  return (
    <>
      <PageHeader title="Tin nhắn" description="Hội thoại của account đang dùng" />
      {/* key: connection results and form state belong to one account */}
      <RequireAccount>{(account) => <ChatBody key={account.id} account={account} />}</RequireAccount>
    </>
  );
}

function ChatBody({ account }: { account: Account }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);
  const openSettings = () => {
    setSettingsKey((k) => k + 1); // fresh form each time
    setSettingsOpen(true);
  };

  const dialog = (
    <HxSettingsDialog key={settingsKey} account={account} open={settingsOpen} onOpenChange={setSettingsOpen} />
  );

  if (!account.hx) {
    return (
      <>
        <EmptyState
          icon={PlugIcon}
          title="Chưa cấu hình chat"
          description={`Nhập IM host, login template và hxPwd (hoặc token) của ${account.label} để kết nối server chat.`}
          action={<Button onClick={openSettings}>Cấu hình chat</Button>}
        />
        {dialog}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-label="Danh sách hội thoại" className="flex w-72 shrink-0 flex-col border-r">
        <ConnectionPanel account={account} hx={account.hx} onConfigure={openSettings} />
        <EmptyState
          icon={InboxIcon}
          title="Chưa có hội thoại"
          description="Danh sách hội thoại sẽ có ở bước tiếp theo."
        />
      </section>

      <section aria-label="Nội dung hội thoại" className="flex min-w-0 flex-1 flex-col">
        <EmptyState icon={MessageSquareIcon} title="Chọn một hội thoại để xem tin nhắn" />
        <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => e.preventDefault()}>
          <Textarea
            placeholder="Nhập tin nhắn…"
            aria-label="Nội dung tin nhắn"
            rows={1}
            className="max-h-32 min-h-9 flex-1 resize-none"
            disabled
          />
          <Button type="submit" size="icon-lg" aria-label="Gửi" disabled>
            <SendIcon aria-hidden />
          </Button>
        </form>
      </section>
      {dialog}
    </div>
  );
}
