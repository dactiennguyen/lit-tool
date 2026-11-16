import { useState } from "react";
import { cn } from "@/lib/utils";

/** Texts longer than this, or with line breaks, start collapsed. */
const LONG = 90;

/**
 * A sent message: two lines at most until clicked, then in full (line breaks
 * kept). Short texts show as they are, with nothing to click.
 */
export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG || text.includes("\n");
  if (!long) return <p className={cn("break-words whitespace-pre-wrap", className)}>{text}</p>;
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className={cn(
        "block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className={cn("block break-words whitespace-pre-wrap", !open && "line-clamp-2")}>{text}</span>
      <span className="mt-0.5 block text-[11px] font-medium text-primary">{open ? "Thu gọn" : "Xem đầy đủ"}</span>
    </button>
  );
}
