import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { optionParts, type ChatField } from "@/lib/form-fields";
import { DateField } from "@/components/ui/date-field";

/**
 * The assistant's questions, as real controls, inline in the transcript.
 *
 * Deliberately quiet: this sits inside a message bubble, not on top of it. The
 * user can fill these in or ignore them entirely and answer in the chat box —
 * so nothing here is required, and the submit button never blocks on
 * validation. Half an answer is still an answer.
 *
 * A question does not disappear once it is answered. It folds to one muted
 * line — `Answered · 2 fields` — and opens again on a click, prefilled from
 * the record, so an earlier answer can be corrected weeks later, after a
 * reload, from the transcript where it was given. Nothing here remembers
 * whether it was sent: `answered` is derived by the page from the record.
 */

const INPUT =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30";

const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40";

/** The name of the event the footer chevrons and the section menu dispatch. */
export const EXPAND_QUESTION = "expand-question";

export function ChatFormFields({
  fields,
  onSubmit,
  disabled,
  questionId,
  valueFor,
  answered = false,
  current = true,
  sectionLabel,
}: {
  fields: ChatField[];
  /** A first submit sends every filled value; a later save sends only what changed. */
  onSubmit: (values: Record<string, string>) => void;
  disabled?: boolean;
  /** Stable id; the accordion opens on an `expand-question` event carrying it. */
  questionId?: string;
  /** The recorded value for a key — the source of truth after submit and after a reload. */
  valueFor?: (key: string) => string | undefined;
  /** Derived by the page: a key has a value in the record, or an answers turn followed. */
  answered?: boolean;
  /** The last question, still open — the only one that shows Send. */
  current?: boolean;
  /** "Section 17" — what the row reads while editing. */
  sectionLabel?: string;
}) {
  const recorded = useCallback((k: string) => (valueFor?.(k) ?? "").trim(), [valueFor]);
  const fromRecord = useCallback(
    () => Object.fromEntries(fields.map((f) => [f.key, recorded(f.key) || f.value || ""])),
    [fields, recorded],
  );

  const [values, setValues] = useState<Record<string, string>>(fromRecord);
  const [open, setOpen] = useState(false);

  // The footer chevrons and the section menu land here. Read the record
  // fresh on the way in — local state is gone after a reload, and the record
  // may have moved on since this question was asked.
  useEffect(() => {
    if (!questionId) return;
    const onExpand = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== questionId) return;
      setValues(fromRecord());
      setOpen(true);
    };
    window.addEventListener(EXPAND_QUESTION, onExpand);
    return () => window.removeEventListener(EXPAND_QUESTION, onExpand);
  }, [questionId, fromRecord]);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const toggle = (k: string, v: string) =>
    setValues((p) => {
      const cur = (p[k] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      return { ...p, [k]: next.join(", ") };
    });

  const filled = Object.entries(values).filter(([, v]) => v.trim());
  const changed = Object.fromEntries(
    fields.filter((f) => (values[f.key] ?? "").trim() !== recorded(f.key)).map((f) => [f.key, (values[f.key] ?? "").trim()]),
  );
  const dirty = Object.keys(changed).length > 0;
  const live = current && !answered;

  const controls = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.key] ?? "";
        const wide = f.kind === "textarea" || f.kind === "checkbox" || (f.options?.length ?? 0) > 3;
        const id = questionId ? `${questionId}-${f.key}` : undefined;
        return (
          <div key={f.key} className={wide ? "sm:col-span-2" : undefined}>
            <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-foreground" title={f.key}>
              {f.label}
              {f.optional && <span className="ml-1 font-normal text-muted-foreground">optional</span>}
            </label>

            {f.kind === "textarea" && (
              <textarea id={id} rows={2} className={INPUT} value={v} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}

            {f.kind === "select" && (
              <select id={id} className={INPUT} value={v} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">Choose…</option>
                {f.options!.map((o) => {
                  const { value, label } = optionParts(o);
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            )}

            {f.kind === "radio" && (
              <div className="flex flex-wrap gap-1.5">
                {f.options!.map((o) => {
                  const { value, label } = optionParts(o);
                  const on = v === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => set(f.key, on ? "" : value)}
                      className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                        on ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {f.kind === "checkbox" && (
              <div className="flex flex-wrap gap-1.5">
                {f.options!.map((o) => {
                  const { value, label } = optionParts(o);
                  const on = v.split(",").map((s) => s.trim()).includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggle(f.key, value)}
                      className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                        on ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {f.kind === "date" && (
              <DateField id={id} className={INPUT} value={v} onChange={(iso) => set(f.key, iso)} placeholder={f.placeholder} />
            )}

            {!["textarea", "select", "radio", "checkbox", "date"].includes(f.kind) && (
              <input
                id={id}
                className={INPUT}
                type={f.kind === "number" || f.kind === "money" ? "text" : f.kind === "email" ? "email" : f.kind === "tel" ? "tel" : "text"}
                inputMode={f.kind === "money" || f.kind === "number" || f.kind === "ssn" || f.kind === "tel" ? "numeric" : undefined}
                // Never let a browser autofill or remember a Social Security number.
                autoComplete={f.kind === "ssn" ? "off" : undefined}
                value={v}
                placeholder={f.placeholder ?? (f.kind === "money" ? "$" : undefined)}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}

            {f.help && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{f.help}</p>}
          </div>
        );
      })}
    </div>
  );

  if (live) {
    return (
      <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
        {controls}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || !filled.length}
            onClick={() => onSubmit(Object.fromEntries(filled))}
            className={PRIMARY}
          >
            {filled.length ? `Send ${filled.length}` : "Send"}
            <ArrowRight className="h-3 w-3" />
          </button>
          <p className="text-[10px] text-muted-foreground">or just answer in the chat box — whatever is easier.</p>
        </div>
      </div>
    );
  }

  const n = fields.filter((f) => recorded(f.key)).length;
  const plural = (c: number) => `${c} field${c === 1 ? "" : "s"}`;
  const row = open
    ? `Editing · ${sectionLabel ?? "this question"}`
    : answered
      ? `Answered · ${plural(n)}`
      : `Not answered · ${plural(fields.length)}`;

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) return setOpen(false);
          setValues(fromRecord());
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        <span>{row}</span>
      </button>

      {/* The accordion: a grid row that goes 0fr → 1fr, which animates height
          without measuring it. Closed, it is also inert so nothing inside can
          take focus. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3">
            {controls}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={disabled || !dirty}
                onClick={() => {
                  onSubmit(changed);
                  setOpen(false);
                }}
                className={PRIMARY}
              >
                Save changes
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary/80"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
