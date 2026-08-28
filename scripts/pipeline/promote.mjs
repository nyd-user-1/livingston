#!/usr/bin/env node
// scripts/pipeline/promote.mjs — the switch. Read this before running it.
//
//   node scripts/pipeline/promote.mjs NY --session 2025 --source nysenate            # dry run (default)
//   node scripts/pipeline/promote.mjs NY --session 2025 --source nysenate --apply --confirm NY
//
// For a jurisdiction that has come back `parity` on TWO CONSECUTIVE reconciles,
// this makes the direct pipeline the writer of the canonical tables for NEW rows
// — rows we do not already have. It never rewrites a row LegiScan owns, and it
// never deletes anything.
//
// FOUR LOCKS, and all four have to be open:
//   1. --apply. Without it this prints what it would do and writes nothing.
//   2. --confirm <STATE>, matching the jurisdiction. The brief's words: "Runs
//      only on Brendan's explicit instruction per jurisdiction." Typing the
//      state's name IS the instruction; a flag you can add by habit is not.
//   3. two consecutive `parity` verdicts in openstates.pipeline_reconcile, from
//      two different runs. One good reconcile is a measurement; two is a trend.
//   4. no other writer on "Bills" right now — checked against pg_stat_activity,
//      because lv-legiscan-delta and lv-national-sweep both write that table and
//      "never two writers" is the rule that has no exceptions.
//
// THE ID SPACE, stated rather than assumed. Our canonical tables are keyed on
// LegiScan's bill_id. For a bill that already has one, openstates.bill_xref
// supplies it and it is preserved — the app's foreign keys keep working. For a
// bill LegiScan has never seen, we mint our own from a DEDICATED DESCENDING
// SEQUENCE, so ours are NEGATIVE. Negative, not a high positive range, because:
// it can never collide with a LegiScan id no matter how large theirs grow; it is
// self-describing in a query (`WHERE bill_id < 0` is "ours"); and it is already
// the house convention — lane BT mints negative document_ids for the NY text
// rows that have no LegiScan document behind them.
//
// LegiScan's delta keeps running for a promoted jurisdiction. It stops being the
// writer and becomes the check: the nightly reconcile is what tells us whether
// the two still agree.

import { connect, log } from "./_lib/db.mjs";
import { prepareSchema } from "./_lib/schema.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const STATE = (argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--")) || "").toUpperCase();
const SESSION = val("--session");
const SOURCE = val("--source", "openstates");
const OURS = val("--ours", SESSION);
const APPLY = has("--apply");
const CONFIRM = val("--confirm").toUpperCase();

if (!STATE || !SESSION) { console.error("usage: promote.mjs <STATE> --session <id> [--source ...] [--apply --confirm <STATE>]"); process.exit(2); }

const c = await connect({ label: "promote" });
await prepareSchema(c, { log });

/* ---- lock 3: two consecutive parity verdicts ------------------------------ */
const { rows: recent } = await c.query(
  `SELECT verdict, ran_at, bills_pct, actions_pct, sponsors_pct FROM openstates.pipeline_reconcile
    WHERE state=$1 AND session=$2 AND source=$3 ORDER BY ran_at DESC LIMIT 2`, [STATE, SESSION, SOURCE]);
const twoParity = recent.length === 2 && recent.every((r) => r.verdict === "parity");

/* ---- lock 4: nobody else is writing "Bills" ------------------------------- */
const { rows: writers } = await c.query(
  `SELECT application_name, pid, extract(epoch from now()-query_start)::int AS secs
     FROM pg_stat_activity
    WHERE state <> 'idle' AND pid <> pg_backend_pid()
      AND query ~* '(insert|update|delete)[[:space:]]+(into[[:space:]]+)?"?(Bills|Sponsors|Roll Call|Votes|History Table|Documents|People)"?'`);

/* ---- what promotion would actually write ---------------------------------- */
const plan = (await c.query(`
  WITH theirs AS (SELECT bill_key, bill_number, title, description, last_action, last_action_date, status_desc, url, state_link
                    FROM openstates.bills WHERE state=$1 AND session=$2 AND source=$3 AND bill_key IS NOT NULL),
       ours AS (SELECT bill_key, legiscan_bill_id FROM openstates.bill_xref WHERE state=$1 AND session_id=$4)
  SELECT count(*) FILTER (WHERE o.legiscan_bill_id IS NOT NULL) AS keep_legiscan_id,
         count(*) FILTER (WHERE o.bill_key IS NULL)             AS would_mint,
         count(*)                                              AS total
    FROM theirs t LEFT JOIN ours o USING (bill_key)`, [STATE, SESSION, SOURCE, OURS])).rows[0];

const blockers = [];
if (!APPLY) blockers.push("--apply not given (dry run)");
if (CONFIRM !== STATE) blockers.push(`--confirm ${STATE} not given — the jurisdiction must be named explicitly`);
if (!twoParity) blockers.push(`needs two consecutive 'parity' reconciles, last two are [${recent.map((r) => r.verdict).join(", ") || "none"}]`);
if (writers.length) blockers.push(`another writer is active on the canonical tables: ${writers.map((w) => `${w.application_name || "?"}(pid ${w.pid}, ${w.secs}s)`).join(", ")}`);

console.log(JSON.stringify({
  jurisdiction: STATE, session: SESSION, source: SOURCE, our_session_id: OURS,
  reconciles: recent.map((r) => ({ verdict: r.verdict, at: r.ran_at, bills_pct: r.bills_pct, actions_pct: r.actions_pct, sponsors_pct: r.sponsors_pct })),
  would_write: { bills_total: Number(plan.total), keeping_legiscan_bill_id: Number(plan.keep_legiscan_id), minting_new_negative_ids: Number(plan.would_mint) },
  id_policy: "existing rows keep their LegiScan bill_id via openstates.bill_xref; new bills get NEGATIVE ids from openstates.native_bill_id_seq",
  promoted: false, blockers,
}, null, 1));

if (blockers.length) {
  log(`promote: NOT promoting ${STATE} ${SESSION} — ${blockers.length} blocker(s), listed above.`);
  await c.end();
  process.exit(blockers.length === 1 && !APPLY ? 0 : 1);   // a plain dry run is a success
}

/* ---- the write ------------------------------------------------------------
 * Only reached with all four locks open. New bills only: ON CONFLICT DO NOTHING
 * against public."Bills"' own unique key, so a row LegiScan owns is untouched.  */
await c.query(`CREATE SEQUENCE IF NOT EXISTS openstates.native_bill_id_seq START -1 INCREMENT -1 MINVALUE -9223372036854775808 MAXVALUE -1`);
const ins = await c.query(`
  WITH theirs AS (SELECT * FROM openstates.bills WHERE state=$1 AND session=$2 AND source=$3 AND bill_key IS NOT NULL),
       new AS (SELECT t.* FROM theirs t
                 LEFT JOIN openstates.bill_xref x ON x.state=$1 AND x.session_id=$4 AND x.bill_key=t.bill_key
                WHERE x.legiscan_bill_id IS NULL)
  INSERT INTO public."Bills" (bill_id, session_id, bill_number, title, description, status_desc, last_action, last_action_date, url, state_link, state, special)
  SELECT nextval('openstates.native_bill_id_seq'), $4::bigint, n.bill_number, n.title, n.description,
         n.status_desc, n.last_action, n.last_action_date, n.url, n.state_link, $1, 0
    FROM new n
  ON CONFLICT DO NOTHING`, [STATE, SESSION, SOURCE, OURS]);

log(`promote: ${STATE} ${SESSION} [${SOURCE}] — ${ins.rowCount} new bills written with minted negative ids; existing rows untouched.`);
await c.query(`INSERT INTO openstates.pipeline_reconcile (state, session, source, verdict, notes)
               VALUES ($1,$2,$3,'promoted',$4)`, [STATE, SESSION, SOURCE, `promoted by promote.mjs: ${ins.rowCount} new bills`]);
await c.end();
