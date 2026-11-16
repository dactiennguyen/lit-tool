import type { RefObject } from "react";
import { TEMPLATE_VARS } from "@/features/outreach/lib/outreach-view";

/**
 * Inserts `token` at the caret of a textarea (or appends when there is no live
 * caret), and returns the new text plus where the caret should land. The caller
 * writes the text, then restores the caret.
 */
export function insertAt(el: HTMLTextAreaElement | null, current: string, token: string): { text: string; caret: number } {
  const start = el && el.selectionStart != null ? el.selectionStart : current.length;
  const end = el && el.selectionEnd != null ? el.selectionEnd : current.length;
  return { text: current.slice(0, start) + token + current.slice(end), caret: start + token.length };
}

/** A row of chips that drop a {variable} into the message at the caret. */
export function TemplateVarBar({
  textareaRef,
  value,
  onChange,
  disabled,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const insert = (token: string) => {
    const el = textareaRef.current;
    const { text, caret } = insertAt(el, value, token);
    onChange(text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted-foreground">Chèn:</span>
      {TEMPLATE_VARS.map((v) => (
        <button
          key={v.token}
          type="button"
          disabled={disabled}
          title={`${v.label} — ${v.token}`}
          onClick={() => insert(v.token)}
          className="rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {v.token}
        </button>
      ))}
    </div>
  );
}
