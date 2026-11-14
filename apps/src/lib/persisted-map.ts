// A small Map store kept in memory and, best effort, in localStorage.
// Entries are kept in insertion order; the oldest are dropped past `max`.

import { useSyncExternalStore } from "react";

export interface PersistedMap<V> {
  get(): ReadonlyMap<string, V>;
  /** Applies `update` to a copy; saves and notifies only when it returns true (changed). */
  update(update: (draft: Map<string, V>) => boolean): void;
  /** The current map; re-renders when it changes. */
  use(): ReadonlyMap<string, V>;
}

export function persistedMap<V>(
  storageKey: string,
  isValue: (v: unknown) => v is V,
  max: number,
): PersistedMap<V> {
  let map: ReadonlyMap<string, V> = load();
  const listeners = new Set<() => void>();

  function load(): Map<string, V> {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
      if (!Array.isArray(raw)) return new Map();
      return new Map(raw.filter((e): e is [string, V] => Array.isArray(e) && typeof e[0] === "string" && isValue(e[1])));
    } catch {
      return new Map();
    }
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const get = () => map;

  return {
    get,
    update(update) {
      const next = new Map(map);
      if (!update(next)) return;
      while (next.size > max) next.delete(next.keys().next().value!);
      map = next;
      try {
        localStorage.setItem(storageKey, JSON.stringify([...map]));
      } catch {
        /* storage unavailable: memory only */
      }
      for (const l of listeners) l();
    },
    use: () => useSyncExternalStore(subscribe, get),
  };
}
