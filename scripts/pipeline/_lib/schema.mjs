#!/usr/bin/env node
// scripts/pipeline/_lib/schema.mjs — every table lane DP writes, in one idempotent place.
//
// ONE SHAPE FOR 52 JURISDICTIONS. The pipeline has two engines — the mirrored
// Open States scrapers, and a native feed where the legislature publishes one —
// and they must land in the same tables or `reconcile.mjs` becomes 52 scripts.
// So every row carries `source` ('openstates' | 'nysenate' | 'govinfo' | ...)
// and every key is (source, state, session, bill_number).
//
// Lane IN created bills/sponsors/actions/roll_calls/votes/documents/people here
// with a unique key that had no `source`. Adding a second engine for the same
// state would have collided, so the key gains `source` and existing rows default
// to 'openstates', which is what they are. See D2 in the report.
//
// `norm_billno` is the join key for the whole lane. LegiScan zero-pads (A00021),
// nobody else does (A21), and our own "Bills" holds BOTH for New York (lane IN's
// F5). One IMMUTABLE function, used on both sides of every comparison, is the
// only way that stays honest.

export const DDL = `
CREATE SCHEMA IF NOT EXISTS openstates;

CREATE OR REPLACE FUNCTION openstates.norm_billno(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(upper(regexp_replace(coalesce(t,''),'[^A-Za-z0-9]','','g')), '^([A-Z]+)0+([0-9])', '\\1\\2')
$$;

-- ---- the shared core, extended with source ------------------------------
ALTER TABLE openstates.bills      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openstates';
ALTER TABLE openstates.sponsors   ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openstates';
ALTER TABLE openstates.actions    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openstates';
ALTER TABLE openstates.roll_calls ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openstates';
ALTER TABLE openstates.votes      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openstates';
ALTER TABLE openstates.documents  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openstates';

ALTER TABLE openstates.bills      ADD COLUMN IF NOT EXISTS bill_key text;
ALTER TABLE openstates.sponsors   ADD COLUMN IF NOT EXISTS bill_key text;
ALTER TABLE openstates.actions    ADD COLUMN IF NOT EXISTS bill_key text;
ALTER TABLE openstates.roll_calls ADD COLUMN IF NOT EXISTS bill_key text;
ALTER TABLE openstates.documents  ADD COLUMN IF NOT EXISTS bill_key text;

DROP INDEX IF EXISTS openstates.os_bills_key;
CREATE UNIQUE INDEX IF NOT EXISTS os_bills_key ON openstates.bills (source, state, session, bill_number);
CREATE INDEX IF NOT EXISTS os_bills_bk    ON openstates.bills      (source, state, session, bill_key);
CREATE INDEX IF NOT EXISTS os_sponsors_bk ON openstates.sponsors   (source, state, session, bill_key);
CREATE INDEX IF NOT EXISTS os_actions_bk  ON openstates.actions    (source, state, session, bill_key);
CREATE INDEX IF NOT EXISTS os_rc_bk       ON openstates.roll_calls (source, state, session, bill_key);
CREATE INDEX IF NOT EXISTS os_docs_bk     ON openstates.documents  (source, state, session, bill_key);

-- ---- native depth: what a real feed gives that a scraper's subset does not --
-- One row per amendment version. LegiScan collapses a bill to its latest text;
-- New York publishes every letter, each with its own memo, law code and status.
CREATE TABLE IF NOT EXISTS openstates.bill_versions (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  version text NOT NULL, print_no text, publish_date text, published boolean, stricken boolean,
  uni_bill boolean, act_clause text, law_code text, law_section text,
  full_text_chars int, full_text_sha256 text, memo_chars int, memo_sha256 text,
  n_cosponsors int, n_multisponsors int,
  PRIMARY KEY (source, state, session, bill_key, version)
);

-- Text and memo, hashed always and stored on request (--store-text). The hash is
-- what reconcile needs; the bytes are already canonical in public."BillTexts".
CREATE TABLE IF NOT EXISTS openstates.bill_texts (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  version text NOT NULL, kind text NOT NULL,          -- 'text' | 'memo'
  chars int, sha256 text, mime text, body text,
  PRIMARY KEY (source, state, session, bill_key, version, kind)
);

-- Committee agendas: which committee had this bill on its agenda, and when.
-- LegiScan has no equivalent field at all.
CREATE TABLE IF NOT EXISTS openstates.bill_agendas (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  agenda_year int, agenda_no int, chamber text, committee text,
  PRIMARY KEY (source, state, session, bill_key, agenda_year, agenda_no, chamber, committee)
);

-- Floor calendars: the bill's appearances on a day's active list.
CREATE TABLE IF NOT EXISTS openstates.bill_calendars (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  cal_year int, cal_no int,
  PRIMARY KEY (source, state, session, bill_key, cal_year, cal_no)
);

-- Bill-to-bill relations: same-as companions, previous sessions' versions,
-- substitutions, reprints. This is how a bill's life crosses chambers and years.
CREATE TABLE IF NOT EXISTS openstates.bill_relations (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  version text NOT NULL DEFAULT '', relation text NOT NULL,
  related_bill text NOT NULL, related_session text,
  PRIMARY KEY (source, state, session, bill_key, version, relation, related_bill, related_session)
);

-- Statutory effect: which laws this bill adds to, amends or repeals.
CREATE TABLE IF NOT EXISTS openstates.bill_laws (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  version text NOT NULL DEFAULT '', relation text NOT NULL, law_code text NOT NULL,
  PRIMARY KEY (source, state, session, bill_key, version, relation, law_code)
);

-- The status ladder, as the legislature itself models it (not our derived status).
CREATE TABLE IF NOT EXISTS openstates.bill_milestones (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  seq int NOT NULL, status_type text, status_desc text, action_date text,
  committee text, bill_cal_no int,
  PRIMARY KEY (source, state, session, bill_key, seq)
);

-- Executive action: veto and approval messages, in full. LegiScan gives a status code.
CREATE TABLE IF NOT EXISTS openstates.bill_messages (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  kind text NOT NULL, seq int NOT NULL, year int, date text, chapter int, memo text,
  PRIMARY KEY (source, state, session, bill_key, kind, seq)
);

-- Members as the feed knows them, with the feed's own id. people_xref joins
-- these to LegiScan's people_id and to openstates/people's ids.
CREATE TABLE IF NOT EXISTS openstates.legislators (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, member_id text NOT NULL,
  session_member_id text, chamber text, full_name text, short_name text, district text,
  incumbent boolean, img text,
  PRIMARY KEY (source, state, session, member_id)
);

-- Hearing notices, in the legislature's own words: who chaired, where, when, and
-- the note attached to the meeting. LegiScan carries none of this.
CREATE TABLE IF NOT EXISTS openstates.meetings (
  source text NOT NULL, state text NOT NULL, session text NOT NULL,
  agenda_year int NOT NULL, agenda_no int NOT NULL, addendum text NOT NULL DEFAULT '',
  chamber text NOT NULL, committee text NOT NULL,
  chair text, location text, meeting_dt text, notes text,
  has_votes boolean, n_bills int, week_of text, modified_dt text,
  PRIMARY KEY (source, state, session, agenda_year, agenda_no, addendum, chamber, committee)
);

-- Floor calendars, entry by entry: which bill was on which day's list, in which
-- section (THIRD_READING, STARRED, ...), and in what order.
CREATE TABLE IF NOT EXISTS openstates.calendar_entries (
  source text NOT NULL, state text NOT NULL, session text NOT NULL,
  cal_year int NOT NULL, cal_no int NOT NULL, cal_kind text NOT NULL, cal_version text NOT NULL DEFAULT '',
  section text NOT NULL DEFAULT '', seq int NOT NULL DEFAULT 0,
  cal_date text, release_dt text, bill_key text, print_no text, sub_bill_key text,
  PRIMARY KEY (source, state, session, cal_year, cal_no, cal_kind, cal_version, section, seq)
);

-- Committee referral history. LegiScan gives one current committee; the feed
-- gives the whole path a bill took through them.
CREATE TABLE IF NOT EXISTS openstates.bill_committees (
  source text NOT NULL, state text NOT NULL, session text NOT NULL, bill_key text NOT NULL,
  chamber text NOT NULL, committee text NOT NULL, reference_date text NOT NULL DEFAULT '',
  PRIMARY KEY (source, state, session, bill_key, chamber, committee, reference_date)
);

-- Extra columns the feed carries and the shared core did not have room for.
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS chamber text;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS bill_type text;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS is_resolution boolean;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS active_version text;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS program_info text;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS signed boolean;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS adopted boolean;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS vetoed boolean;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS substituted_by text;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS published_dt text;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS law_code text;
ALTER TABLE openstates.bills ADD COLUMN IF NOT EXISTS law_section text;

-- ---- the normalisers, in ONE place --------------------------------------
-- Every one of these exists because a comparison that skipped it produced a
-- confidently wrong number first. They live in the schema, not in a caller, so
-- reconcile.mjs and build-xref.mjs cannot disagree about what "same" means.

CREATE OR REPLACE FUNCTION openstates.norm_chamber(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  -- ours says House / Senate / Assembly; the feeds say H / S; Open States says
  -- lower / upper / legislature. Assembly is a lower house.
  SELECT CASE upper(left(coalesce(t,''),1))
    WHEN 'A' THEN 'H' WHEN 'H' THEN 'H' WHEN 'L' THEN 'H'
    WHEN 'S' THEN 'S' WHEN 'U' THEN 'S' WHEN 'J' THEN 'J' ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION openstates.norm_district(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  -- ours writes SD-055 / HD-004A, the feeds write 55 / 4A.
  SELECT coalesce(nullif(regexp_replace(regexp_replace(upper(coalesce(t,'')), '^[A-Z]+-', ''), '^0+([0-9A-Z])', '\\1'), ''), '?')
$$;

-- One value at a time, because Open States is not internally consistent:
-- "Barlas, Al" and "Claire Valdez" and bare "JACKSON" all appear, sometimes in
-- the same state. split_part(name,',',1) is right for the first and returns the
-- WHOLE STRING for the second, which is how a sponsor overlap of 0.0% gets
-- reported as a finding instead of as a bug.
CREATE OR REPLACE FUNCTION openstates.surname(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(regexp_replace(
    CASE
      WHEN t IS NULL OR btrim(t) = '' THEN ''
      WHEN position(',' in t) > 0 THEN split_part(t, ',', 1)
      WHEN t !~ '\\s' THEN t
      -- Drop a trailing generational suffix BEFORE taking the last token, or
      -- "Joseph P. Addabbo Jr." yields "JR". Our "People".last_name has no
      -- suffix, so without this the two sides never meet.
      ELSE regexp_replace(regexp_replace(btrim(t), '[ ,]+(JR|SR|II|III|IV|V)\\.?$', '', 'i'), '^.*\\s', '')
    END, '[^A-Za-z-]', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION openstates.norm_vote(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE upper(coalesce(t,''))
    WHEN 'YEA' THEN 'Y' WHEN 'AYE' THEN 'Y' WHEN 'AYEWR' THEN 'Y' WHEN 'Y' THEN 'Y' WHEN 'YES' THEN 'Y'
    WHEN 'NAY' THEN 'N' WHEN 'NO' THEN 'N' WHEN 'N' THEN 'N'
    WHEN 'NV' THEN 'X' WHEN 'ABD' THEN 'X' WHEN 'ABSTAIN' THEN 'X' WHEN 'NOT VOTING' THEN 'X'
    WHEN 'ABSENT' THEN 'A' WHEN 'ABS' THEN 'A' WHEN 'EXC' THEN 'A' WHEN 'EXCUSED' THEN 'A'
    ELSE 'O' END
$$;

-- The session map. Open States says '222', we say 2026; the feeds say 2025 and
-- so do we; govinfo says 119 and we say 2025. Rather than hard-code 52 of those,
-- it is DERIVED from key overlap and stored WITH the overlap, so a mapping is a
-- measurement anyone can check rather than a constant someone once typed.
-- our_special is NOT decoration. public."Bills" is unique on
-- (state, bill_number, session_id, SPECIAL), and Texas held a regular session
-- and two called sessions in 2025 — three different HB1s under one session_id.
-- Mapping to session_id alone matched Open States' 892 (the 2nd called session)
-- against the REGULAR session's bills and reported actions at 2.46%: 692 bills
-- "matched", every one of them the wrong bill.
CREATE TABLE IF NOT EXISTS openstates.session_map (
  state text NOT NULL, source text NOT NULL, session text NOT NULL,
  our_session_id text NOT NULL, our_special smallint NOT NULL DEFAULT 0,
  shared_keys int, their_keys int, overlap_pct numeric,
  built_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state, source, session)
);
ALTER TABLE openstates.session_map ADD COLUMN IF NOT EXISTS our_special smallint NOT NULL DEFAULT 0;

-- ---- the crosswalks (deliverable 4) ---------------------------------------
-- Built while BOTH id spaces exist, which is the only time it can be built.
CREATE TABLE IF NOT EXISTS openstates.bill_xref (
  state text NOT NULL, session_id text NOT NULL, bill_number text NOT NULL,
  bill_key text NOT NULL, special smallint NOT NULL DEFAULT 0,
  legiscan_bill_id bigint, openstates_id text, native_id text,
  legiscan_session_id bigint, session_title text,
  first_seen timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state, session_id, bill_key, special)
);
CREATE INDEX IF NOT EXISTS bill_xref_legiscan ON openstates.bill_xref (legiscan_bill_id);

CREATE TABLE IF NOT EXISTS openstates.people_xref (
  state text NOT NULL, chamber text NOT NULL, district text NOT NULL, name_key text NOT NULL,
  legiscan_people_id bigint, openstates_id text, native_member_id text,
  ballotpedia text, votesmart text, bioguide text, full_name text,
  first_seen timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state, chamber, district, name_key)
);
CREATE INDEX IF NOT EXISTS people_xref_legiscan ON openstates.people_xref (legiscan_people_id);

-- ---- the reconcile ledger (deliverable 2) ---------------------------------
-- A verdict with a timestamp, so drift is a time series and not a memory.
CREATE TABLE IF NOT EXISTS openstates.pipeline_reconcile (
  run_id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL, session text NOT NULL, source text NOT NULL,
  verdict text NOT NULL,                              -- parity | close | gap | failed
  bills_ours int, bills_theirs int, bills_matched int, bills_pct numeric,
  actions_pct numeric, sponsors_pct numeric, votes_pct numeric,
  rc_ours int, rc_theirs int, rc_matched int,
  docs_ours int, docs_theirs int,
  detail jsonb, notes text
);
CREATE INDEX IF NOT EXISTS pipeline_reconcile_key ON openstates.pipeline_reconcile (state, session, source, ran_at DESC);
`;

/**
 * The four inherited tables had no unique key, so a re-run doubled every row.
 * Declaring one means collapsing the exact duplicates that a missing key
 * allowed in — a self-join over 90,000 vote rows, which is a minute of work and
 * has no business running on every nightly invocation. So each repair is
 * guarded by "does this index already exist", and after the first run
 * prepareSchema is a no-op again.
 */
const REPAIRS = [
  {
    index: "os_votes_uk", table: "votes",
    // ctid + row_number(): ONE sort and one join on ctid. The obvious
    // `DELETE ... USING <self> WHERE a.ctid > b.ctid AND ...` is a nested loop
    // — it ran for 200 s on 90,000 vote rows without finishing, which is not a
    // thing to leave inside a nightly job's schema step.
    dedupe: `DELETE FROM openstates.votes x USING (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (PARTITION BY source, os_rc_id, coalesce(voter_name,''), coalesce(vote_desc,'') ORDER BY ctid) AS rn
          FROM openstates.votes
        ) z WHERE z.rn > 1
      ) d WHERE x.ctid = d.ctid`,
    create: `CREATE UNIQUE INDEX os_votes_uk ON openstates.votes (source, os_rc_id, coalesce(voter_name,''), coalesce(vote_desc,''))`,
  },
  {
    index: "os_sponsors_uk", table: "sponsors",
    // ctid + row_number(): ONE sort and one join on ctid. The obvious
    // `DELETE ... USING <self> WHERE a.ctid > b.ctid AND ...` is a nested loop
    // — it ran for 200 s on 90,000 vote rows without finishing, which is not a
    // thing to leave inside a nightly job's schema step.
    dedupe: `DELETE FROM openstates.sponsors x USING (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (PARTITION BY source, state, session, bill_number, coalesce(name,''), coalesce(classification,'') ORDER BY ctid) AS rn
          FROM openstates.sponsors
        ) z WHERE z.rn > 1
      ) d WHERE x.ctid = d.ctid`,
    create: `CREATE UNIQUE INDEX os_sponsors_uk ON openstates.sponsors (source, state, session, bill_number, coalesce(name,''), coalesce(classification,''))`,
  },
  {
    index: "os_actions_uk", table: "actions",
    // ctid + row_number(): ONE sort and one join on ctid. The obvious
    // `DELETE ... USING <self> WHERE a.ctid > b.ctid AND ...` is a nested loop
    // — it ran for 200 s on 90,000 vote rows without finishing, which is not a
    // thing to leave inside a nightly job's schema step.
    dedupe: `DELETE FROM openstates.actions x USING (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (PARTITION BY source, state, session, bill_number, coalesce(seq,-1), md5(coalesce(date,'') || '|' || coalesce(action,'')) ORDER BY ctid) AS rn
          FROM openstates.actions
        ) z WHERE z.rn > 1
      ) d WHERE x.ctid = d.ctid`,
    create: `CREATE UNIQUE INDEX os_actions_uk ON openstates.actions (source, state, session, bill_number, coalesce(seq,-1), md5(coalesce(date,'') || '|' || coalesce(action,'')))`,
  },
  {
    index: "os_documents_uk", table: "documents",
    // ctid + row_number(): ONE sort and one join on ctid. The obvious
    // `DELETE ... USING <self> WHERE a.ctid > b.ctid AND ...` is a nested loop
    // — it ran for 200 s on 90,000 vote rows without finishing, which is not a
    // thing to leave inside a nightly job's schema step.
    dedupe: `DELETE FROM openstates.documents x USING (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (PARTITION BY source, state, session, bill_number, coalesce(kind,''), coalesce(note,''), md5(coalesce(url,'')) ORDER BY ctid) AS rn
          FROM openstates.documents
        ) z WHERE z.rn > 1
      ) d WHERE x.ctid = d.ctid`,
    create: `CREATE UNIQUE INDEX os_documents_uk ON openstates.documents (source, state, session, bill_number, coalesce(kind,''), coalesce(note,''), md5(coalesce(url,'')))`,
  },
];

/**
 * bill_key is the join key for the whole lane, and the rows lane IN loaded
 * predate the column. They are reachable only through it, so a NULL there is a
 * table that silently contributes nothing to a reconcile — which is exactly how
 * New Jersey first came back with "actions: theirs 0" over 13,229 real rows.
 * Backfilled once per table, guarded by an EXISTS so the nightly path is free.
 */
const KEYED = ["bills", "sponsors", "actions", "roll_calls", "documents"];

export async function prepareSchema(c, { log = () => {} } = {}) {
  await c.query(DDL);
  for (const t of KEYED) {
    const { rows } = await c.query(`SELECT 1 FROM openstates.${t} WHERE bill_key IS NULL AND bill_number IS NOT NULL LIMIT 1`);
    if (!rows.length) continue;
    const r = await c.query(`UPDATE openstates.${t} SET bill_key = openstates.norm_billno(bill_number)
                              WHERE bill_key IS NULL AND bill_number IS NOT NULL`);
    log(`schema: ${t}.bill_key backfilled on ${r.rowCount} rows`);
  }
  for (const r of REPAIRS) {
    const { rows } = await c.query(`SELECT 1 FROM pg_indexes WHERE schemaname='openstates' AND indexname=$1`, [r.index]);
    if (rows.length) continue;
    const t0 = Date.now();
    const del = await c.query(r.dedupe);
    await c.query(r.create);
    log(`schema: ${r.index} created · ${del.rowCount} duplicate rows collapsed · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

/** The same normalisation as openstates.norm_billno(), in JS, for pre-insert keys. */
export function normBillNo(t) {
  return String(t ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^([A-Z]+)0+([0-9])/, "$1$2");
}
