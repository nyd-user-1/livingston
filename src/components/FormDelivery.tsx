import { useState } from "react";
import { Download, Mail, Send, Loader2, Check, AlertCircle } from "lucide-react";
import type { ProgramForm } from "@/lib/programs";

/**
 * What happens to the finished application.
 *
 * Three ways out, in the order a person would want them: take the file, have it
 * emailed to yourself, or have sam email it to the county for you.
 *
 * The third is doing something on someone else's behalf, so it is gated behind
 * an explicit confirmation and always copies them — they should hold a record
 * of anything sent in their name. It also says, without hedging, that most
 * districts will still want a signed original: an emailed PDF gets the
 * paperwork in front of a caseworker, it does not file the application.
 */
export function FormDelivery({
  form,
  url,
  pdfBase64,
  county,
}: {
  form: ProgramForm;
  url: string;
  pdfBase64: () => Promise<string>;
  county?: string;
}) {
  const [mode, setMode] = useState<null | "self" | "office">(null);
  const [to, setTo] = useState("");
  const [office, setOffice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(which: "self" | "office") {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        to: which === "self" ? to.trim() : office.trim(),
        cc: which === "office" ? to.trim() : undefined,
        formCode: form.code,
        formTitle: form.title,
        pdfBase64: await pdfBase64(),
        mode: which,
        county,
        confirm: which === "office" ? true : undefined,
      };
      const r = await fetch("/api/send-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Send failed (${r.status})`);
      setDone(which === "self" ? `Sent to ${d.sentTo}.` : `Sent to ${d.sentTo}, copy to you.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const INPUT =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-foreground/30";

  return (
    <div className="mt-2 rounded-lg border border-border bg-background p-3">
      <p className="text-[12px] font-medium text-foreground">Your {form.code} is ready</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        It is a draft. Read it before you file it, and fill in anything left blank.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <a
          href={url}
          download={`${form.code}-draft.pdf`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-foreground hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" />
          Download it
        </a>
        <button
          onClick={() => setMode(mode === "self" ? null : "self")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
            mode === "self" ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted"
          }`}
        >
          <Mail className="h-3.5 w-3.5" />
          Email it to me
        </button>
        <button
          onClick={() => setMode(mode === "office" ? null : "office")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
            mode === "office" ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted"
          }`}
        >
          <Send className="h-3.5 w-3.5" />
          Send it for me
        </button>
      </div>

      {mode === "self" && (
        <div className="mt-2.5 space-y-2">
          <input className={INPUT} type="email" placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
          <button
            disabled={busy || !to.trim()}
            onClick={() => send("self")}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            Send it to me
          </button>
        </div>
      )}

      {mode === "office" && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This emails the draft to the office and copies you. Most New York districts still require a signed
              original, so this puts it in front of a caseworker — it does not file the application for you.
            </span>
          </div>
          <input
            className={INPUT}
            type="email"
            placeholder="County office email"
            value={office}
            onChange={(e) => setOffice(e.target.value)}
          />
          <input className={INPUT} type="email" placeholder="Your email, for the copy" value={to} onChange={(e) => setTo(e.target.value)} />
          <button
            disabled={busy || !office.trim() || !to.trim()}
            onClick={() => send("office")}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send it on my behalf
          </button>
        </div>
      )}

      {done && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-foreground">
          <Check className="h-3.5 w-3.5" />
          {done}
        </p>
      )}
      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </div>
  );
}
