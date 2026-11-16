// App-wide UI choices remembered on this machine (zustand).

import { create } from "zustand";
import { readStored, writeStored } from "@/lib/storage";

const COLLAPSE_KEY = "sky-manager:sidebar-collapsed";

interface UiState {
  /** The sidebar is collapsed to icons. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  sidebarCollapsed: readStored(COLLAPSE_KEY, (v) => v === "1", false),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    writeStored(COLLAPSE_KEY, next ? "1" : "0");
  },
}));
