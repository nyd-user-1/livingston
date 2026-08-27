import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The app's tooltip surface — the recipe the chart tooltips already use, in
 * theme tokens rather than hex, so it is correct in light and dark with no
 * per-theme special case. One definition; `Search.tsx`'s chart tooltips import
 * it too.
 */
export const TOOLTIP_SURFACE =
  "rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground shadow";

/**
 * Hover/focus label for an icon button.
 *
 * The bubble is **portaled to `document.body`** and positioned from the
 * trigger's rect. An in-flow bubble is clipped by any ancestor that scrolls or
 * hides overflow — which is what happened to the top bar's icons, whose labels
 * were sliced off by the header's own edge. Out here nothing can crop it.
 *
 * That means the reveal is state, not `group-hover`: a portaled node is not a
 * DOM descendant of the trigger, so no CSS selector reaches it.
 *
 * Give the trigger an `aria-label`; the bubble is `aria-hidden` so a screen
 * reader hears the label once rather than twice.
 */
export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  /** Which side of the trigger the bubble sits on. Default `top`. */
  side?: "top" | "bottom";
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    setAt({
      top: side === "bottom" ? r.bottom + 6 : r.top - 6,
      left: r.left + r.width / 2,
    });
  }, [side]);
  const hide = useCallback(() => setAt(null), []);

  return (
    <span
      ref={anchor}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      // focus/blur bubble in React, so a keyboard tab onto the button shows it.
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {at &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            aria-hidden
            className={`pointer-events-none fixed z-[300] whitespace-nowrap ${TOOLTIP_SURFACE}`}
            style={{
              top: at.top,
              left: at.left,
              transform: side === "bottom" ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
