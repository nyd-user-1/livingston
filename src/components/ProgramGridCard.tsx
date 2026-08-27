import { memo } from "react";
import { ArrowUp, ClipboardList, Phone, ExternalLink, FileText } from "lucide-react";
import { setDragEntity } from "@/lib/drag-entity";
import { formEntity } from "@/components/FormCard";
import { formStats, type ProgramForm } from "@/lib/programs";

/**
 * A programme, as a card in the browse grid.
 *
 * Same shell as the paper card it replaces — same border, ground, radius and
 * minimum height — so the grid reads the same. The content is what changed:
 * a paper's card leads with a title and ends with a citation, and a
 * programme's has to answer three different questions in the two seconds
 * someone looks at it. What is this, does it apply to me, and what do I do now.
 *
 * So: the name, then the plain-language line, then the chips for what it
 * covers, then — pinned to the bottom, where the DOI used to be — the actual
 * next step. A phone number, or how long the form takes.
 */

const CATEGORY_LABEL: Record<ProgramForm["category"], string> = {
  apply: "Apply for several at once",
  food: "Food",
  health: "Health",
  energy: "Heat & utilities",
  family: "Children & family",
  money: "Cash & credits",
  older: "Older adults",
};

export const ProgramGridCard = memo(function ProgramGridCard({
  program,
  onOpen,
  onAsk,
}: {
  program: ProgramForm;
  onOpen?: () => void;
  onAsk?: () => void;
}) {
  const isForm = Boolean(program.pdf);
  const stats = formStats(program);

  return (
    <div
      draggable
      onDragStart={(e) => {
        setDragEntity(e.dataTransfer, formEntity(program));
        const r = e.currentTarget.getBoundingClientRect();
        e.dataTransfer.setDragImage(e.currentTarget, e.clientX - r.left, e.clientY - r.top);
      }}
      onClick={onOpen}
      className="group relative flex min-h-[280px] cursor-grab flex-col rounded-lg border border-border/40 bg-muted/40 p-4 pb-14 transition-all hover:border-border hover:shadow-lg active:cursor-grabbing active:border-border active:shadow-lg md:p-6 md:pb-16"
    >
      {/* Name, and whether there is a form behind it */}
      <div className="mb-1 flex items-start gap-2">
        <p className="text-base font-bold leading-snug text-foreground">{program.code}</p>
        {isForm ? (
          <ClipboardList className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" />
        )}
      </div>

      <p className="mb-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        {CATEGORY_LABEL[program.category]}
      </p>

      <p className="mb-3 text-sm font-medium leading-snug text-foreground">{program.blurb}</p>

      {program.covers.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-muted-foreground">Covers</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {program.covers.slice(0, 3).map((c) => (
              <span
                key={c}
                className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-foreground/80"
              >
                {c}
              </span>
            ))}
            {program.covers.length > 3 && (
              <span className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                +{program.covers.length - 3}
              </span>
            )}
          </div>
        </div>
      )}

      {/* What you actually do next */}
      <div className="mt-auto text-xs">
        <span className="text-muted-foreground">{isForm ? "The form" : "How to apply"}</span>
        <p className="mt-0.5 font-medium leading-snug text-foreground">
          {isForm
            ? `${program.pages} pages · ${stats.questionSections} sections · about ${program.minutes} min`
            : (program.apply?.how ?? "Ask sam how this one works.")}
        </p>
      </div>

      {/* Bottom bar: contact on the left, actions on the right */}
      <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between md:bottom-4 md:left-6">
        {program.apply?.phone ? (
          <a
            href={`tel:${program.apply.phone.replace(/[^\d+]/g, "")}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 truncate text-xs text-brand hover:underline"
          >
            <Phone className="h-3 w-3 shrink-0" />
            {program.apply.phone}
          </a>
        ) : program.apply?.url ? (
          <a
            href={program.apply.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 truncate text-xs text-brand hover:underline"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            Apply online
          </a>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            {isForm ? "Drag onto the chat to start" : " "}
          </span>
        )}

        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAsk?.();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-all hover:scale-110"
            title={isForm ? `Fill in ${program.code} with sam` : `Ask sam about ${program.code}`}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
});
