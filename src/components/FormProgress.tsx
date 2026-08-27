import { useState } from "react";
import { Download, Check, Loader2, ChevronDown } from "lucide-react";
import { answerCount, type FormAnswers } from "@/lib/form-answers";
import type { ProgramForm } from "@/lib/programs";

/**
 * What the form knows so far, sitting above the input.
 *
 * The point is that nothing about this is a black box: the count is real, the
 * sections tick off as they finish, and the answers can be opened and read at
 * any time. The user can take the filled PDF the moment they want it — half
 * finished is still worth more than a blank form.
 */
export function FormProgress({ form, answers }: { form?: ProgramForm; answers: FormAnswers }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!form) return null;
  const total = form.sections.filter((s) => !s.consent).length;
  const done = answers.done.length;
  const n = answerCount(answers);

  async function build() {
    setBusy(true);
    setErr(null);
    try {
      // pdf-lib is ~350 KB; it has no business loading until someone asks for
      // the document.
      const { fillForm } = await import("@/lib/fill-form");
      const bytes = await fillForm(form!, answers);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 items-center gap-1.5 rounded hover:text-foreground"
          >
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
            <span className="truncate">
              {n} answer{n === 1 ? "" : "s"} recorded · {done} of {total} sections
            </span>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {url && (
              <a
                href={url}
                download={`${form.code}-draft.pdf`}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-brand hover:bg-muted"
              >
                <Download className="h-3 w-3" />
                Download draft
              </a>
            )}
            <button
              onClick={build}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {url ? "Rebuild" : "Put it on the form"}
            </button>
          </div>
        </div>

        {err && <p className="mt-1.5 text-[11px] text-destructive">{err}</p>}

        {open && (
          <dl className="mt-2 grid max-h-48 grid-cols-1 gap-x-6 gap-y-1 overflow-y-auto border-t border-border pt-2 sm:grid-cols-2">
            {Object.entries(answers.values).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/40 pb-1">
                <dt className="truncate font-mono text-[10px] text-muted-foreground">{k}</dt>
                <dd className="truncate text-right text-[11px] text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
