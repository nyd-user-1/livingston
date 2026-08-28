// /api/model-bills — the model bills, and the state bills copied from them.
//
// Three human-curated sources, which is the whole point: everything else in this
// database is machine-derived. These are people saying "this state bill came
// from that model", and that is the benchmark and the training signal for
// "find this bill in other states".
//
//   ?source=alec[&limit=N]      alec.org's model-policy library, ~1,128 policies
//                               from two sitemaps. Live, healthy, robots-allowed.
//   ?source=cpi                 "Copy, Paste, Legislate" (Center for Public
//                               Integrity, 2019). The organisation closed in 2025
//                               and the tool's host no longer resolves, so this
//                               reads the Wayback Machine and the PublicI GitHub
//                               data repos. Fetch first, structure second.
//   ?census=1                   counts only, fetches nothing.
//
// NCSL is deliberately absent. See the report: robots.txt disallows ClaudeBot,
// GPTBot, CCBot and Amazonbot outright, and every page — including their own
// terms of use — answers our User-Agent with a Cloudflare 403 challenge. Two
// independent refusals is an answer, and getting past a bot challenge is not
// something this lane will do.
//
// Raw HTML is written to ~/cache/model-bills/<source>/ before anything is
// parsed, because one of these sources is already an archive and the other could
// be. A parser can be rewritten from the cache; a fetch cannot be re-taken from
// a site that has gone.
//
//   Auth: Authorization: Bearer $CRON_SECRET, or ?secret=
//   Env:  POLICY_DATABASE_URL, CRON_SECRET

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PoliteFetcher } from "./_lib/polite-fetch.js";

export const config = { maxDuration: 300 };

type Sql = NeonQueryFunction<false, false>;
type Counts = Record<string, number>;

const CACHE = path.join(os.homedir(), "cache", "model-bills");
const UA = "livingston-model-bills/1.0 (research archive of published model legislation; +https://github.com/nyd-user-1/livingston; contact: brendan@nysgpt.com)";

/* ---- schema -------------------------------------------------------------- */

async function prepareSchema(sql: Sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS "ModelBills" (
    model_id text PRIMARY KEY,
    source text NOT NULL,
    title text,
    year int,
    issue text,
    type text,
    status text,
    tags text[],
    text text,
    url text,
    fetched_at timestamptz NOT NULL DEFAULT now())`);
  await sql.query(`CREATE INDEX IF NOT EXISTS modelbills_source_idx ON "ModelBills" (source)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS modelbills_year_idx ON "ModelBills" (year)`);

  await sql.query(`CREATE TABLE IF NOT EXISTS "ModelBillMatches" (
    id bigserial PRIMARY KEY,
    model_id text NOT NULL,
    state text,
    session_id int,
    bill_number text,
    bill_id bigint,
    match_score numeric,
    source text NOT NULL,
    raw jsonb)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS modelmatches_bill_idx ON "ModelBillMatches" (bill_id)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS modelmatches_model_idx ON "ModelBillMatches" (model_id)`);
  // One row per (model, state, bill number, source): re-running a harvest must
  // update a match rather than pile up copies of it.
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS modelmatches_key ON "ModelBillMatches" (model_id, source, COALESCE(state, ''), COALESCE(bill_number, ''), COALESCE(session_id, 0))`);
}

/* ---- html -> text -------------------------------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sect: "§", para: "¶", hellip: "…",
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|section|blockquote)\s*>/gi, "\n")
      .replace(/<(p|div|tr|li|h[1-6]|section|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Innermost text of the first element matching a class, by brace-free depth counting. */
function divByClass(html: string, cls: string): string | null {
  const open = new RegExp(`<div\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, "i");
  const m = open.exec(html);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = i;
  let t: RegExpExecArray | null;
  while ((t = tag.exec(html))) {
    depth += t[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(i, t.index);
  }
  return html.slice(i);
}

/* ---- ALEC ---------------------------------------------------------------- */

/**
 * Links inside ONE named sidebar module.
 *
 * The naive version of this — grep the page for /issue/ and /task-force/ hrefs —
 * scrapes ALEC's site-wide navigation menu instead, and every policy comes back
 * carrying all 46 issues and all 11 task forces. The page's own subject labels
 * live in `<div class="sidebar-module"><h4 class="module-title">Issues</h4>…`,
 * and nowhere else, so that is what this reads.
 */
function sidebarLinks(html: string, label: string): { slug: string; text: string }[] {
  const head = new RegExp(`module-title"[^>]*>\\s*${label}\\s*</h4>`, "i").exec(html);
  if (!head) return [];
  const rest = html.slice(head.index + head[0].length);
  // Stop at the next module: a sidebar module never nests.
  const end = rest.search(/sidebar-module|module-title"/i);
  const block = end > 0 ? rest.slice(0, end) : rest;
  return [...block.matchAll(/<a\s+href="https:\/\/alec\.org\/(?:issue|tag|task-force)\/([^"/]+)\/"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ slug: m[1], text: htmlToText(m[2]).trim() }))
    .filter((x) => x.slug);
}

/** `Type:`, `Status:`, `Date Introduced:` … out of ALEC's sidebar meta list. */
function metaValue(html: string, key: string): string | null {
  const re = new RegExp(`post-meta-list__key">\\s*${key}\\s*:?\\s*</span>\\s*<span class="post-meta-list__value">([\\s\\S]*?)</span>`, "i");
  const m = re.exec(html);
  return m ? htmlToText(m[1]).trim() || null : null;
}

export function parseAlec(url: string, html: string) {
  const slug = (/\/model-policy\/([^/]+)\//.exec(url) ?? [, ""])[1];
  const title = htmlToText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ?? [, ""])[1] || (/<title>([\s\S]*?)<\/title>/i.exec(html) ?? [, ""])[1])
    .replace(/\s*-\s*American Legislative Exchange Council.*$/i, "").trim();

  const type = metaValue(html, "Type");
  const status = metaValue(html, "Status");
  const finalized = metaValue(html, "Date Finalized");
  const introduced = metaValue(html, "Date Introduced");
  // The year the policy is OF, preferring when it was finalised over when the
  // page was last edited — ALEC re-touches old pages and the modified date lies.
  const dateStr = finalized || introduced || "";
  let year = Number((/\b(19|20)\d{2}\b/.exec(dateStr) ?? [""])[0]) || 0;
  if (!year) {
    const published = (/"datePublished":"(\d{4})/.exec(html) ?? [, ""])[1];
    year = Number(published) || 0;
  }

  const issues = sidebarLinks(html, "Issues");
  const taskForces = sidebarLinks(html, "Task Forces");
  const tagLinks = sidebarLinks(html, "Tags");
  // Human-readable labels, because that is what a reader and a prompt both want;
  // the slug is recoverable by lowercasing and hyphenating.
  const tags = [...new Set([...issues, ...taskForces, ...tagLinks].map((x) => x.text).filter(Boolean))];

  const container = divByClass(html, "article-content-container") ?? html;
  const body = divByClass(container, "the-content") ?? container;
  const text = htmlToText(body);

  return {
    model_id: `alec:${slug}`, source: "alec", title: title || slug, year: year || null,
    issue: issues[0]?.text ?? taskForces[0]?.text ?? null,
    type, status, tags, text: text || null, url,
  };
}

async function alecUrls(fetcher: PoliteFetcher, counts: Counts): Promise<string[]> {
  const urls = new Set<string>();
  for (const sm of ["model-policy-sitemap.xml", "model-policy-sitemap2.xml"]) {
    const r = await fetcher.get(`https://alec.org/${sm}`);
    counts.sitemaps = (counts.sitemaps ?? 0) + 1;
    if (!r.ok || !r.body) { counts.sitemapErrors = (counts.sitemapErrors ?? 0) + 1; continue; }
    const xml = new TextDecoder().decode(r.body);
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = m[1].trim();
      // The library index itself is not a policy.
      if (/\/model-policy\/[^/]+\/$/.test(u)) urls.add(u);
    }
  }
  return [...urls].sort();
}

async function runAlec(sql: Sql, limit: number, refetch: boolean, reparse: boolean, counts: Counts, fetcher: PoliteFetcher) {
  const dir = path.join(CACHE, "alec");
  fs.mkdirSync(dir, { recursive: true });

  const all = await alecUrls(fetcher, counts);
  counts.inSitemap = all.length;

  const have = new Set(((await sql.query(`SELECT model_id FROM "ModelBills" WHERE source = 'alec' AND text IS NOT NULL`)) as { model_id: string }[]).map((r) => r.model_id));
  // --reparse re-reads what is already on disk and re-runs the parser, which is
  // the whole reason the raw HTML is kept: fixing the parser must never cost
  // another 1,128 requests to somebody else's website.
  const todo = (refetch || reparse) ? all : all.filter((u) => !have.has(`alec:${(/\/model-policy\/([^/]+)\//.exec(u) ?? [, ""])[1]}`));
  counts.outstanding = todo.length;
  const work = limit ? todo.slice(0, limit) : todo;
  counts.considered = work.length;

  for (const url of work) {
    const slug = (/\/model-policy\/([^/]+)\//.exec(url) ?? [, ""])[1];
    const cached = path.join(dir, `${slug}.html`);
    let html = "";
    if (reparse && !fs.existsSync(cached)) { counts.notCached = (counts.notCached ?? 0) + 1; continue; }
    if (!refetch && fs.existsSync(cached)) { html = fs.readFileSync(cached, "utf8"); counts.fromCache = (counts.fromCache ?? 0) + 1; }
    else {
      const r = await fetcher.get(url);
      if (!r.ok || !r.body) { counts[`skip_${r.skipped ?? "error"}`] = (counts[`skip_${r.skipped ?? "error"}`] ?? 0) + 1; continue; }
      html = new TextDecoder().decode(r.body);
      // Raw first, always. The parser can be rewritten; the fetch cannot be retaken.
      fs.writeFileSync(cached, html);
      counts.fetched = (counts.fetched ?? 0) + 1;
    }
    const row = parseAlec(url, html);
    if (!row.text) { counts.noText = (counts.noText ?? 0) + 1; }
    await sql.query(
      `INSERT INTO "ModelBills" (model_id, source, title, year, issue, type, status, tags, text, url, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (model_id) DO UPDATE SET title = EXCLUDED.title, year = EXCLUDED.year, issue = EXCLUDED.issue,
         type = EXCLUDED.type, status = EXCLUDED.status, tags = EXCLUDED.tags, text = EXCLUDED.text,
         url = EXCLUDED.url, fetched_at = now()`,
      [row.model_id, row.source, row.title, row.year, row.issue, row.type, row.status, row.tags, row.text, row.url],
    );
    counts.stored = (counts.stored ?? 0) + 1;
    counts.chars = (counts.chars ?? 0) + (row.text?.length ?? 0);
  }
}

/* ---- CPI: what survives of "Copy, Paste, Legislate" ---------------------- */

const CPI_CSV = "https://raw.githubusercontent.com/PublicI/religious-freedom-bills-data/master/bills.csv";
const CPI_API_SNAPSHOT = 'http://web.archive.org/web/20240116232948id_/https://model-legislation.apps.publicintegrity.org/api/bills/search?q=%22voter+registration+drive%22';

/** A CSV reader that survives quoted commas and embedded newlines. Bill descriptions have both. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; }
      else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Find our bill_id for someone else's bill number.
 *
 * The naive equality match resolved 514 of 549 and the 35 misses were ALL format,
 * not absence: the spreadsheet says `H401` where LegiScan says `H0401`, `SB64`
 * against `SB0064`, `SB550` against North Carolina's `S550`, and North Dakota's
 * `SB2136` against a bare `2136`. We hold every one of those sessions — Florida
 * 2016 alone has 1,815 bills — so giving up on a zero would have thrown away real
 * curated labels.
 *
 * Four passes, narrowing only as far as is safe:
 *   1. exact
 *   2. zero-padding normalised away on BOTH sides
 *   3. chamber letter reduced to its initial (SB -> S), zeros gone
 *   4. digits alone — and ONLY if that is unique in the state and session, which
 *      is what stops HB2136 being handed back for SB2136
 */
async function resolveBill(sql: Sql, rawState: string, year: number | null, num: string, counts: Counts): Promise<number | null> {
  const state = normaliseState(rawState);
  const digits = (num.match(/\d+/) ?? [""])[0].replace(/^0+/, "");
  const letters = (num.match(/^[A-Z]+/) ?? [""])[0];
  const passes: [string, unknown[]][] = [
    [`bill_number = $3`, [num]],
    [`regexp_replace(upper(bill_number), '^([A-Z]*)0+', '\\1') = $3`, [`${letters}${digits}`]],
    [`regexp_replace(upper(bill_number), '^([A-Z])[A-Z]*0*', '\\1') = $3`, [`${letters.slice(0, 1)}${digits}`]],
    [`regexp_replace(upper(bill_number), '[^0-9]', '', 'g') = $3`, [digits]],
  ];
  for (const [i, [pred, params]] of passes.entries()) {
    if (!digits) break;
    const rows = (await sql.query(
      `SELECT bill_id FROM "Bills" WHERE state = $1 AND ($2::int IS NULL OR session_id = $2) AND ${pred} LIMIT 3`,
      [state, year, ...params],
    )) as { bill_id: number }[];
    // The last pass throws away the chamber letter, so it is only allowed to
    // answer when the answer is unambiguous.
    if (rows.length === 1 || (rows.length > 1 && i < 3)) {
      counts[`resolvedPass${i + 1}`] = (counts[`resolvedPass${i + 1}`] ?? 0) + 1;
      return Number(rows[0].bill_id);
    }
    if (rows.length > 1) counts.ambiguous = (counts.ambiguous ?? 0) + 1;
  }
  // Last resort: drop the YEAR. Three rows label a two-year session by its second
  // year where LegiScan uses its first — the spreadsheet says South Carolina 2016
  // while its own link says /2015 — so the number is right and the session label
  // is not. Only accepted when the state has exactly one bill with that number
  // across every session we hold, which is what keeps it from guessing.
  if (digits && year) {
    const rows = (await sql.query(
      `SELECT bill_id FROM "Bills" WHERE state = $1 AND regexp_replace(upper(bill_number), '^([A-Z]*)0+', '\\1') = $2 LIMIT 3`,
      [state, `${letters}${digits}`],
    )) as { bill_id: number }[];
    if (rows.length === 1) { counts.resolvedPass5 = (counts.resolvedPass5 ?? 0) + 1; return Number(rows[0].bill_id); }
  }
  return null;
}

/**
 * The spreadsheet's `state` column is not always a postal code: eight rows say
 * "U.S. HOUSE" or "U.S. SENATE", which is a chamber, not a state. Our "Bills"
 * calls Congress `US` for both. Left alone these are eight curated federal
 * matches thrown away over a label.
 */
function normaliseState(s: string): string {
  const x = s.trim().toUpperCase().replace(/\./g, "");
  if (/^(US|U S)?\s*(HOUSE|SENATE|CONGRESS)$/.test(x) || x === "US" || x === "U S") return "US";
  return x.slice(0, 2);
}

/**
 * The Center for Public Integrity closed in 2025 and its model-legislation
 * tracker went with it — the host does not resolve, the article 404s, and the
 * Wayback Machine holds the Nuxt shell but not the data: the archived HTML says
 * `serverRendered:true` with `data:[{}]`, and of 603 archived URLs exactly ONE
 * API response was ever captured. The ~10,000 copied bills the tool knew about
 * are, as far as this lane can establish, gone.
 *
 * What survives, and what this loads:
 *   1. PublicI/religious-freedom-bills-data — 549 copycat bills across 49 states
 *      with a Project Blitz category each, produced by the same tool. Human
 *      curated, still on GitHub, and it joins to "Bills" on (state, session, number).
 *   2. The one captured API response, kept as a raw artifact in the cache. It is
 *      NOT loaded as matches: it is a search result for one phrase, with no model
 *      bill on the other end of it, and calling that a curated pair would be
 *      inventing a label the source never made.
 */
async function runCpi(sql: Sql, counts: Counts, fetcher: PoliteFetcher) {
  const dir = path.join(CACHE, "cpi");
  fs.mkdirSync(dir, { recursive: true });

  // Raw first.
  const csvPath = path.join(dir, "religious-freedom-bills.csv");
  let csv = "";
  if (fs.existsSync(csvPath)) { csv = fs.readFileSync(csvPath, "utf8"); counts.fromCache = 1; }
  else {
    const r = await fetcher.get(CPI_CSV);
    if (!r.ok || !r.body) throw new Error(`the CPI spreadsheet did not answer: ${r.error ?? r.status}`);
    csv = new TextDecoder().decode(r.body);
    fs.writeFileSync(csvPath, csv);
    counts.fetched = 1;
  }
  const snapPath = path.join(dir, "api-bills-search-voter-registration-drive.json");
  if (!fs.existsSync(snapPath)) {
    const r = await fetcher.get(CPI_API_SNAPSHOT);
    if (r.ok && r.body) { fs.writeFileSync(snapPath, new TextDecoder().decode(r.body)); counts.apiSnapshot = 1; }
    else counts.apiSnapshotMissing = 1;
  } else counts.apiSnapshot = 1;

  const rows = parseCsv(csv);
  const header = rows.shift() ?? [];
  const col = (name: string) => header.indexOf(name);
  const iState = col("state"), iYear = col("session.year_start"), iNum = col("bill_number"),
        iDesc = col("description"), iStatus = col("status"), iUrl = col("url"), iType = col("Type");
  counts.csvRows = rows.length;

  // One "model" per Project Blitz category — the category IS the label CPI made.
  // No model TEXT, because the playbook itself is not ours to publish and the
  // spreadsheet does not carry it; an empty text column says so honestly.
  const types = [...new Set(rows.map((r) => r[iType]).filter(Boolean))];
  for (const t of types) {
    await sql.query(
      `INSERT INTO "ModelBills" (model_id, source, title, year, issue, type, status, tags, text, url, fetched_at)
       VALUES ($1, 'cpi', $2, 2019, 'Project Blitz', 'Model cluster', 'archived', $3, NULL, $4, now())
       ON CONFLICT (model_id) DO UPDATE SET title = EXCLUDED.title, tags = EXCLUDED.tags, url = EXCLUDED.url, fetched_at = now()`,
      [`cpi:blitz-${slug(t)}`, t, ["Project Blitz", "religious freedom", t], "https://github.com/PublicI/religious-freedom-bills-data"],
    );
  }
  counts.models = types.length;

  let resolved = 0;
  for (const r of rows) {
    const state = normaliseState(r[iState] ?? "");
    const year = Number(r[iYear]) || null;
    const num = (r[iNum] ?? "").trim().toUpperCase();
    if (!state || !num) { counts.badRows = (counts.badRows ?? 0) + 1; continue; }
    const hit = await resolveBill(sql, state, year, num, counts);
    if (hit) resolved += 1;
    await sql.query(
      `INSERT INTO "ModelBillMatches" (model_id, state, session_id, bill_number, bill_id, match_score, source, raw)
       VALUES ($1,$2,$3,$4,$5,NULL,'cpi',$6)
       ON CONFLICT (model_id, source, COALESCE(state, ''), COALESCE(bill_number, ''), COALESCE(session_id, 0))
       DO UPDATE SET bill_id = EXCLUDED.bill_id, raw = EXCLUDED.raw`,
      [`cpi:blitz-${slug(r[iType] ?? "uncategorised")}`, state, year, num, hit,
       JSON.stringify({ description: r[iDesc], status: r[iStatus], url: r[iUrl], type: r[iType] })],
    );
    counts.matches = (counts.matches ?? 0) + 1;
  }
  counts.resolved = resolved;
}

/* ---- census -------------------------------------------------------------- */

async function census(sql: Sql) {
  const models = await sql.query(
    `SELECT source, count(*)::int AS rows, count(*) FILTER (WHERE text IS NOT NULL)::int AS with_text,
            COALESCE(sum(length(text)), 0)::bigint AS chars, min(year)::int AS first_year, max(year)::int AS last_year
       FROM "ModelBills" GROUP BY 1 ORDER BY 2 DESC`,
  );
  const matches = await sql.query(
    `SELECT source, count(*)::int AS rows, count(*) FILTER (WHERE bill_id IS NOT NULL)::int AS resolved,
            count(DISTINCT model_id)::int AS models, count(DISTINCT state)::int AS states
       FROM "ModelBillMatches" GROUP BY 1 ORDER BY 2 DESC`,
  );
  return { models, matches };
}

/* ---- handler ------------------------------------------------------------- */

export default async function handler(req: { headers?: Record<string, string>; query?: Record<string, string> }, res: { status: (n: number) => { json: (o: unknown) => unknown } }) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!dbUrl) return res.status(503).json({ error: "POLICY_DATABASE_URL is required" });

  const t0 = Date.now();
  const counts: Counts = {};
  // Pooled endpoint, same reasoning as api/bill-text.ts: the direct one allows
  // 450 connections and the HTTP driver opens one per query.
  const u = (() => { try { const x = new URL(dbUrl); if (!x.hostname.includes("-pooler")) { const p = x.hostname.split("."); p[0] += "-pooler"; x.hostname = p.join("."); } return x.toString(); } catch { return dbUrl; } })();
  let sql = neon(u);
  try { await sql.query("select 1"); counts.pooled = 1; } catch { sql = neon(dbUrl); counts.pooled = 0; }

  const source = String(req.query?.source ?? "");
  const limit = Math.min(5000, Number(req.query?.limit ?? 0) || 0);
  const fetcher = new PoliteFetcher({ ua: UA, minDelayMs: Math.max(1000, Number(req.query?.delay ?? 1000) || 1000) });

  try {
    await prepareSchema(sql);
    if (req.query?.census) return res.status(200).json({ ok: true, census: true, ...(await census(sql)), ms: Date.now() - t0 });

    if (source === "alec") await runAlec(sql, limit, Boolean(req.query?.refetch), Boolean(req.query?.reparse), counts, fetcher);
    else if (source === "cpi") await runCpi(sql, counts, fetcher);
    else return res.status(400).json({ error: "pass ?source=alec|cpi, or ?census=1" });

    return res.status(200).json({ ok: true, source, ...counts, hosts: fetcher.stats(), dropped: fetcher.stats().filter((h) => h.dropped).map((h) => h.host), ms: Date.now() - t0 });
  } catch (err) {
    return res.status(500).json({ error: String((err as Error).message), source, ...counts, ms: Date.now() - t0 });
  }
}
