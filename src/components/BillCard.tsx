import { ExternalLink, GripVertical } from "lucide-react";
import { SHELL_CLS } from "@/components/WidgetCard";
import { billEntity, setDragEntity } from "@/lib/drag-entity";
import type { Bill } from "@/types/bill";

/**
 * A New York State bill, as a card you can pick up — the forms rail's shell
 * (grip header, fixed-height body, the tilt) with policy's bill card inside
 * it: the chamber seal and print number, the title, then the key facts in a
 * two-column grid — Sponsor · Status · Last Action Date · Last Action ·
 * Session. Dropping it on the chat attaches the bill as context.
 */

const longDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const SEAL: Record<string, { src: string; alt: string }> = {
  senate: { src: "/seals/nys-senate-seal.avif", alt: "New York State Senate" },
  assembly: { src: "/seals/nys-assembly-seal.avif", alt: "New York State Assembly" },
};

/** One labelled fact, policy's way: the label muted above, the value below. */
function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
      <p className="truncate text-[12px] font-medium leading-snug text-foreground" title={value}>
        {value || "—"}
      </p>
    </div>
  );
}

export function BillCard({ bill, onOpen }: { bill: Bill; onOpen?: () => void }) {
  const seal = SEAL[bill.chamber];
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
        {seal && <img src={seal.src} alt={seal.alt} className="h-4 w-4 shrink-0 rounded-full object-contain" />}
        <span className="truncate text-xs font-semibold text-foreground" title={`${bill.printNo}, ${bill.session} session`}>
          {bill.printNo}
        </span>
        <a
          href={bill.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${bill.printNo} on nysenate.gov`}
          title="Open on nysenate.gov"
          className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="flex h-[212px] flex-col px-3 py-3">
        <p className="line-clamp-3 text-[13px] leading-snug text-muted-foreground">{bill.title}</p>
        <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-2">
          <Fact label="Sponsor" value={bill.sponsor} />
          <Fact label="Status" value={bill.status} />
          <Fact label="Last Action Date" value={longDate(bill.actionDate)} />
          <Fact label="Last Action" value={bill.status} />
          <Fact label="Session" value={String(bill.session)} />
          {bill.committee && <Fact label="Committee" value={bill.committee} />}
        </div>
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
          {bill.actionDate ? ` (${longDate(bill.actionDate)})` : ""}
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
