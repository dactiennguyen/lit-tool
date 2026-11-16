// Saved message templates for "Ngẫu nhiên từ mẫu" (zustand, kept in localStorage).

import { create } from "zustand";
import { readStored, writeStored } from "@/lib/storage";

const KEY = "sky-manager:outreach-templates";

function parse(raw: string): string[] {
  const v = JSON.parse(raw) as unknown;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export const useTemplateStore = create<{ templates: string[] }>(() => ({ templates: readStored(KEY, parse, []) }));

export function setTemplates(next: string[]): void {
  useTemplateStore.setState({ templates: next });
  writeStored(KEY, JSON.stringify(next));
}

/** The current templates; re-renders when they change. */
export const useTemplates = (): string[] => useTemplateStore((s) => s.templates);
