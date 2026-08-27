// The record detail, rendered inside the app-shell push panel (AppPanel).
//
// Replaces the old right-side Sheet: the panel pushes the page over instead of
// overlaying it, and it lives in AppLayout, so it survives route changes. The
// paper's title is the panel's own header — this component renders the body.
import { useEffect, useState } from "react";
import { ExternalLink, ChevronDown, Loader2, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { CorpusRecord } from "@/types/record";
import { useS2Enrichment } from "@/hooks/useS2Enrichment";

/* ------------------------------------------------------------------ *
 *  Related preprints — the CITE encoder (api/similar.ts): a document→document
 *  question, answered by the citation-trained encoder from the paper's
 *  already-stored vector, so it costs no inference.
 * ------------------------------------------------------------------ */
function RelatedPreprints({ recordKey, onOpen }: { recordKey: string; onOpen?: (key: string) => void }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [failed, setFailed] = useState(false);

  // Keyed by recordKey at the call site, so a new paper mounts a fresh list —
  // no synchronous reset-in-effect.
  useEffect(() => {
    let alive = true;
    if (!recordKey) return;
    fetch(`/api/similar?key=${encodeURIComponent(recordKey)}&limit=6`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setRows(d.records ?? []); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [recordKey]);

  if (failed || (rows && rows.length === 0)) return null;

  return (
    <div className="pt-5">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Related preprints
      </h4>
      {!rows ? (
        <p className="mt-2 text-xs text-muted-foreground">Finding related work…</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={String(r.key_number)} className="group">
              <button
                type="button"
                onClick={() => onOpen?.(String(r.key_number))}
                className="w-full text-left text-xs leading-snug text-foreground/85 group-hover:text-foreground"
              >
                <span className="link-wipe">{String(r.title)}</span>
              </button>
              <span className="text-[10px] text-muted-foreground">
                {String(r.server ?? "")}{r.pub_year ? ` · ${r.pub_year}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecordPanel({ record, onOpenRelated }: { record: CorpusRecord; onOpenRelated?: (key: string) => void }) {
  const { data: s2, isPlaceholderData } = useS2Enrichment(record.id, {
    citation_count: record.citation_count ?? null,
    abstract: record.abstract ?? null,
    s2_lookup_status: record.s2_lookup_status ?? null,
  });
  const s2Loading = !s2 && !isPlaceholderData;
  const queryClient = useQueryClient();
  const [abstractDraft, setAbstractDraft] = useState("");
  const [abstractOpen, setAbstractOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveAbstract = async () => {
    if (!abstractDraft.trim()) return;
    setSaving(true);
    await fetch(`/api/record?id=${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ abstract: abstractDraft.trim() }),
    });
    setSaving(false);
    setSaved(true);
    setAbstractDraft("");
    queryClient.invalidateQueries({ queryKey: ["s2-enrichment", record.id] });
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-0 flex-1 select-text overflow-y-auto px-4 pb-6 pt-2">
      {s2Loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!s2Loading && (
        <>
          {record.doi && (
            <div className="border-b border-border/80 py-3">
              <a
                href={`https://doi.org/${record.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                DOI: {record.doi}
              </a>
            </div>
          )}

          {/* Abstract — ten lines, then the row expands it. */}
          {s2?.abstract ? (
            <div className="py-3">
              <button
                type="button"
                onClick={() => setAbstractOpen((v) => !v)}
                className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
                aria-expanded={abstractOpen}
              >
                <span className="text-xs text-muted-foreground">Abstract</span>
                <ChevronDown
                  className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${abstractOpen ? "rotate-180" : ""}`}
                />
              </button>
              <p className={`mt-1 text-sm font-medium leading-relaxed text-foreground/80 ${abstractOpen ? "" : "line-clamp-[10]"}`}>
                {s2.abstract}
              </p>
            </div>
          ) : (
            <div className="py-3">
              <span className="mb-1 block text-xs text-muted-foreground">Abstract</span>
              <textarea
                value={abstractDraft}
                onChange={(e) => setAbstractDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && abstractDraft.trim()) {
                    e.preventDefault();
                    handleSaveAbstract();
                  }
                }}
                placeholder="Paste abstract here..."
                className="min-h-[80px] w-full resize-none rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-foreground/20"
                rows={3}
              />
              {abstractDraft.trim() && (
                <button
                  onClick={handleSaveAbstract}
                  disabled={saving}
                  className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : null}
                  {saving ? "Saving..." : saved ? "Saved" : "Save Abstract"}
                </button>
              )}
            </div>
          )}

          {record.authors && (
            <div className="py-3">
              <span className="text-xs text-muted-foreground">Authors</span>
              <p className="text-sm font-medium">{record.authors}</p>
            </div>
          )}

          <div className="py-3">
            <span className="text-xs text-muted-foreground">Year</span>
            <p className="text-sm font-medium">{record.pub_year}</p>
          </div>
        </>
      )}

      {record.key_number && (
        <RelatedPreprints key={String(record.key_number)} recordKey={String(record.key_number)} onOpen={onOpenRelated} />
      )}
    </div>
  );
}
