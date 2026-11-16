import { useMemo, useState } from "react";
import { AlertTriangleIcon, HeartIcon, Loader2Icon, MapPinIcon, MessageCircleIcon, NewspaperIcon, RefreshCwIcon, VideoIcon } from "lucide-react";
import { PersonAvatar } from "@/components/account-avatar";
import { EmptyState } from "@/components/empty-state";
import { LoadMoreSentinel } from "@/components/load-more-sentinel";
import { TabToolbar } from "@/components/tab-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { UserInfoDialog, type UserRef } from "@/features/users/components/user-info-dialog";
import type { Account, FeedKind } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { FeedPicture, FeedPost } from "@/features/feed/lib/feed-view";
import { useFeed, useRestartFeed } from "@/features/feed/hooks/use-feed";

const KINDS: { kind: FeedKind; label: string }[] = [
  { kind: "Trends", label: "Phổ biến" },
  { kind: "Associate", label: "Kết bạn" },
];

const countFmt = new Intl.NumberFormat("vi-VN", { notation: "compact" });

/** Bảng tin tab: the "Gợi ý" feeds (Phổ biến, Kết bạn) as seen by a logged-in account. Read-only. */
export function FeedTab({ account }: { account: Account }) {
  const [kind, setKind] = useState<FeedKind>("Trends");
  const feed = useFeed(account.id, kind);
  const restart = useRestartFeed(account.id, kind);
  const [viewing, setViewing] = useState<UserRef | null>(null);
  const [picture, setPicture] = useState<FeedPicture | null>(null);

  // Pages can overlap when new posts arrive between requests: dedupe by key.
  const posts = useMemo(() => {
    const seen = new Set<string>();
    return (feed.data?.pages ?? []).flatMap((p) => p.posts).filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)));
  }, [feed.data]);
  const refreshing = feed.isFetching && !feed.isFetchingNextPage;

  return (
    <>
      <TabToolbar label={feed.data ? `${posts.length} bài` : undefined}>
        <div role="group" aria-label="Loại bảng tin" className="-order-1 flex gap-1">
          {KINDS.map((k) => (
            <Button
              key={k.kind}
              aria-pressed={kind === k.kind}
              variant={kind === k.kind ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setKind(k.kind)}
            >
              {k.label}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => void restart()} disabled={feed.isFetching}>
          <RefreshCwIcon className={cn(refreshing && "animate-spin")} aria-hidden />
          Làm mới
        </Button>
      </TabToolbar>

      {feed.isPending ? (
        <div className="mx-auto w-full max-w-2xl space-y-3 p-5" aria-busy="true" aria-label="Đang tải">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : feed.error && posts.length === 0 ? (
        <EmptyState
          icon={AlertTriangleIcon}
          title="Không tải được bảng tin"
          description={feed.error.message}
          action={
            <Button variant="outline" onClick={() => void restart()}>
              Thử lại
            </Button>
          }
        />
      ) : posts.length === 0 ? (
        <EmptyState icon={NewspaperIcon} title="Chưa có bài nào" description="Thử làm mới sau ít phút." />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-scroll-root>
          <ul className="mx-auto w-full max-w-2xl space-y-3 p-5">
            {posts.map((p) => (
              <PostCard key={p.key} post={p} onOpenAuthor={setViewing} onOpenPicture={setPicture} />
            ))}
          </ul>
          <div className="flex flex-col items-center gap-2 pb-6">
            <LoadMoreSentinel
              enabled={feed.hasNextPage && !feed.isFetchingNextPage && !feed.error}
              onVisible={() => void feed.fetchNextPage()}
            />
            {feed.error && <p className="text-sm text-destructive">{feed.error.message}</p>}
            {feed.hasNextPage ? (
              <Button variant="outline" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                {feed.isFetchingNextPage && <Loader2Icon className="animate-spin" aria-hidden />}
                Tải thêm
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Đã hết bảng tin</p>
            )}
          </div>
        </div>
      )}

      <UserInfoDialog accountId={account.id} user={viewing} onClose={() => setViewing(null)} />
      <PictureDialog picture={picture} onClose={() => setPicture(null)} />
    </>
  );
}

function PostCard({
  post,
  onOpenAuthor,
  onOpenPicture,
}: {
  post: FeedPost;
  onOpenAuthor: (u: UserRef) => void;
  onOpenPicture: (p: FeedPicture) => void;
}) {
  const { author } = post;
  const authorId = author.id;
  const header = (
    <>
      <div className="relative shrink-0">
        <PersonAvatar name={author.name} src={author.avatarUrl} />
        {author.online && (
          <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-success ring-2 ring-card" aria-label="Đang online" role="img" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{author.name}</p>
        <p className="truncate text-xs text-muted-foreground">{[author.meta, post.time].filter(Boolean).join(" · ")}</p>
      </div>
    </>
  );

  return (
    <li className="space-y-3 rounded-xl border bg-card p-4">
      {authorId ? (
        <button
          type="button"
          onClick={() => onOpenAuthor({ id: authorId, name: author.name })}
          className="-m-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-lg p-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`Xem hồ sơ ${author.name}`}
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-2.5">{header}</div>
      )}

      {post.content && <p className="text-sm leading-relaxed whitespace-pre-line break-words select-text">{post.content}</p>}

      {post.pictures.length > 0 && (
        <div className={cn("grid gap-1.5", post.pictures.length === 1 ? "grid-cols-1" : post.pictures.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {post.pictures.slice(0, 9).map((pic, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onOpenPicture(pic)}
              className="overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={`Xem ảnh ${i + 1}`}
            >
              <img
                src={pic.thumb}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className={cn("w-full object-cover", post.pictures.length === 1 ? "max-h-96" : "aspect-square")}
              />
            </button>
          ))}
        </div>
      )}

      {(post.hasVideo || post.tags.length > 0 || post.location) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {post.hasVideo && (
            <Badge variant="outline" className="text-[11px]">
              <VideoIcon aria-hidden />
              Video
            </Badge>
          )}
          {post.tags.map((t, i) => (
            <Badge key={i} variant="secondary" className="text-[11px]">
              #{t}
            </Badge>
          ))}
          {post.location && (
            <span className="inline-flex items-center gap-1">
              <MapPinIcon className="size-3" aria-hidden />
              {post.location}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1" aria-label={`${post.likes} lượt thích`}>
          <HeartIcon className="size-3.5" aria-hidden />
          {countFmt.format(post.likes)}
        </span>
        <span className="inline-flex items-center gap-1" aria-label={`${post.comments} bình luận`}>
          <MessageCircleIcon className="size-3.5" aria-hidden />
          {countFmt.format(post.comments)}
        </span>
      </div>
    </li>
  );
}

function PictureDialog({ picture, onClose }: { picture: FeedPicture | null; onClose: () => void }) {
  return (
    <Dialog open={picture !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-2 sm:max-w-3xl">
        <DialogTitle className="sr-only">Ảnh trong bài</DialogTitle>
        {picture && (
          <img src={picture.full} alt="" referrerPolicy="no-referrer" className="max-h-[80vh] w-full rounded-lg object-contain" />
        )}
      </DialogContent>
    </Dialog>
  );
}
