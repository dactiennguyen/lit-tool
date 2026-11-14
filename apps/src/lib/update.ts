// Self-update state from the backend (src-tauri/src/update.rs): read once, then
// kept current by the "update" event. Null outside Tauri or before the first read.

import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type UpdateState =
  | { state: "off"; reason: string }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "latest"; checkedAt: number }
  | { state: "downloading"; version: string; notes: string; got: number; total: number | null }
  | { state: "ready"; version: string; notes: string }
  | { state: "installing"; version: string }
  | { state: "failed"; message: string; checkedAt: number };

/** The version running, plus where the update stands. */
export type UpdateView = { current: string } & UpdateState;

let view: UpdateView | null = null;
const listeners = new Set<() => void>();
let started = false;

function publish(next: UpdateView) {
  view = next;
  for (const l of listeners) l();
}

function start() {
  if (started || !isTauri()) return;
  started = true;
  // Listen first, so no event between the read and the subscription is lost.
  void listen<UpdateView>("update", (e) => publish(e.payload)).then(() =>
    invoke<UpdateView>("update_status").then((v) => {
      if (!view) publish(v);
    }),
  );
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useUpdate = () => useSyncExternalStore(subscribe, () => view, () => null);

/** A newer version is on its way: the app is blocked until it restarts on it. */
export const isBlocking = (u: UpdateView | null) =>
  u?.state === "downloading" || u?.state === "ready" || u?.state === "installing";

export const checkUpdate = () => invoke<void>("update_check");

const MB = 1_048_576;
export const mb = (n: number) => (n / MB).toFixed(1).replace(".", ",");
