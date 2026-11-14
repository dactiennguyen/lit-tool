import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequireAccount } from "@/components/require-account";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/api";
import { useActiveAccount } from "@/lib/active-account";
import { useAccountInfo } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ProfileDetails } from "./profile-details";

export function ProfilePage() {
  const { active } = useActiveAccount();
  const info = useAccountInfo(active?.id);

  return (
    <>
      <PageHeader
        title="Hồ sơ"
        description={active ? `Thông tin từ server của ${active.label}` : undefined}
        actions={
          <Button variant="outline" onClick={() => info.refetch()} disabled={!active || info.isFetching}>
            <RefreshCwIcon className={cn(info.isFetching && "animate-spin")} aria-hidden />
            Tải lại
          </Button>
        }
      />
      <RequireAccount>{(account) => <ProfileBody account={account} info={info} />}</RequireAccount>
    </>
  );
}

function ProfileBody({ account, info }: { account: Account; info: ReturnType<typeof useAccountInfo> }) {
  if (info.isPending) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4 p-5" aria-busy="true" aria-label="Đang tải hồ sơ">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (info.error) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Không lấy được hồ sơ"
        description={info.error.message}
        action={
          <Button variant="outline" onClick={() => info.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-5">
        <ProfileDetails data={info.data} fallbackName={account.label} updatedAt={info.dataUpdatedAt} />
      </div>
    </div>
  );
}
