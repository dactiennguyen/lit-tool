// Self-update state from the backend (src-tauri/src/update.rs), in a zustand
// store: read once, then kept current by the "update" event. Null outside
// Tauri or before the first read.

import { useEffect } from "react";
import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type UpdateState =
  | { state: "off"; reason: string }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "latest"; checkedAt: number }
  | { state: "available"; version: string; notes: string }
  | { state: "downloading"; version: string; notes: string; got: number; total: number | null }
  | { state: "ready"; version: string; notes: string }
  | { state: "installing"; version: string }
  | { state: "failed"; message: string; checkedAt: number };

/** The version running, plus where the update stands. */
export type UpdateView = { current: string } & UpdateState;

export const useUpdateStore = create<{ view: UpdateView | null }>(() => ({ view: null }));
let started = false;

const publish = (view: UpdateView) => useUpdateStore.setState({ view });

function start() {
  if (started || !isTauri()) return;
  started = true;
  // Listen first, so no event between the read and the subscription is lost.
  void listen<UpdateView>("update", (e) => publish(e.payload)).then(() =>
    invoke<UpdateView>("update_status").then((v) => {
      if (!useUpdateStore.getState().view) publish(v);
    }),
  );
}

export function useUpdate(): UpdateView | null {
  useEffect(start, []);
  return useUpdateStore((s) => s.view);
}

/** A newer version is on its way: the app is blocked until it restarts on it. */
export const isBlocking = (u: UpdateView | null) =>
  u?.state === "downloading" || u?.state === "ready" || u?.state === "installing";

export const checkUpdate = () => invoke<void>("update_check");

/** Downloads and installs the offered version (state "available"); the app opens again on it. */
export const installUpdate = () => invoke<void>("update_install");

const MB = 1_048_576;
export const mb = (n: number) => (n / MB).toFixed(1).replace(".", ",");
