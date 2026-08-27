import { FileText, GripVertical } from "lucide-react";
import { SHELL_CLS } from "@/components/WidgetCard";
import { setDragEntity, type DragEntity } from "@/lib/drag-entity";
import { buildFormInterview, formStats, type ProgramForm } from "@/lib/programs";

/**
 * A form, as a card you can pick up.
 *
 * Same shell as the paper cards it replaces, so the rail reads the same. The
 * whole card is the drag unit: dropping it on the chat input turns the
 * conversation into that form's interface (see describeEntity in
 * lib/drag-entity).
 */
export function formEntity(f: ProgramForm): DragEntity {
  return {
    type: "form",
    id: f.id,
    label: f.code,
    title: f.title,
    sub: `${f.pages} pages`,
    // The interview rides with the drag, so the drop needs no fetch.
    context: buildFormInterview(f),
  };
}

export function FormCard({ form, onOpen }: { form: ProgramForm; onOpen?: () => void }) {
  const stats = formStats(form);
  return (
    <div
      className={`${SHELL_CLS} cursor-grab active:cursor-grabbing`}
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
        <span className="truncate text-xs font-semibold text-foreground">{form.code}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{form.minutes} min</span>
      </div>

      <div className="px-3 py-3">
        <div className="flex items-start gap-2">
          <p className="text-[13px] font-medium leading-snug text-foreground">{form.blurb}</p>
          <FileText className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {form.covers.slice(0, 4).map((c) => (
            <span
              key={c}
              className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-foreground/80"
            >
              {c}
            </span>
          ))}
          {form.covers.length > 4 && (
            <span className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] text-muted-foreground">
              +{form.covers.length - 4}
            </span>
          )}
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          {form.pages} pages · {stats.questionSections} sections to fill · {stats.readingPages} pages to read
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Drag onto the chat to fill it in together.</p>
      </div>
    </div>
  );
}
