import { TexText } from "./TexText";
import { useState, useRef, useEffect } from "react";
import { ThumbsUp, ThumbsDown, Copy, Check, BookOpen, ExternalLink, GraduationCap, FileText, ShieldCheck, SquareMenu, ChevronUp, ChevronDown } from "lucide-react";
import { subjectTitle } from "@/lib/subjects";
import { toast } from "sonner";
import type { MessageSources } from "@/hooks/useChat";
import { usePaperLookup } from "@/hooks/usePaperLookup";
import { TextSearch } from "@/components/icons/TextSearch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Moving between the questions of a form interview — the footer of every
 * assistant turn that carries a fields block gets a section menu and
 * up/down chevrons. Up is the previous question, down the next one that
 * exists; from question 1 you can walk down to the one you are on. Down is
 * muted only at the last question, because there is nothing after it yet.
 */
export interface FormNavSection {
  n: string;
  label: string;
  state: "done" | "progress" | "none";
  /** The first question asked in this section; absent until one has been. */
  firstId?: string;
}
export interface FormNav {
  prevId?: string;
  nextId?: string;
  sections: FormNavSection[];
  onJump: (id: string) => void;
}

const ICON =
  "inline-flex items-center justify-center h-7 w-7 rounded-[3px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors";
const ICON_MUTED = `${ICON} cursor-default text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40`;

function FormNavButtons({ nav }: { nav: FormNav }) {
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={ICON} title="Sections" aria-label="Form sections">
            <SquareMenu className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-64 p-1">
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sections</p>
          {nav.sections.map((s) => {
            const clickable = s.state !== "none" && Boolean(s.firstId);
            return (
              <button
                key={s.n}
                type="button"
                disabled={!clickable}
                onClick={() => s.firstId && nav.onJump(s.firstId)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors ${
                  clickable ? "text-foreground hover:bg-muted" : "cursor-default text-muted-foreground/60"
                }`}
              >
                <span className={`w-3 shrink-0 text-center ${s.state === "done" ? "text-green-600 dark:text-green-500" : ""}`} aria-hidden>
                  {s.state === "done" ? "✓" : s.state === "progress" ? "●" : "○"}
                </span>
                <span className="truncate">{s.label}</span>
                <span className="sr-only">{s.state === "done" ? "done" : s.state === "progress" ? "in progress" : "not started"}</span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-disabled={!nav.prevId}
        onClick={() => nav.prevId && nav.onJump(nav.prevId)}
        className={nav.prevId ? ICON : ICON_MUTED}
        title={nav.prevId ? "Previous question" : "This is the first question"}
        aria-label="Previous question"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-disabled={!nav.nextId}
        onClick={() => nav.nextId && nav.onJump(nav.nextId)}
        className={nav.nextId ? ICON : ICON_MUTED}
        title={nav.nextId ? "Next question" : "No next question yet"}
        aria-label="Next question"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </>
  );
}

interface SimilarRecord {
  key_number: string;
  title: string | null;
  doi: string | null;
  server: string | null;
  categories: string[] | null;
}

/** Related preprints from /api/similar (the CITE encoder, zero inference): the footer
 *  suggests the next papers and subjects, so one click re-scopes the user without
 *  them ever seeing a filter. */
function RelatedFooter({ sourceKey }: { sourceKey: string }) {
  const [related, setRelated] = useState<SimilarRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/similar?key=${encodeURIComponent(sourceKey)}&limit=4`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        setRelated((d?.records as SimilarRecord[]) ?? []);
        // These arrive a beat after the answer finishes streaming, so they grow
        // the transcript below the last auto-scroll and the row ends up clipped
        // behind the composer — the one control that re-scopes the user, out of
        // reach. Tell the page so it can re-pin, but only if the reader is
        // still at the bottom (see Chat.tsx).
        window.dispatchEvent(new Event("followups-rendered"));
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  if (!related?.length) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Keep reading
      </p>
      <div className="flex flex-col items-start gap-1.5">
        {related.map((r) => (
          <div key={r.key_number} className="group flex w-full items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            <a
              href={r.doi ? `https://doi.org/${r.doi}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-left text-[13.5px] text-foreground"
            >
              <span className="link-wipe max-w-full truncate align-bottom">
                <TexText text={r.title ?? r.key_number} />
              </span>
            </a>
            {(r.categories ?? []).slice(0, 1).map((cat) => (
              <span key={cat} className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                {subjectTitle(cat)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Bedrock's contextual-grounding check (api/grounding.ts).
 *
 *  NOT RENDERED right now, and the reason is worth keeping. The score is well
 *  behaved on factual claims — 0.96 for a claim drawn from a paper, 0.88 for a
 *  multi-sentence factual answer, 0.00 for one with invented FDA approval — but
 *  it measures VERBATIM support, and our commonest question ("what is the
 *  significance of this research?") asks for interpretive synthesis that is by
 *  definition not verbatim in any source. That answer scored 0.04 while being
 *  perfectly sound, and "4% grounded" on a good answer is a worse lie than no
 *  badge at all. Re-enable it when it is either (a) restricted to factual
 *  questions, or (b) calibrated against human judgement on a real sample. */
export function GroundingBadge({
  content,
  sources,
  query,
}: {
  content: string;
  sources?: MessageSources;
  query?: string;
}) {
  const [score, setScore] = useState<{ grounding: number | null; ok: boolean } | null>(null);
  const keys = (sources?.nsr ?? []).map((r) => r.key_number).join(",");

  useEffect(() => {
    // The guardrail requires all three parts — source, query, answer.
    if (!content || !keys || !query) return;
    let cancelled = false;
    fetch("/api/grounding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: content, keys: keys.split(","), query }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && typeof d?.grounding === "number") setScore({ grounding: d.grounding, ok: d.ok });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [content, keys, query]);

  if (!score) return null;
  const pct = Math.round(score.grounding! * 100);
  return (
    <span
      className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        score.ok ? "text-muted-foreground" : "border-destructive/40 text-destructive"
      }`}
      title={
        score.ok
          ? `Bedrock contextual-grounding check: ${pct}% of this answer is supported by the retrieved preprints.`
          : `Only ${pct}% of this answer is supported by the retrieved preprints — read it with care.`
      }
    >
      <ShieldCheck className="h-3 w-3" />
      {pct}% grounded
    </span>
  );
}

interface ChatResponseFooterProps {
  content: string;
  isStreaming?: boolean;
  sources?: MessageSources;
  pdfUrl?: string;
  query?: string;
  /** Set on form-interview questions only: the section menu and chevrons. */
  formNav?: FormNav;
}

export function ChatResponseFooter({
  content,
  isStreaming = false,
  sources,
  pdfUrl,
  formNav,
  // `query` stays on the props (callers pass it) but is unread while the
  // grounding badge is withheld — see GroundingBadge above.
}: ChatResponseFooterProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [abstractOpen, setAbstractOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const abstractRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  const { data: paperData } = usePaperLookup(pdfUrl);

  // Preprints resolve through /api/pdf, which returns the canonical PDF URL plus a
  // Google-viewer URL — the same technique the sibling `policy` project uses for bill
  // PDFs. We never fetch the PDF ourselves: bioRxiv/medRxiv sit behind bot protection
  // that answers any non-browser client with 429, so a server-side proxy cannot work.
  // Google's fetcher is not blocked, and its viewer is frameable.
  const [resolvedPdf, setResolvedPdf] = useState<{ url: string; viewerUrl: string } | null>(null);
  const isPreprintRef = Boolean(pdfUrl && pdfUrl.startsWith("/api/pdf"));
  const preprintPdf = isPreprintRef ? resolvedPdf : null;

  useEffect(() => {
    if (!isPreprintRef || !pdfUrl) return;
    let cancelled = false;
    fetch(pdfUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setResolvedPdf(d?.viewerUrl ? { url: d.url, viewerUrl: d.viewerUrl } : null);
      })
      .catch(() => {
        if (!cancelled) setResolvedPdf(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, isPreprintRef]);

  // What the iframe loads.
  const frameUrl =
    preprintPdf?.viewerUrl ??
    paperData?.openAccessPdfUrl ??
    (pdfUrl && !isPreprintRef && pdfUrl.toLowerCase().endsWith(".pdf") ? pdfUrl : undefined);
  // What "Open in new tab" points at — the real PDF, never the viewer wrapper.
  const effectivePdfUrl =
    preprintPdf?.url ??
    paperData?.openAccessPdfUrl ??
    (pdfUrl && !isPreprintRef && pdfUrl.toLowerCase().endsWith(".pdf") ? pdfUrl : undefined);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  if (isStreaming) return null;

  const totalCount = sources
    ? sources.nsr.length + sources.s2.length
    : 0;

  return (
    // 24px between whatever came last (prose, a fields card) and the rule; it
    // used to sit flush. Prose ends flush too (last paragraph drops its margin).
    <div className="mt-6 pt-3 border-t animate-in fade-in duration-300">
      <div className="flex items-center gap-1">
        {/* Sources (Book icon) */}
        {totalCount > 0 && (
          <button
            onClick={() => {
              setSourcesOpen(!sourcesOpen);
              if (!sourcesOpen) {
                setTimeout(() => sourcesRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
              }
            }}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-[3px] transition-colors ${
              sourcesOpen
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title={`${totalCount} source${totalCount !== 1 ? "s" : ""}`}
          >
            <BookOpen className="h-4 w-4" />
          </button>
        )}

        {/* Abstract (TextSearch icon) — visible when S2 paper data is available */}
        {paperData && (
          <button
            onClick={() => {
              setAbstractOpen(!abstractOpen);
              if (!abstractOpen) {
                setTimeout(() => abstractRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
              }
            }}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-[3px] transition-colors ${
              abstractOpen
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="View abstract"
          >
            <TextSearch className="h-4 w-4" />
          </button>
        )}

        {/* PDF viewer */}
        {effectivePdfUrl && (
          <button
            onClick={() => {
              setPdfOpen(!pdfOpen);
              if (!pdfOpen) {
                setTimeout(() => pdfRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
              }
            }}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-[3px] transition-colors ${
              pdfOpen
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="View PDF"
          >
            <FileText className="h-4 w-4" />
          </button>
        )}

        {/* Copy */}
        <button
          onClick={handleCopy}
          className="inline-flex items-center justify-center h-7 w-7 rounded-[3px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Copy response"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>

        {/* Form interview: sections menu, previous / next question */}
        {formNav && <FormNavButtons nav={formNav} />}

        {/* Thumbs Up / Down */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setFeedback(feedback === "good" ? null : "good")}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-[3px] transition-colors ${
              feedback === "good"
                ? "text-green-600 hover:text-green-600 hover:bg-green-500/10 dark:text-green-500"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Good response"
          >
            <ThumbsUp className="h-4 w-4" />
          </button>
          <button
            onClick={() => setFeedback(feedback === "bad" ? null : "bad")}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-[3px] transition-colors ${
              feedback === "bad"
                ? "text-red-500 hover:text-red-500 hover:bg-red-500/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Bad response"
          >
            <ThumbsDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Room honesty: when in-room retrieval was sparse the search widened to
          the whole corpus — the UI says so, matching what the prompt told the
          generator. A silent widen would make the room chip a lie. */}
      {sources?.room?.widened && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Few matches inside the {sources.room.category} room — this answer also draws on the wider corpus.
        </p>
      )}

      {/* Sources dropdown */}
      {sourcesOpen && sources && (
        <div ref={sourcesRef} className="mt-2 border rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="px-3 py-2 space-y-3">
            {/* Corpus records (the wire key is still `nsr` — see types/chat.ts) */}
            {sources.nsr.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  Preprints
                  {(sources.fulltext?.length ?? 0) > 0 && (
                    <span className="normal-case font-normal tracking-normal">
                      · full text read for {sources.fulltext!.length}
                    </span>
                  )}
                </p>
                <div className="space-y-1.5">
                  {sources.nsr.map((r) => {
                    const href = r.doi
                      ? `https://doi.org/${r.doi}`
                      : undefined;
                    const Row = href ? "a" : "div";
                    return (
                      <Row
                        key={r.key_number}
                        {...(href
                          ? {
                              href,
                              target: "_blank",
                              rel: "noopener noreferrer",
                            }
                          : {})}
                        className="flex items-start gap-2 text-xs rounded-md bg-muted/30 px-2.5 py-1.5 transition-colors hover:bg-muted/60 cursor-pointer"
                      >
                        <span className="font-mono font-bold text-foreground shrink-0">
                          {r.key_number}
                        </span>
                        <span className="text-muted-foreground truncate flex-1">
                          <TexText text={r.title} />
                        </span>
                        {r.fulltext && (
                          <span
                            className="shrink-0 rounded-full border border-brand/30 bg-brand/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-brand"
                            title="The full text of this paper was fetched and read for this answer"
                          >
                            full text
                          </span>
                        )}
                        {href && (
                          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                        )}
                      </Row>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Semantic Scholar Papers */}
            {sources.s2.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <GraduationCap className="h-3 w-3" />
                  Semantic Scholar
                </p>
                <div className="space-y-1.5">
                  {sources.s2.map((p, i) => {
                    const Row = p.url ? "a" : "div";
                    return (
                      <Row
                        key={i}
                        {...(p.url
                          ? {
                              href: p.url,
                              target: "_blank",
                              rel: "noopener noreferrer",
                            }
                          : {})}
                        className="flex items-start gap-2 text-xs rounded-md bg-muted/30 px-2.5 py-1.5 transition-colors hover:bg-muted/60 cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-foreground font-medium line-clamp-1">
                            <TexText text={p.title} />
                          </span>
                          <span className="text-muted-foreground block truncate">
                            {p.authors} &middot; {p.citations} citations
                          </span>
                        </div>
                        {p.url && (
                          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/70 mt-0.5" />
                        )}
                      </Row>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Abstract panel */}
      {abstractOpen && paperData && (
        <div ref={abstractRef} className="mt-2 border rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="px-3 py-2 bg-muted/40 border-b">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {paperData.title && (
                  <p className="text-sm font-semibold text-foreground leading-snug">
                    <TexText text={paperData.title} />
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                  {paperData.authors.length > 0 && (
                    <span>{paperData.authors.join(", ")}</span>
                  )}
                  {paperData.year && <span>&middot; {paperData.year}</span>}
                  {paperData.venue && <span>&middot; {paperData.venue}</span>}
                  {paperData.citationCount != null && (
                    <span>&middot; {paperData.citationCount} citations</span>
                  )}
                </div>
              </div>
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  Open DOI
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          {paperData.abstract && (
            <div className="px-3 py-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {paperData.abstract}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Inline PDF viewer */}
      {pdfOpen && frameUrl && (
        <div ref={pdfRef} className="mt-2 border rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              {preprintPdf ? "Preprint PDF" : paperData ? "Paper PDF" : "Report PDF"}
            </span>
            <a
              href={effectivePdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Open in new tab
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <iframe
            src={preprintPdf ? frameUrl! : `${frameUrl}#navpanes=0&view=FitH`}
            title={preprintPdf ? "Preprint PDF" : paperData ? "Paper PDF" : "Report PDF"}
            className="w-full h-[50vh] md:h-[600px] bg-background"
          />
        </div>
      )}

      {/* Follow-ups: the doc-similarity model suggests the next papers/rooms */}
      {sources?.nsr?.[0]?.key_number && (
        <RelatedFooter sourceKey={sources.nsr[0].key_number} />
      )}
    </div>
  );
}
