// /api/bills-search — the /search page's backend: Typesense over the bills index.
//
//   ?q=lithium                 full-text, typo-tolerant, prefix on titles and numbers
//   &state=NY&state=US         jurisdiction (repeatable; none = everything indexed)
//   &session=2025&chamber=Senate&status=…&committee=…&sponsor=…&party=…   facet filters (repeatable)
//   &in=title,description,memo,crs,text,sponsor,committee,number   which fields to search (default: all)
//   &has_text=1                only bills whose text we hold
//   &sort=relevance|newest|oldest
//   &facet_q=committee:health  search inside one facet's values (for the long lists)
//   &page=1&per_page=20
//
// Returns hits with highlighted snippets, facet counts, total, and the engine's own time.
// The search-only key can read this one collection and nothing else.
//
//   Env: TYPESENSE_URL, TYPESENSE_SEARCH_KEY

/* eslint-disable @typescript-eslint/no-explicit-any */
export const config = { maxDuration: 15 };

const FACETS = ["state", "session", "chamber", "status", "committee", "sponsor", "party"] as const;
// Searchable fields and their weights. "number" searches both spellings of a bill number.
const FIELDS: Record<string, { by: string[]; w: number[]; prefix: boolean[]; typos: number[] }> = {
  title: { by: ["title"], w: [10], prefix: [true], typos: [2] },
  number: { by: ["bill_number", "number_alt"], w: [10, 10], prefix: [true, true], typos: [0, 0] },
  description: { by: ["description"], w: [6], prefix: [false], typos: [1] },
  memo: { by: ["memo"], w: [4], prefix: [false], typos: [1] },
  crs: { by: ["crs"], w: [4], prefix: [false], typos: [1] },
  sponsor: { by: ["sponsor"], w: [3], prefix: [true], typos: [1] },
  committee: { by: ["committee"], w: [2], prefix: [false], typos: [1] },
  text: { by: ["text"], w: [1], prefix: [false], typos: [1] },
};
const DEFAULT_IN = Object.keys(FIELDS);

const list = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [String(v)]).flatMap((s) => String(s).split(",")).map((s) => s.trim()).filter(Boolean);
const esc = (s: string) => s.replace(/[`\\]/g, "");

export default async function handler(req: any, res: any) {
  const url = process.env.TYPESENSE_URL;
  const key = process.env.TYPESENSE_SEARCH_KEY;
  if (!url || !key) return res.status(503).json({ configured: false, error: "TYPESENSE_URL and TYPESENSE_SEARCH_KEY are not set" });

  const q = String(req.query?.q ?? "").trim();
  const page = Math.max(1, Number(req.query?.page ?? 1) || 1);
  const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page ?? 20) || 20));
  const sort = String(req.query?.sort ?? "relevance");
  const asked = list(req.query?.in).filter((f) => FIELDS[f]);
  const inFields = asked.length ? asked : DEFAULT_IN;

  const filters: string[] = [];
  for (const f of FACETS) {
    const vals = list(req.query?.[f]);
    if (!vals.length) continue;
    filters.push(f === "session" ? `session:[${vals.map(Number).filter(Number.isFinite).join(",")}]` : `${f}:=[${vals.map((v) => `\`${esc(v)}\``).join(",")}]`);
  }
  if (String(req.query?.has_text ?? "") === "1") filters.push("text_chars:>0");

  const by = inFields.flatMap((f) => FIELDS[f].by);
  const params = new URLSearchParams({
    q: q || "*",
    query_by: by.join(","),
    query_by_weights: inFields.flatMap((f) => FIELDS[f].w).join(","),
    prefix: inFields.flatMap((f) => FIELDS[f].prefix).join(","),
    num_typos: inFields.flatMap((f) => FIELDS[f].typos).join(","),
    facet_by: FACETS.join(","),
    max_facet_values: "60",
    highlight_fields: by.filter((f) => f !== "number_alt").join(","),
    highlight_affix_num_tokens: "12",
    snippet_threshold: "40",
    per_page: String(perPage),
    page: String(page),
    sort_by: sort === "newest" ? "last_action_ts:desc" : sort === "oldest" ? "last_action_ts:asc" : q ? "_text_match:desc,last_action_ts:desc" : "last_action_ts:desc",
    exclude_fields: "text,memo,crs",
    drop_tokens_threshold: "1",
  });
  if (filters.length) params.set("filter_by", filters.join(" && "));
  const fq = String(req.query?.facet_q ?? "");
  if (/^[a-z]+:.+/.test(fq)) params.set("facet_query", fq);

  const t0 = Date.now();
  let r: Response;
  try {
    r = await fetch(`${url}/collections/bills/documents/search?${params}`, { headers: { "X-TYPESENSE-API-KEY": key }, signal: AbortSignal.timeout(8_000) });
  } catch (err) {
    return res.status(502).json({ error: `search engine unreachable: ${(err as Error).message}` });
  }
  if (!r.ok) return res.status(502).json({ error: `search engine answered ${r.status}`, detail: (await r.text()).slice(0, 300) });
  const d: any = await r.json();

  const hits = (d.hits ?? []).map((h: any) => {
    const doc = h.document ?? {};
    const hl: Record<string, string> = {};
    for (const x of h.highlights ?? []) if (x.field && (x.snippet || x.value)) hl[x.field] = x.snippet ?? x.value;
    return {
      id: doc.id, state: doc.state, bill_number: doc.bill_number, session: doc.session, chamber: doc.chamber, title: doc.title, description: doc.description ?? null,
      status: doc.status ?? null, committee: doc.committee ?? null, sponsor: doc.sponsor ?? null, party: doc.party ?? null, district: doc.district ?? null,
      cosponsors: doc.cosponsors ?? 0, last_action: doc.last_action ?? null, last_action_date: doc.last_action_date ?? null,
      text_chars: doc.text_chars ?? 0, url: doc.url ?? null, highlights: hl,
    };
  });
  const facets: Record<string, { value: string; count: number }[]> = {};
  for (const f of d.facet_counts ?? []) facets[f.field_name] = (f.counts ?? []).map((c: any) => ({ value: String(c.value), count: c.count }));

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({ q, in: inFields, page, per_page: perPage, found: d.found ?? 0, out_of: d.out_of ?? 0, search_ms: d.search_time_ms ?? null, round_trip_ms: Date.now() - t0, hits, facets });
}
