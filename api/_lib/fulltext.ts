// On-demand full text for the records that reach the chat prompt (Task 1b).
//
// The generator has only ever read a ~1,670-char abstract; every fact the five
// failed test answers missed lives in the body. This module fetches the body
// for the top few retrieved records, per row trying:
//
//   1. preprint_fulltext cache (Neon) — the second ask is free
//   1b. PMC, via the resolved published version (api/_lib/dossier.ts) — the
//       peer-reviewed version of record, from an origin that does not block
//       datacenter clients. This rung is FIRST among the network rungs because
//       it is both the best text and the only one that reliably answers us.
//   2. jatsxml_url                    — structured JATS, cleanest to parse
//   3. the article HTML full-text page (derived from doi + server + version)
//   4. Europe PMC fullTextXML         — different origin, different rate limits
//   5. Wayback Machine (id_ mode)     — an archive whose crawler the origin does
//                                       not block (the same reasoning as
//                                       /api/pdf's Google-viewer route); bioRxiv
//                                       is heavily archived
//   6. r.jina.ai reader               — works from residential IPs (local dev);
//                                       Vercel's egress gets 403'd, so in
//                                       production it is a long shot, kept last
//
// bioRxiv/medRxiv sit behind Cloudflare rate limiting that answers a busy
// client with 429 (measured 2026-08-21: EVERY biorxiv.org fetch from Vercel's
// egress 429s; medrxiv.org intermittently allows), so a miss on rungs 2–3 is
// expected background noise, not an error. Rung 4 covers ~6% of preprints plus
// published versions; rung 5 measured ~5 s / 359 KB for a paper rungs 2–4 all
// missed.
//
// TIMING CONTRACT. The caller gives a prompt budget (~3 s). Each fetch races
// that budget for *inclusion in the prompt*, but keeps running afterwards (up
// to a hard cap) so a slow success still lands in the cache — the turn is
// never hung, and the next ask hits rung 1. Cache writes are fire-and-forget.
//
// The stored text is section-trimmed (abstract + results + discussion when
// the source is structured), never the raw 60k-char body.

import { fetchPmcXml, resolvePublished } from "./dossier.js";

interface SqlClient {
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
}

export interface FulltextRow {
  key_number: string;
  doi: string | null;
  server: string | null;
  version: number | null;
  jatsxml_url: string | null;
  // Present when the caller resolved a published version (api/_lib/dossier.ts).
  // The version of record beats the preprint on every axis that matters here —
  // peer reviewed, revised numbers, and hosted somewhere that will actually
  // answer our serverless egress.
  title?: string | null;
  authors?: string | null;
  pub_year?: number | null;
  published_doi?: string | null;
  published_journal?: string | null;
}

export interface FulltextResult {
  key_number: string;
  source: string; // 'cache:pmc' | 'pmc' | 'jats' | 'html' | 'wayback' | 'reader'
  text: string;
  /** set when the text came from the published version, not the preprint */
  published?: { doi: string; journal?: string; year?: number; title?: string };
}

// STORAGE cap, not prompt cap. This is what we keep in preprint_fulltext; the
// prompt-side budget in chat.ts decides how much of it any one turn reads.
// Keep it comfortably larger than the prompt budget or storage silently
// becomes the binding constraint — measured on the CRISPR paper, an 18k cap on
// a 196k PMC article kept "two hundred" but cut the array-orientation result
// (85% vs 33%), which is the paper's most useful practical finding.
const PER_PAPER_CHARS = 60_000;
const HARD_FETCH_MS = 20_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 sam/1.0";

/* ── text extraction ─────────────────────────────────────────────────────── */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#x2009;|&#8201;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(s: string): string {
  return decodeEntities(
    s
      .replace(/<xref[^>]*>[\s\S]*?<\/xref>/g, "") // citation markers add noise, no facts
      .replace(/<(table-wrap|fig|graphic|disp-formula)[\s\S]*?<\/\1>/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Split a JATS body into its TOP-LEVEL <sec> blocks.
 *
 * This must track nesting depth. A non-greedy /<sec>([\s\S]*?)<\/sec>/ stops at
 * the first *inner* closing tag, so on a real article — where Results contains
 * half a dozen subsections — it returns only the first subsection and silently
 * discards the rest. Measured on PMC8482600: that bug cost the array-orientation
 * result (85% vs CRISPRCasdb's 33%), the paper's most useful practical finding,
 * while still returning a plausible 15k of text.
 */
function topLevelSections(body: string): { title: string; xml: string }[] {
  const out: { title: string; xml: string }[] = [];
  const tag = /<(\/?)sec\b[^>]*>/g;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body))) {
    if (m[1] !== "/") {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        const xml = body.slice(start, m.index + m[0].length);
        const t = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/);
        out.push({ title: t ? stripTags(t[1]) : "", xml });
        start = -1;
      }
    }
  }
  return out;
}

/** JATS → "abstract + the sections a reader needs", capped. */
export function trimJats(xml: string): string | null {
  const bodyM = xml.match(/<body[\s>][\s\S]*?<\/body>/);
  if (!bodyM) return null;
  const abstractM = xml.match(/<abstract[\s>][\s\S]*?<\/abstract>/);

  const secs = topLevelSections(bodyM[0]);
  // Drop the apparatus rather than select the good parts: a published article's
  // section names vary ("Findings", "Main", "Background"), and guessing which
  // are interesting loses more than skipping the ones that never are.
  const skip = /method|material|supplementar|acknowledg|reference|availability|declaration|competing|abbreviation|funding|ethics/i;
  let picked = secs.filter((s) => !skip.test(s.title));
  if (!picked.length) picked = secs;

  let out = abstractM ? `Abstract: ${stripTags(abstractM[0])}\n\n` : "";
  for (const s of picked) {
    if (out.length >= PER_PAPER_CHARS) break;
    out += (s.title ? `${s.title}: ` : "") + stripTags(s.xml) + "\n\n";
  }
  // Fallback when <sec> parsing found nothing at all
  if (out.trim().length < 400) out = stripTags(bodyM[0]);
  const text = out.slice(0, PER_PAPER_CHARS).trim();
  return text.length >= 400 ? text : null;
}

/** Reader-proxy markdown → abstract + the sections a reader needs, capped. */
export function trimReaderMarkdown(md: string): string | null {
  const body = md.replace(/^[\s\S]*?Markdown Content:\s*/, "");
  const secs = body.split(/\n(?=#{1,4} )/);
  const wanted = /abstract|result|discussion|conclusion|finding/i;
  let picked = secs.filter((s) => wanted.test(s.match(/^#{1,4} (.+)/)?.[1] ?? ""));
  if (!picked.length) picked = secs;
  const text = picked
    .join("\n\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")      // images carry no facts
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")    // keep link text, drop URLs
    .replace(/[ \t]+/g, " ")
    .slice(0, PER_PAPER_CHARS)
    .trim();
  return text.length >= 400 ? text : null;
}

/** bioRxiv/medRxiv .full HTML page → article text, capped.
 *
 *  Section-aware for the same reason as trimJats: taken in document order,
 *  abstract + introduction fill the cap before Results — where the quantities
 *  live — arrives. And LEVEL-aware, which is not a detail: on this template
 *  <h2>Results</h2> carries no paragraphs of its own, all of them hang off
 *  <h3> subheadings whose titles are findings ("43% of Type III repeat
 *  clusters contain a PAM"), so a flat title filter drops the entire results
 *  section while reporting success. Keeping an <h2> keeps everything under it
 *  until the next <h2>. */
export function trimArticleHtml(html: string): string | null {
  const clean = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  // The article body lives in <div class="article fulltext-view">…
  const artM = clean.match(/<div[^>]*class="[^"]*fulltext-view[^"]*"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*(?:ref-list|fn-group|license)/);
  const scope = artM ? artM[1] : clean;

  const wanted = /abstract|result|discussion|conclusion|finding/i;
  // Skip the apparatus: methods and everything after it are not what a reader
  // asking "what does this paper say" needs, and they are large.
  const stop = /method|acknowledg|reference|literature cited|author contribution|declaration|supplementary|footnote|data and material/i;

  const secs: { title: string; parts: string[] }[] = [];
  let keeping = true;              // content before the first heading = abstract-ish
  let total = 0;
  const re = /<(h[2-4]|p)[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) && total < PER_PAPER_CHARS * 6) {
    const t = stripTags(m[2]);
    if (t.length <= 2) continue;
    if (m[1] === "h2") {
      keeping = wanted.test(t) && !stop.test(t);
      if (keeping) secs.push({ title: t, parts: [] });
    } else if (m[1] === "p") {
      if (keeping && secs.length) { secs[secs.length - 1].parts.push(t); total += t.length; }
    } else if (keeping && secs.length) {
      // an h3/h4 inside a kept section — the title is itself a finding
      secs[secs.length - 1].parts.push(`\n${t}:`);
    }
  }

  const text = secs
    .filter((s) => s.parts.length)
    .map((s) => `${s.title}:\n${s.parts.join("\n")}`)
    .join("\n\n")
    .slice(0, PER_PAPER_CHARS)
    .trim();
  return text.length >= 800 ? text : null; // shorter than this ⇒ we parsed chrome, not the article
}

/* ── fetch rungs ─────────────────────────────────────────────────────────── */

async function fetchText(url: string, signal: AbortSignal): Promise<string | null> {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal, redirect: "follow" });
  if (!r.ok) {
    console.log(`fulltext fetch ${r.status}: ${url}`);
    return null;
  }
  return r.text();
}

async function fetchJats(row: FulltextRow, signal: AbortSignal): Promise<string | null> {
  if (!row.jatsxml_url) return null;
  const xml = await fetchText(row.jatsxml_url, signal);
  return xml ? trimJats(xml) : null;
}

async function fetchHtml(row: FulltextRow, signal: AbortSignal): Promise<string | null> {
  if (!row.doi || !row.server) return null;
  const v = row.version ? `v${row.version}` : "";
  const html = await fetchText(`https://www.${row.server}.org/content/${row.doi}${v}.full`, signal);
  return html ? trimArticleHtml(html) : null;
}

async function fetchEpmc(row: FulltextRow, signal: AbortSignal): Promise<string | null> {
  if (!row.doi) return null;
  const s = await fetch(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%22${encodeURIComponent(row.doi)}%22&format=json&pageSize=3`,
    { signal },
  );
  if (!s.ok) return null;
  const hits = ((await s.json()) as { resultList?: { result?: { id: string; source: string }[] } })
    .resultList?.result ?? [];
  // Prefer a published (PMC) version over the preprint mirror — more likely to have text.
  const ordered = [...hits.filter((h) => h.source !== "PPR"), ...hits.filter((h) => h.source === "PPR")];
  for (const h of ordered) {
    const xml = await fetchText(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/${h.source}/${h.id}/fullTextXML`,
      signal,
    );
    if (xml) {
      const t = trimJats(xml);
      if (t) return t;
    }
  }
  return null;
}

async function fetchWayback(row: FulltextRow, signal: AbortSignal): Promise<string | null> {
  if (!row.doi || !row.server) return null;
  const v = row.version ? `v${row.version}` : "";
  // "2" = latest snapshot, "id_" = the original bytes, no toolbar injection.
  const html = await fetchText(
    `https://web.archive.org/web/2id_/https://www.${row.server}.org/content/${row.doi}${v}.full`,
    signal,
  );
  return html ? trimArticleHtml(html) : null;
}

async function fetchReader(row: FulltextRow, signal: AbortSignal): Promise<string | null> {
  if (!row.doi || !row.server) return null;
  const v = row.version ? `v${row.version}` : "";
  const md = await fetchText(
    `https://r.jina.ai/https://www.${row.server}.org/content/${row.doi}${v}.full`,
    signal,
  );
  return md ? trimReaderMarkdown(md) : null;
}

/* ── the ladder, cache-aware ─────────────────────────────────────────────── */

async function fetchOne(
  sql: SqlClient,
  row: FulltextRow,
  signal: AbortSignal,
): Promise<{ source: string; text: string; published?: FulltextResult["published"] } | null> {
  // Rung 1b: the published version, read from PMC.
  try {
    const m = await resolvePublished(sql as never, row, signal);
    if (m.status === "matched" && m.pmcid) {
      const xml = await fetchPmcXml(m.pmcid, signal);
      const text = xml ? trimJats(xml) : null;
      if (text) {
        return {
          source: "pmc",
          text,
          published: {
            doi: m.published_doi!,
            journal: m.published_journal,
            year: m.published_year,
            title: m.published_title,
          },
        };
      }
    }
  } catch (e) {
    console.log(`fulltext rung error: pmc ${row.key_number} ${(e as Error).message.slice(0, 80)}`);
  }

  for (const [source, fn] of [
    ["jats", fetchJats],
    ["html", fetchHtml],
    ["epmc", fetchEpmc],
    ["wayback", fetchWayback],
    ["reader", fetchReader],
  ] as const) {
    if (signal.aborted) return null;
    try {
      const text = await fn(row, signal);
      if (text) return { source, text };
      console.log(`fulltext rung empty: ${source} ${row.key_number}`);
    } catch (e) {
      // rung failed — log and try the next
      console.log(`fulltext rung error: ${source} ${row.key_number} ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return null;
}

/**
 * Full text for `rows`, cache-first. Resolves within ~`promptBudgetMs` with
 * whatever is ready by then; slower fetches keep running (≤ HARD_FETCH_MS) and
 * land in the cache for the next ask.
 */
export async function getFulltext(
  sql: SqlClient,
  rows: FulltextRow[],
  // The PMC rung costs ~1 s end to end (OpenAlex resolve → esearch → efetch)
  // and is the rung that actually succeeds in production, so the budget has to
  // be wide enough to let it land rather than timing it out into the blocked
  // origins below it.
  promptBudgetMs = 4000,
): Promise<FulltextResult[]> {
  if (!rows.length) return [];
  const results: FulltextResult[] = [];

  let cached = new Map<string, { source: string; text: string }>();
  try {
    const hit = await sql.query(
      `SELECT key_number, source, text FROM preprint_fulltext WHERE key_number = ANY($1)`,
      [rows.map((r) => r.key_number)],
    );
    cached = new Map(hit.map((r) => [String(r.key_number), { source: String(r.source), text: String(r.text) }]));
  } catch { /* cache unavailable — fetch anyway */ }

  const misses: FulltextRow[] = [];
  for (const row of rows) {
    const c = cached.get(row.key_number);
    if (c) results.push({ key_number: row.key_number, source: `cache:${c.source}`, text: c.text });
    else misses.push(row);
  }
  if (!misses.length) return results;

  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort(), HARD_FETCH_MS);

  const fetches = misses.map((row) =>
    fetchOne(sql, row, controller.signal).then((got) => {
      if (!got) return null;
      // Fire-and-forget cache write — the turn never waits on it.
      sql
        .query(
          `INSERT INTO preprint_fulltext (key_number, source, text) VALUES ($1, $2, $3)
           ON CONFLICT (key_number) DO UPDATE SET source = $2, text = $3, fetched_at = now()`,
          [row.key_number, got.source, got.text],
        )
        .catch(() => {});
      return { key_number: row.key_number, ...got };
    }),
  );

  // Prompt inclusion races the budget; the fetches themselves keep going.
  const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), promptBudgetMs));
  const settled = await Promise.race([Promise.allSettled(fetches), budget.then(() => null)]);

  if (settled) {
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) results.push(s.value);
    }
    clearTimeout(hardTimer);
  } else {
    // Budget elapsed — take whatever individual fetches already resolved.
    const ready = await Promise.all(
      fetches.map((p) => Promise.race([p, Promise.resolve(null)])),
    );
    for (const r of ready) if (r) results.push(r);
    // Leave hardTimer armed: stragglers still get aborted at the cap, and their
    // successes still write the cache. allSettled above keeps the process alive
    // only as long as the response stream does — which is exactly the window
    // Bedrock generation holds open anyway.
    Promise.allSettled(fetches).finally(() => clearTimeout(hardTimer));
  }
  return attachPublished(sql, results);
}

/**
 * Attach the resolved publication status to every result, including cache hits.
 *
 * This is separate from fetching on purpose: publication status matters to the
 * answer even when the body came from the preprint or from cache, because the
 * single worst thing this system can say is that a published paper is
 * unreviewed. `preprints.published_journal` alone cannot tell us — it is null
 * for half the corpus, including papers that are in fact published.
 */
async function attachPublished(sql: SqlClient, results: FulltextResult[]): Promise<FulltextResult[]> {
  const need = results.filter((r) => !r.published).map((r) => r.key_number);
  if (!need.length) return results;
  try {
    const rows = await sql.query(
      `SELECT key_number, published_doi, published_journal, published_year, published_title
       FROM preprint_published_match WHERE status = 'matched' AND key_number = ANY($1)`,
      [need],
    );
    const byKey = new Map(rows.map((r) => [String(r.key_number), r]));
    for (const r of results) {
      const m = byKey.get(r.key_number);
      if (m && !r.published) {
        r.published = {
          doi: String(m.published_doi),
          journal: m.published_journal ? String(m.published_journal) : undefined,
          year: m.published_year ? Number(m.published_year) : undefined,
          title: m.published_title ? String(m.published_title) : undefined,
        };
      }
    }
  } catch { /* match table absent — status simply stays unknown */ }
  return results;
}
