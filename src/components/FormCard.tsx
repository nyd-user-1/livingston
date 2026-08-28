import { useLayoutEffect, useRef } from "react";
import { FileText, GripVertical } from "lucide-react";
import { SHELL_CLS } from "@/components/WidgetCard";
import { setDragEntity } from "@/lib/drag-entity";
import { formEntity } from "@/lib/form-entity";
import type { ProgramForm } from "@/lib/programs";

/**
 * A form, as a card you can pick up.
 *
 * Same shell as the paper cards it replaces, so the rail reads the same. The
 * whole card is the drag unit: dropping it on the chat input turns the
 * conversation into that form's interface (see describeEntity in
 * lib/drag-entity).
 *
 * Every card is the same height by construction: the body is a fixed-height
 * column — a blurb clamped to three lines at the top, the chips pinned to
 * the bottom, and whatever is left between them as air (48px at the least).
 * The chips fit two lines; the rest fold into `+N`, measured, not sliced.
 */

const CHIP = "inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-foreground/80";

/**
 * As many chips as fit on two lines, then `+N`. Measured in the DOM, and
 * settled in the DOM: every chip is rendered, then the layout effect hides
 * from the end until nothing (the +N included) sits on a third row. No
 * state, so no render loop; re-run when the rail's width changes.
 */
function CoverChips({ covers }: { covers: string[] }) {
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
      const line = chips[0].offsetHeight + 4; // the gap
      const row = (c: HTMLElement) => Math.round((c.offsetTop - top) / line);
      let shown = chips.length;
      const overflows = () => [...chips.slice(0, shown), ...(shown < chips.length ? [more] : [])].some((c) => row(c) > 1);
      while (shown > 0 && overflows()) {
        shown -= 1;
        chips[shown].style.display = "none";
        more.style.display = "";
        more.textContent = `+${chips.length - shown}`;
        more.title = covers.slice(shown).join(", ");
      }
    };

    fit();
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      // Width only — hiding chips changes the height, and reacting to that
      // would loop.
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [covers]);

  return (
    <div ref={ref} className="flex max-h-[52px] flex-wrap gap-1 overflow-hidden">
      {covers.map((c) => (
        <span key={c} data-chip className={CHIP}>
          {c}
        </span>
      ))}
      <span data-more className={`${CHIP} text-muted-foreground`} style={{ display: "none" }} />
    </div>
  );
}

export function FormCard({ form, onOpen }: { form: ProgramForm; onOpen?: () => void }) {
  return (
    <div
      // The tilt says "pick me up": counter-clockwise, a touch of lift, and
      // above its neighbours while it is up. Stays while grabbing.
      className={`${SHELL_CLS} cursor-grab bg-background transition-[transform,box-shadow] duration-200 ease-out hover:z-10 hover:-rotate-6 hover:scale-[1.02] hover:shadow-lg active:cursor-grabbing motion-reduce:transform-none motion-reduce:transition-none`}
      draggable
      onDragStart={(e) => {
        setDragEntity(e.dataTransfer, formEntity(form));
        // Pin the drag image to the card itself — otherwise Chrome composites
        // its own snapshot onto a padded backing plate.
        const r = e.currentTarget.getBoundingClientRect();
        e.dataTransfer.setDragImage(e.currentTarget, e.clientX - r.left, e.clientY - r.top);
      }}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 select-none">
        <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-label="drag" />
        <span className="truncate text-xs font-semibold text-foreground" title={form.code}>
          {form.name}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{form.minutes} min</span>
      </div>

      <div className="flex h-[174px] flex-col px-3 py-3">
        <div className="flex items-start gap-2">
          <p className="line-clamp-3 text-[13px] font-medium leading-snug text-foreground">{form.blurb}</p>
          <FileText className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="min-h-12 flex-1" />
        <CoverChips covers={form.covers} />
      </div>
    </div>
  );
}
