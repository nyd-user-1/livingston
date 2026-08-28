// /api/ftm-sync — campaign finance for the People table, from FollowTheMoney
// (the National Institute on Money in Politics), joined on the entity id that
// LegiScan already gives us: People.followthemoney_eid.
//
//   ?state=NY&limit=25&refresh=30 [&person=<people_id>]
//
// Four calls per legislator, all against api.followthemoney.org filtered by
// the person's career entity (c-t-eid = followthemoney_eid), 100 rows a page:
//
//   gro=c-t-id   every candidacy: year, office, party, outcome, total  → "Finance"
//   gro=d-ccg    totals by contributing sector                          → "FinanceSectors"
//   gro=d-eid    the top 100 contributors (default sort: Total_$ desc)  → "FinanceContributors"
//   gro=d-ins    in-state / out-of-state / unknown totals               → People.ftm_*
//
// The API's rate limits are undocumented, so this runs sequentially, takes a
// small batch a call, and stops the run on the first {"error": …} it sees.
// Every row also keeps the raw record (jsonb) — the tag names come from the
// 2013 manual, and the live API may spell some differently.
//
//   Auth: Authorization: Bearer $CRON_SECRET, or ?secret=
//   Env:  FOLLOWTHEMONEY_API_KEY, POLICY_DATABASE_URL, CRON_SECRET

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const config = { maxDuration: 300 };

const API = "https://api.followthemoney.org/";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sql = NeonQueryFunction<false, false>;

async function ftm(key: string, params: Record<string, string | number>, counts: Record<string, number>): Promise<any> {
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), mode: "json", APIKey: key });
  const r = await fetch(`${API}?${qs}`, { signal: AbortSignal.timeout(60_000) });
  counts.queries += 1;
  if (!r.ok) throw new Error(`FollowTheMoney answered ${r.status}`);
  const data: any = await r.json();
  if (data?.error) throw new Error(`FollowTheMoney: ${data.error}`);
  return data;
}

/* ---- reading a record ---------------------------------------------------- */
// A grouped record looks like { "Candidate": { token, id, "Candidate": "…" },
// "#_of_Records": { "#_of_Records": "5" }, "Total_$": { "Total_$": "435000.00" } }.

const records = (d: any): any[] => (Array.isArray(d?.records) ? d.records : []);
const val = (rec: any, ...tags: string[]): string | null => {
  for (const tag of tags) {
    const t = rec?.[tag];
    if (t == null) continue;
    if (typeof t !== "object") return String(t);
    const v = t[tag];
    if (v != null && v !== "") return String(v);
  }
  return null;
};
const idOf = (rec: any, ...tags: string[]): string | null => {
  for (const tag of tags) {
    const v = rec?.[tag]?.id;
    if (v != null && v !== "") return String(v);
  }
  return null;
};
const num = (s: string | null): number | null => {
  if (s == null) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const int = (s: string | null): number | null => {
  const n = num(s);
  return n == null ? null : Math.trunc(n);
};
const count = (rec: any) => int(val(rec, "#_of_Records", "Num_of_Records"));
const total = (rec: any) => num(val(rec, "Total_$", "Total_Dollars"));

/* ---- schema -------------------------------------------------------------- */

async function prepareSchema(sql: Sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS "Finance" (
    people_id integer NOT NULL, followthemoney_eid bigint NOT NULL, candidate_id bigint NOT NULL,
    election_year integer, election_state text, election_type text, office text, office_type text,
    party text, status text, incumbency text, records integer, total numeric(14,2), raw jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (people_id, candidate_id))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FinanceSectors" (
    people_id integer NOT NULL, sector_id integer NOT NULL, sector text, records integer, total numeric(14,2),
    fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (people_id, sector_id))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FinanceContributors" (
    people_id integer NOT NULL, contributor_eid bigint NOT NULL, contributor text, contributor_type text,
    rank integer, records integer, total numeric(14,2), raw jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (people_id, contributor_eid))`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_finance_year ON "Finance"(election_year)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_finance_contrib_eid ON "FinanceContributors"(contributor_eid)`);
  for (const [c, t] of [["ftm_total", "numeric(14,2)"], ["ftm_in_state", "numeric(14,2)"], ["ftm_out_of_state", "numeric(14,2)"], ["ftm_records", "integer"], ["ftm_last_updated", "timestamptz"], ["ftm_fetched_at", "timestamptz"], ["ftm_error", "text"]])
    await sql.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS ${c} ${t}`);
}

/* ---- one legislator ------------------------------------------------------ */

type Person = { people_id: number; followthemoney_eid: string; name: string; state: string };

async function pull(sql: Sql, key: string, p: Person, counts: Record<string, number>) {
  const eid = p.followthemoney_eid;

  // Candidacies — one row per run for office.
  const cand = await ftm(key, { "c-t-eid": eid, gro: "c-t-id" }, counts);
  const candidacies = records(cand).map((r) => ({
    candidate_id: idOf(r, "Candidate"),
    election_year: int(val(r, "Election_Year")),
    election_state: val(r, "Election_State"),
    election_type: val(r, "Election_Type"),
    office: val(r, "Office_Sought"),
    office_type: val(r, "Type_of_Office"),
    party: val(r, "Party_Details", "Specific_Party", "Political_Party", "General_Party"),
    status: val(r, "Election_Status", "Status_of_Candidate"),
    incumbency: val(r, "Incumbency_Status", "Incumbency_Data"),
    records: count(r),
    total: total(r),
    raw: r,
  })).filter((c) => c.candidate_id);

  // Sectors.
  const sect = await ftm(key, { "c-t-eid": eid, gro: "d-ccg" }, counts);
  const sectors = records(sect).map((r) => ({ sector_id: int(idOf(r, "Sector")), sector: val(r, "Sector"), records: count(r), total: total(r) })).filter((s) => s.sector_id != null);

  // Top contributors — page 0 of the default sort (Total_$ descending).
  const contrib = await ftm(key, { "c-t-eid": eid, gro: "d-eid" }, counts);
  const contributors = records(contrib).map((r, i) => ({ contributor_eid: idOf(r, "Contributor"), contributor: val(r, "Contributor"), contributor_type: val(r, "Type_of_Contributor"), rank: i + 1, records: count(r), total: total(r), raw: r })).filter((c) => c.contributor_eid);

  // In-state / out-of-state / unknown.
  const ins = await ftm(key, { "c-t-eid": eid, gro: "d-ins" }, counts);
  let inState = 0, outOfState = 0, all = 0, n = 0;
  for (const r of records(ins)) {
    const t = total(r) ?? 0;
    const which = idOf(r, "In-State", "In_State") ?? val(r, "In-State", "In_State");
    all += t;
    n += count(r) ?? 0;
    if (which === "1") inState += t;
    else if (which === "0") outOfState += t;
  }
  const lastUpdated = ins?.metaInfo?.completeness?.lastUpdated ?? cand?.metaInfo?.completeness?.lastUpdated ?? null;

  // Write: replace the person's children, then stamp the person.
  await sql.query(`DELETE FROM "Finance" WHERE people_id = $1`, [p.people_id]);
  await sql.query(`DELETE FROM "FinanceSectors" WHERE people_id = $1`, [p.people_id]);
  await sql.query(`DELETE FROM "FinanceContributors" WHERE people_id = $1`, [p.people_id]);
  if (candidacies.length)
    await sql.query(
      `INSERT INTO "Finance" (people_id, followthemoney_eid, candidate_id, election_year, election_state, election_type, office, office_type, party, status, incumbency, records, total, raw)
       SELECT $1, $2, * FROM unnest($3::bigint[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::int[], $13::numeric[], $14::jsonb[])
       ON CONFLICT (people_id, candidate_id) DO NOTHING`,
      [p.people_id, eid, candidacies.map((c) => c.candidate_id), candidacies.map((c) => c.election_year), candidacies.map((c) => c.election_state), candidacies.map((c) => c.election_type), candidacies.map((c) => c.office), candidacies.map((c) => c.office_type), candidacies.map((c) => c.party), candidacies.map((c) => c.status), candidacies.map((c) => c.incumbency), candidacies.map((c) => c.records), candidacies.map((c) => c.total), candidacies.map((c) => JSON.stringify(c.raw))],
    );
  if (sectors.length)
    await sql.query(
      `INSERT INTO "FinanceSectors" (people_id, sector_id, sector, records, total)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::int[], $5::numeric[])
       ON CONFLICT (people_id, sector_id) DO NOTHING`,
      [p.people_id, sectors.map((s) => s.sector_id), sectors.map((s) => s.sector), sectors.map((s) => s.records), sectors.map((s) => s.total)],
    );
  if (contributors.length)
    await sql.query(
      `INSERT INTO "FinanceContributors" (people_id, contributor_eid, contributor, contributor_type, rank, records, total, raw)
       SELECT $1, * FROM unnest($2::bigint[], $3::text[], $4::text[], $5::int[], $6::int[], $7::numeric[], $8::jsonb[])
       ON CONFLICT (people_id, contributor_eid) DO NOTHING`,
      [p.people_id, contributors.map((c) => c.contributor_eid), contributors.map((c) => c.contributor), contributors.map((c) => c.contributor_type), contributors.map((c) => c.rank), contributors.map((c) => c.records), contributors.map((c) => c.total), contributors.map((c) => JSON.stringify(c.raw))],
    );
  await sql.query(
    `UPDATE "People" SET ftm_total = $2, ftm_in_state = $3, ftm_out_of_state = $4, ftm_records = $5, ftm_last_updated = $6, ftm_fetched_at = now(), ftm_error = NULL WHERE people_id = $1`,
    [p.people_id, all, inState, outOfState, n, lastUpdated],
  );
  counts.people += 1;
  counts.candidacies += candidacies.length;
  counts.sectors += sectors.length;
  counts.contributors += contributors.length;
}

/* ---- handler ------------------------------------------------------------- */

export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const key = process.env.FOLLOWTHEMONEY_API_KEY;
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!key || !dbUrl) return res.status(503).json({ error: "FOLLOWTHEMONEY_API_KEY and POLICY_DATABASE_URL are both required" });

  const sql = neon(dbUrl);
  const state = String(req.query?.state ?? "").toUpperCase();
  const limit = Math.min(200, Number(req.query?.limit ?? 25) || 25);
  const refreshDays = Math.max(1, Number(req.query?.refresh ?? 30) || 30);
  const person = Number(req.query?.person) || 0;
  const t0 = Date.now();
  const counts: Record<string, number> = { queries: 0, people: 0, candidacies: 0, sectors: 0, contributors: 0 };
  let current: Person | null = null;
  try {
    await prepareSchema(sql);
    const due = (await sql.query(
      `SELECT people_id, followthemoney_eid::text AS followthemoney_eid, name, state FROM "People"
       WHERE followthemoney_eid IS NOT NULL
         AND ($1 = '' OR state = $1)
         AND ($2 = 0 OR people_id = $2)
         AND ($2 <> 0 OR ftm_fetched_at IS NULL OR ftm_fetched_at < now() - ($3 || ' days')::interval)
       ORDER BY (archived IS TRUE), ftm_fetched_at NULLS FIRST, people_id
       LIMIT $4`,
      [state, person, String(refreshDays), limit],
    )) as Person[];
    for (const p of due) {
      current = p;
      await pull(sql, key, p, counts);
    }
    const [left] = (await sql.query(
      `SELECT count(*)::int AS n FROM "People" WHERE followthemoney_eid IS NOT NULL AND ($1 = '' OR state = $1) AND (ftm_fetched_at IS NULL OR ftm_fetched_at < now() - ($2 || ' days')::interval)`,
      [state, String(refreshDays)],
    )) as { n: number }[];
    return res.status(200).json({ ok: true, state: state || "ALL", ...counts, remaining: left?.n ?? null, ms: Date.now() - t0 });
  } catch (err) {
    const message = (err as Error).message;
    if (current) await sql.query(`UPDATE "People" SET ftm_error = $2 WHERE people_id = $1`, [current.people_id, message]).catch(() => undefined);
    return res.status(500).json({ error: message, at: current ? { people_id: current.people_id, name: current.name, eid: current.followthemoney_eid } : null, ...counts, ms: Date.now() - t0 });
  }
}
