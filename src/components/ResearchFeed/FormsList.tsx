import { useAppPanel } from "@/hooks/useAppPanel";
import { FormCard } from "@/components/FormCard";
import { FORMS, formStats, type ProgramForm } from "@/lib/programs";

/**
 * The forms rail. Same construction as the Papers rail — a column of cards you
 * can pick up — but each card is an application rather than a preprint, and
 * dropping one on the chat starts filling it.
 */
function FormDetail({ form }: { form: ProgramForm }) {
  const stats = formStats(form);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="font-medium text-foreground">{form.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {form.agency} · rev. {form.revision}
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Applies for</p>
        <ul className="mt-1.5 space-y-1">
          {form.covers.map((c) => (
            <li key={c} className="text-xs text-foreground">
              {c}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        {form.pages} pages. {stats.questionSections} sections ask you something; {stats.readingPages} pages are
        notices to read, with nothing to fill in.
      </p>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sections</p>
        <ol className="mt-1.5 space-y-1.5">
          {form.sections.map((s) => (
            <li key={s.n} className="text-xs">
              <span className="font-medium text-foreground">
                {s.n === "notices" || s.n === "withdraw" || s.n === "vote" ? "" : `${s.n}. `}
                {s.title}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · p.{s.pages.join(", ")}
                {s.consent ? " · read only" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <a
        href={form.pdf}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs text-brand hover:bg-muted"
      >
        Open the blank form
      </a>
    </div>
  );
}

export function FormsList() {
  const { openPanel } = useAppPanel();

  return (
    <div className="flex flex-col gap-3 px-3 pb-3 pt-2">
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Drag one onto the chat and sam will fill it in with you, one section at a time.
      </p>
      {FORMS.map((f) => (
        <FormCard
          key={f.id}
          form={f}
          onOpen={() => openPanel({ title: f.code, content: <FormDetail form={f} /> })}
        />
      ))}
    </div>
  );
}
