import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpDown, ChevronLeft, ChevronRight, Database, ExternalLink, FileText, Loader2, Search as SearchIcon, SlidersHorizontal, X } from "lucide-react";

/**
 * /search — the New York corpus, through Typesense.
 *
 * Instant, typo-tolerant search over every NY bill since 2009: number, title,
 * description, the sponsor's memo, and the text itself. Facets on the left
 * (session, chamber, status, committee, sponsor, party), highlighted snippets on
 * the right, and the engine's own timing in the header so the speed is a
 * measurement, not a claim. The whole state lives in the URL, so a search is a
 * link.
 */

/* ---- types --------------------------------------------------------------- */

interface Hit {
  id: string; bill_number: string; session: number; chamber: string; title: string; description: string | null;
  status: string | null; committee: string | null; sponsor: string | null; party: string | null; district: string | null;
  cosponsors: number; last_action: string | null; last_action_date: string | null; text_chars: number; url: string | null;
  highlights: Record<string, string>;
}
interface FacetValue { value: string; count: number }
interface SearchResponse {
  q: string; page: number; per_page: number; found: number; out_of: number; search_ms: number | null; round_trip_ms: number;
  hits: Hit[]; facets: Record<string, FacetValue[]>; error?: string; configured?: boolean;
}

const FACETS: { key: string; label: string }[] = [
  { key: "session", label: "Session" },
  { key: "chamber", label: "Chamber" },
  { key: "status", label: "Status" },
  { key: "committee", label: "Committee" },
  { key: "sponsor", label: "Sponsor" },
  { key: "party", label: "Party" },
];
const PER_PAGE = 20;

const SEAL: Record<string, { src: string; alt: string }> = {
  Senate: { src: "/seals/nys-senate-seal.avif", alt: "New York State Senate" },
  Assembly: { src: "/seals/nys-assembly-seal.avif", alt: "New York State Assembly" },
};

/* ---- helpers ------------------------------------------------------------- */

/** Typesense highlights arrive with <mark> tags; keep those and nothing else. */
const safeHighlight = (s: string) => s.replace(/<(?!\/?mark>)[^>]*>/g, "");
const longDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const sessionLabel = (s: number | string) => { const y = Number(s); return Number.isFinite(y) ? `${y}–${String(y + 1).slice(2)}` : String(s); };
const fmt = (n: number) => n.toLocaleString("en-US");

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/* ---- page ---------------------------------------------------------------- */

export default function BillSearch() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = params.get("sort") === "newest" ? "newest" : "relevance";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const selected = useMemo(() => Object.fromEntries(FACETS.map((f) => [f.key, params.getAll(f.key)])) as Record<string, string[]>, [params]);

  const [draft, setDraft] = useState(q);
  const debounced = useDebounced(draft, 150);
  useEffect(() => { setDraft(q); }, [q]);

  const update = useCallback((patch: Record<string, string | string[] | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
      else if (v) next.set(k, v);
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => { if (debounced !== q) update({ q: debounced || null }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    qs.set("sort", sort); qs.set("page", String(page)); qs.set("per_page", String(PER_PAGE));
    for (const f of FACETS) selected[f.key].forEach((v) => qs.append(f.key, v));
    setLoading(true);
    fetch(`/api/bills-search?${qs}`, { signal: ac.signal })
      .then(async (r) => { const j = (await r.json()) as SearchResponse; if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j; })
      .then((j) => { setData(j); setError(null); })
      .catch((e: unknown) => { if ((e as Error).name !== "AbortError") setError((e as Error).message); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [q, sort, page, selected]);

  const toggle = (key: string, value: string) => {
    const cur = selected[key];
    update({ [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] });
  };
  const activeChips = FACETS.flatMap((f) => selected[f.key].map((v) => ({ key: f.key, label: f.label, value: v })));
  const totalPages = data ? Math.max(1, Math.ceil(data.found / PER_PAGE)) : 1;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Search the New York legislature</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.out_of ? `${fmt(data.out_of)} bills` : "Every bill"} since 2009 — numbers, titles, sponsor memos, and full text.
            {data?.search_ms != null && (
              <span className="ml-2 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {data.search_ms} ms engine · {data.round_trip_ms} ms round trip
              </span>
            )}
          </p>
        </div>
        <button onClick={() => setCatalogOpen((v) => !v)} className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium ${catalogOpen ? "bg-active" : "bg-background hover:bg-muted"}`}>
          <Database className="h-4 w-4" /> What can be searched
        </button>
      </header>
      {catalogOpen && <Catalog onClose={() => setCatalogOpen(false)} />}

      {/* Search box */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") update({ q: draft || null }); if (e.key === "Escape") { setDraft(""); update({ q: null }); } }}
          placeholder="Try “lithium battery”, “S1234”, “rent stabilization”, or a sponsor’s name"
          className="h-14 w-full rounded-lg border border-input bg-background pl-12 pr-24 text-base text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          aria-label="Search bills"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {draft && (
            <button onClick={() => { setDraft(""); update({ q: null }); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear">
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => update({ sort: sort === "newest" ? null : "newest" }, false)}
            className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${sort === "newest" ? "bg-active text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            title="Sort by most recent action"
          >
            <ArrowUpDown className="h-3.5 w-3.5" /> {sort === "newest" ? "Newest" : "Relevance"}
          </button>
        </div>
      </div>

      {/* Active filters */}
      {activeChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activeChips.map((c) => (
            <button key={`${c.key}:${c.value}`} onClick={() => toggle(c.key, c.value)} className="flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-active">
              <span className="text-muted-foreground">{c.label}:</span> {c.key === "session" ? sessionLabel(c.value) : c.value} <X className="h-3 w-3" />
            </button>
          ))}
          <button onClick={() => update(Object.fromEntries(FACETS.map((f) => [f.key, null])))} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Clear all</button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
        {/* Facets */}
        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5" /> Refine</div>
          {FACETS.map((f) => {
            const values = data?.facets[f.key] ?? [];
            if (!values.length && !selected[f.key].length) return null;
            return (
              <section key={f.key}>
                <h3 className="mb-1.5 text-xs font-semibold text-foreground">{f.label}</h3>
                <ul className="space-y-0.5">
                  {values.slice(0, f.key === "session" ? 12 : 8).map((v) => {
                    const on = selected[f.key].includes(v.value);
                    return (
                      <li key={v.value}>
                        <button onClick={() => toggle(f.key, v.value)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[13px] ${on ? "bg-active font-medium text-foreground" : "text-foreground hover:bg-muted"}`}>
                          <span className="truncate">{f.key === "session" ? sessionLabel(v.value) : v.value}</span>
                          <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{fmt(v.count)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </aside>

        {/* Results */}
        <main className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between text-sm text-muted-foreground">
            <span>
              {error ? "" : data ? (data.found ? <>{fmt(data.found)} {data.found === 1 ? "bill" : "bills"}{q ? <> for <span className="font-medium text-foreground">“{q}”</span></> : ""}</> : "") : "Searching…"}
            </span>
            {data && data.found > PER_PAGE && <span>Page {page} of {fmt(totalPages)}</span>}
          </div>

          {error && (
            <div className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
              <p className="font-medium">Search is unavailable right now.</p>
              <p className="mt-1 text-muted-foreground">{error}</p>
            </div>
          )}

          {!error && data && data.found === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nothing matched. Typos are forgiven up to two letters — try fewer words, or clear a filter.
            </div>
          )}

          <ol className="space-y-3">
            {data?.hits.map((h) => <Result key={h.id} hit={h} onFacet={toggle} />)}
          </ol>

          {data && data.found > PER_PAGE && (
            <nav className="mt-6 flex items-center justify-center gap-2 text-sm">
              <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 disabled:opacity-40 hover:bg-muted">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="px-2 tabular-nums text-muted-foreground">{page} / {fmt(totalPages)}</span>
              <button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) }, false)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 disabled:opacity-40 hover:bg-muted">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </nav>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---- the catalog: everything that could be a search result --------------- */

interface CatalogEntity { key: string; label: string; what: string; count: number | null; estimate: boolean; indexed: "ny" | "all" | null; fields: string | null }
interface CatalogResponse {
  generated_at: string; totals: { bills: number; bills_with_text: number; jurisdictions: number; indexed_bills: number };
  groups: { group: string; entities: CatalogEntity[] }[];
  jurisdictions: { state: string; bills: number; first_session: number; last_session: number; bills_with_text: number }[];
}

function Catalog({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<CatalogResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/search-catalog").then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as CatalogResponse; }).then(setCat).catch((e: Error) => setErr(e.message));
  }, []);
  const total = cat ? cat.groups.flatMap((g) => g.entities).reduce((a, e) => a + (e.count ?? 0), 0) : 0;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">What can be searched</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Everything in the policy database that could become a result. <span className="font-medium text-foreground">Indexed</span> marks what the search engine covers today (New York bills, texts, memos, and sponsors); the rest is one indexing job away.
          </p>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>

      {err && <p className="mt-3 text-sm text-muted-foreground">Couldn't load the catalog: {err}</p>}
      {!cat && !err && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Counting…</p>}

      {cat && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Bills, all jurisdictions" value={fmt(cat.totals.bills)} sub={`${cat.totals.jurisdictions} legislatures · ${fmt(Math.ceil(cat.totals.bills / PER_PAGE))} pages of ${PER_PAGE}`} />
            <Stat label="Bills indexed today" value={fmt(cat.totals.indexed_bills)} sub={`New York · ${fmt(Math.ceil(cat.totals.indexed_bills / PER_PAGE))} pages`} />
            <Stat label="Bills with full text" value={fmt(cat.totals.bills_with_text)} sub="fetched from the legislatures" />
            <Stat label="Rows that could be results" value={fmt(total)} sub="across every entity below" />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {cat.groups.map((g) => (
              <div key={g.group}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</h3>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {g.entities.map((e) => (
                    <li key={e.key} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-foreground">{e.label}</span>
                          {e.indexed && <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">indexed{e.indexed === "ny" ? " · NY" : ""}</span>}
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{e.what}{e.fields ? <span className="block text-[11px] italic">{e.fields}</span> : null}</p>
                      </div>
                      <span className="shrink-0 tabular-nums text-[13px] font-medium text-foreground" title={e.estimate ? "planner estimate" : "exact count"}>
                        {e.count == null ? "—" : `${e.estimate ? "≈" : ""}${fmt(e.count)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <h3 className="mb-1.5 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jurisdictions — {cat.jurisdictions.length}</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {cat.jurisdictions.map((j) => (
              <div key={j.state} className={`flex items-baseline justify-between rounded-md px-2 py-1 text-[12px] ${j.state === "NY" ? "bg-active" : ""}`} title={`${j.first_session}–${j.last_session} · ${fmt(j.bills_with_text)} with text`}>
                <span className="font-medium text-foreground">{j.state === "US" ? "Congress" : j.state}</span>
                <span className="tabular-nums text-muted-foreground">{fmt(j.bills)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Counts as of {new Date(cat.generated_at).toLocaleString()}. ≈ marks a planner estimate on tables too large to count on every page load.</p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ---- one result ---------------------------------------------------------- */

function Result({ hit, onFacet }: { hit: Hit; onFacet: (key: string, value: string) => void }) {
  const seal = SEAL[hit.chamber];
  const title = hit.highlights.title ? safeHighlight(hit.highlights.title) : hit.title;
  const snippet = hit.highlights.memo ?? hit.highlights.description ?? hit.highlights.text ?? null;
  const snippetFrom = hit.highlights.memo ? "memo" : hit.highlights.description ? "description" : hit.highlights.text ? "text" : null;
  const fallback = hit.description && hit.description !== hit.title ? hit.description : null;

  return (
    <li className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring/60">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {seal && <img src={seal.src} alt={seal.alt} className="h-4 w-4 rounded-full object-contain" />}
        <span className="font-mono text-[13px] font-semibold text-foreground">{hit.bill_number}</span>
        <span>·</span>
        <button onClick={() => onFacet("session", String(hit.session))} className="hover:underline">{sessionLabel(hit.session)}</button>
        {hit.chamber && <><span>·</span><button onClick={() => onFacet("chamber", hit.chamber)} className="hover:underline">{hit.chamber}</button></>}
        {hit.status && <><span>·</span><button onClick={() => onFacet("status", hit.status!)} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-active">{hit.status}</button></>}
        {hit.text_chars > 0 && <span className="ml-auto flex items-center gap-1 text-[11px]" title={`${fmt(hit.text_chars)} characters of text indexed`}><FileText className="h-3 w-3" /> text</span>}
      </div>

      <h2 className="mt-1.5 text-[15px] font-medium leading-snug text-foreground [&_mark]:rounded-sm [&_mark]:bg-brand/20 [&_mark]:px-0.5 [&_mark]:text-foreground" dangerouslySetInnerHTML={{ __html: title }} />

      {snippet ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground [&_mark]:rounded-sm [&_mark]:bg-brand/20 [&_mark]:px-0.5 [&_mark]:text-foreground">
          {snippetFrom && <span className="mr-1 rounded border border-border px-1 text-[10px] uppercase tracking-wide">{snippetFrom}</span>}
          <span dangerouslySetInnerHTML={{ __html: `…${safeHighlight(snippet)}…` }} />
        </p>
      ) : fallback ? (
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{fallback}</p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Fact label="Sponsor" value={hit.sponsor ? `${hit.sponsor}${hit.party ? ` (${hit.party.charAt(0)}${hit.district ? `-${hit.district}` : ""})` : ""}` : "—"} onClick={hit.sponsor ? () => onFacet("sponsor", hit.sponsor!) : undefined} />
        <Fact label="Committee" value={hit.committee ?? "—"} onClick={hit.committee ? () => onFacet("committee", hit.committee!) : undefined} />
        <Fact label="Last action" value={hit.last_action ?? "—"} />
        <Fact label="Date" value={longDate(hit.last_action_date) || "—"} />
      </div>

      {hit.url && (
        <a href={hit.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
          Official text <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </li>
  );
}

function Fact({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const inner = <span className="block truncate text-[12px] font-medium leading-snug text-foreground" title={value}>{value}</span>;
  return (
    <div className="min-w-0">
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
      {onClick ? <button onClick={onClick} className="block w-full text-left hover:underline">{inner}</button> : inner}
    </div>
  );
}
