import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangleIcon, Loader2Icon, MapPinIcon, RadioIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequireAccount } from "@/components/require-account";
import { PersonAvatar } from "@/components/account-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "@/lib/active-account";
import { cn } from "@/lib/utils";
import { UserInfoDialog, type UserRef } from "@/features/users/user-info-dialog";
import type { OnlineUser } from "./online-view";
import { useOnlineUsers } from "./use-online-users";

export function OnlinePage() {
  const { active } = useActiveAccount();
  const online = useOnlineUsers(active?.id);
  const [viewing, setViewing] = useState<UserRef | null>(null);

  // Pages can overlap when people come online between requests: dedupe by id.
  const users = useMemo(() => {
    const seen = new Set<string>();
    return (online.data?.pages ?? [])
      .flatMap((p) => p.users)
      .filter((u) => (seen.has(u.key) ? false : (seen.add(u.key), true)));
  }, [online.data]);

  const refreshing = online.isFetching && !online.isFetchingNextPage;

  return (
    <>
      <PageHeader
        title="Đang online"
        description={online.data ? `${users.length} người` : "Người dùng đang online ở trang chủ"}
        actions={
          <>
            {active && <LookupById onOpen={setViewing} />}
            <Button variant="outline" onClick={() => online.refetch()} disabled={!active || online.isFetching}>
              <RefreshCwIcon className={cn(refreshing && "animate-spin")} aria-hidden />
              Làm mới
            </Button>
          </>
        }
      />
      <RequireAccount>
        {() =>
          online.isPending ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-5" aria-busy="true" aria-label="Đang tải">
              {Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : online.error && users.length === 0 ? (
            <EmptyState
              icon={AlertTriangleIcon}
              title="Không tải được danh sách online"
              description={online.error.message}
              action={
                <Button variant="outline" onClick={() => online.refetch()}>
                  Thử lại
                </Button>
              }
            />
          ) : users.length === 0 ? (
            <EmptyState icon={RadioIcon} title="Chưa thấy ai online" description="Thử làm mới sau ít phút." />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-5">
                {users.map((u) => (
                  <UserCard key={u.key} user={u} onOpen={setViewing} />
                ))}
              </ul>
              <div className="flex flex-col items-center gap-2 pb-6">
                {online.error && <p className="text-sm text-destructive">{online.error.message}</p>}
                {online.hasNextPage ? (
                  <Button variant="outline" onClick={() => online.fetchNextPage()} disabled={online.isFetchingNextPage}>
                    {online.isFetchingNextPage && <Loader2Icon className="animate-spin" aria-hidden />}
                    Tải thêm
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Đã hết danh sách</p>
                )}
              </div>
            </div>
          )
        }
      </RequireAccount>
      {active && <UserInfoDialog accountId={active.id} user={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Open any user's info by id, without needing them in the online list. */
function LookupById({ onOpen }: { onOpen: (u: UserRef) => void }) {
  const [value, setValue] = useState("");
  const id = value.trim();
  const valid = USER_ID.test(id);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) onOpen({ id, name: id });
  }

  return (
    <form onSubmit={submit} className="relative" role="search">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Xem user theo ID"
        aria-label="Xem thông tin user theo ID, nhấn Enter"
        aria-invalid={id !== "" && !valid}
        spellCheck={false}
        className="w-52 pl-8 font-mono"
      />
    </form>
  );
}

const GENDER_LABEL = { female: "Nữ", male: "Nam" } as const;

function UserCard({ user, onOpen }: { user: OnlineUser; onOpen: (u: UserRef) => void }) {
  const meta = [user.gender && GENDER_LABEL[user.gender], user.age !== null && `${user.age} tuổi`].filter(Boolean);
  const id = user.id;
  const body = (
    <>
      <div className="relative shrink-0">
        <PersonAvatar name={user.name} src={user.avatarUrl} size="lg" />
        {user.online !== false && (
          <span
            className="absolute right-0 bottom-0 size-3 rounded-full bg-success ring-2 ring-card"
            aria-label="Đang online"
            role="img"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium" title={user.name}>
          {user.name}
        </p>
        {(meta.length > 0 || user.mood) && (
          <div className="flex flex-wrap gap-1">
            {meta.map((m) => (
              <Badge key={String(m)} variant="secondary" className="text-[11px]">
                {m}
              </Badge>
            ))}
            {user.mood && (
              <Badge variant="outline" className="text-[11px]">
                {user.mood}
              </Badge>
            )}
          </div>
        )}
        {user.location && (
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPinIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{user.location}</span>
          </p>
        )}
        {user.tags.length > 0 && <p className="truncate text-xs text-muted-foreground">{user.tags.join(" · ")}</p>}
        {user.bio && <p className="line-clamp-2 text-xs text-muted-foreground">{user.bio}</p>}
        {user.id && <p className="truncate font-mono text-[11px] text-muted-foreground">ID {user.id}</p>}
      </div>
    </>
  );
  const base = "flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left";
  return (
    <li>
      {id ? (
        <button
          type="button"
          onClick={() => onOpen({ id, name: user.name })}
          className={cn(
            base,
            "outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
          aria-label={`Xem thông tin ${user.name}`}
        >
          {body}
        </button>
      ) : (
        <div className={base}>{body}</div>
      )}
    </li>
  );
}
