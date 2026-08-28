// /api/lda-sync — who lobbied on which federal bill, from the Senate Lobbying
// Disclosure Act API (lda.gov/api). Every filing's activities name the issue,
// the lobbyists, the agencies contacted and a free-text description; the
// description is where bill numbers live ("H.R. 1", "S. 1234", "H.J.Res. 7").
// We pull the filings, keep the activities, extract the bill numbers and
// resolve them against our Congress rows in "Bills" (state = 'US').
//
//   ?year=2025&page=1&pages=40         backfill: walk a filing year, 25 filings a page,
//                                      `pages` pages an invocation; the response carries nextPage.
//   ?mode=delta[&since=YYYY-MM-DD]     daily: everything posted since `since` (default: two days ago).
//   [&types=Q1,Q2,...]                 restrict to filing types (default: all, registrations included).
//
//   Auth: Authorization: Bearer $CRON_SECRET, or ?secret=
//   Env:  LDA_API_KEY (optional — raises the throttle), POLICY_DATABASE_URL, CRON_SECRET

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const config = { maxDuration: 300 };

const API = "https://lda.gov/api/v1";
const PAGE = 25; // the API's ceiling

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sql = NeonQueryFunction<false, false>;

async function lda(key: string | undefined, path: string, params: Record<string, string | number>, counts: Record<string, number>): Promise<any> {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers.Authorization = `Token ${key}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await fetch(`${API}${path}?${qs}`, { headers, signal: AbortSignal.timeout(60_000) });
    counts.queries += 1;
    if (r.status === 429) {
      const wait = Math.min(60, Number(r.headers.get("retry-after") ?? 15) || 15);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`LDA ${path} answered ${r.status}`);
    return r.json();
  }
  throw new Error("LDA throttled three times in a row — run again later");
}

/* ---- bill numbers in prose ---------------------------------------------- */

// Longest forms first so "H.J.Res. 7" is not read as "H.R." + nothing. The lookbehind
// keeps "U.S. 2025" from reading as "S. 2025".
const BILL_RE = /(?<![A-Z.])\b(H\.?\s?J\.?\s?RES\.?|S\.?\s?J\.?\s?RES\.?|H\.?\s?CON\.?\s?RES\.?|S\.?\s?CON\.?\s?RES\.?|H\.?\s?RES\.?|S\.?\s?RES\.?|H\.?\s?R\.?|S\.)\s?(\d{1,5})\b/gi;
const PREFIX: Record<string, string> = { HJRES: "HJR", SJRES: "SJR", HCONRES: "HCR", SCONRES: "SCR", HRES: "HR", SRES: "SR", HR: "HB", S: "SB" };

export function billNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(BILL_RE)) {
    const p = PREFIX[m[1].replace(/[.\s]/g, "").toUpperCase()];
    if (p) out.add(`${p}${Number(m[2])}`);
  }
  return [...out];
}

/* ---- schema -------------------------------------------------------------- */

async function prepareSchema(sql: Sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS "LobbyingFilings" (
    filing_uuid text PRIMARY KEY, filing_year integer, filing_period text, filing_type text, filing_type_display text,
    dt_posted timestamptz, income numeric(14,2), expenses numeric(14,2), expenses_method text,
    registrant_id integer, registrant_name text, client_id integer, client_name text, client_description text,
    client_state text, client_country text, url text, document_url text, fetched_at timestamptz NOT NULL DEFAULT now())`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "LobbyingActivities" (
    filing_uuid text NOT NULL, seq integer NOT NULL, issue_code text, issue text, description text,
    government_entities text[], lobbyists text[], PRIMARY KEY (filing_uuid, seq))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "LobbyingBills" (
    filing_uuid text NOT NULL, seq integer NOT NULL, bill_number text NOT NULL, session_id integer NOT NULL, bill_id bigint,
    PRIMARY KEY (filing_uuid, seq, bill_number))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "LobbyingSync" (key text PRIMARY KEY, value text, updated_at timestamptz NOT NULL DEFAULT now())`);
  for (const [n, t, c] of [
    ["idx_lobbying_filings_year", "LobbyingFilings", "(filing_year, filing_period)"],
    ["idx_lobbying_filings_client", "LobbyingFilings", "(client_name)"],
    ["idx_lobbying_filings_registrant", "LobbyingFilings", "(registrant_name)"],
    ["idx_lobbying_filings_posted", "LobbyingFilings", "(dt_posted)"],
    ["idx_lobbying_activities_issue", "LobbyingActivities", "(issue_code)"],
    ["idx_lobbying_bills_bill", "LobbyingBills", "(bill_id)"],
    ["idx_lobbying_bills_number", "LobbyingBills", "(session_id, bill_number)"],
  ]) await sql.query(`CREATE INDEX IF NOT EXISTS ${n} ON "${t}" ${c}`);
}

/* ---- one page of filings ------------------------------------------------- */

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const sessionFor = (year: number) => (year % 2 === 1 ? year : year - 1);

async function ingest(sql: Sql, filings: any[], counts: Record<string, number>) {
  if (!filings.length) return;
  const f = filings.map((x) => ({
    uuid: String(x.filing_uuid), year: num(x.filing_year), period: str(x.filing_period), type: str(x.filing_type), typeDisplay: str(x.filing_type_display),
    posted: str(x.dt_posted), income: num(x.income), expenses: num(x.expenses), expensesMethod: str(x.expenses_method_display ?? x.expenses_method),
    registrantId: num(x.registrant?.id), registrant: str(x.registrant?.name), clientId: num(x.client?.id), client: str(x.client?.name),
    clientDescription: str(x.client?.general_description), clientState: str(x.client?.state_display ?? x.client?.state), clientCountry: str(x.client?.country_display ?? x.client?.country),
    url: str(x.url), document: str(x.filing_document_url),
  }));
  await sql.query(
    `INSERT INTO "LobbyingFilings" (filing_uuid, filing_year, filing_period, filing_type, filing_type_display, dt_posted, income, expenses, expenses_method,
       registrant_id, registrant_name, client_id, client_name, client_description, client_state, client_country, url, document_url, fetched_at)
     SELECT *, now() FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::numeric[], $8::numeric[], $9::text[],
       $10::int[], $11::text[], $12::int[], $13::text[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[])
     ON CONFLICT (filing_uuid) DO UPDATE SET filing_year = EXCLUDED.filing_year, filing_period = EXCLUDED.filing_period, filing_type = EXCLUDED.filing_type,
       filing_type_display = EXCLUDED.filing_type_display, dt_posted = EXCLUDED.dt_posted, income = EXCLUDED.income, expenses = EXCLUDED.expenses,
       expenses_method = EXCLUDED.expenses_method, registrant_id = EXCLUDED.registrant_id, registrant_name = EXCLUDED.registrant_name,
       client_id = EXCLUDED.client_id, client_name = EXCLUDED.client_name, client_description = EXCLUDED.client_description,
       client_state = EXCLUDED.client_state, client_country = EXCLUDED.client_country, url = EXCLUDED.url, document_url = EXCLUDED.document_url, fetched_at = now()`,
    [f.map((x) => x.uuid), f.map((x) => x.year), f.map((x) => x.period), f.map((x) => x.type), f.map((x) => x.typeDisplay), f.map((x) => x.posted),
      f.map((x) => x.income), f.map((x) => x.expenses), f.map((x) => x.expensesMethod), f.map((x) => x.registrantId), f.map((x) => x.registrant),
      f.map((x) => x.clientId), f.map((x) => x.client), f.map((x) => x.clientDescription), f.map((x) => x.clientState), f.map((x) => x.clientCountry),
      f.map((x) => x.url), f.map((x) => x.document)],
  );
  counts.filings += f.length;

  // Activities and the bills they name. Replace per filing (amendments re-post the whole filing).
  const uuids = f.map((x) => x.uuid);
  await sql.query(`DELETE FROM "LobbyingBills" WHERE filing_uuid = ANY($1::text[])`, [uuids]);
  await sql.query(`DELETE FROM "LobbyingActivities" WHERE filing_uuid = ANY($1::text[])`, [uuids]);
  const acts: { uuid: string; seq: number; code: string | null; issue: string | null; description: string | null; entities: string[]; lobbyists: string[] }[] = [];
  const bills: { uuid: string; seq: number; number: string; session: number }[] = [];
  for (const x of filings) {
    const session = sessionFor(num(x.filing_year) ?? new Date().getFullYear());
    (Array.isArray(x.lobbying_activities) ? x.lobbying_activities : []).forEach((a: any, i: number) => {
      const description = str(a.description);
      acts.push({
        uuid: String(x.filing_uuid), seq: i + 1, code: str(a.general_issue_code), issue: str(a.general_issue_code_display), description,
        entities: (Array.isArray(a.government_entities) ? a.government_entities : []).map((g: any) => String(g?.name ?? g)).filter(Boolean),
        lobbyists: (Array.isArray(a.lobbyists) ? a.lobbyists : []).map((l: any) => [l?.lobbyist?.first_name, l?.lobbyist?.last_name].filter(Boolean).join(" ")).filter(Boolean),
      });
      if (description) for (const n of billNumbers(description)) bills.push({ uuid: String(x.filing_uuid), seq: i + 1, number: n, session });
    });
  }
  if (acts.length)
    await sql.query(
      `INSERT INTO "LobbyingActivities" (filing_uuid, seq, issue_code, issue, description, government_entities, lobbyists)
       SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[][], $7::text[][]) ON CONFLICT DO NOTHING`,
      [acts.map((a) => a.uuid), acts.map((a) => a.seq), acts.map((a) => a.code), acts.map((a) => a.issue), acts.map((a) => a.description),
        acts.map((a) => a.entities), acts.map((a) => a.lobbyists)],
    ).catch(async () => {
      // text[][] must be rectangular; when the lists differ in length insert row by row.
      for (const a of acts)
        await sql.query(
          `INSERT INTO "LobbyingActivities" (filing_uuid, seq, issue_code, issue, description, government_entities, lobbyists) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [a.uuid, a.seq, a.code, a.issue, a.description, a.entities, a.lobbyists],
        );
    });
  counts.activities += acts.length;
  if (bills.length) {
    await sql.query(
      `INSERT INTO "LobbyingBills" (filing_uuid, seq, bill_number, session_id) SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::int[]) ON CONFLICT DO NOTHING`,
      [bills.map((b) => b.uuid), bills.map((b) => b.seq), bills.map((b) => b.number), bills.map((b) => b.session)],
    );
    const resolved = (await sql.query(
      `UPDATE "LobbyingBills" lb SET bill_id = b.bill_id FROM "Bills" b
       WHERE lb.filing_uuid = ANY($1::text[]) AND lb.bill_id IS NULL AND b.state = 'US' AND b.bill_number = lb.bill_number AND b.session_id = lb.session_id
       RETURNING 1`,
      [uuids],
    )) as any[];
    counts.billMentions += bills.length;
    counts.billsResolved += resolved.length;
  }
}

/* ---- handler ------------------------------------------------------------- */

export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const key = process.env.LDA_API_KEY || undefined;
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!dbUrl) return res.status(503).json({ error: "POLICY_DATABASE_URL is required" });

  const sql = neon(dbUrl);
  const mode = String(req.query?.mode ?? "year");
  const year = Number(req.query?.year) || new Date().getFullYear();
  const types = String(req.query?.types ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let page = Math.max(1, Number(req.query?.page) || 1);
  const pages = Math.min(400, Number(req.query?.pages ?? 40) || 40);
  const t0 = Date.now();
  const counts: Record<string, number> = { queries: 0, filings: 0, activities: 0, billMentions: 0, billsResolved: 0 };
  try {
    await prepareSchema(sql);
    const base: Record<string, string | number> = { page_size: PAGE, ordering: "dt_posted" };
    if (types.length) base.filing_type = types.join(",");
    if (mode === "delta") {
      const since = String(req.query?.since ?? new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10));
      base.filing_dt_posted_after = since;
    } else base.filing_year = year;
    let total = 0;
    let next: number | null = page;
    for (let i = 0; i < pages && next; i += 1) {
      const d = await lda(key, "/filings/", { ...base, page: next }, counts);
      total = Number(d?.count ?? 0);
      await ingest(sql, Array.isArray(d?.results) ? d.results : [], counts);
      page = next;
      next = d?.next ? next + 1 : null;
    }
    if (mode !== "delta") await sql.query(`INSERT INTO "LobbyingSync" (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [`year:${year}`, String(next ?? "done")]);
    return res.status(200).json({ ok: true, mode, year: mode === "delta" ? undefined : year, since: base.filing_dt_posted_after, ...counts, total, lastPage: page, nextPage: next, ms: Date.now() - t0 });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message, mode, page, ...counts, ms: Date.now() - t0 });
  }
}
