import { useLayoutEffect, useRef } from "react";
import { ExternalLink, FileText, GripVertical } from "lucide-react";
import { SHELL_CLS } from "@/components/WidgetCard";
import { billEntity, setDragEntity } from "@/lib/drag-entity";
import type { Bill } from "@/types/bill";

/**
 * A New York State bill, as a card you can pick up — the forms rail's card,
 * with a bill in it. Same shell, same fixed-height body (title clamped to
 * three lines, chips pinned to the bottom, two lines then `+N`), same tilt.
 * Dropping it on the chat attaches the bill as context.
 */

const CHIP = "inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-foreground/80";

const shortDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** As many chips as fit on two lines, then `+N` — settled in the DOM, no state. */
function Chips({ items }: { items: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chips = [...el.querySelectorAll<HTMLElement>("[data-chip]")];
    const more = el.querySelector<HTMLElement>("[data-more]");
    if (!chips.length || !more) return;

    const fit = () => {
      chips.forEach((c) => (c.style.display = ""));
      more.style.display = "none";
      const top = chips[0].offsetTop;
      const line = chips[0].offsetHeight + 4;
      const row = (c: HTMLElement) => Math.round((c.offsetTop - top) / line);
      let shown = chips.length;
      const overflows = () => [...chips.slice(0, shown), ...(shown < chips.length ? [more] : [])].some((c) => row(c) > 1);
      while (shown > 0 && overflows()) {
        shown -= 1;
        chips[shown].style.display = "none";
        more.style.display = "";
        more.textContent = `+${chips.length - shown}`;
        more.title = items.slice(shown).join(", ");
      }
    };

    fit();
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  return (
    <div ref={ref} className="flex max-h-[52px] flex-wrap gap-1 overflow-hidden">
      {items.map((c) => (
        <span key={c} data-chip className={CHIP}>
          {c}
        </span>
      ))}
      <span data-more className={`${CHIP} text-muted-foreground`} style={{ display: "none" }} />
    </div>
  );
}

/** What a bill's chips say: who, where, and where it stands. */
function billChips(b: Bill): string[] {
  return [
    b.sponsor,
    b.chamber === "senate" ? "Senate" : b.chamber === "assembly" ? "Assembly" : "",
    b.committee,
    b.status,
    b.signed ? "Signed" : "",
  ].filter((s, i, a) => s && a.indexOf(s) === i);
}

export function BillCard({ bill, onOpen }: { bill: Bill; onOpen?: () => void }) {
  return (
    <div
      className={`${SHELL_CLS} cursor-grab bg-background transition-[transform,box-shadow] duration-200 ease-out hover:z-10 hover:-rotate-6 hover:scale-[1.02] hover:shadow-lg active:cursor-grabbing motion-reduce:transform-none motion-reduce:transition-none`}
      draggable
      onDragStart={(e) => {
        setDragEntity(e.dataTransfer, billEntity(bill));
        const r = e.currentTarget.getBoundingClientRect();
        e.dataTransfer.setDragImage(e.currentTarget, e.clientX - r.left, e.clientY - r.top);
      }}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 select-none">
        <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-label="drag" />
        <span className="truncate text-xs font-semibold text-foreground" title={`${bill.printNo}, ${bill.session} session`}>
          {bill.printNo}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground" title={bill.actionDate ? `Last action ${bill.actionDate.slice(0, 10)}` : undefined}>
          {shortDate(bill.actionDate) || bill.session}
        </span>
      </div>

      <div className="flex h-[174px] flex-col px-3 py-3">
        <div className="flex items-start gap-2">
          <p className="line-clamp-3 text-[13px] font-medium leading-snug text-foreground">{bill.title}</p>
          <a
            href={bill.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open ${bill.printNo} on nysenate.gov`}
            title="Open on nysenate.gov"
            className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileText className="h-4 w-4" />
          </a>
        </div>
        <div className="min-h-12 flex-1" />
        <Chips items={billChips(bill)} />
      </div>
    </div>
  );
}

/** The panel behind a card: the whole summary, and the way to the bill itself. */
export function BillDetail({ bill }: { bill: Bill }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="font-medium text-foreground">{bill.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {bill.printNo} · {bill.session} session{bill.chamber ? ` · ${bill.chamber === "senate" ? "Senate" : "Assembly"}` : ""}
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Where it stands</p>
        <p className="mt-1 text-xs text-foreground">
          {bill.status || "No status recorded"}
          {bill.committee ? ` — ${bill.committee}` : ""}
          {bill.actionDate ? ` (${bill.actionDate.slice(0, 10)})` : ""}
        </p>
        {bill.sponsor && <p className="mt-1.5 text-xs text-foreground">Sponsor: {bill.sponsor}</p>}
        {bill.signed && <p className="mt-1.5 text-xs font-medium text-foreground">Signed into law.</p>}
      </div>

      {bill.summary && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground">{bill.summary}</p>
        </div>
      )}

      <a
        href={bill.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-brand hover:bg-muted"
      >
        Open on nysenate.gov
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
