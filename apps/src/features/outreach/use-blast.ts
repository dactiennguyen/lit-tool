// Sends one message to each collected person, rotating through the chosen
// sender accounts, with a pause between messages. One send = api.hx.sendText
// (the same 1-1 send used by the chat composer). Every send — success or
// failure — is written to the localStorage sent log so the history reflects
// what actually happened. Stoppable at any moment, and on leaving the screen.

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canSend } from "@/features/chat/chat-view";
import type { UserProfile } from "@/lib/lit-types";
import { conversationsKey } from "@/lib/queries";
import { logSent } from "./sent-log";
import { userKey } from "./outreach-view";

/** The backend's "frame written, no ACK" error (hx.rs SendUnknown): maybe delivered. */
const isUncertainSend = (message: string) => message.includes("Không rõ tin đã gửi được chưa");

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

/** sleep(ms) that returns early as soon as `cancel.current` is set. */
function sleepUnlessCancelled(ms: number, cancel: { readonly current: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () =>
      cancel.current || Date.now() - start >= ms ? resolve() : setTimeout(tick, Math.min(150, ms));
    tick();
  });
}

export function useBlast() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<BlastProgress>(IDLE);
  const [log, setLog] = useState<BlastLogEntry[]>([]);
  const cancel = useRef(false);

  // Leaving the screen stops an in-flight run (the component unmounts, but the
  // async loop would otherwise keep sending with no visible Stop button).
  useEffect(() => () => void (cancel.current = true), []);

  const add = (entry: BlastLogEntry) => setLog((list) => [entry, ...list].slice(0, LOG_LIMIT));

  const start = async ({ senders, targets, pickText, delaySec, firstContact }: BlastJob): Promise<BlastResult> => {
    cancel.current = false;
    setRunning(true);
    setStopping(false);
    setLog([]);
    let ok = 0;
    let fail = 0;
    setProgress({ ...IDLE, total: targets.length });
    const touched = new Set<string>();
    try {
      for (let i = 0; i < targets.length; i++) {
        if (cancel.current) break;
        const user = targets[i]!;
        const sender = senders[i % senders.length]!;
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
        setProgress({ done: i, total: targets.length, ok, fail, current: { peer: name, sender: sender.label } });

        if (!to) {
          fail++;
          const note = "Người này không có IM id nên không gửi được.";
          add({ ...base, state: "fail", note });
          logSent({ ...logBase, ok: false, error: note, note: null });
        } else if (!canSend(text)) {
          // The filled template can end up empty ({tuoi} with no age) or over the
          // byte limit ({ten} with a long name); the backend would reject it, so
          // skip and log instead of sending something that cannot go through.
          fail++;
          const note = "Nội dung sau khi điền biến không gửi được (rỗng hoặc quá 4096 byte).";
          add({ ...base, state: "fail", note });
          logSent({ ...logBase, ok: false, error: note, note: null });
        } else {
          try {
            const outcome = await api.hx.sendText(sender.id, to, text, firstContact);
            touched.add(sender.id);
            ok++;
            const note = outcome.metadataError ? `Đã gửi, chưa ghi được hội thoại: ${outcome.metadataError}` : undefined;
            add({ ...base, state: "ok", note });
            logSent({ ...logBase, ok: true, error: null, note: outcome.metadataError });
          } catch (e) {
            fail++;
            const msg = (e as Error).message;
            // The backend writes the frame then waits for an ACK; an "unknown"
            // result means the message may already have been delivered. Mark it
            // contacted (not a clean failure) so a re-run holds this person
            // instead of blindly sending again, and persist it to history.
            const uncertain = isUncertainSend(msg);
            add({
              ...base,
              state: "fail",
              note: uncertain
                ? "Chưa rõ đã gửi được chưa — đã đánh dấu đã liên hệ; kiểm tra lịch sử trước khi gửi lại."
                : msg,
            });
            logSent({ ...logBase, ok: false, uncertain, error: msg, note: null });
          }
        }
        setProgress({ done: i + 1, total: targets.length, ok, fail, current: null });
        if (i < targets.length - 1 && !cancel.current) await sleepUnlessCancelled(delaySec * 1000, cancel);
      }
      return { ok, fail, stopped: cancel.current };
    } finally {
      setProgress((p) => ({ ...p, current: null }));
      setRunning(false);
      setStopping(false);
      // Refresh the conversation list of each account that actually sent.
      for (const id of touched) void qc.invalidateQueries({ queryKey: conversationsKey(id) });
    }
  };

  return {
    running,
    stopping,
    progress,
    log,
    start,
    stop: () => {
      cancel.current = true;
      setStopping(true);
    },
    clearLog: () => {
      setLog([]);
      setProgress(IDLE);
    },
  };
}
