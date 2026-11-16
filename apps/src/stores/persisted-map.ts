// A small Map in a zustand store, saved best effort to localStorage
// (`storageKey` null = memory only). Entries are kept in insertion order; the
// oldest are dropped past `max`.

import { createStore, useStore, type StoreApi } from "zustand";
import { readStored, writeStored } from "@/lib/storage";

export interface PersistedMap<V> {
  get(): ReadonlyMap<string, V>;
  /** Applies `update` to a copy; saves and notifies only when it returns true (changed). */
  update(update: (draft: Map<string, V>) => boolean): void;
  /** The current map; re-renders when it changes. */
  use(): ReadonlyMap<string, V>;
  /** The zustand store itself. */
  store: StoreApi<{ map: ReadonlyMap<string, V> }>;
}

export function persistedMap<V>(
  storageKey: string | null,
  isValue: (v: unknown) => v is V,
  max: number,
): PersistedMap<V> {
  const load = (): Map<string, V> => {
    if (storageKey === null) return new Map();
    return readStored(
      storageKey,
      (raw) => {
        const v = JSON.parse(raw) as unknown;
        if (!Array.isArray(v)) return new Map<string, V>();
        return new Map(v.filter((e): e is [string, V] => Array.isArray(e) && typeof e[0] === "string" && isValue(e[1])));
      },
      new Map<string, V>(),
    );
  };
  const store = createStore<{ map: ReadonlyMap<string, V> }>(() => ({ map: load() }));
  const get = () => store.getState().map;
  const select = (s: { map: ReadonlyMap<string, V> }) => s.map;

  return {
    get,
    update(update) {
      const next = new Map(get());
      if (!update(next)) return;
      while (next.size > max) next.delete(next.keys().next().value!);
      store.setState({ map: next });
      if (storageKey !== null) writeStored(storageKey, JSON.stringify([...next]));
    },
    use: () => useStore(store, select),
    store,
  };
}
