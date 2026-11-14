import { InboxIcon, MessageSquareIcon, SearchIcon, SendIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequireAccount } from "@/components/require-account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ChatPage() {
  return (
    <>
      <PageHeader title="Tin nhắn" description="Hội thoại của account đang dùng" />
      <RequireAccount>
        {(account) => (
          <div className="flex min-h-0 flex-1">
            <section aria-label="Danh sách hội thoại" className="flex w-72 shrink-0 flex-col border-r">
              <div className="relative p-3">
                <SearchIcon
                  className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input placeholder="Tìm hội thoại" aria-label="Tìm hội thoại" className="pl-8" disabled />
              </div>
              <EmptyState
                icon={InboxIcon}
                title="Chưa có hội thoại"
                description={`Hội thoại của ${account.label} sẽ hiện khi phần kết nối chat được nối vào app.`}
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
          </div>
        )}
      </RequireAccount>
    </>
  );
}
