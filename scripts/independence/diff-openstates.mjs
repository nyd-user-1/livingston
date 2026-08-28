#!/usr/bin/env node
// SUPERSEDED 2026-08-28: use scripts/pipeline/reconcile.mjs, which serves both the Open States engine and the native
// loaders. This script predates the native rows in schema `openstates` and, without a source = 'openstates' filter,
// would union them into its counts. Kept for the record of lane IN's diff; do not run it against current data.
// scripts/independence/diff-openstates.mjs — lane IN, step 4.
//
// Compares one session, LegiScan (public."Bills" & friends) vs Open States (schema openstates),
// and prints every number WITH ITS DENOMINATOR. A percentage whose base is not shown is not a
// result, it is a rumour.
//
//   node scripts/independence/diff-openstates.mjs --state NJ --our-session 2026 --their-session 222
//
// READ-ONLY on public.*. It runs SELECTs there and writes nothing anywhere.

import pg from "pg";
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const STATE = opt("--state"), OURS = opt("--our-session"), THEIRS = opt("--their-session");
if (!STATE || !OURS || !THEIRS) { console.error("need --state --our-session --their-session"); process.exit(2); }

const c = new pg.Client({ connectionString: process.env.POLICY_DATABASE_URL });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const norm = `upper(regexp_replace($X$, '[^A-Za-z0-9]', '', 'g'))`;

const P = [STATE, OURS, THEIRS];
const out = { state: STATE, our_session: OURS, their_session: THEIRS };

// ---------- bills
const [b] = await q(`
WITH ours AS (
  SELECT DISTINCT ON (k) * FROM (
    SELECT regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') k, bill_number, title, last_action_date, status_desc, status, special
    FROM public."Bills" WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL
  ) z ORDER BY k, special
), theirs AS (
  SELECT regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') k, bill_number, title, last_action_date, status_desc
  FROM openstates.bills WHERE state=$1 AND session=$3
)
SELECT (SELECT count(*) FROM ours) AS ours_n,
       (SELECT count(*) FROM theirs) AS theirs_n,
       (SELECT count(*) FROM ours o JOIN theirs t USING (k)) AS matched,
       (SELECT count(*) FROM ours o JOIN theirs t USING (k)
          WHERE lower(regexp_replace(coalesce(o.title,''),'\\s+',' ','g'))
              = lower(regexp_replace(coalesce(t.title,''),'\\s+',' ','g'))) AS title_exact,
       (SELECT count(*) FROM ours o JOIN theirs t USING (k)
          WHERE left(lower(coalesce(o.title,'')),60) = left(lower(coalesce(t.title,'')),60)) AS title_prefix60,
       (SELECT count(*) FROM ours o JOIN theirs t USING (k)
          WHERE o.last_action_date = t.last_action_date) AS lad_exact,
       (SELECT count(*) FROM ours o JOIN theirs t USING (k)
          WHERE o.last_action_date IS NOT NULL AND t.last_action_date IS NOT NULL
            AND abs(o.last_action_date::date - t.last_action_date::date) <= 7) AS lad_within7,
       (SELECT count(*) FROM ours o WHERE NOT EXISTS (SELECT 1 FROM theirs t WHERE t.k=o.k)) AS ours_only,
       (SELECT count(*) FROM theirs t WHERE NOT EXISTS (SELECT 1 FROM ours o WHERE o.k=t.k)) AS theirs_only
`, P);
out.bills = b;
out.bills_ours_only_sample = (await q(`
  SELECT bill_number, left(coalesce(title,''),70) title, status_desc, last_action_date FROM public."Bills"
  WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL
    AND regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') NOT IN
        (SELECT regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') FROM openstates.bills WHERE state=$1 AND session=$3)
  ORDER BY bill_number LIMIT 20`, P));
out.bills_theirs_only_sample = (await q(`
  SELECT bill_number, left(coalesce(title,''),70) title, status_desc, last_action_date FROM openstates.bills
  WHERE state=$1 AND session=$3
    AND regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') NOT IN
        (SELECT regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') FROM public."Bills" WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL)
  ORDER BY bill_number LIMIT 20`, P));

// ---------- sponsors: exact-set agreement on surname sets (names are formatted differently)
const [sp] = await q(`
WITH ob AS (SELECT DISTINCT ON (k) bill_id, k FROM (
              SELECT bill_id, regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') k, special
              FROM public."Bills" WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL) z ORDER BY k, special),
-- Surnames, not full names: the two sources format people differently ("Al Barlas" vs
-- "Barlas, Al"), so comparing raw name strings would measure formatting, not agreement.
o AS (SELECT ob.k, array_agg(DISTINCT upper(regexp_replace(coalesce(pe.last_name,''),'[^A-Za-z]','','g'))) names, count(*) n
      FROM public."Sponsors" s JOIN ob ON ob.bill_id=s.bill_id
      JOIN public."People" pe ON pe.people_id=s.people_id WHERE coalesce(pe.last_name,'')<>'' GROUP BY 1),
t AS (SELECT bill_number k, array_agg(DISTINCT upper(regexp_replace(CASE WHEN name LIKE '%,%' THEN split_part(name, ',', 1) ELSE regexp_replace(btrim(name), '^.*[[:space:]]', '') END,'[^A-Za-z]','','g'))) names, count(*) n
      FROM openstates.sponsors WHERE state=$1 AND session=$3 GROUP BY 1),
j AS (SELECT o.k, o.names onames, t.names tnames, o.n on_, t.n tn FROM o JOIN t USING (k))
SELECT (SELECT count(*) FROM o) ours_bills_with_sponsors,
       (SELECT count(*) FROM t) theirs_bills_with_sponsors,
       (SELECT count(*) FROM j) matched_bills,
       (SELECT count(*) FROM j WHERE onames = tnames) set_equal,
       (SELECT count(*) FROM j WHERE on_ = tn) count_equal,
       (SELECT round(avg(sim),1) FROM (
          SELECT (SELECT count(*) FROM unnest(onames) x WHERE x = ANY(tnames))::numeric * 100
                 / greatest(cardinality(onames), cardinality(tnames), 1) sim FROM j) z) overlap_pct
`, P);
out.sponsors = sp;

// ---------- actions
const [ac] = await q(`
WITH ob AS (SELECT DISTINCT ON (k) bill_id, k FROM (
              SELECT bill_id, regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') k, special
              FROM public."Bills" WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL) z ORDER BY k, special),
o AS (SELECT ob.k, count(*) n, min(h.date) first_d, max(h.date) last_d
      FROM public."History Table" h JOIN ob ON ob.bill_id=h.bill_id GROUP BY 1),
t AS (SELECT bill_number k, count(*) n, min(date) first_d, max(date) last_d
      FROM openstates.actions WHERE state=$1 AND session=$3 GROUP BY 1)
SELECT (SELECT count(*) FROM o) ours_bills, (SELECT count(*) FROM t) theirs_bills,
       (SELECT count(*) FROM o JOIN t USING (k)) matched,
       (SELECT count(*) FROM o JOIN t USING (k) WHERE o.n=t.n) count_equal,
       (SELECT count(*) FROM o JOIN t USING (k) WHERE o.n>t.n) ours_more,
       (SELECT count(*) FROM o JOIN t USING (k) WHERE o.n<t.n) theirs_more,
       (SELECT sum(o.n) FROM o JOIN t USING (k)) ours_total_actions,
       (SELECT sum(t.n) FROM o JOIN t USING (k)) theirs_total_actions,
       (SELECT count(*) FROM o JOIN t USING (k) WHERE o.last_d=t.last_d) last_action_date_equal
`, P);
out.actions = ac;

// ---------- roll calls + member votes
const [rc] = await q(`
WITH ob AS (SELECT DISTINCT ON (k) bill_id, k FROM (
              SELECT bill_id, regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') k, special
              FROM public."Bills" WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL) z ORDER BY k, special),
o AS (SELECT r.roll_call_id, ob.k, r.date, CASE WHEN r.chamber ILIKE 'sen%' THEN 'S'
                  WHEN r.chamber ILIKE 'assem%' OR r.chamber ILIKE 'hou%' THEN 'H'
                  WHEN r.chamber ILIKE 'joint%' THEN 'J'
                  ELSE upper(left(coalesce(r.chamber,''),1)) END ch, r.yea::text yea, r.nay::text nay
      FROM public."Roll Call" r JOIN ob ON ob.bill_id=r.bill_id),
t AS (SELECT os_rc_id, bill_number k, date, upper(left(coalesce(chamber,''),1)) ch, yea::text yea, nay::text nay
      FROM openstates.roll_calls WHERE state=$1 AND session=$3),
m AS (SELECT o.roll_call_id, t.os_rc_id, (o.yea=t.yea AND o.nay=t.nay) tally_ok
      FROM o JOIN t ON t.k=o.k AND t.date=o.date AND t.ch=o.ch)
SELECT (SELECT count(*) FROM o) ours_rollcalls, (SELECT count(*) FROM t) theirs_rollcalls,
       (SELECT count(DISTINCT os_rc_id) FROM m) theirs_matched,
       (SELECT count(DISTINCT roll_call_id) FROM m) ours_matched,
       (SELECT count(DISTINCT os_rc_id) FROM m WHERE tally_ok) theirs_matched_tally_equal
`, P);
out.roll_calls = rc;

const [mv] = await q(`
WITH ob AS (SELECT DISTINCT ON (k) bill_id, k FROM (
              SELECT bill_id, regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') k, special
              FROM public."Bills" WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL) z ORDER BY k, special),
pair AS (SELECT DISTINCT ON (t.os_rc_id) t.os_rc_id, r.roll_call_id
         FROM public."Roll Call" r JOIN ob ON ob.bill_id=r.bill_id
         JOIN openstates.roll_calls t ON t.state=$1 AND t.session=$3 AND t.bill_number=ob.k
              AND t.date=r.date AND upper(left(coalesce(t.chamber,''),1))=
                CASE WHEN r.chamber ILIKE 'sen%' THEN 'S'
                     WHEN r.chamber ILIKE 'assem%' OR r.chamber ILIKE 'hou%' THEN 'H'
                     WHEN r.chamber ILIKE 'joint%' THEN 'J'
                     ELSE upper(left(coalesce(r.chamber,''),1)) END),
-- DISTINCT on (roll call, surname) on BOTH sides: two legislators can share a surname, and an
-- un-deduped join inflates the denominator above the number of votes actually cast. The first
-- run of this query reported 43,982 "matched" out of 34,127 our-side votes, which is the tell.
ov AS (SELECT DISTINCT p.os_rc_id,
              upper(regexp_replace(coalesce(pe.last_name,''),'[^A-Za-z]','','g')) nm,
              CASE WHEN lower(coalesce(v.vote_desc,'')) LIKE 'yea%' OR lower(coalesce(v.vote_desc,'')) LIKE 'yes%' THEN 'yes'
                   WHEN lower(coalesce(v.vote_desc,'')) LIKE 'nay%' OR lower(coalesce(v.vote_desc,'')) LIKE 'no%' THEN 'no'
                   ELSE 'other' END vd
       FROM pair p JOIN public."Votes" v ON v.roll_call_id=p.roll_call_id
       JOIN public."People" pe ON pe.people_id=v.people_id
       WHERE coalesce(pe.last_name,'') <> ''),
tv AS (SELECT DISTINCT p.os_rc_id,
              upper(regexp_replace(CASE WHEN v.voter_name LIKE '%,%' THEN split_part(v.voter_name, ',', 1) ELSE regexp_replace(btrim(v.voter_name), '^.*[[:space:]]', '') END,'[^A-Za-z]','','g')) nm,
              CASE WHEN v.vote_desc='yes' THEN 'yes' WHEN v.vote_desc='no' THEN 'no' ELSE 'other' END vd
       FROM pair p JOIN openstates.votes v ON v.os_rc_id=p.os_rc_id)
SELECT (SELECT count(*) FROM pair) paired_rollcalls,
       (SELECT count(*) FROM ov) our_rc_member_pairs,
       (SELECT count(*) FROM tv) their_rc_member_pairs,
       (SELECT count(*) FROM (SELECT DISTINCT os_rc_id, nm FROM ov) a
          JOIN (SELECT DISTINCT os_rc_id, nm FROM tv) b USING (os_rc_id, nm)) name_matched,
       (SELECT count(*) FROM ov JOIN tv USING (os_rc_id, nm, vd)) vote_agree
`, P);
out.member_votes = mv;

// ---------- texts / documents
const [tx] = await q(`
WITH ob AS (SELECT DISTINCT ON (k) bill_id, k FROM (
              SELECT bill_id, regexp_replace(upper(regexp_replace(bill_number,'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2') k, special
              FROM public."Bills" WHERE state=$1 AND session_id::text=$2 AND bill_number IS NOT NULL) z ORDER BY k, special),
o AS (SELECT ob.k, count(*) n FROM public."Documents" d JOIN ob ON ob.bill_id=d.bill_id GROUP BY 1),
t AS (SELECT bill_number k, count(*) n FROM openstates.documents WHERE state=$1 AND session=$3 GROUP BY 1)
SELECT (SELECT count(*) FROM o) ours_bills_with_docs, (SELECT count(*) FROM t) theirs_bills_with_docs,
       (SELECT sum(n) FROM o) ours_docs, (SELECT sum(n) FROM t) theirs_docs,
       (SELECT count(*) FROM o JOIN t USING (k)) both,
       (SELECT count(*) FROM t WHERE NOT EXISTS (SELECT 1 FROM o WHERE o.k=t.k)) theirs_only,
       (SELECT count(*) FROM o WHERE NOT EXISTS (SELECT 1 FROM t WHERE t.k=o.k)) ours_only,
       (SELECT count(DISTINCT url) FROM openstates.documents WHERE state=$1 AND session=$3) their_distinct_urls,
       (SELECT count(*) FROM openstates.documents WHERE state=$1 AND session=$3 AND media_type='application/pdf') their_pdf,
       (SELECT count(*) FROM openstates.documents WHERE state=$1 AND session=$3 AND media_type='text/html') their_html
`, P);
out.texts = tx;

console.log(JSON.stringify(out, null, 1));
await c.end();
