// Collects people from `home/online_users` with one or more logged-in accounts
// until a target count is reached, de-duplicated by user id. Keeps the raw
// UserProfile so the send step has each person's IM id (huanxinId).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { UserProfile } from "@/lib/lit-types";
import { rememberPeers } from "@/lib/peer-directory";
import type { StatusText } from "./outreach-view";

/** Page size per request to `home/online_users`. */
const PAGE_SIZE = 20;
/** Safety cap per account so a run never pages forever when few people are online. */
const MAX_PAGES_PER_ACCOUNT = 60;
/** Pause between page requests so collecting stays gentle on the server. */
const PAGE_PAUSE_MS = 400;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const keyOf = (u: UserProfile) => u.userId ?? u.huanxinId ?? null;

export function useCollectOnline() {
  const [found, setFound] = useState<UserProfile[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<StatusText | null>(null);
  const cancel = useRef(false);
  // The list also lives in a ref so the loop can read the running total synchronously.
  const foundRef = useRef<UserProfile[]>([]);
  const setList = (next: UserProfile[]) => {
    foundRef.current = next;
    setFound(next);
  };
  // Leaving the screen for good stops a run.
  useEffect(() => () => void (cancel.current = true), []);

  /** Adds users not seen yet (by id); returns how many were new. */
  const merge = (users: UserProfile[]): number => {
    let added = 0;
    const next = [...foundRef.current];
    const seen = new Set(next.map(keyOf));
    for (const u of users) {
      const k = keyOf(u);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      next.push(u);
      added++;
    }
    setList(next);
    return added;
  };

  const collect = useCallback(async (accountIds: string[], target: number) => {
    cancel.current = false;
    setRunning(true);
    setList([]); // each run starts a fresh list; several accounts merge into it
    const want = Math.max(1, target);
    let failed: string | null = null;
    try {
      for (const accountId of accountIds) {
        if (cancel.current || foundRef.current.length >= want) break;
        let start = 0;
        const pagedKeys = new Set<string>();
        for (let page = 0; page < MAX_PAGES_PER_ACCOUNT && !cancel.current && foundRef.current.length < want; page++) {
          setStatus({ text: `Đang lấy… ${foundRef.current.length}/${want} người`, tone: "idle" });
          let res;
          try {
            res = await api.lit.onlineUsers(accountId, start, PAGE_SIZE);
          } catch (e) {
            failed = (e as Error).message;
            break; // give up on this account, try the next one
          }
          if (res.users.length === 0) break;
          rememberPeers(res.users);
          merge(res.users);
          // Advance the cursor; stop if the server ignored start_pos (same page again).
          const keys = res.users.map(keyOf).filter((k): k is string => !!k);
          if (keys.length > 0 && keys.every((k) => pagedKeys.has(k))) break;
          keys.forEach((k) => pagedKeys.add(k));
          if (res.hasNext === false) break;
          start = res.nextStart !== null && res.nextStart > start ? res.nextStart : start + res.users.length;
          if (foundRef.current.length >= want) break;
          await sleep(PAGE_PAUSE_MS);
        }
      }
      const got = foundRef.current.length;
      setStatus(
        cancel.current
          ? { text: `Đã dừng · lấy được ${got}/${want} người`, tone: "warn" }
          : failed
            ? { text: `Lấy được ${got} người · lỗi: ${failed}`, tone: got > 0 ? "warn" : "bad" }
            : got >= want
              ? { text: `Xong · đã lấy ${got} người`, tone: "ok" }
              : { text: `Hết người đang online · chỉ lấy được ${got}/${want}`, tone: "warn" },
      );
    } finally {
      setRunning(false);
    }
  }, []);

  return {
    found,
    running,
    status,
    collect,
    stop: () => void (cancel.current = true),
    clear: () => {
      setList([]);
      setStatus(null);
    },
  };
}

export type CollectOnline = ReturnType<typeof useCollectOnline>;
