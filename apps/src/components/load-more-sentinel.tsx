import { useEffect, useRef } from "react";

/**
 * Calls `onVisible` when it scrolls within 300px of the view of its nearest
 * `[data-scroll-root]` ancestor, once per time it becomes visible while
 * `enabled`. Callers turn it off after an error (no retry loop) and keep a
 * "Tải thêm" button as the fallback.
 */
export function LoadMoreSentinel({ enabled, onVisible }: { enabled: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onVisible);
  latest.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    // Re-created after each page (enabled flips), so it fires again if still in view.
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && latest.current(), {
      root: el.closest("[data-scroll-root]"),
      rootMargin: "300px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);
  return <div ref={ref} aria-hidden className="h-px w-full" />;
}
