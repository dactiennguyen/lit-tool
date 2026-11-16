// The live state of the "Lấy & gửi" view, kept in a zustand store so it lives
// OUTSIDE the React tree: leaving the tab (the route unmounts) no longer wipes
// the collected list, selections, send progress or log. Collecting and sending
// run as store actions, so they also keep going in the background and you pick
// them up where they were when you come back. Nothing here is persisted to disk
// (the online list goes stale), so it resets on app restart.

import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canSend } from "@/features/chat/chat-view";
import type { UserProfile } from "@/lib/lit-types";
import { conversationsKey } from "@/lib/queries";
import { rememberPeers } from "@/lib/peer-directory";
import { isAccountLoggedIn } from "@/lib/sessions";
import { logSent } from "./sent-log";
import { liveSenders, userKey, type StatusText } from "./outreach-view";

// ---- collecting ----
const PAGE_SIZE = 20;
const MAX_PAGES_PER_ACCOUNT = 60;
const DEFAULT_PAUSE_SEC = 0.4;
const keyOf = (u: UserProfile) => u.userId ?? u.huanxinId ?? null;

// ---- sending ----
export type SendState = "ok" | "fail";

export interface BlastSender {
  id: string;
  label: string;
}

export interface BlastLogEntry {
  id: string;
  at: number;
  peerName: string;
  senderLabel: string;
  text: string;
  state: SendState;
  /** Error of a failed send, or a partial-failure note (metadata not written). */
  note?: string;
}

export interface BlastProgress {
  done: number;
  total: number;
  ok: number;
  fail: number;
  current: { peer: string; sender: string } | null;
}

export interface BlastResult {
  ok: number;
  fail: number;
  stopped: boolean;
}

export interface BlastJob {
  senders: BlastSender[];
  targets: UserProfile[];
  /** The message for one recipient (fixed or random template, variables filled). */
  pickText: (user: UserProfile) => string;
  delaySec: number;
  /** Write Litmatch "new conversation" metadata (a first-contact / bắt chuyện). */
  firstContact: boolean;
}

const IDLE: BlastProgress = { done: 0, total: 0, ok: 0, fail: 0, current: null };
const LOG_LIMIT = 1000;

/** The backend's "frame written, no ACK" error (hx.rs SendUnknown): maybe delivered. */
const isUncertainSend = (message: string) => message.includes("Không rõ tin đã gửi được chưa");

/** sleep(ms) that returns early as soon as `cancelled()` is true, so Stop is snappy. */
const sleep = (ms: number, cancelled: () => boolean) =>
  new Promise<void>((resolve) => {
    const start = Date.now();
    const tick = () => (cancelled() || Date.now() - start >= ms ? resolve() : setTimeout(tick, Math.min(150, ms)));
    tick();
  });

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// Cancellation lives outside the store: it must not trigger re-renders.
let collectCancel = false;
let blastCancel = false;

interface OutreachState {
  // collecting
  found: UserProfile[];
  collectStatus: StatusText | null;
  collecting: boolean;
  // recipient-list UI
  query: string;
  excluded: Set<string>;
  collectIds: string[];
  senderIds: string[];
  // sending
  sendLog: BlastLogEntry[];
  sendProgress: BlastProgress;
  sending: boolean;
  stopping: boolean;

  setQuery: (q: string) => void;
  toggleExcluded: (uid: string) => void;
  selectAll: () => void;
  selectNone: (keys: string[]) => void;
  setCollectIds: (ids: string[]) => void;
  setSenderIds: (ids: string[]) => void;
  /** Default the two account selections to all online, dropping ones that logged out. */
  reconcileAccounts: (onlineIds: string[]) => void;
  clearFound: () => void;

  collect: (accountIds: string[], target: number, delaySec?: number) => Promise<void>;
  stopCollect: () => void;

  startBlast: (job: BlastJob, qc: QueryClient) => Promise<BlastResult>;
  stopBlast: () => void;
  clearSendLog: () => void;
}

export const useOutreachStore = create<OutreachState>((set, get) => ({
  found: [],
  collectStatus: null,
  collecting: false,
  query: "",
  excluded: new Set(),
  collectIds: [],
  senderIds: [],
  sendLog: [],
  sendProgress: IDLE,
  sending: false,
  stopping: false,

  setQuery: (q) => set({ query: q }),
  toggleExcluded: (uid) =>
    set((s) => {
      const next = new Set(s.excluded);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return { excluded: next };
    }),
  selectAll: () => set({ excluded: new Set() }),
  selectNone: (keys) => set({ excluded: new Set(keys) }),
  setCollectIds: (ids) => set({ collectIds: ids }),
  setSenderIds: (ids) => set({ senderIds: ids }),
  reconcileAccounts: (onlineIds) =>
    set((s) => {
      const fix = (prev: string[]) => {
        const kept = prev.filter((id) => onlineIds.includes(id));
        return kept.length ? kept : onlineIds;
      };
      const patch: Partial<OutreachState> = {};
      const collectIds = fix(s.collectIds);
      if (!sameIds(collectIds, s.collectIds)) patch.collectIds = collectIds;
      const senderIds = fix(s.senderIds);
      if (!sameIds(senderIds, s.senderIds)) patch.senderIds = senderIds;
      return patch;
    }),
  clearFound: () => set({ found: [], collectStatus: null, excluded: new Set() }),

  collect: async (accountIds, target, delaySec = DEFAULT_PAUSE_SEC) => {
    collectCancel = false;
    set({ collecting: true, found: [], collectStatus: null, excluded: new Set() });
    const want = Math.max(1, target);
    const pauseMs = Math.max(0, Math.round(delaySec * 1000));
    let failed: string | null = null;
    try {
      for (const accountId of accountIds) {
        if (collectCancel || get().found.length >= want) break;
        let start = 0;
        const pagedKeys = new Set<string>();
        for (let page = 0; page < MAX_PAGES_PER_ACCOUNT && !collectCancel && get().found.length < want; page++) {
          set({ collectStatus: { text: `Đang lấy… ${get().found.length}/${want} người`, tone: "idle" } });
          let res;
          try {
            res = await api.lit.onlineUsers(accountId, start, PAGE_SIZE);
          } catch (e) {
            failed = (e as Error).message;
            break; // give up on this account, try the next one
          }
          if (res.users.length === 0) break;
          rememberPeers(res.users);
          // merge: add people not seen yet (by id)
          set((s) => {
            const next = [...s.found];
            const seen = new Set(next.map(keyOf));
            for (const u of res.users) {
              const k = keyOf(u);
              if (!k || seen.has(k)) continue;
              seen.add(k);
              next.push(u);
            }
            return { found: next };
          });
          // Advance the cursor; stop if the server ignored start_pos (same page again).
          const keys = res.users.map(keyOf).filter((k): k is string => !!k);
          if (keys.length > 0 && keys.every((k) => pagedKeys.has(k))) break;
          keys.forEach((k) => pagedKeys.add(k));
          if (res.hasNext === false) break;
          start = res.nextStart !== null && res.nextStart > start ? res.nextStart : start + res.users.length;
          if (get().found.length >= want) break;
          if (pauseMs) await sleep(pauseMs, () => collectCancel);
        }
      }
      const got = get().found.length;
      set({
        collectStatus: collectCancel
          ? { text: `Đã dừng · lấy được ${got}/${want} người`, tone: "warn" }
          : failed
            ? { text: `Lấy được ${got} người · lỗi: ${failed}`, tone: got > 0 ? "warn" : "bad" }
            : got >= want
              ? { text: `Xong · đã lấy ${got} người`, tone: "ok" }
              : { text: `Hết người đang online · chỉ lấy được ${got}/${want}`, tone: "warn" },
      });
    } finally {
      set({ collecting: false });
    }
  },
  stopCollect: () => void (collectCancel = true),

  startBlast: async ({ senders, targets, pickText, delaySec, firstContact }, qc) => {
    blastCancel = false;
    set({ sending: true, stopping: false, sendLog: [], sendProgress: { ...IDLE, total: targets.length } });
    let ok = 0;
    let fail = 0;
    let aborted = false;
    const touched = new Set<string>();
    const addLog = (entry: BlastLogEntry) => set((s) => ({ sendLog: [entry, ...s.sendLog].slice(0, LOG_LIMIT) }));
    try {
      for (let i = 0; i < targets.length; i++) {
        if (blastCancel) break;
        // Re-check every message: an account may have logged out or been unticked
        // after the run started, and the loop must not keep sending with it.
        const active = liveSenders(senders, get().senderIds, isAccountLoggedIn);
        if (active.length === 0) {
          aborted = true;
          addLog({
            id: `${Date.now()}-${i}`,
            at: Date.now(),
            peerName: "—",
            senderLabel: "—",
            text: "",
            state: "fail",
            note: "Không còn account nào đang đăng nhập & được chọn — đã dừng gửi.",
          });
          break;
        }
        const user = targets[i]!;
        const sender = active[i % active.length]!;
        const to = user.huanxinId;
        const text = pickText(user);
        const at = Date.now();
        const name = user.nickname ?? user.userId ?? "(không tên)";
        const base = { id: `${at}-${i}`, at, peerName: name, senderLabel: sender.label, text };
        const logBase = {
          sentAt: at,
          accountId: sender.id,
          accountLabel: sender.label,
          peerUid: userKey(user),
          peerImId: to ?? "",
          peerName: name,
          text,
        };
        set({ sendProgress: { done: i, total: targets.length, ok, fail, current: { peer: name, sender: sender.label } } });

        if (!to) {
          fail++;
          const note = "Người này không có IM id nên không gửi được.";
          addLog({ ...base, state: "fail", note });
          logSent({ ...logBase, ok: false, error: note, note: null });
        } else if (!canSend(text)) {
          // The filled template can end up empty ({tuoi} with no age) or over the
          // byte limit ({ten} with a long name); the backend would reject it, so
          // skip and log instead of sending something that cannot go through.
          fail++;
          const note = "Nội dung sau khi điền biến không gửi được (rỗng hoặc quá 4096 byte).";
          addLog({ ...base, state: "fail", note });
          logSent({ ...logBase, ok: false, error: note, note: null });
        } else {
          try {
            const outcome = await api.hx.sendText(sender.id, to, text, firstContact);
            touched.add(sender.id);
            ok++;
            const note = outcome.metadataError ? `Đã gửi, chưa ghi được hội thoại: ${outcome.metadataError}` : undefined;
            addLog({ ...base, state: "ok", note });
            logSent({ ...logBase, ok: true, error: null, note: outcome.metadataError });
          } catch (e) {
            fail++;
            const msg = (e as Error).message;
            // "unknown" means the frame was written but no ACK came back — the
            // message may already be delivered. Mark contacted (not a clean
            // failure) so a re-run holds this person instead of resending.
            const uncertain = isUncertainSend(msg);
            addLog({
              ...base,
              state: "fail",
              note: uncertain
                ? "Chưa rõ đã gửi được chưa — đã đánh dấu đã liên hệ; kiểm tra lịch sử trước khi gửi lại."
                : msg,
            });
            logSent({ ...logBase, ok: false, uncertain, error: msg, note: null });
          }
        }
        set({ sendProgress: { done: i + 1, total: targets.length, ok, fail, current: null } });
        if (i < targets.length - 1 && !blastCancel) await sleep(delaySec * 1000, () => blastCancel);
      }
      return { ok, fail, stopped: blastCancel || aborted };
    } finally {
      set((s) => ({ sendProgress: { ...s.sendProgress, current: null }, sending: false, stopping: false }));
      // Refresh the conversation list of each account that actually sent.
      for (const id of touched) void qc.invalidateQueries({ queryKey: conversationsKey(id) });
    }
  },
  stopBlast: () => {
    blastCancel = true;
    set({ stopping: true });
  },
  clearSendLog: () => set({ sendLog: [], sendProgress: IDLE }),
}));
