import { RadioIcon, RefreshCwIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequireAccount } from "@/components/require-account";
import { Button } from "@/components/ui/button";

export function OnlinePage() {
  return (
    <>
      <PageHeader
        title="Đang online"
        description="Người dùng đang online ở trang chủ"
        actions={
          <Button variant="outline" disabled>
            <RefreshCwIcon aria-hidden />
            Làm mới
          </Button>
        }
      />
      <RequireAccount>
        {(account) => (
          <EmptyState
            icon={RadioIcon}
            title="Chưa nối dữ liệu"
            description={
              <>
                Danh sách online của <span className="font-medium text-foreground">{account.label}</span> sẽ hiện ở
                đây khi lệnh backend <code className="font-mono text-xs">home/online_users</code> được nối vào app.
              </>
            }
          />
        )}
      </RequireAccount>
    </>
  );
}
