import { useState } from "react";
import { Check, Loader2, ChevronDown } from "lucide-react";
import { answerCount, type FormAnswers } from "@/lib/form-answers";
import { displayValue, isActionKey, labelFor, type ProgramForm } from "@/lib/programs";
import { FormDelivery } from "@/components/FormDelivery";

/**
 * What the form knows so far, sitting above the input.
 *
 * The point is that nothing about this is a black box: the count is real, the
 * sections tick off as they finish, and the answers can be opened and read at
 * any time. The user can take the filled PDF the moment they want it — half
 * finished is still worth more than a blank form.
 *
 * `progress` comes from the page (formProgress in programs.ts): it counts a
 * section done when the interview has moved past it, not only when the model
 * remembered to say so, and it names the section that is open so the printed
 * number and the count stop contradicting each other.
 */
export function FormProgress({
  form,
  answers,
  progress,
}: {
  form?: ProgramForm;
  answers: FormAnswers;
  progress?: { done: number; total: number; current?: string };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!form) return null;
  const total = progress?.total ?? form.sections.filter((s) => !s.consent).length;
  const done = progress?.done ?? answers.done.length;
  const n = answerCount(answers);
  const current = progress?.current && /^\d/.test(progress.current) ? `Section ${progress.current} · ` : "";

  async function build() {
    setBusy(true);
    setErr(null);
    try {
      // pdf-lib is ~350 KB; it has no business loading until someone asks for
      // the document.
      const { fillForm } = await import("@/lib/fill-form");
      const out = await fillForm(form!, answers);
      setBytes(out);
      const blob = new Blob([out as BlobPart], { type: "application/pdf" });
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

  const entries = Object.entries(answers.values).filter(([k]) => !isActionKey(k));

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
              {current}
              {n} answer{n === 1 ? "" : "s"} · {done} of {total} sections done
            </span>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
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

        {url && bytes && (
          <FormDelivery
            form={form}
            url={url}
            county={answers.values["address.county"]}
            pdfBase64={async () => {
              // Chunked so a 2 MB form does not blow the argument limit.
              let bin = "";
              for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
              }
              return btoa(bin);
            }}
          />
        )}

        {open && (
          <dl className="mt-2 grid max-h-48 grid-cols-1 gap-x-6 gap-y-1 overflow-y-auto border-t border-border pt-2 sm:grid-cols-2">
            {entries.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/40 pb-1">
                <dt className="truncate text-[10px] text-muted-foreground" title={k}>
                  {labelFor(k)}
                </dt>
                <dd className="truncate text-right text-[11px] text-foreground" title={v}>
                  {displayValue(k, v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
