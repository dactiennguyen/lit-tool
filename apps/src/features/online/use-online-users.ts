import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { nextStartPos, toOnlinePage } from "./online-view";

const PAGE_SIZE = 15; // same as scripts/src/cli/home-online.ts

export function useOnlineUsers(accountId: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.lit, "online_users", accountId],
    queryFn: async ({ pageParam }) => toOnlinePage(await api.lit.onlineUsers(accountId!, pageParam, PAGE_SIZE), pageParam),
    initialPageParam: 0,
    getNextPageParam: (page, allPages, startPos) => {
      const seenBefore = new Set(allPages.slice(0, -1).flatMap((p) => p.users.map((u) => u.key)));
      return nextStartPos(page, startPos, PAGE_SIZE, seenBefore);
    },
    enabled: !!accountId,
    retry: false,
    staleTime: 30_000,
  });
}
