#!/usr/bin/env node
// scripts/pipeline/build-xref.mjs — the crosswalk, built while both id spaces still exist.
//
//   node scripts/pipeline/build-xref.mjs [--refresh]
//
// Every canonical table we own is keyed on LegiScan's proprietary ids —
// bill_id, people_id, roll_call_id. If LegiScan stops, those ids stop being
// mintable, and any replacement keys on (state, session, bill_number) instead.
// The map between the two can only be built while BOTH sides are present, which
// is now and not later. It is cheap and it is read-only against public.*.
//
// openstates.bill_xref  (state, session_id, bill_key, special)
//     -> legiscan_bill_id, openstates_id, native_id
// openstates.people_xref (state, chamber, district, name_key)
//     -> legiscan_people_id, openstates_id, native_member_id, and the external
//        ids that join to the outside world (ballotpedia, votesmart, bioguide)
//
// Lane IN measured why the people half matters more than it looks: LegiScan's
// people_id is proprietary, but Ballotpedia (99.59%) and VoteSmart (75.56%) are
// independently reproducible from openstates/people, which is CC0. What is NOT
// reproducible is followthemoney_eid (20,922 of our rows) — the money data hangs
// off an id the open route cannot mint. This table is where that becomes
// visible rather than a surprise.

import { connect, log } from "./_lib/db.mjs";
import { prepareSchema } from "./_lib/schema.mjs";

const c = await connect({ label: "xref" });
await prepareSchema(c, { log });
const t0 = Date.now();

if (process.argv.includes("--refresh")) {
  await c.query(`TRUNCATE openstates.bill_xref`);
  await c.query(`TRUNCATE openstates.people_xref`);
}

/* ---- bills ---------------------------------------------------------------
 * DISTINCT ON collapses our duplicate rows (lane IN's F5) onto the lowest
 * bill_id, which is LegiScan's own: the padded A00021 row predates the second
 * ingestion path that wrote A21. `special` stays in the key because
 * public."Bills" is unique on it and a special session legitimately reuses a
 * bill number.                                                               */
const bills = await c.query(`
  INSERT INTO openstates.bill_xref (state, session_id, bill_number, bill_key, special, legiscan_bill_id, legiscan_session_id, session_title)
  SELECT DISTINCT ON (state, session_id, bill_key, special)
         state, session_id, bill_number, bill_key, special, bill_id, legiscan_session_id, session_title
    FROM (
      -- bill_key is computed here rather than in the DISTINCT ON: inside an
      -- INSERT ... SELECT the SELECT cannot reference the TARGET table's
      -- columns, and Postgres resolves a bare bill_key to bill_xref's own.
      SELECT state, session_id::text AS session_id, bill_number,
             openstates.norm_billno(bill_number) AS bill_key, coalesce(special,0) AS special,
             bill_id, legiscan_session_id, session_title
        FROM public."Bills"
       WHERE bill_number IS NOT NULL AND session_id IS NOT NULL
    ) src
   ORDER BY state, session_id, bill_key, special, bill_id
  ON CONFLICT (state, session_id, bill_key, special) DO UPDATE
     SET legiscan_bill_id = EXCLUDED.legiscan_bill_id, updated_at = now()`);
log(`bill_xref: ${bills.rowCount} rows from LegiScan`);

/* ---- the session map, derived and stored with its evidence ---------------
 * Open States says '222' where we say 2026; govinfo says 119 where we say 2025;
 * the NY feed says 2025 and so do we. Hard-coding 52 of those is 52 chances to
 * be quietly wrong, so each mapping is chosen as the session_id of OURS that
 * shares the most bill_keys with theirs — and the overlap is stored beside it,
 * so a mapping is a measurement someone can check.                            */
const map = await c.query(`
  INSERT INTO openstates.session_map (state, source, session, our_session_id, our_special, shared_keys, their_keys, overlap_pct)
  SELECT DISTINCT ON (state, source, session) state, source, session, our_session_id, our_special, shared, their_keys,
         round(100.0 * shared / nullif(their_keys,0), 2)
    FROM (
      -- count(DISTINCT bill_key), not count(*): bill_xref is keyed on
      -- (state, session_id, bill_key, SPECIAL), so a state that held a regular
      -- and two special sessions in one year has three rows for HB1 and the
      -- join multiplies. Texas came back with an overlap of 195.23% — the same
      -- impossible-number tell that has caught three defects in this lane.
      SELECT t.state, t.source, t.session, x.session_id AS our_session_id, x.special AS our_special,
             count(DISTINCT t.bill_key) AS shared,
             (SELECT count(DISTINCT bill_key) FROM openstates.bills z
               WHERE z.state=t.state AND z.source=t.source AND z.session=t.session AND z.bill_key IS NOT NULL) AS their_keys
        FROM (SELECT DISTINCT state, source, session, bill_key FROM openstates.bills WHERE bill_key IS NOT NULL) t
        JOIN openstates.bill_xref x ON x.state=t.state AND x.bill_key=t.bill_key
       GROUP BY t.state, t.source, t.session, x.session_id, x.special
    ) z
   -- Tie-break, and it is needed: New York's bill numbers recur every session,
   -- so a partial 1,487-bill scrape shares 100% of its keys with several of our
   -- sessions at once and 'ORDER BY shared DESC' alone picked 2023 for a
   -- session literally called '2025-2026'. Prefer a session_id that appears IN
   -- their session string, then the most recent.
   ORDER BY state, source, session, shared DESC,
            (position(our_session_id in session) > 0) DESC, our_session_id DESC, our_special ASC
  ON CONFLICT (state, source, session) DO UPDATE
     SET our_session_id=EXCLUDED.our_session_id, our_special=EXCLUDED.our_special, shared_keys=EXCLUDED.shared_keys,
         their_keys=EXCLUDED.their_keys, overlap_pct=EXCLUDED.overlap_pct, built_at=now()`);
log(`session_map: ${map.rowCount} (state, source, session) mappings derived`);
const impossible = (await c.query(`SELECT state, source, session, overlap_pct FROM openstates.session_map WHERE overlap_pct > 100`)).rows;
if (impossible.length) {
  console.error(`build-xref: ${impossible.length} session mapping(s) claim an overlap above 100%, which cannot be true: ` +
    impossible.map((r) => `${r.state}/${r.source}/${r.session}=${r.overlap_pct}%`).join(", "));
  process.exit(1);
}
for (const m of (await c.query(`SELECT * FROM openstates.session_map ORDER BY state, source`)).rows) {
  log(`  ${m.state} ${m.source} '${m.session}' -> our session_id ${m.our_session_id}${m.our_special ? ` special ${m.our_special}` : ""} · ${m.shared_keys}/${m.their_keys} keys shared (${m.overlap_pct}%)` +
      (Number(m.overlap_pct) >= 99.9 ? "  [100% overlap does not prove the mapping: most states reuse HB1 every session — check it]" : ""));
}

const osSide = await c.query(`
  UPDATE openstates.bill_xref b SET openstates_id = t.os_id, updated_at = now()
    FROM (SELECT z.state, m.our_session_id, z.bill_key, min(z.os_id) os_id
            FROM openstates.bills z JOIN openstates.session_map m
              ON m.state=z.state AND m.source=z.source AND m.session=z.session
           WHERE z.source='openstates' AND z.bill_key IS NOT NULL
           GROUP BY 1,2,3) t
   WHERE b.state=t.state AND b.session_id=t.our_session_id AND b.bill_key=t.bill_key`);
log(`bill_xref: ${osSide.rowCount} rows carry an Open States id`);

const nativeSide = await c.query(`
  UPDATE openstates.bill_xref b SET native_id = t.os_id, updated_at = now()
    FROM (SELECT z.state, m.our_session_id, z.bill_key, min(z.os_id) os_id
            FROM openstates.bills z JOIN openstates.session_map m
              ON m.state=z.state AND m.source=z.source AND m.session=z.session
           WHERE z.source <> 'openstates' AND z.bill_key IS NOT NULL
           GROUP BY 1,2,3) t
   WHERE b.state=t.state AND b.session_id=t.our_session_id AND b.bill_key=t.bill_key`);
log(`bill_xref: ${nativeSide.rowCount} rows carry a native id`);

/* ---- people --------------------------------------------------------------
 * Two more vocabularies, measured not assumed: our "People".chamber is
 * House/Senate/Assembly and theirs is H/S/legislature; our district is SD-055
 * and theirs is 55. norm_chamber() and norm_district() do both, once.         */
const people = await c.query(`
  INSERT INTO openstates.people_xref (state, chamber, district, name_key, legiscan_people_id, ballotpedia, votesmart, bioguide, full_name)
  SELECT DISTINCT ON (state, chamber, district, name_key) state, chamber, district, name_key, people_id, ballotpedia, votesmart, bioguide, name
    FROM (
      SELECT p.state, coalesce(openstates.norm_chamber(p.chamber),'?') AS chamber,
             openstates.norm_district(p.district) AS district,
             openstates.surname(p.last_name) AS name_key,
             p.people_id, p.ballotpedia, nullif(p.votesmart_id::text,'') AS votesmart, p.bioguide_id AS bioguide, p.name
        FROM public."People" p WHERE p.state IS NOT NULL AND p.last_name IS NOT NULL
    ) z WHERE name_key <> ''
   ORDER BY state, chamber, district, name_key, people_id
  ON CONFLICT (state, chamber, district, name_key) DO UPDATE
     SET legiscan_people_id = EXCLUDED.legiscan_people_id,
         ballotpedia = coalesce(EXCLUDED.ballotpedia, openstates.people_xref.ballotpedia),
         votesmart   = coalesce(EXCLUDED.votesmart,   openstates.people_xref.votesmart),
         bioguide    = coalesce(EXCLUDED.bioguide,    openstates.people_xref.bioguide),
         updated_at = now()`);
log(`people_xref: ${people.rowCount} rows from LegiScan`);

const osPeople = await c.query(`
  UPDATE openstates.people_xref x SET openstates_id = t.os_person_id, updated_at = now()
    FROM (SELECT DISTINCT ON (state, chamber, district, name_key) state, chamber, district, name_key, os_person_id
            FROM (SELECT p.state, coalesce(openstates.norm_chamber(p.chamber),'?') chamber,
                         openstates.norm_district(p.district) district,
                         openstates.surname(coalesce(p.family_name, p.name)) name_key, p.os_person_id
                    FROM openstates.people p WHERE p.state IS NOT NULL) z
           ORDER BY state, chamber, district, name_key, os_person_id) t
   WHERE x.state=t.state AND x.chamber=t.chamber AND x.district=t.district AND x.name_key=t.name_key`);
log(`people_xref: ${osPeople.rowCount} rows carry an Open States person id`);

const nativePeople = await c.query(`
  UPDATE openstates.people_xref x SET native_member_id = t.member_id, updated_at = now()
    FROM (SELECT DISTINCT ON (state, chamber, district, name_key) state, chamber, district, name_key, member_id
            FROM (SELECT l.state, coalesce(openstates.norm_chamber(l.chamber),'?') chamber,
                         openstates.norm_district(l.district) district,
                         openstates.surname(coalesce(l.short_name, l.full_name)) name_key, l.member_id
                    FROM openstates.legislators l) z
           ORDER BY state, chamber, district, name_key, member_id) t
   WHERE x.state=t.state AND x.chamber=t.chamber AND x.district=t.district AND x.name_key=t.name_key`);
log(`people_xref: ${nativePeople.rowCount} rows carry a native member id`);

/* A second, looser pass on (state, chamber, surname) — filling ONLY the rows the
 * strict key missed, and only where the surname is unambiguous within the
 * chamber. District is the fragile part of the strict key: openstates/people
 * holds current members while our "People" spans every session we have, and a
 * redistricting changes the number without changing the person. Precision is
 * kept by refusing any surname that appears twice. */
const loose = await c.query(`
  UPDATE openstates.people_xref x SET openstates_id = t.os_person_id, updated_at = now()
    FROM (SELECT state, chamber, name_key, min(os_person_id) os_person_id
            FROM (SELECT p.state, coalesce(openstates.norm_chamber(p.chamber),'?') chamber,
                         openstates.surname(coalesce(p.family_name, p.name)) name_key, p.os_person_id
                    FROM openstates.people p WHERE p.state IS NOT NULL) z
           GROUP BY 1,2,3 HAVING count(*) = 1) t
   WHERE x.openstates_id IS NULL AND x.state=t.state AND x.chamber=t.chamber AND x.name_key=t.name_key`);
log(`people_xref: +${loose.rowCount} more via (state, chamber, surname) where the surname is unique`);

/* ---- verify independently, not by restating what the INSERTs believed ----- */
const v = (await c.query(`
  SELECT (SELECT count(*) FROM openstates.bill_xref) AS bills,
         (SELECT count(*) FROM openstates.bill_xref WHERE openstates_id IS NOT NULL) AS bills_os,
         (SELECT count(*) FROM openstates.bill_xref WHERE native_id IS NOT NULL) AS bills_native,
         (SELECT count(DISTINCT (state, session_id, openstates.norm_billno(bill_number), coalesce(special,0)))
            FROM public."Bills" WHERE bill_number IS NOT NULL AND session_id IS NOT NULL) AS src_distinct,
         (SELECT count(*) FROM public."Bills" WHERE bill_number IS NOT NULL AND session_id IS NOT NULL) AS src_rows,
         (SELECT count(*) FROM openstates.people_xref) AS people,
         (SELECT count(*) FROM openstates.people_xref WHERE openstates_id IS NOT NULL) AS people_os,
         (SELECT count(*) FROM openstates.people_xref WHERE native_member_id IS NOT NULL) AS people_native,
         (SELECT count(*) FROM openstates.people_xref WHERE ballotpedia IS NOT NULL) AS people_ballotpedia,
         (SELECT count(*) FROM openstates.people_xref WHERE votesmart IS NOT NULL) AS people_votesmart,
         (SELECT count(*) FROM public."People" WHERE followthemoney_eid IS NOT NULL) AS ftm_only_ours`)).rows[0];

const ok = Number(v.bills) === Number(v.src_distinct);
console.log(JSON.stringify({
  bill_xref: { rows: Number(v.bills), with_openstates_id: Number(v.bills_os), with_native_id: Number(v.bills_native),
    legiscan_rows: Number(v.src_rows), legiscan_distinct_keys: Number(v.src_distinct),
    duplicate_rows_collapsed: Number(v.src_rows) - Number(v.src_distinct), coverage_verified: ok },
  people_xref: { rows: Number(v.people), with_openstates_id: Number(v.people_os), with_native_member_id: Number(v.people_native),
    ballotpedia: Number(v.people_ballotpedia), votesmart: Number(v.people_votesmart) },
  not_reproducible_without_legiscan: { followthemoney_eid: Number(v.ftm_only_ours) },
  seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
}, null, 1));
await c.end();
if (!ok) { console.error("build-xref: bill_xref does not cover every distinct LegiScan key — refusing to report success"); process.exit(1); }
