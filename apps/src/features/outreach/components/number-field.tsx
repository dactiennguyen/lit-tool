import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A number box you can actually type in. It keeps a text draft while you edit,
 * so you can clear the field or type a half-finished decimal ("2.") without the
 * value snapping back, then commits the parsed number as you go (the parent
 * clamps/floors in `onCommit`). Uses type="text" + inputMode on purpose: a
 * controlled type="number" reports a half-typed "2." as "" in Chrome and eats
 * the dot, so decimals can't be typed.
 */
export function NumberField({
  value,
  onCommit,
  decimal = false,
  disabled,
  placeholder,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  /** Allow a decimal point (for delays); otherwise digits only. */
  decimal?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  // null = not editing, show the committed value; a string = the live draft.
  const [draft, setDraft] = useState<string | null>(null);
  const allowed = decimal ? /^\d*\.?\d*$/ : /^\d*$/;
  return (
    <Input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      id={id}
      value={draft ?? String(value)}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value;
        if (!allowed.test(raw)) return; // reject letters, a second dot, etc.
        setDraft(raw);
        if (raw === "" || raw === ".") return; // nothing to commit yet
        const n = Number(raw);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setDraft(null)} // fall back to the committed (clamped) value
    />
  );
}
