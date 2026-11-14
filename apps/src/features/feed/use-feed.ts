import { useInfiniteQuery } from "@tanstack/react-query";
import { api, type FeedKind } from "@/lib/api";
import { rememberPeers } from "@/lib/peer-directory";
import { queryKeys } from "@/lib/queries";
import { nextFeedStart, toFeedView } from "./feed-view";

const PAGE_SIZE = 20; // same default as scripts/src/cli/feed.ts

export function useFeed(accountId: string | undefined, kind: FeedKind) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.lit, "feeds", accountId, kind],
    queryFn: async ({ pageParam }) => {
      const page = await api.lit.feeds(accountId!, kind, pageParam, PAGE_SIZE);
      // Authors get a name and avatar in the chat list too.
      rememberPeers(page.feeds.flatMap((f) => (f.userInfo ? [f.userInfo] : [])));
      return toFeedView(page, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (page, allPages, startPos) => {
      const seenBefore = new Set(allPages.slice(0, -1).flatMap((p) => p.posts.map((x) => x.key)));
      return nextFeedStart(page, startPos, seenBefore);
    },
    enabled: !!accountId,
    retry: false,
    staleTime: 60_000,
  });
}
