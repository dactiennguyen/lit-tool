// Saved message templates for "Ngẫu nhiên từ mẫu", kept in localStorage.

import { useSyncExternalStore } from "react";

const KEY = "sky-manager:outreach-templates";

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let templates: string[] = load();
const listeners = new Set<() => void>();

export function setTemplates(next: string[]): void {
  templates = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: memory only */
  }
  for (const l of listeners) l();
}

/** The current templates; re-renders when they change. */
export function useTemplates(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => templates,
  );
}
