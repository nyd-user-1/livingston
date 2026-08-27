import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X, Columns2, Columns3, ArrowUpRight, ArrowLeft, ArrowRight } from "lucide-react";

/**
 * The right-hand "push" panel — ported from 44b (`src/components/AppPanel.tsx`).
 * It portals into `#app-panel-root` in AppLayout, beside the page wrapper, so it
 * pushes the page content over and survives route changes. Open it from
 * anywhere with `useAppPanel().openPanel({...})` (see hooks/useAppPanel).
 * Design tokens swapped for the app's (background / border / muted).
 */
export function AppPanel({
  root,
  resetKey,
  open,
  onClose,
  title,
  footer,
  children,
  defaultExpanded,
  bodyClass,
  detailHref,
  prevHref,
  nextHref,
  onPrev,
  onNext,
}: {
  /** the `#app-panel-root` element (AppLayout owns it via ref) */
  root: Element | null;
  /** changes on each openPanel() — resets the inner state without remounting the animated wrapper */
  resetKey?: number;
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  bodyClass?: string;
  detailHref?: string;
  prevHref?: string;
  nextHref?: string;
  /** index-based navigation (the record list): callbacks instead of hrefs */
  onPrev?: () => void;
  onNext?: () => void;
}) {
  if (!root) return null;
  return createPortal(
    <PanelFrame resetKey={resetKey} open={open} onClose={onClose} title={title} footer={footer} defaultExpanded={defaultExpanded} bodyClass={bodyClass} detailHref={detailHref} prevHref={prevHref} nextHref={nextHref} onPrev={onPrev} onNext={onNext}>
      {children}
    </PanelFrame>,
    root,
  );
}

/**
 * The animated width wrapper stays mounted across opens (so the push eases in
 * and out); the header/body inside re-keys per open to reset expand state.
 * Width is driven by classes on the always-present wrapper — that is what
 * transitions; the page wrapper is flex-1 and follows it.
 */
function PanelFrame({ resetKey, open, onClose, title, footer, children, defaultExpanded, bodyClass, detailHref, prevHref, nextHref, onPrev, onNext }: {
  resetKey?: number; open: boolean; onClose: () => void; title: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode;
  defaultExpanded?: boolean; bodyClass?: string; detailHref?: string; prevHref?: string; nextHref?: string;
  onPrev?: () => void; onNext?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  // Reset expand state per open WITHOUT remounting (React's "adjust state during render" pattern),
  // so the width wrapper persists and the push animates in and out.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setExpanded(defaultExpanded ?? false);
  }
  const w = expanded ? "md:w-[50vw]" : "md:w-[423px]";
  const iconBtn = "shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors";
  return (
    <div className={`shrink-0 transition-[width,margin] duration-300 ease-in-out overflow-hidden ${open ? `w-full ${w} md:ml-4` : "w-0 md:ml-0"}`}>
      {open && (
        <div className={`relative h-full w-full ${w} md:rounded-xl md:border bg-background flex flex-col overflow-hidden`}>
          <div className="flex items-center gap-1 border-b px-4 py-2 shrink-0">
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">{title}</span>
              {detailHref && (
                <Link to={detailHref} className={iconBtn} aria-label="Open detail page"><ArrowUpRight className="h-4 w-4" /></Link>
              )}
            </div>
            {prevHref && <Link to={prevHref} className={iconBtn} aria-label="Previous"><ArrowLeft className="h-4 w-4" /></Link>}
            {nextHref && <Link to={nextHref} className={iconBtn} aria-label="Next"><ArrowRight className="h-4 w-4" /></Link>}
            {onPrev && <button onClick={onPrev} className={iconBtn} aria-label="Previous"><ArrowLeft className="h-4 w-4" /></button>}
            {onNext && <button onClick={onNext} className={iconBtn} aria-label="Next"><ArrowRight className="h-4 w-4" /></button>}
            <button onClick={() => setExpanded((v) => !v)} className={iconBtn} aria-label={expanded ? "Collapse" : "Expand"}>
              {expanded ? <Columns3 className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
            </button>
            <button onClick={onClose} className={iconBtn} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className={`flex-1 min-h-0 overflow-y-auto ${bodyClass ?? ""}`}>{children}</div>
          {footer && <div className="shrink-0 border-t">{footer}</div>}
        </div>
      )}
    </div>
  );
}
