import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, Loader2, Search as SearchIcon, SlidersHorizontal, X } from "lucide-react";

/**
 * /search — legislation, through Typesense.
 *
 * The left column IS the search configuration: which jurisdictions, which
 * sessions, chambers, statuses, committees, sponsors and parties; which fields
 * the words are matched against (title, number, description, memo, CRS
 * summary, sponsor, committee, full text); only-with-text; sort. Every value
 * shows its live count for the current query, the long lists are searchable,
 * and the whole configuration lives in the URL so a search is a link.
 */

/* ---- types --------------------------------------------------------------- */

interface Hit {
  id: string; state: string; bill_number: string; session: number; chamber: string; title: string; description: string | null;
  status: string | null; committee: string | null; sponsor: string | null; party: string | null; district: string | null;
  cosponsors: number; last_action: string | null; last_action_date: string | null; text_chars: number; url: string | null;
  highlights: Record<string, string>;
}
interface FacetValue { value: string; count: number }
interface SearchResponse {
  q: string; in: string[]; page: number; per_page: number; found: number; out_of: number; search_ms: number | null; round_trip_ms: number;
  hits: Hit[]; facets: Record<string, FacetValue[]>; error?: string;
}

const FACETS: { key: string; label: string; searchable?: boolean; show: number }[] = [
  { key: "state", label: "Jurisdiction", searchable: true, show: 12 },
  { key: "session", label: "Session", show: 10 },
  { key: "chamber", label: "Chamber", show: 6 },
  { key: "status", label: "Status", show: 10 },
  { key: "committee", label: "Committee", searchable: true, show: 8 },
  { key: "sponsor", label: "Sponsor", searchable: true, show: 8 },
  { key: "party", label: "Party", show: 6 },
];
const SEARCH_IN: { key: string; label: string; hint: string }[] = [
  { key: "title", label: "Title", hint: "the bill's title" },
  { key: "number", label: "Bill number", hint: "S1234 or S01234" },
  { key: "description", label: "Description", hint: "the legislature's summary" },
  { key: "memo", label: "Sponsor memo", hint: "New York's justification memo" },
  { key: "crs", label: "CRS summary", hint: "Congressional Research Service" },
  { key: "sponsor", label: "Sponsor name", hint: "" },
  { key: "committee", label: "Committee name", hint: "" },
  { key: "text", label: "Full text", hint: "the bill as published" },
];
const PER_PAGE = 20;
const STATE_NAMES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", US: "Congress" };

const SEAL: Record<string, { src: string; alt: string }> = {
  "NY:Senate": { src: "/seals/nys-senate-seal.avif", alt: "New York State Senate" },
  "NY:Assembly": { src: "/seals/nys-assembly-seal.avif", alt: "New York State Assembly" },
};

/* ---- helpers ------------------------------------------------------------- */

const safeHighlight = (s: string) => s.replace(/<(?!\/?mark>)[^>]*>/g, "");
const longDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const sessionLabel = (s: number | string, state?: string) => {
  const y = Number(s);
  if (!Number.isFinite(y)) return String(s);
  if (state === "US") return `${Math.floor((y - 1789) / 2) + 1}th Congress (${y}–${String(y + 1).slice(2)})`;
  return `${y}–${String(y + 1).slice(2)}`;
};
const fmt = (n: number) => n.toLocaleString("en-US");
const labelFor = (key: string, value: string) => (key === "state" ? STATE_NAMES[value] ?? value : key === "session" ? sessionLabel(value) : value);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/* ---- page ---------------------------------------------------------------- */

export default function BillSearch() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = ["newest", "oldest"].includes(params.get("sort") ?? "") ? (params.get("sort") as string) : "relevance";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const hasText = params.get("has_text") === "1";
  const inFields = useMemo(() => params.getAll("in").filter((f) => SEARCH_IN.some((s) => s.key === f)), [params]);
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

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const buildQuery = useCallback((extra?: Record<string, string>) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    qs.set("sort", sort); qs.set("page", String(page)); qs.set("per_page", String(PER_PAGE));
    if (hasText) qs.set("has_text", "1");
    inFields.forEach((f) => qs.append("in", f));
    for (const f of FACETS) selected[f.key].forEach((v) => qs.append(f.key, v));
    for (const [k, v] of Object.entries(extra ?? {})) qs.set(k, v);
    return qs;
  }, [q, sort, page, hasText, inFields, selected]);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    setLoading(true);
    fetch(`/api/bills-search?${buildQuery()}`, { signal: ac.signal })
      .then(async (r) => { const j = (await r.json()) as SearchResponse; if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j; })
      .then((j) => { setData(j); setError(null); })
      .catch((e: unknown) => { if ((e as Error).name !== "AbortError") setError((e as Error).message); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [buildQuery]);

  const toggle = (key: string, value: string) => {
    const cur = selected[key];
    update({ [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] });
  };
  const toggleIn = (key: string) => {
    const cur = inFields.length ? inFields : SEARCH_IN.map((s) => s.key);
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    update({ in: next.length === SEARCH_IN.length || next.length === 0 ? null : next });
  };
  const activeIn = inFields.length ? inFields : SEARCH_IN.map((s) => s.key);
  const activeChips = FACETS.flatMap((f) => selected[f.key].map((v) => ({ key: f.key, label: f.label, value: v })));
  const totalPages = data ? Math.max(1, Math.ceil(data.found / PER_PAGE)) : 1;
  const clearAll = () => update({ ...Object.fromEntries(FACETS.map((f) => [f.key, null])), in: null, has_text: null, sort: null });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Search legislation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data ? `${fmt(data.out_of)} bills indexed` : "Bills"} — configure what you search on the left.
          {data?.search_ms != null && (
            <span className="ml-2 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
              {data.search_ms} ms engine · {data.round_trip_ms} ms round trip
            </span>
          )}
        </p>
      </header>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") update({ q: draft || null }); if (e.key === "Escape") { setDraft(""); update({ q: null }); } }}
          placeholder="Search bills — words, a bill number, a sponsor…"
          className="h-14 w-full rounded-lg border border-input bg-background pl-12 pr-12 text-base text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          aria-label="Search bills"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {draft && <button onClick={() => { setDraft(""); update({ q: null }); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      {(activeChips.length > 0 || inFields.length > 0 || hasText) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activeChips.map((c) => (
            <Chip key={`${c.key}:${c.value}`} onClick={() => toggle(c.key, c.value)}><span className="text-muted-foreground">{c.label}:</span> {labelFor(c.key, c.value)}</Chip>
          ))}
          {inFields.length > 0 && <Chip onClick={() => update({ in: null })}><span className="text-muted-foreground">Search in:</span> {inFields.map((k) => SEARCH_IN.find((s) => s.key === k)?.label ?? k).join(", ")}</Chip>}
          {hasText && <Chip onClick={() => update({ has_text: null })}>Has full text</Chip>}
          <button onClick={clearAll} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Reset</button>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        {/* ---- the configuration panel ---- */}
        <aside className="space-y-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:self-start lg:pr-2">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" /> Search configuration</span>
          </div>

          <Section title="Search in" sub={`${activeIn.length} of ${SEARCH_IN.length} fields`}>
            <ul className="space-y-0.5">
              {SEARCH_IN.map((s) => {
                const on = activeIn.includes(s.key);
                return (
                  <li key={s.key}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted">
                      <input type="checkbox" checked={on} onChange={() => toggleIn(s.key)} className="h-3.5 w-3.5 accent-[color:var(--color-brand)]" />
                      <span className={on ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
                      {s.hint && <span className="ml-auto truncate text-[11px] text-muted-foreground">{s.hint}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Sort">
            <div className="flex gap-1">
              {(["relevance", "newest", "oldest"] as const).map((s) => (
                <button key={s} onClick={() => update({ sort: s === "relevance" ? null : s }, false)} className={`flex-1 rounded-md border px-2 py-1 text-[12px] capitalize ${sort === s ? "border-ring bg-active font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>{s}</button>
              ))}
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted">
              <input type="checkbox" checked={hasText} onChange={() => update({ has_text: hasText ? null : "1" })} className="h-3.5 w-3.5 accent-[color:var(--color-brand)]" />
              <span className="text-foreground">Only bills with full text</span>
            </label>
          </Section>

          {FACETS.map((f) => (
            <FacetSection key={f.key} facet={f} values={data?.facets[f.key] ?? []} selected={selected[f.key]} onToggle={(v) => toggle(f.key, v)} onSearch={f.searchable ? async (term) => {
              const r = await fetch(`/api/bills-search?${buildQuery({ facet_q: `${f.key}:${term}`, per_page: "0" })}`);
              const j = (await r.json()) as SearchResponse;
              return j.facets?.[f.key] ?? [];
            } : undefined} />
          ))}
        </aside>

        {/* ---- results ---- */}
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
              Nothing matched. Typos are forgiven up to two letters — try fewer words, widen “Search in”, or clear a filter.
            </div>
          )}

          <ol className="space-y-3">
            {data?.hits.map((h) => <Result key={h.id} hit={h} onFacet={toggle} />)}
          </ol>

          {data && data.found > PER_PAGE && (
            <nav className="mt-6 flex items-center justify-center gap-2 text-sm">
              <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
              <span className="px-2 tabular-nums text-muted-foreground">{page} / {fmt(totalPages)}</span>
              <button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) }, false)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
            </nav>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---- panel pieces -------------------------------------------------------- */

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-active">
      {children} <X className="h-3 w-3" />
    </button>
  );
}

function FacetSection({ facet, values, selected, onToggle, onSearch }: {
  facet: { key: string; label: string; searchable?: boolean; show: number };
  values: FacetValue[]; selected: string[]; onToggle: (v: string) => void;
  onSearch?: (term: string) => Promise<FacetValue[]>;
}) {
  const [term, setTerm] = useState("");
  // The facet-value search result is keyed by the term it answered, so a stale answer
  // never shows for a newer (or emptied) term and no state is set synchronously in the effect.
  const [answer, setAnswer] = useState<{ term: string; values: FacetValue[] } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const debounced = useDebounced(term, 200).trim();
  useEffect(() => {
    if (!onSearch || !debounced) return;
    let live = true;
    onSearch(debounced).then((v) => { if (live) setAnswer({ term: debounced, values: v }); }).catch(() => { if (live) setAnswer({ term: debounced, values: [] }); });
    return () => { live = false; };
  }, [debounced, onSearch]);
  const found = debounced && answer?.term === debounced ? answer.values : null;

  const base = found ?? values;
  // Selected values first (even if they fell out of the top counts), then the rest.
  const rows = [...selected.filter((s) => !base.some((v) => v.value === s)).map((s) => ({ value: s, count: 0 })), ...base];
  const visible = expanded || found ? rows : rows.slice(0, facet.show);
  if (!rows.length && !selected.length) return null;

  return (
    <Section title={facet.label} sub={selected.length ? `${selected.length} selected` : undefined}>
      {facet.searchable && (
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Find a ${facet.label.toLowerCase()}…`} className="mb-1.5 h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
      )}
      <ul className="space-y-0.5">
        {visible.map((v) => {
          const on = selected.includes(v.value);
          return (
            <li key={v.value}>
              <label className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] ${on ? "bg-active" : "hover:bg-muted"}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(v.value)} className="h-3.5 w-3.5 accent-[color:var(--color-brand)]" />
                <span className={`truncate ${on ? "font-medium text-foreground" : "text-foreground"}`} title={labelFor(facet.key, v.value)}>{labelFor(facet.key, v.value)}</span>
                <span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted-foreground">{v.count ? fmt(v.count) : ""}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {!found && rows.length > facet.show && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-1 flex items-center gap-1 px-2 text-[12px] text-muted-foreground hover:text-foreground">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} /> {expanded ? "Show fewer" : `Show all ${fmt(rows.length)}`}
        </button>
      )}
    </Section>
  );
}

/* ---- one result ---------------------------------------------------------- */

function Result({ hit, onFacet }: { hit: Hit; onFacet: (key: string, value: string) => void }) {
  const seal = SEAL[`${hit.state}:${hit.chamber}`];
  const title = hit.highlights.title ? safeHighlight(hit.highlights.title) : hit.title;
  const order: [string, string][] = [["memo", "memo"], ["crs", "CRS summary"], ["description", "description"], ["text", "text"]];
  const snip = order.find(([k]) => hit.highlights[k]);
  const fallback = hit.description && hit.description !== hit.title ? hit.description : null;

  return (
    <li className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring/60">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {seal && <img src={seal.src} alt={seal.alt} className="h-4 w-4 rounded-full object-contain" />}
        <button onClick={() => onFacet("state", hit.state)} className="font-medium text-foreground hover:underline">{STATE_NAMES[hit.state] ?? hit.state}</button>
        <span>·</span>
        <span className="font-mono text-[13px] font-semibold text-foreground">{hit.bill_number}</span>
        <span>·</span>
        <button onClick={() => onFacet("session", String(hit.session))} className="hover:underline">{sessionLabel(hit.session, hit.state)}</button>
        {hit.chamber && <><span>·</span><button onClick={() => onFacet("chamber", hit.chamber)} className="hover:underline">{hit.chamber}</button></>}
        {hit.status && <button onClick={() => onFacet("status", hit.status!)} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-active">{hit.status}</button>}
        {hit.text_chars > 0 && <span className="ml-auto flex items-center gap-1 text-[11px]" title={`${fmt(hit.text_chars)} characters of text`}><FileText className="h-3 w-3" /> text</span>}
      </div>

      <h2 className="mt-1.5 text-[15px] font-medium leading-snug text-foreground [&_mark]:rounded-sm [&_mark]:bg-brand/20 [&_mark]:px-0.5 [&_mark]:text-foreground" dangerouslySetInnerHTML={{ __html: title }} />

      {snip ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground [&_mark]:rounded-sm [&_mark]:bg-brand/20 [&_mark]:px-0.5 [&_mark]:text-foreground">
          <span className="mr-1 rounded border border-border px-1 text-[10px] uppercase tracking-wide">{snip[1]}</span>
          <span dangerouslySetInnerHTML={{ __html: `…${safeHighlight(hit.highlights[snip[0]])}…` }} />
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
