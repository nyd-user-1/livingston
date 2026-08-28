// /api/fec-sync — federal campaign finance for the Congress members in People,
// from OpenFEC (api.open.fec.gov), joined on bioguide_id.
//
//   ?mode=crosswalk                         bioguide_id → FEC candidate ids, from the
//                                           unitedstates/congress-legislators files
//                                           (current + historical). Two fetches, no API calls.
//   ?cycles=2026,2024&limit=20&refresh=7    pull members whose finance is older than
//   [&person=<people_id>]                   `refresh` days, for the cycles given.
//
// Per member: candidate totals for every cycle (1 call), their committees (1),
// then per requested cycle and principal/authorized committee: independent
// expenditures for/against (1), receipts by employer / size / state (3), and the
// 100 largest itemized receipts (1). ~2 + 5 × cycles calls a member; the key
// allows 1,000 an hour. Stops the run on the first 429.
//
//   Auth: Authorization: Bearer $CRON_SECRET, or ?secret=
//   Env:  FEC_API_KEY, POLICY_DATABASE_URL, CRON_SECRET

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const config = { maxDuration: 300 };

const API = "https://api.open.fec.gov/v1";
const LEGISLATORS = "https://unitedstates.github.io/congress-legislators";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sql = NeonQueryFunction<false, false>;
type Params = Record<string, string | number | (string | number)[]>;

// api.data.gov also enforces a burst window (the key reports x-ratelimit-limit: 60),
// so requests go out one at a time, `FEC_PACE_MS` apart (default 1,100 ms).
const PACE_MS = Math.max(0, Number(process.env.FEC_PACE_MS ?? 1100) || 1100);
let lastCall = 0;

async function fec(key: string, path: string, params: Params, counts: Record<string, number>): Promise<any> {
  const qs = new URLSearchParams({ api_key: key, per_page: "100" });
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) qs.append(k, String(x));
  for (let attempt = 0; ; attempt += 1) {
    const wait = lastCall + PACE_MS - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    lastCall = Date.now();
    const r = await fetch(`${API}${path}?${qs}`, { signal: AbortSignal.timeout(60_000) });
    counts.queries += 1;
    if (r.status === 429) throw new Error("OpenFEC rate limit reached — run again later");
    // The gateway times out now and then (502/504); one retry after a pause is enough.
    if (r.status >= 500 && attempt < 2) {
      await new Promise((ok) => setTimeout(ok, 5_000));
      continue;
    }
    if (!r.ok) throw new Error(`OpenFEC ${path} answered ${r.status}`);
    const data: any = await r.json();
    return data?.results ?? [];
  }
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const day = (v: unknown): string | null => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);

/* ---- schema -------------------------------------------------------------- */

async function prepareSchema(sql: Sql) {
  for (const [c, t] of [["fec_candidate_ids", "text[]"], ["fec_fetched_at", "timestamptz"], ["fec_extras_at", "timestamptz"], ["fec_error", "text"]])
    await sql.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS ${c} ${t}`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FecTotals" (
    people_id integer NOT NULL, candidate_id text NOT NULL, cycle integer NOT NULL,
    receipts numeric(14,2), individual_contributions numeric(14,2), individual_itemized_contributions numeric(14,2),
    individual_unitemized_contributions numeric(14,2), other_political_committee_contributions numeric(14,2),
    political_party_committee_contributions numeric(14,2), candidate_contribution numeric(14,2), loans_received numeric(14,2),
    transfers_from_other_authorized_committee numeric(14,2), disbursements numeric(14,2), operating_expenditures numeric(14,2),
    cash_on_hand_end numeric(14,2), debts_owed_by_committee numeric(14,2), coverage_start date, coverage_end date,
    last_report_type text, raw jsonb, fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (people_id, candidate_id, cycle))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FecCommittees" (
    people_id integer NOT NULL, candidate_id text NOT NULL, committee_id text NOT NULL, name text,
    designation text, designation_full text, committee_type_full text, cycles integer[], raw jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (people_id, committee_id))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FecIndependentExpenditures" (
    people_id integer NOT NULL, candidate_id text NOT NULL, cycle integer NOT NULL, committee_id text NOT NULL,
    committee_name text, support_oppose text NOT NULL, count integer, total numeric(14,2),
    fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (people_id, cycle, committee_id, support_oppose))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FecReceiptsByEmployer" (
    people_id integer NOT NULL, committee_id text NOT NULL, cycle integer NOT NULL, employer text NOT NULL,
    count integer, total numeric(14,2), fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (people_id, committee_id, cycle, employer))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FecReceiptsBySize" (
    people_id integer NOT NULL, committee_id text NOT NULL, cycle integer NOT NULL, size integer NOT NULL,
    count integer, total numeric(14,2), fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (people_id, committee_id, cycle, size))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FecReceiptsByState" (
    people_id integer NOT NULL, committee_id text NOT NULL, cycle integer NOT NULL, state text NOT NULL,
    count integer, total numeric(14,2), fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (people_id, committee_id, cycle, state))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "FecContributions" (
    sub_id text PRIMARY KEY, people_id integer NOT NULL, committee_id text NOT NULL, cycle integer NOT NULL,
    contributor_name text, contributor_employer text, contributor_occupation text, contributor_city text,
    contributor_state text, contributor_zip text, entity_type text, amount numeric(14,2), date date,
    receipt_type text, aggregate_ytd numeric(14,2), pdf_url text, raw jsonb, fetched_at timestamptz NOT NULL DEFAULT now())`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_fec_contributions_person ON "FecContributions"(people_id, cycle)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_fec_contributions_name ON "FecContributions"(contributor_name)`);
}

/* ---- crosswalk ----------------------------------------------------------- */

async function runCrosswalk(sql: Sql, counts: Record<string, number>) {
  const byBioguide = new Map<string, string[]>();
  for (const file of ["legislators-current.json", "legislators-historical.json"]) {
    const r = await fetch(`${LEGISLATORS}/${file}`, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`${file} answered ${r.status}`);
    const list = (await r.json()) as any[];
    for (const m of list) {
      const b = m?.id?.bioguide;
      const f: string[] = Array.isArray(m?.id?.fec) ? m.id.fec.map(String) : [];
      if (b && f.length) byBioguide.set(String(b), f);
    }
    counts[file.replace(".json", "")] = list.length;
  }
  // Flattened pairs (a member can have several FEC ids), re-aggregated in SQL.
  const bioguides: string[] = [];
  const fecIds: string[] = [];
  for (const [b, list] of byBioguide) for (const f of list) { bioguides.push(b); fecIds.push(f); }
  const updated = (await sql.query(
    `WITH x AS (SELECT bioguide_id, array_agg(fec) AS fecs FROM unnest($1::text[], $2::text[]) AS t(bioguide_id, fec) GROUP BY 1)
     UPDATE "People" p SET fec_candidate_ids = x.fecs FROM x WHERE p.bioguide_id = x.bioguide_id RETURNING 1`,
    [bioguides, fecIds],
  )) as any[];
  counts.members = byBioguide.size;
  counts.matched = updated.length;
}

/* ---- one member ---------------------------------------------------------- */

type Person = { people_id: number; name: string; fec_candidate_ids: string[] };

// detail: "basic" = totals, committees, independent expenditures, receipts by employer, top receipts (2 + 3 × cycles calls a member);
//         "extras" = only receipts by size and by state, for members basic has already covered (2 calls a committee-cycle);
//         "full"   = both.
type Detail = "basic" | "extras" | "full";

async function pull(sql: Sql, key: string, p: Person, cycles: number[], detail: Detail, counts: Record<string, number>) {
  for (const cid of p.fec_candidate_ids) {
    // Totals, every cycle on file.
    // election_full=false → one row per two-year cycle with `cycle` set; the default mixes in
    // full-election aggregates whose cycle is null.
    const totals = detail === "extras" ? [] : await fec(key, `/candidate/${cid}/totals/`, { election_full: "false", sort: "-cycle" }, counts);
    for (const t of totals) {
      if (num(t.cycle) == null) continue;
      await sql.query(
        `INSERT INTO "FecTotals" (people_id, candidate_id, cycle, receipts, individual_contributions, individual_itemized_contributions,
           individual_unitemized_contributions, other_political_committee_contributions, political_party_committee_contributions,
           candidate_contribution, loans_received, transfers_from_other_authorized_committee, disbursements, operating_expenditures,
           cash_on_hand_end, debts_owed_by_committee, coverage_start, coverage_end, last_report_type, raw, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())
         ON CONFLICT (people_id, candidate_id, cycle) DO UPDATE SET
           receipts = EXCLUDED.receipts, individual_contributions = EXCLUDED.individual_contributions,
           individual_itemized_contributions = EXCLUDED.individual_itemized_contributions,
           individual_unitemized_contributions = EXCLUDED.individual_unitemized_contributions,
           other_political_committee_contributions = EXCLUDED.other_political_committee_contributions,
           political_party_committee_contributions = EXCLUDED.political_party_committee_contributions,
           candidate_contribution = EXCLUDED.candidate_contribution, loans_received = EXCLUDED.loans_received,
           transfers_from_other_authorized_committee = EXCLUDED.transfers_from_other_authorized_committee,
           disbursements = EXCLUDED.disbursements, operating_expenditures = EXCLUDED.operating_expenditures,
           cash_on_hand_end = EXCLUDED.cash_on_hand_end, debts_owed_by_committee = EXCLUDED.debts_owed_by_committee,
           coverage_start = EXCLUDED.coverage_start, coverage_end = EXCLUDED.coverage_end,
           last_report_type = EXCLUDED.last_report_type, raw = EXCLUDED.raw, fetched_at = now()`,
        [p.people_id, cid, num(t.cycle), num(t.receipts), num(t.individual_contributions), num(t.individual_itemized_contributions),
          num(t.individual_unitemized_contributions), num(t.other_political_committee_contributions), num(t.political_party_committee_contributions),
          num(t.candidate_contribution), num(t.loans_received), num(t.transfers_from_other_authorized_committee), num(t.disbursements),
          num(t.operating_expenditures), num(t.last_cash_on_hand_end_period), num(t.last_debts_owed_by_committee),
          day(t.coverage_start_date), day(t.coverage_end_date), str(t.last_report_type_full), JSON.stringify(t)],
      );
      counts.totals += 1;
    }

    // Committees the candidate has authorized (principal campaign committee and other authorized ones).
    const committees: any[] = detail === "extras"
      ? ((await sql.query(`SELECT committee_id, cycles FROM "FecCommittees" WHERE people_id = $1 AND candidate_id = $2`, [p.people_id, cid])) as any[])
      : await fec(key, `/candidate/${cid}/committees/`, { designation: ["P", "A"] }, counts);
    if (detail !== "extras") for (const c of committees) {
      await sql.query(
        `INSERT INTO "FecCommittees" (people_id, candidate_id, committee_id, name, designation, designation_full, committee_type_full, cycles, raw, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (people_id, committee_id) DO UPDATE SET name = EXCLUDED.name, designation = EXCLUDED.designation,
           designation_full = EXCLUDED.designation_full, committee_type_full = EXCLUDED.committee_type_full, cycles = EXCLUDED.cycles, raw = EXCLUDED.raw, fetched_at = now()`,
        [p.people_id, cid, c.committee_id, str(c.name), str(c.designation), str(c.designation_full), str(c.committee_type_full),
          Array.isArray(c.cycles) ? c.cycles.map(Number) : [], JSON.stringify(c)],
      );
      counts.committees += 1;
    }

    for (const cycle of cycles) {
      // Independent expenditures for or against the candidate.
      const ie = detail === "extras" ? [] : await fec(key, `/schedules/schedule_e/by_candidate/`, { candidate_id: cid, cycle, election_full: "true" }, counts);
      if (detail !== "extras") await sql.query(`DELETE FROM "FecIndependentExpenditures" WHERE people_id = $1 AND candidate_id = $2 AND cycle = $3`, [p.people_id, cid, cycle]);
      for (const e of ie) {
        await sql.query(
          `INSERT INTO "FecIndependentExpenditures" (people_id, candidate_id, cycle, committee_id, committee_name, support_oppose, count, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [p.people_id, cid, cycle, str(e.committee_id) ?? "?", str(e.committee_name), str(e.support_oppose_indicator) ?? "?", num(e.count), num(e.total)],
        );
        counts.independentExpenditures += 1;
      }

      const active = committees.filter((c: any) => !Array.isArray(c.cycles) || c.cycles.map(Number).includes(cycle));
      for (const c of active) {
        const committee_id = String(c.committee_id);
        const base = { committee_id, cycle };
        const byEmployer = detail === "extras" ? [] : await fec(key, `/schedules/schedule_a/by_employer/`, { ...base, sort: "-total" }, counts);
        const bySize = detail === "basic" ? [] : await fec(key, `/schedules/schedule_a/by_size/`, base, counts);
        const byState = detail === "basic" ? [] : await fec(key, `/schedules/schedule_a/by_state/`, { ...base, sort: "-total" }, counts);
        if (detail !== "extras") await sql.query(`DELETE FROM "FecReceiptsByEmployer" WHERE people_id = $1 AND committee_id = $2 AND cycle = $3`, [p.people_id, committee_id, cycle]);
        if (detail !== "basic") {
          await sql.query(`DELETE FROM "FecReceiptsBySize" WHERE people_id = $1 AND committee_id = $2 AND cycle = $3`, [p.people_id, committee_id, cycle]);
          await sql.query(`DELETE FROM "FecReceiptsByState" WHERE people_id = $1 AND committee_id = $2 AND cycle = $3`, [p.people_id, committee_id, cycle]);
        }
        if (byEmployer.length)
          await sql.query(
            `INSERT INTO "FecReceiptsByEmployer" (people_id, committee_id, cycle, employer, count, total)
             SELECT $1, $2, $3, * FROM unnest($4::text[], $5::int[], $6::numeric[]) ON CONFLICT DO NOTHING`,
            [p.people_id, committee_id, cycle, byEmployer.map((r: any) => str(r.employer) ?? "(none)"), byEmployer.map((r: any) => num(r.count)), byEmployer.map((r: any) => num(r.total))],
          );
        if (bySize.length)
          await sql.query(
            `INSERT INTO "FecReceiptsBySize" (people_id, committee_id, cycle, size, count, total)
             SELECT $1, $2, $3, * FROM unnest($4::int[], $5::int[], $6::numeric[]) ON CONFLICT DO NOTHING`,
            [p.people_id, committee_id, cycle, bySize.map((r: any) => num(r.size) ?? 0), bySize.map((r: any) => num(r.count)), bySize.map((r: any) => num(r.total))],
          );
        if (byState.length)
          await sql.query(
            `INSERT INTO "FecReceiptsByState" (people_id, committee_id, cycle, state, count, total)
             SELECT $1, $2, $3, * FROM unnest($4::text[], $5::int[], $6::numeric[]) ON CONFLICT DO NOTHING`,
            [p.people_id, committee_id, cycle, byState.map((r: any) => str(r.state) ?? "??"), byState.map((r: any) => num(r.count)), byState.map((r: any) => num(r.total))],
          );
        counts.aggregates += byEmployer.length + bySize.length + byState.length;

        // The 100 largest itemized receipts this cycle.
        if (detail === "extras") continue;
        const top = await fec(key, `/schedules/schedule_a/`, { committee_id, two_year_transaction_period: cycle, sort: "-contribution_receipt_amount", is_individual: "true" }, counts);
        await sql.query(`DELETE FROM "FecContributions" WHERE people_id = $1 AND committee_id = $2 AND cycle = $3`, [p.people_id, committee_id, cycle]);
        if (top.length)
          await sql.query(
            `INSERT INTO "FecContributions" (sub_id, people_id, committee_id, cycle, contributor_name, contributor_employer, contributor_occupation,
               contributor_city, contributor_state, contributor_zip, entity_type, amount, date, receipt_type, aggregate_ytd, pdf_url, raw)
             SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
               $11::text[], $12::numeric[], $13::date[], $14::text[], $15::numeric[], $16::text[], $17::jsonb[])
             ON CONFLICT (sub_id) DO NOTHING`,
            [top.map((r: any) => String(r.sub_id)), top.map(() => p.people_id), top.map(() => committee_id), top.map(() => cycle),
              top.map((r: any) => str(r.contributor_name)), top.map((r: any) => str(r.contributor_employer)), top.map((r: any) => str(r.contributor_occupation)),
              top.map((r: any) => str(r.contributor_city)), top.map((r: any) => str(r.contributor_state)), top.map((r: any) => str(r.contributor_zip)),
              top.map((r: any) => str(r.entity_type)), top.map((r: any) => num(r.contribution_receipt_amount)), top.map((r: any) => day(r.contribution_receipt_date)),
              top.map((r: any) => str(r.receipt_type_full) ?? str(r.receipt_type)), top.map((r: any) => num(r.contributor_aggregate_ytd)), top.map((r: any) => str(r.pdf_url)),
              top.map((r: any) => JSON.stringify(r))],
          );
        counts.contributions += top.length;
      }
    }
  }
  const stamp = detail === "basic" ? "fec_fetched_at = now()" : detail === "extras" ? "fec_extras_at = now()" : "fec_fetched_at = now(), fec_extras_at = now()";
  await sql.query(`UPDATE "People" SET ${stamp}, fec_error = NULL WHERE people_id = $1`, [p.people_id]);
  counts.people += 1;
}

/* ---- handler ------------------------------------------------------------- */

export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const key = process.env.FEC_API_KEY;
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!key || !dbUrl) return res.status(503).json({ error: "FEC_API_KEY and POLICY_DATABASE_URL are both required" });

  const sql = neon(dbUrl);
  const mode = String(req.query?.mode ?? "pull");
  const thisCycle = new Date().getFullYear() + (new Date().getFullYear() % 2);
  const cycles = String(req.query?.cycles ?? thisCycle).split(",").map(Number).filter((n) => n >= 1980 && n % 2 === 0);
  const limit = Math.min(100, Number(req.query?.limit ?? 20) || 20);
  const refreshDays = Math.max(1, Number(req.query?.refresh ?? 7) || 7);
  const person = Number(req.query?.person) || 0;
  const detail: Detail = req.query?.detail === "full" ? "full" : req.query?.detail === "extras" ? "extras" : "basic";
  // Extras run only for members basic has covered; basic/full run for members never pulled or stale.
  const stampCol = detail === "extras" ? "fec_extras_at" : "fec_fetched_at";
  const gate = detail === "extras" ? "fec_fetched_at IS NOT NULL" : "TRUE";
  const t0 = Date.now();
  const counts: Record<string, number> = { queries: 0, people: 0, totals: 0, committees: 0, independentExpenditures: 0, aggregates: 0, contributions: 0 };
  let current: Person | null = null;
  try {
    await prepareSchema(sql);
    if (mode === "crosswalk") {
      await runCrosswalk(sql, counts);
      return res.status(200).json({ ok: true, mode, ...counts, ms: Date.now() - t0 });
    }
    const due = (await sql.query(
      `SELECT people_id, name, fec_candidate_ids FROM "People"
       WHERE fec_candidate_ids IS NOT NULL AND cardinality(fec_candidate_ids) > 0 AND ${gate}
         AND ($1 = 0 OR people_id = $1)
         AND ($1 <> 0 OR ${stampCol} IS NULL OR ${stampCol} < now() - ($2 || ' days')::interval)
       ORDER BY (archived IS TRUE), ${stampCol} NULLS FIRST, people_id
       LIMIT $3`,
      [person, String(refreshDays), limit],
    )) as Person[];
    for (const p of due) {
      current = p;
      await pull(sql, key, p, cycles, detail, counts);
    }
    const [left] = (await sql.query(
      `SELECT count(*)::int AS n FROM "People" WHERE fec_candidate_ids IS NOT NULL AND cardinality(fec_candidate_ids) > 0 AND ${gate}
         AND (${stampCol} IS NULL OR ${stampCol} < now() - ($1 || ' days')::interval)`,
      [String(refreshDays)],
    )) as { n: number }[];
    return res.status(200).json({ ok: true, mode, detail, cycles, ...counts, remaining: left?.n ?? null, ms: Date.now() - t0 });
  } catch (err) {
    const message = (err as Error).message;
    if (current) await sql.query(`UPDATE "People" SET fec_error = $2 WHERE people_id = $1`, [current.people_id, message]).catch(() => undefined);
    return res.status(500).json({ error: message, at: current ? { people_id: current.people_id, name: current.name } : null, ...counts, ms: Date.now() - t0 });
  }
}
