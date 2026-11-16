// Light / dark / system theme in a zustand store (a small replacement for
// next-themes: no inline <script>, which React 19 warns about and our CSP
// blocks). The class is applied before the first render in main.tsx, then on
// every change of the choice or of the system setting.

import { create } from "zustand";
import { readStored, writeStored } from "@/lib/storage";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "sky.theme";
const DEFAULT_THEME: Theme = "dark";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function readStoredTheme(): Theme {
  return readStored<Theme>(
    STORAGE_KEY,
    (v) => (v === "light" || v === "dark" || v === "system" ? v : DEFAULT_THEME),
    DEFAULT_THEME,
  );
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? (media().matches ? "dark" : "light") : theme;
}

export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

interface ThemeState {
  theme: Theme;
  /** The system is in dark mode (for "system"). */
  systemDark: boolean;
  setTheme: (theme: Theme) => void;
}

const resolved = (s: Pick<ThemeState, "theme" | "systemDark">): ResolvedTheme =>
  s.theme === "system" ? (s.systemDark ? "dark" : "light") : s.theme;

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: readStoredTheme(),
  systemDark: media().matches,
  setTheme: (theme) => {
    set({ theme });
    writeStored(STORAGE_KEY, theme);
  },
}));

media().addEventListener("change", (e) => useThemeStore.setState({ systemDark: e.matches }));
useThemeStore.subscribe((s, prev) => {
  if (resolved(s) !== resolved(prev)) applyTheme(resolved(s));
});

export function useTheme(): { theme: Theme; resolvedTheme: ResolvedTheme; setTheme: (theme: Theme) => void } {
  const theme = useThemeStore((s) => s.theme);
  const resolvedTheme = useThemeStore(resolved);
  const setTheme = useThemeStore((s) => s.setTheme);
  return { theme, resolvedTheme, setTheme };
}
