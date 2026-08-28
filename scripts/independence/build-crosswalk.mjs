#!/usr/bin/env node
// scripts/independence/build-crosswalk.mjs — lane IN, step 5.
//
// Every table we own is keyed on LegiScan's proprietary ids (bill_id, people_id, roll_call_id).
// If LegiScan stops, those ids stop being mintable — and any replacement source keys on
// (state, session, bill_number) instead. The crosswalk between the two can only be built while
// BOTH exist, which is now. It is cheap, it is read-only against public.*, and it lives in
// schema openstates so this lane writes nothing outside its sandbox.
//
//   node scripts/independence/build-crosswalk.mjs [--refresh]

import pg from "pg";
const c = new pg.Client({ connectionString: process.env.POLICY_DATABASE_URL });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS openstates.bill_crosswalk (
  state text NOT NULL, session_id bigint NOT NULL, bill_key text NOT NULL, special smallint NOT NULL,
  bill_id bigint NOT NULL, bill_number_raw text, legiscan_session_id bigint, session_title text,
  built_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state, session_id, bill_key, special)
)`);
if (process.argv.includes("--refresh")) await c.query(`TRUNCATE openstates.bill_crosswalk`);

// bill_key normalises away LegiScan's zero padding, because no other source uses it:
//   ours A00021 -> A21     Open States A100 -> A100
const t0 = Date.now();
const { rowCount } = await c.query(`
INSERT INTO openstates.bill_crosswalk (state, session_id, bill_key, special, bill_id, bill_number_raw, legiscan_session_id, session_title)
SELECT DISTINCT ON (state, session_id, bill_key, special) * FROM (
  SELECT state, session_id,
         regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') AS bill_key,
         special, bill_id, bill_number AS bill_number_raw, legiscan_session_id, session_title
  FROM public."Bills" WHERE bill_number IS NOT NULL AND session_id IS NOT NULL
) z ORDER BY state, session_id, bill_key, special, bill_id
ON CONFLICT DO NOTHING`);

// An independent count from the source, not a restatement of what the INSERT believed
// (ORCHESTRATION §2): re-derive the expected number straight from public."Bills".
const [{ src_distinct, src_rows }] = (await c.query(`
  SELECT count(DISTINCT (state, session_id,
           regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2'), special)) AS src_distinct,
         count(*) AS src_rows
  FROM public."Bills" WHERE bill_number IS NOT NULL AND session_id IS NOT NULL`)).rows;
const [{ n }] = (await c.query(`SELECT count(*) n FROM openstates.bill_crosswalk`)).rows;

const ok = String(n) === String(src_distinct);
console.log(JSON.stringify({
  inserted: rowCount, crosswalk_rows: Number(n),
  source_rows: Number(src_rows), source_distinct_keys: Number(src_distinct),
  collapsed_duplicates: Number(src_rows) - Number(src_distinct),
  coverage_verified: ok, seconds: +((Date.now() - t0) / 1000).toFixed(1),
}, null, 1));
await c.end();
if (!ok) { console.error("CROSSWALK COVERAGE MISMATCH — refusing to report success"); process.exit(1); }
