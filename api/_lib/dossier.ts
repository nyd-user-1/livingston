// Find a preprint's published version, and read its full text.
//
// THE PROBLEM. Our generator could only ever see the preprint abstract, and the
// preprint is often not the paper of record. For the CRISPR test case the
// published version (Genome Biology, 2021) carries a REVISED headline number
// ("more than two hundred" PAM sequences vs 114 in the v2 preprint) and results
// the preprint text does not contain at all — the array-orientation figure of
// 85% vs CRISPRCasdb's 33%, for instance. Answering from the preprint alone is
// not just thin, it can be out of date.
//
// WHY WE CANNOT JUST LOOK IT UP. A preprint and its version of record are
// separately registered DOIs (10.1101/… vs 10.1186/…); the DOI does not carry
// over. The standard bridge is Crossref's `relation` field, and for this paper
// it is empty `{}`. bioRxiv's own API reports `published: "NA"` on both
// versions and /pubs/ says "no articles found". Our `published_doi` column is
// null for 50.3% of the corpus for exactly this reason — it faithfully mirrors
// an upstream gap. Measured 2026-08-21; do not "fix" this by adding another
// identifier lookup, there isn't one.
//
// WHAT WORKS. Rediscover the link from CONTENT. Search OpenAlex by the
// corresponding author's surname plus topic terms, then score candidates on
// author-surname overlap and abstract term overlap. On the test case the true
// match scored 0.255 against ≤0.060 for all fourteen other candidates — a 4×
// separation, with all three surnames matching. Then NCBI (esearch by DOI →
// efetch) returns the full JATS body: 196,073 chars in 165 ms.
//
// WHY NCBI RATHER THAN THE PUBLISHER. www.biorxiv.org answers our serverless
// egress with 429 on every request, as do web.archive.org and r.jina.ai
// (measured). NCBI does not block datacenter clients and we hold an API key.
// Europe PMC 404s `fullTextXML` even for records it lists as in-EPMC, so it is
// not a substitute. This is doctrine §7 applied to text rather than to PDFs:
// never fetch a blocked origin yourself; use a client that is not blocked.

interface SqlClient {
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
}

export interface PreprintRef {
  key_number: string;
  doi: string | null;
  title?: string | null;
  authors?: string | null;
  pub_year?: number | null;
  published_doi?: string | null;
  published_journal?: string | null;
}

export interface PublishedMatch {
  status: "matched" | "none";
  published_doi?: string;
  published_journal?: string;
  published_year?: number;
  published_title?: string;
  pmcid?: string;
  confidence?: number;
  method?: string;
}

const OA = "https://api.openalex.org";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const mailto = () => process.env.OPENALEX_MAILTO ?? "preprints@nysgpt.com";
const ncbiKey = () => (process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "");

/* ── scoring ─────────────────────────────────────────────────────────────── */

/** "Vink, J. N.; Baijens, J. H.; Brouns, S. J." → ["vink","baijens","brouns"] */
export function surnames(authors: string | null | undefined): string[] {
  if (!authors) return [];
  return authors
    .split(";")
    .map((a) => a.split(",")[0].trim().toLowerCase())
    .filter((a) => a.length > 1);
}

const STOP = new Set([
  "which", "these", "their", "there", "where", "while", "about", "using", "used",
  "study", "studies", "results", "shown", "showed", "between", "based", "against",
]);
const terms = (t: string | null | undefined): Set<string> =>
  new Set(
    String(t ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4 && !STOP.has(w)),
  );

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / new Set([...a, ...b]).size;
}

interface OaWork {
  doi?: string;
  title?: string;
  publication_year?: number;
  type?: string;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } };
  abstract_inverted_index?: Record<string, number[]>;
  ids?: { pmcid?: string };
}

function abstractOf(w: OaWork): string {
  const idx = w.abstract_inverted_index;
  if (!idx) return "";
  const out: string[] = [];
  for (const [word, ps] of Object.entries(idx)) for (const p of ps) out[p] = word;
  return out.join(" ");
}

/**
 * How confident are we that `cand` is the published version of `rec`?
 *
 * Author agreement carries most of the weight: a title can be rewritten
 * wholesale (it was, here) but the author list rarely changes. Abstract
 * overlap breaks ties and catches the case where a lab publishes several
 * adjacent papers in the same window.
 */
export function scoreCandidate(rec: PreprintRef, cand: OaWork): number {
  const ours = surnames(rec.authors);
  if (!ours.length) return 0;
  const theirs = (cand.authorships ?? [])
    .map((a) => (a.author?.display_name ?? "").split(/\s+/).pop()?.toLowerCase() ?? "")
    .filter(Boolean);
  const matched = ours.filter((s) => theirs.includes(s)).length;
  const authorScore = matched / ours.length;

  // A different paper by the same lab is the failure mode to beat, so require
  // real author agreement before content can count for anything.
  if (authorScore < 0.6) return 0;

  const absScore = jaccard(terms(rec.title), terms(cand.title)) * 0.5 +
    jaccard(terms(rec.title), terms(abstractOf(cand)));
  return authorScore * 0.6 + Math.min(absScore, 1) * 0.4;
}

/* ── resolution ──────────────────────────────────────────────────────────── */

async function openAlexCandidates(rec: PreprintRef, signal: AbortSignal): Promise<OaWork[]> {
  const last = surnames(rec.authors).slice(-1)[0] ?? surnames(rec.authors)[0];
  if (!last) return [];
  // Topic terms from the title, minus filler — a generic "CRISPR" alone buries
  // the target under review articles.
  const topic = [...terms(rec.title)].slice(0, 6).join(" ");
  const y = rec.pub_year ?? 2000;
  const url =
    `${OA}/works?search=${encodeURIComponent(`${last} ${topic}`)}` +
    `&filter=from_publication_date:${y}-01-01,to_publication_date:${y + 3}-12-31,type:article` +
    `&per-page=25&mailto=${encodeURIComponent(mailto())}`;
  const r = await fetch(url, { signal });
  if (!r.ok) return [];
  return ((await r.json()) as { results?: OaWork[] }).results ?? [];
}

/** PMCID for a DOI, via NCBI esearch. Empty string when PMC does not have it. */
async function pmcIdForDoi(doi: string, signal: AbortSignal): Promise<string> {
  const r = await fetch(
    `${EUTILS}/esearch.fcgi?db=pmc&term=${encodeURIComponent(`${doi}[DOI]`)}&retmode=json${ncbiKey()}`,
    { signal },
  );
  if (!r.ok) return "";
  const j = (await r.json()) as { esearchresult?: { idlist?: string[] } };
  return j.esearchresult?.idlist?.[0] ?? "";
}

const MIN_CONFIDENCE = 0.62;

/**
 * Resolve `rec` to its published version, cache-first. Returns `{status:"none"}`
 * when nothing clears the bar — which is a real answer, not a failure, and is
 * persisted so we do not re-pay for it.
 */
export async function resolvePublished(
  sql: SqlClient,
  rec: PreprintRef,
  signal: AbortSignal,
): Promise<PublishedMatch> {
  try {
    const cached = await sql.query(
      `SELECT status, published_doi, published_journal, published_year, published_title, pmcid, confidence, method
       FROM preprint_published_match WHERE key_number = $1`,
      [rec.key_number],
    );
    if (cached[0]) {
      const c = cached[0];
      return c.status === "matched"
        ? {
            status: "matched",
            published_doi: String(c.published_doi),
            published_journal: c.published_journal ? String(c.published_journal) : undefined,
            published_year: c.published_year ? Number(c.published_year) : undefined,
            published_title: c.published_title ? String(c.published_title) : undefined,
            pmcid: c.pmcid ? String(c.pmcid) : undefined,
            confidence: Number(c.confidence),
            method: String(c.method),
          }
        : { status: "none" };
    }
  } catch { /* table missing — resolve live */ }

  let out: PublishedMatch = { status: "none" };

  // The DB already knows for 49.7% of the corpus; trust it and skip the search.
  if (rec.published_doi) {
    out = {
      status: "matched",
      published_doi: rec.published_doi,
      published_journal: rec.published_journal ?? undefined,
      confidence: 1,
      method: "db",
    };
  } else {
    try {
      const cands = await openAlexCandidates(rec, signal);
      let best: OaWork | null = null;
      let bestScore = 0;
      for (const c of cands) {
        if (!c.doi) continue;
        // never "resolve" a preprint to itself
        if (rec.doi && c.doi.toLowerCase().includes(rec.doi.toLowerCase())) continue;
        const sc = scoreCandidate(rec, c);
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
      if (best && bestScore >= MIN_CONFIDENCE) {
        out = {
          status: "matched",
          published_doi: String(best.doi).replace(/^https?:\/\/doi\.org\//, ""),
          published_journal: best.primary_location?.source?.display_name,
          published_year: best.publication_year,
          published_title: best.title,
          confidence: bestScore,
          method: "openalex",
        };
      }
    } catch { /* leave as none */ }
  }

  if (out.status === "matched" && out.published_doi && !out.pmcid) {
    try { out.pmcid = (await pmcIdForDoi(out.published_doi, signal)) || undefined; } catch { /* optional */ }
  }

  sql
    .query(
      `INSERT INTO preprint_published_match
         (key_number, status, published_doi, published_journal, published_year, published_title, pmcid, confidence, method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (key_number) DO UPDATE SET
         status=$2, published_doi=$3, published_journal=$4, published_year=$5,
         published_title=$6, pmcid=$7, confidence=$8, method=$9, resolved_at=now()`,
      [
        rec.key_number, out.status, out.published_doi ?? null, out.published_journal ?? null,
        out.published_year ?? null, out.published_title ?? null, out.pmcid ?? null,
        out.confidence ?? null, out.method ?? null,
      ],
    )
    .catch(() => {});

  return out;
}

/** Full JATS text of a PMC article. This is the peer-reviewed version of record. */
export async function fetchPmcXml(pmcid: string, signal: AbortSignal): Promise<string | null> {
  const r = await fetch(
    `${EUTILS}/efetch.fcgi?db=pmc&id=${encodeURIComponent(pmcid)}&retmode=xml${ncbiKey()}`,
    { signal },
  );
  if (!r.ok) {
    console.log(`pmc efetch ${r.status} for ${pmcid}`);
    return null;
  }
  const xml = await r.text();
  return xml.includes("<body") ? xml : null;
}
