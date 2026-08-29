// /api/bills-search — the /search page's backend: Typesense over the bills index.
//
//   ?q=lithium                 full-text with typo tolerance and prefix matching
//   &session=2025&chamber=Senate&status=…&committee=…&sponsor=…&party=…   facet filters (repeatable)
//   &sort=relevance|newest     default relevance (ties by last action, newest first)
//   &page=1&per_page=20
//
// Returns hits with highlighted snippets, facet counts, total, and the engine's own
// search time. The search-only key can read this one collection and nothing else.
//
//   Env: TYPESENSE_URL, TYPESENSE_SEARCH_KEY

/* eslint-disable @typescript-eslint/no-explicit-any */
export const config = { maxDuration: 15 };

const FACETS = ["session", "chamber", "status", "committee", "sponsor", "party"] as const;

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

  const filters: string[] = [];
  for (const f of FACETS) {
    const vals = list(req.query?.[f]);
    if (!vals.length) continue;
    filters.push(f === "session" ? `session:[${vals.map(Number).filter(Number.isFinite).join(",")}]` : `${f}:=[${vals.map((v) => `\`${esc(v)}\``).join(",")}]`);
  }

  const params = new URLSearchParams({
    q: q || "*",
    query_by: "title,bill_number,number_alt,description,memo,sponsor,committee,text",
    query_by_weights: "10,10,10,6,4,3,2,1",
    prefix: "true,true,true,false,false,true,false,false",
    num_typos: "2,0,0,1,1,1,1,1",
    facet_by: FACETS.join(","),
    max_facet_values: "12",
    highlight_fields: "title,description,memo,text",
    highlight_affix_num_tokens: "12",
    snippet_threshold: "40",
    per_page: String(perPage),
    page: String(page),
    sort_by: sort === "newest" ? "last_action_ts:desc" : q ? "_text_match:desc,last_action_ts:desc" : "last_action_ts:desc",
    exclude_fields: "text,memo",
    drop_tokens_threshold: "1",
  });
  if (filters.length) params.set("filter_by", filters.join(" && "));

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
      id: doc.id, bill_number: doc.bill_number, session: doc.session, chamber: doc.chamber, title: doc.title, description: doc.description ?? null,
      status: doc.status ?? null, committee: doc.committee ?? null, sponsor: doc.sponsor ?? null, party: doc.party ?? null, district: doc.district ?? null,
      cosponsors: doc.cosponsors ?? 0, last_action: doc.last_action ?? null, last_action_date: doc.last_action_date ?? null,
      text_chars: doc.text_chars ?? 0, url: doc.url ?? null, highlights: hl,
    };
  });
  const facets: Record<string, { value: string; count: number }[]> = {};
  for (const f of d.facet_counts ?? []) facets[f.field_name] = (f.counts ?? []).map((c: any) => ({ value: String(c.value), count: c.count }));

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({ q, page, per_page: perPage, found: d.found ?? 0, out_of: d.out_of ?? 0, search_ms: d.search_time_ms ?? null, round_trip_ms: Date.now() - t0, hits, facets });
}
