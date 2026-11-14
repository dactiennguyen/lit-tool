import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequireAccount } from "@/components/require-account";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/api";
import { useActiveAccount } from "@/lib/active-account";
import { useAccountInfo, useUserInfoMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ProfileDetails } from "./profile-details";
import { toWallet } from "./wallet";

const numberFmt = new Intl.NumberFormat("vi-VN");

export function ProfilePage() {
  const { active } = useActiveAccount();
  const me = useUserInfoMe(active?.id);
  const wallet = useAccountInfo(active?.id);
  const fetching = me.isFetching || wallet.isFetching;

  return (
    <>
      <PageHeader
        title="Hồ sơ"
        description={active ? `Thông tin từ server của ${active.label}` : undefined}
        actions={
          <Button
            variant="outline"
            onClick={() => Promise.all([me.refetch(), wallet.refetch()])}
            disabled={!active || fetching}
          >
            <RefreshCwIcon className={cn(fetching && "animate-spin")} aria-hidden />
            Tải lại
          </Button>
        }
      />
      <RequireAccount>{(account) => <ProfileBody account={account} me={me} wallet={wallet} />}</RequireAccount>
    </>
  );
}

function ProfileBody({
  account,
  me,
  wallet,
}: {
  account: Account;
  me: ReturnType<typeof useUserInfoMe>;
  wallet: ReturnType<typeof useAccountInfo>;
}) {
  if (me.isPending) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4 p-5" aria-busy="true" aria-label="Đang tải hồ sơ">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (me.error) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Không lấy được hồ sơ"
        description={me.error.message}
        action={
          <Button variant="outline" onClick={() => me.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-2xl gap-4 p-5">
        <WalletCard wallet={wallet} />
        <ProfileDetails profile={me.data} fallbackName={account.label} updatedAt={me.dataUpdatedAt} />
      </div>
    </div>
  );
}

function WalletCard({ wallet }: { wallet: ReturnType<typeof useAccountInfo> }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Ví</CardTitle>
      </CardHeader>
      <CardContent>
        {wallet.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : wallet.error ? (
          <p className="text-sm text-destructive">{wallet.error.message}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {toWallet(wallet.data).map((item) => (
              <div key={item.key} className="rounded-lg bg-muted/50 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="text-base font-semibold tabular-nums">{numberFmt.format(item.value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
