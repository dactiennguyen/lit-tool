import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, type FeedKind } from "@/lib/api";
import { rememberPeers } from "@/stores/peer-directory";
import { queryKeys } from "@/lib/queries";
import { nextFeedStart, toFeedView } from "@/features/feed/lib/feed-view";

const PAGE_SIZE = 20; // same default as scripts/src/cli/feed.ts

const feedKey = (accountId: string | undefined, kind: FeedKind) => [...queryKeys.lit, "feeds", accountId, kind];

export function useFeed(accountId: string | undefined, kind: FeedKind) {
  return useInfiniteQuery({
    queryKey: feedKey(accountId, kind),
    queryFn: async ({ pageParam }) => {
      const page = await api.lit.feeds(accountId!, kind, pageParam, PAGE_SIZE);
      // Authors get a name and avatar in the chat list too.
      rememberPeers(page.feeds.flatMap((f) => (f.userInfo ? [f.userInfo] : [])));
      return toFeedView(page, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (page, allPages) => {
      const seenBefore = new Set(allPages.slice(0, -1).flatMap((p) => p.posts.map((x) => x.key)));
      return nextFeedStart(page, seenBefore);
    },
    enabled: !!accountId,
    retry: false,
    staleTime: 60_000,
    // Recommendations differ on every request: refetching would re-request every
    // loaded page and swap the posts under the reader. "Làm mới" starts over instead.
    refetchOnWindowFocus: false,
  });
}

/** Back to a fresh first page of the feed (not a refetch of every loaded page). */
export function useRestartFeed(accountId: string | undefined, kind: FeedKind) {
  const qc = useQueryClient();
  return () => qc.resetQueries({ queryKey: feedKey(accountId, kind) });
}
