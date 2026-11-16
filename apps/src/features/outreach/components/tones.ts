// Accent colours of the "Lấy & gửi" steps. Each step keeps one hue, and the
// preview badges reuse it, so a number points back to the step that sets it.
// Tints and text shades are picked for 4.5:1 on cards in both themes.

export type Tone = "sky" | "violet" | "amber" | "teal" | "primary";

export const TONE: Record<Tone, { tile: string; badge: string }> = {
  sky: {
    tile: "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
    badge: "border-sky-500/25 bg-sky-500/10 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200",
  },
  violet: {
    tile: "bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    badge:
      "border-violet-500/25 bg-violet-500/10 text-violet-800 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-200",
  },
  amber: {
    tile: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
  },
  teal: {
    tile: "bg-teal-500/12 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300",
    badge: "border-teal-500/25 bg-teal-500/10 text-teal-800 dark:border-teal-400/25 dark:bg-teal-400/10 dark:text-teal-200",
  },
  primary: {
    tile: "bg-primary/12 text-primary",
    badge: "border-primary/25 bg-primary/10 text-primary",
  },
};
