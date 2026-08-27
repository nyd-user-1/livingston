import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { optionParts, type ChatField } from "@/lib/form-fields";

/**
 * The assistant's questions, as real controls, inline in the transcript.
 *
 * Deliberately quiet: this sits inside a message bubble, not on top of it. The
 * user can fill these in or ignore them entirely and answer in the chat box —
 * so nothing here is required, and the submit button never blocks on
 * validation. Half an answer is still an answer.
 */

const INPUT =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30";

export function ChatFormFields({
  fields,
  onSubmit,
  disabled,
}: {
  fields: ChatField[];
  onSubmit: (values: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.value).map((f) => [f.key, f.value!])),
  );
  const [sent, setSent] = useState(false);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const toggle = (k: string, v: string) =>
    setValues((p) => {
      const cur = (p[k] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      return { ...p, [k]: next.join(", ") };
    });

  const filled = Object.entries(values).filter(([, v]) => v.trim());

  if (sent) {
    return (
      <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        <Check className="mr-1.5 inline h-3 w-3" />
        Sent {filled.length} answer{filled.length === 1 ? "" : "s"}.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const v = values[f.key] ?? "";
          const wide = f.kind === "textarea" || f.kind === "checkbox" || (f.options?.length ?? 0) > 3;
          return (
            <div key={f.key} className={wide ? "sm:col-span-2" : undefined}>
              <label className="mb-1 block text-[11px] font-medium text-foreground">
                {f.label}
                {f.optional && <span className="ml-1 font-normal text-muted-foreground">optional</span>}
              </label>

              {f.kind === "textarea" && (
                <textarea rows={2} className={INPUT} value={v} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              )}

              {f.kind === "select" && (
                <select className={INPUT} value={v} onChange={(e) => set(f.key, e.target.value)}>
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

              {!["textarea", "select", "radio", "checkbox"].includes(f.kind) && (
                <input
                  className={INPUT}
                  type={f.kind === "date" ? "date" : f.kind === "number" || f.kind === "money" ? "text" : f.kind === "email" ? "email" : f.kind === "tel" ? "tel" : "text"}
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

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || !filled.length}
          onClick={() => {
            setSent(true);
            onSubmit(Object.fromEntries(filled));
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          {filled.length ? `Send ${filled.length}` : "Send"}
          <ArrowRight className="h-3 w-3" />
        </button>
        <p className="text-[10px] text-muted-foreground">or just answer in the chat box — whatever is easier.</p>
      </div>
    </div>
  );
}
