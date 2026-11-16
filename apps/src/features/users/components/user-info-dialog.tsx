import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, MessageSquareIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserInfo } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ProfileDetails } from "@/features/profile/components/profile-details";

export interface UserRef {
  id: string;
  name: string;
}

/** Shows `user/get_info/:id` for another user, fetched as the given account. */
export function UserInfoDialog({
  accountId,
  user,
  onClose,
}: {
  accountId: string;
  user: UserRef | null;
  onClose: () => void;
}) {
  // Keep showing the last user while the close animation runs; switching to
  // null at once would flash an empty title and skeletons during the fade-out.
  const [last, setLast] = useState<UserRef | null>(user);
  if (user && user !== last) setLast(user);
  const shown = user ?? last;
  const info = useUserInfo(accountId, shown?.id);
  const navigate = useNavigate();
  const imId = info.data?.huanxinId ?? null;

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="truncate">{shown?.name ?? "Thông tin user"}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => info.refetch()}
              disabled={info.isFetching}
              aria-label="Tải lại thông tin user"
            >
              <RefreshCwIcon className={cn(info.isFetching && "animate-spin")} aria-hidden />
            </Button>
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">ID {shown?.id}</DialogDescription>
        </DialogHeader>

        {info.isPending ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Đang tải">
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
        ) : info.error ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertTriangleIcon className="size-5 text-destructive" aria-hidden />
            <p className="text-sm">{info.error.message}</p>
            <Button variant="outline" onClick={() => info.refetch()}>
              Thử lại
            </Button>
          </div>
        ) : (
          <>
            <ProfileDetails profile={info.data} fallbackName={shown?.name ?? ""} updatedAt={info.dataUpdatedAt} />
            {imId && (
              <Button
                className="w-full"
                onClick={() => {
                  onClose();
                  void navigate({ to: "/account/$accountId/chat", params: { accountId }, search: { to: imId } });
                }}
              >
                <MessageSquareIcon aria-hidden />
                Nhắn tin
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
