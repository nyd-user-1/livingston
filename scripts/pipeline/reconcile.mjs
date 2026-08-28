#!/usr/bin/env node
// scripts/pipeline/reconcile.mjs — is the direct pipeline good enough to be believed?
//
//   node scripts/pipeline/reconcile.mjs NY 2025 --source nysenate
//   node scripts/pipeline/reconcile.mjs NJ 222  --source openstates --ours 2026
//   node scripts/pipeline/reconcile.mjs --all                       # every loaded (state, session, source)
//
// Lane IN proved the comparison once, by hand, for three sessions. This makes it
// routine: same numbers, every jurisdiction, written to openstates.pipeline_reconcile
// with a timestamp so DRIFT IS A TIME SERIES. A verdict you cannot plot is a
// verdict you have to remember, and nobody remembers 52 of them.
//
// THE VERDICT (the brief's thresholds, stated here so they are auditable):
//   parity  bills >= 99%  AND actions >= 97% AND sponsors >= 97%
//   close   bills >= 95%  AND actions >= 90% AND sponsors >= 90%
//   gap     anything else
//   failed  one side has no rows at all
//
// `bills` is the LOWER of the two directions (theirs-in-ours, ours-in-theirs).
// A pipeline that has 99% of our bills but invents 40% more is not at parity,
// and a single averaged number would hide that.
//
// THREE VOCABULARY TRAPS, each of which produced a confidently wrong number for
// lane IN before it was caught, so each is fixed in SQL once rather than per call:
//   * bill numbers  — LegiScan zero-pads (A00021), nobody else does (A21), and
//                     our own "Bills" holds BOTH for New York. openstates.norm_billno().
//   * chambers      — ours says Assembly/Senate, the feeds say H/S. norm_chamber().
//   * names         — "Barlas, Al" (NJ), "Claire Valdez" (NY people), "JACKSON"
//                     (NY voters). surname() sniffs the format per value.
//   * vote words    — Yea/Nay/NV/Absent here, AYE/AYEWR/NAY/ABD/ABS/EXC there.
// Everything is compared with its denominator printed. A number without one is
// not a number.

import { connect, log } from "./_lib/db.mjs";
import { prepareSchema } from "./_lib/schema.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

// The normalisers now live in _lib/schema.mjs so build-xref.mjs shares them.

const pct = (a, b) => (b ? Number(((a / b) * 100).toFixed(2)) : null);

async function reconcile(c, state, session, source, ours, special = null) {
  const P = [state, session, source, ours];
  // Pass only as many parameters as the statement actually references: once the
  // key map moved into temp tables, several queries stopped needing $4 and
  // Postgres rejects "4 parameters, but prepared statement requires 3".
  const one = async (sql, params = P) => {
    const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    return (await c.query(sql, params.slice(0, highest))).rows[0];
  };

  /* ---- our side is not one row per bill, and pretending it is inflates
   * EVERYTHING. public."Bills" holds 28,790 rows for New York's 25,357 bills
   * (lane IN's F5: LegiScan's zero-padded A00021 and a second ingestion path's
   * A21 are the same bill and the unique index cannot see it). Joining on
   * bill_key without collapsing counts several of our rows against one of
   * theirs — it produced "actions compared over 28,779 bills" when only 25,346
   * matched, a denominator larger than the population.
   *
   * `mk` is the set of matched KEYS; `mid` maps a key to every bill_id that
   * shares it. Both are MATERIALISED into temp tables, once, for a measured
   * reason: as repeated CTEs the same scan of public."Bills" ran five times and
   * the whole reconcile had not finished in 195 seconds. Temp tables live in
   * pg_temp and vanish with the connection — nothing outside `openstates` is
   * written.                                                                  */
  await c.query(`DROP TABLE IF EXISTS pg_temp.mk; DROP TABLE IF EXISTS pg_temp.mid; DROP TABLE IF EXISTS pg_temp.ob`);
  // Our bills for this (state, session), keyed. Cast the PARAMETER, never the
  // column: `b.session_id::text = $x` makes the index on session_id unusable.
  // `special` is part of our unique key and Texas held three sessions in 2025.
  // Without it, Open States' 2nd-called-session HB1 matches the REGULAR
  // session's HB1 and every downstream number compares two different bills.
  await c.query(`CREATE TEMP TABLE ob AS
    SELECT bill_id, openstates.norm_billno(bill_number) AS bill_key
      FROM public."Bills"
     WHERE state = $1 AND session_id = $2::bigint AND bill_number IS NOT NULL
       AND ($3::int IS NULL OR coalesce(special,0) = $3::int)`, [state, ours, special]);
  await c.query(`CREATE INDEX ON ob (bill_key); CREATE INDEX ON ob (bill_id); ANALYZE ob`);
  await c.query(`CREATE TEMP TABLE mk AS
    SELECT DISTINCT t.bill_key FROM openstates.bills t
     WHERE t.state=$1 AND t.session=$2 AND t.source=$3 AND t.bill_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM ob WHERE ob.bill_key = t.bill_key)`, [state, session, source]);
  await c.query(`CREATE INDEX ON mk (bill_key); ANALYZE mk`);
  await c.query(`CREATE TEMP TABLE mid AS SELECT ob.bill_key, ob.bill_id FROM ob JOIN mk USING (bill_key)`);
  await c.query(`CREATE INDEX ON mid (bill_key); CREATE INDEX ON mid (bill_id); ANALYZE mid`);

  /* ---- bills, both directions -------------------------------------------- */
  const bills = await one(`
    WITH t AS (SELECT DISTINCT bill_key FROM openstates.bills WHERE state=$1 AND session=$2 AND source=$3 AND bill_key IS NOT NULL),
         -- ob, not a second scan of "Bills": otherwise the bill COUNTS ignore
         -- the special-session filter every other measure applies, and Texas
         -- reports 692 of 11,565 when the comparable population is 726.
         o AS (SELECT DISTINCT bill_key FROM ob)
    SELECT (SELECT count(*) FROM o) AS ours, (SELECT count(*) FROM t) AS theirs,
           (SELECT count(*) FROM t JOIN o USING (bill_key)) AS matched`);
  const ourN = Number(bills.ours), theirN = Number(bills.theirs), matched = Number(bills.matched);
  if (!ourN || !theirN) {
    return { verdict: "failed", bills_ours: ourN, bills_theirs: theirN, bills_matched: 0, bills_pct: 0,
      detail: { reason: !theirN ? "the pipeline loaded nothing for this (state, session, source)" : "we hold no LegiScan rows for this (state, session)" } };
  }
  const billsPct = Math.min(pct(matched, ourN), pct(matched, theirN));

  const actions = await one(`
    WITH a AS (SELECT mid.bill_key, count(DISTINCT (h.date, h.action, h.sequence)) n
                 FROM mid JOIN public."History Table" h USING (bill_id) GROUP BY 1),
         t AS (SELECT bill_key, count(*) n FROM openstates.actions
                WHERE state=$1 AND session=$2 AND source=$3 GROUP BY 1),
         -- A second, fairer measure. govinfo publishes each action once per
         -- SOURCE SYSTEM that recorded it ("House floor actions" and "Library of
         -- Congress" both describe the same vote), so it carries ~1.5x the rows
         -- LegiScan does and a count-identity test fails by construction. The
         -- set of DATES on which something happened to a bill is the same fact
         -- stated in a way both sides can agree on. Both numbers are reported;
         -- the verdict still uses the strict one, so it stays comparable.
         ad AS (SELECT mid.bill_key, array_agg(DISTINCT h.date) d
                  FROM mid JOIN public."History Table" h USING (bill_id) WHERE h.date IS NOT NULL GROUP BY 1),
         td AS (SELECT bill_key, array_agg(DISTINCT date) d FROM openstates.actions
                 WHERE state=$1 AND session=$2 AND source=$3 AND date IS NOT NULL GROUP BY 1)
    SELECT (SELECT count(*) FROM mk) AS bills,
           (SELECT coalesce(sum(n),0) FROM a) AS ours, (SELECT coalesce(sum(t.n),0) FROM t JOIN mk USING (bill_key)) AS theirs,
           (SELECT count(*) FROM mk LEFT JOIN a USING (bill_key) LEFT JOIN t USING (bill_key)
             WHERE coalesce(a.n,0)=coalesce(t.n,0)) AS same,
           (SELECT count(*) FROM mk JOIN ad USING (bill_key) JOIN td USING (bill_key)
             WHERE ad.d @> td.d AND td.d @> ad.d) AS same_dates,
           (SELECT count(*) FROM mk JOIN ad USING (bill_key) JOIN td USING (bill_key)) AS date_compared`);

  const sponsors = await one(`
    WITH a AS (SELECT mid.bill_key, array_agg(DISTINCT openstates.surname(p.last_name)) s
                 FROM mid JOIN public."Sponsors" sp USING (bill_id) JOIN public."People" p USING (people_id)
                 WHERE p.last_name IS NOT NULL GROUP BY 1),
         t AS (SELECT bill_key, array_agg(DISTINCT openstates.surname(name)) s
                 FROM openstates.sponsors WHERE state=$1 AND session=$2 AND source=$3 AND entity_type='person' GROUP BY 1)
    SELECT count(*) AS bills,
           count(*) FILTER (WHERE a.s @> t.s AND t.s @> a.s) AS identical,
           round(avg(CASE WHEN cardinality(a.s)=0 THEN NULL ELSE
             (SELECT count(*) FROM unnest(a.s) x WHERE x = ANY(t.s))::numeric / cardinality(a.s) END) * 100, 2) AS mean_overlap
      FROM mk JOIN a USING (bill_key) JOIN t USING (bill_key)`);

  /* Roll calls are matched on (bill, date, chamber) and COUNTED on content, for
   * the same reason: two duplicate bill rows carry two copies of one vote. */
  const rc = await one(`
    WITH a AS (SELECT DISTINCT mid.bill_key, r.date, openstates.norm_chamber(r.chamber) ch, r.description
                 FROM mid JOIN public."Roll Call" r USING (bill_id)),
         t AS (SELECT DISTINCT bill_key, os_rc_id, date, openstates.norm_chamber(chamber) ch
                 FROM openstates.roll_calls WHERE state=$1 AND session=$2 AND source=$3)
    SELECT (SELECT count(*) FROM a) AS ours, (SELECT count(*) FROM t) AS theirs,
           (SELECT count(DISTINCT t.os_rc_id) FROM t JOIN a ON a.bill_key=t.bill_key AND a.date=t.date AND a.ch IS NOT DISTINCT FROM t.ch) AS theirs_matched,
           (SELECT count(*) FROM (SELECT DISTINCT a.bill_key, a.date, a.ch, a.description FROM a JOIN t ON a.bill_key=t.bill_key AND a.date=t.date AND a.ch IS NOT DISTINCT FROM t.ch) z) AS ours_matched,
           (SELECT count(*) FROM a WHERE ch='H') AS ours_lower, (SELECT count(*) FROM a WHERE ch='S') AS ours_upper,
           (SELECT count(*) FROM t WHERE ch='H') AS theirs_lower, (SELECT count(*) FROM t WHERE ch='S') AS theirs_upper`);

  const mv = await one(`
    WITH pair AS (SELECT DISTINCT r.roll_call_id, tr.os_rc_id
                    FROM mid JOIN public."Roll Call" r USING (bill_id)
                    JOIN openstates.roll_calls tr ON tr.state=$1 AND tr.session=$2 AND tr.source=$3
                      AND tr.bill_key=mid.bill_key AND tr.date=r.date
                      AND openstates.norm_chamber(tr.chamber) IS NOT DISTINCT FROM openstates.norm_chamber(r.chamber)),
         ov AS (SELECT DISTINCT p.os_rc_id, openstates.surname(pe.last_name) sn, openstates.norm_vote(v.vote_desc) vd
                  FROM pair p JOIN public."Votes" v ON v.roll_call_id=p.roll_call_id JOIN public."People" pe USING (people_id)),
         tv AS (SELECT DISTINCT os_rc_id, openstates.surname(voter_name) sn, openstates.norm_vote(vote_desc) vd
                  FROM openstates.votes WHERE source=$3 AND os_rc_id IN (SELECT os_rc_id FROM pair))
    SELECT (SELECT count(*) FROM ov) AS ours, (SELECT count(*) FROM tv) AS theirs,
           (SELECT count(*) FROM ov JOIN tv USING (os_rc_id, sn)) AS name_matched,
           (SELECT count(*) FROM ov JOIN tv USING (os_rc_id, sn) WHERE ov.vd = tv.vd) AS agree`);

  const docs = await one(`
        SELECT (SELECT count(DISTINCT (d.document_type, d.url)) FROM mid JOIN public."Documents" d USING (bill_id)) AS ours,
           (SELECT count(*) FROM openstates.documents WHERE state=$1 AND session=$2 AND source=$3) AS theirs`);

  const actionsPct = pct(Number(actions.same), Number(actions.bills));
  const sponsorsPct = pct(Number(sponsors.identical), Number(sponsors.bills));
  const votesPct = pct(Number(mv.agree), Number(mv.name_matched));

  const verdict =
    billsPct >= 99 && (actionsPct ?? 100) >= 97 && (sponsorsPct ?? 100) >= 97 ? "parity" :
    billsPct >= 95 && (actionsPct ?? 100) >= 90 && (sponsorsPct ?? 100) >= 90 ? "close" : "gap";

  return {
    verdict,
    bills_ours: ourN, bills_theirs: theirN, bills_matched: matched, bills_pct: billsPct,
    actions_pct: actionsPct, sponsors_pct: sponsorsPct, votes_pct: votesPct,
    rc_ours: Number(rc.ours), rc_theirs: Number(rc.theirs), rc_matched: Number(rc.theirs_matched),
    docs_ours: Number(docs.ours), docs_theirs: Number(docs.theirs),
    detail: {
      bills: { ours: ourN, theirs: theirN, matched, theirs_in_ours: pct(matched, theirN), ours_in_theirs: pct(matched, ourN) },
      actions: { matched_bills: Number(actions.bills), ours: Number(actions.ours), theirs: Number(actions.theirs),
        identical_count_bills: Number(actions.same),
        row_ratio_theirs_over_ours: actions.ours > 0 ? Number((Number(actions.theirs) / Number(actions.ours)).toFixed(2)) : null,
        identical_date_set_bills: Number(actions.same_dates), date_compared_bills: Number(actions.date_compared),
        date_set_pct: pct(Number(actions.same_dates), Number(actions.date_compared)) },
      sponsors: { compared_bills: Number(sponsors.bills), set_identical: Number(sponsors.identical), mean_overlap_pct: sponsors.mean_overlap == null ? null : Number(sponsors.mean_overlap) },
      roll_calls: { ours: Number(rc.ours), theirs: Number(rc.theirs), theirs_matched: Number(rc.theirs_matched), ours_matched: Number(rc.ours_matched),
        by_chamber: { ours_lower: Number(rc.ours_lower), ours_upper: Number(rc.ours_upper), theirs_lower: Number(rc.theirs_lower), theirs_upper: Number(rc.theirs_upper) } },
      member_votes: { ours: Number(mv.ours), theirs: Number(mv.theirs), name_matched: Number(mv.name_matched), agree: Number(mv.agree) },
      documents: { ours: Number(docs.ours), theirs: Number(docs.theirs), ratio: docs.ours > 0 ? Number((Number(docs.theirs) / Number(docs.ours)).toFixed(2)) : null },
    },
  };
}

/* ---- main ---------------------------------------------------------------- */

const c = await connect({ label: "reconcile" });
await prepareSchema(c, { log });

/* Which of OUR session_ids does a source's session string mean? Open States
 * says '222' where we say 2026; govinfo says 119 where we say 2025; Texas says
 * '892'. openstates.session_map answers it, derived by build-xref.mjs from key
 * overlap and stored WITH the overlap. Falling back to "their string is our
 * string" is only right for New York and would silently compare New Jersey's
 * 2026 session against a session_id of 222 that does not exist — a `failed`
 * verdict that means "the mapping is wrong", not "the pipeline is wrong". */
const { rows: mapRows } = await c.query(`SELECT state, source, session, our_session_id, our_special, overlap_pct FROM openstates.session_map`);
const smap = new Map(mapRows.map((m) => [`${m.state}|${m.source}|${m.session}`, m]));
const oursFor = (state, source, session, explicit) => {
  if (explicit) return explicit;
  const m = smap.get(`${state}|${source}|${session}`);
  if (m) return m.our_session_id;
  return session;
};

let targets = [];
if (has("--all")) {
  const { rows } = await c.query(`SELECT DISTINCT state, session, source FROM openstates.bills WHERE bill_key IS NOT NULL ORDER BY 1,2,3`);
  targets = rows.map((r) => ({ state: r.state, session: r.session, source: r.source, ours: oursFor(r.state, r.source, r.session),
    special: smap.get(`${r.state}|${r.source}|${r.session}`)?.our_special ?? null }));
} else {
  const [state, session] = positional;
  if (!state || !session) { console.error("usage: reconcile.mjs <STATE> <session> [--source openstates] [--ours <session_id>]"); process.exit(2); }
  const st = state.toUpperCase(), src = val("--source", "openstates");
  targets = [{ state: st, session, source: src, ours: oursFor(st, src, session, val("--ours")),
    special: has("--special") ? Number(val("--special")) : (smap.get(`${st}|${src}|${session}`)?.our_special ?? null) }];
}
for (const t of targets) {
  const m = smap.get(`${t.state}|${t.source}|${t.session}`);
  if (m) log(`session_map: ${t.state} ${t.source} '${t.session}' -> our session_id ${t.ours}${t.special ? ` special ${t.special}` : ""} (${m.overlap_pct}% key overlap)`);
  else log(`session_map: ${t.state} ${t.source} '${t.session}' has no mapping — using '${t.ours}'. Run build-xref.mjs to derive one.`);
}

const out = [];
for (const t of targets) {
  const t0 = Date.now();
  let r;
  try { r = await reconcile(c, t.state, t.session, t.source, t.ours, t.special ?? null); }
  catch (e) { r = { verdict: "failed", detail: { error: e.message } }; log(`${t.state} ${t.session} [${t.source}]: FAILED — ${e.message}`); }
  await c.query(
    `INSERT INTO openstates.pipeline_reconcile
       (state, session, source, verdict, bills_ours, bills_theirs, bills_matched, bills_pct,
        actions_pct, sponsors_pct, votes_pct, rc_ours, rc_theirs, rc_matched, docs_ours, docs_theirs, detail, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [t.state, t.session, t.source, r.verdict, r.bills_ours ?? null, r.bills_theirs ?? null, r.bills_matched ?? null, r.bills_pct ?? null,
      r.actions_pct ?? null, r.sponsors_pct ?? null, r.votes_pct ?? null, r.rc_ours ?? null, r.rc_theirs ?? null, r.rc_matched ?? null,
      r.docs_ours ?? null, r.docs_theirs ?? null, JSON.stringify(r.detail ?? {}), val("--notes", null)]);
  log(`${t.state} ${t.session} [${t.source}] → ${r.verdict.toUpperCase()} · bills ${r.bills_pct ?? "-"}% (${r.bills_matched ?? 0}/${r.bills_theirs ?? 0} theirs, ${r.bills_ours ?? 0} ours) · actions ${r.actions_pct ?? "-"}% · sponsors ${r.sponsors_pct ?? "-"}% · votes ${r.votes_pct ?? "-"}% · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  out.push({ ...t, ...r });
}

console.log(JSON.stringify(out, null, 1));
await c.end();
process.exit(out.some((r) => r.verdict === "failed") ? 1 : 0);
