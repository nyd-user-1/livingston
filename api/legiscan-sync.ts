// /api/legiscan-sync — policy's Neon, fed from LegiScan.
//
// Two modes, one importer:
//
//   ?mode=dataset&session=2188   one query: the session's weekly bulk archive
//                                (every bill, person and roll call) — backfill,
//                                and the Sunday refresh. Any session, any year.
//                                &hash= and &special= are recorded in
//                                "LegiscanDatasets" so the weekly national sweep
//                                can skip a session whose archive has not changed.
//   ?mode=delta                  daily: getMasterListRaw for the current session
//                                (one query, every bill's change_hash), then
//                                getBill only for what changed, getRollCall only
//                                for roll calls we have never seen. Capped.
//
// What it writes, and where it stops. Bills, Sponsors (every position, not
// just the primary), People, "History Table", "Roll Call" + Votes, Documents
// (text metadata), and two tables the old sync never had: Subjects and SameAs.
// For the current session the NY Senate sync (api/bills-sync.ts) is the
// authority on status — this import never moves a bill's status backwards.
//
// The dataset mode streams the zip (fflate), mapping each file to rows as it
// goes and flushing in batches, so a 70 MB archive never sits in memory whole.
//
//   Auth: Authorization: Bearer $CRON_SECRET, or ?secret=
//   Env:  LEGISCAN_API_KEY, POLICY_DATABASE_URL, CRON_SECRET

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { Unzip, UnzipInflate } from "fflate";

export const config = { maxDuration: 300 };

const API = "https://api.legiscan.com/";
const BATCH = 1000;
const currentSession = () => {
  const y = new Date().getFullYear();
  return y % 2 === 1 ? y : y - 1;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sql = NeonQueryFunction<false, false>;

async function legiscan(key: string, op: string, params: Record<string, string | number> = {}): Promise<any> {
  const qs = new URLSearchParams({ key, op, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const r = await fetch(`${API}?${qs}`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`LegiScan ${op} answered ${r.status}`);
  const data: any = await r.json();
  if (data?.status !== "OK") throw new Error(`LegiScan ${op}: ${data?.alert?.message ?? data?.status ?? "error"}`);
  return data;
}

/* ---- mapping ------------------------------------------------------------ */

/** LegiScan chamber codes: S, A, H — and Congress calls its lower house the House. */
const chamberName = (c: unknown) => {
  const x = String(c ?? "").toUpperCase();
  return x.startsWith("S") ? "Senate" : x.startsWith("A") ? "Assembly" : x.startsWith("H") ? "House" : x.startsWith("L") ? "Legislature" : x.startsWith("C") ? "Council" : x || null;
};

/**
 * LegiScan state_id → postal code, for the states we have seen it on. Runs always pass ?state=, so this is a backstop.
 * WARNING: 31 is NEW MEXICO, not New Jersey — New Jersey is 30. The wrong pairing here is what
 * `national-full-plan.json` was built from, so 28 New Mexico datasets were imported as
 * `?state=NJ` (their People and Roll Call rows carry state='NJ') and New Jersey's own nine
 * bulk datasets were never in the plan at all. The authority is `getSessionList` with no
 * state param: 993 rows, each with `state_abbr`, one query — which is what
 * `scripts/box/national-sweep.mjs` now uses instead of any table like this one.
 */
const STATE_BY_ID: Record<number, string> = { 30: "NJ", 31: "NM", 32: "NY", 52: "US" };
/** What each legislature calls its lower house. House unless listed. */
const LOWER_HOUSE: Record<string, string> = { NY: "Assembly", NJ: "Assembly", CA: "Assembly", NV: "Assembly", WI: "Assembly", NE: "Legislature", DC: "Council", US: "House" };
const lowerHouse = (state: string) => LOWER_HOUSE[state] ?? "House";
/** LegiScan progress event ids (static lookup). */
const PROGRESS_EVENT: Record<number, string> = { 1: "Introduced", 2: "Engrossed", 3: "Enrolled", 4: "Passed", 5: "Vetoed", 6: "Failed", 7: "Override", 8: "Chaptered", 9: "Referred to committee", 10: "Reported: do pass", 11: "Reported: do not pass", 12: "Draft" };
// sponsor_type_id (static lookup): 0 sponsor, 1 primary, 2 co-sponsor, 3 joint sponsor — stored as the id.

/**
 * Status, in the codes policy's UI already filters on (1 introduced, 2 in
 * committee, 3 floor, 4 passed, 5 delivered, 6 signed/adopted, 7 vetoed,
 * 8 substituted, 9 stricken), read off the last action and LegiScan's own
 * status (1 Introduced, 2 Engrossed, 3 Enrolled, 4 Passed, 5 Vetoed, 6 Failed).
 */
function statusOf(bill: any, lastAction: string, lastChamber: string | null): { code: number; desc: string } {
  const a = lastAction.toLowerCase();
  const ls = Number(bill.status ?? 0);
  if (/signed chap|signed by|approved by governor|chapter \d+/.test(a)) return { code: 6, desc: "Signed by Governor" };
  if (/veto/.test(a) || ls === 5) return { code: 7, desc: "Vetoed" };
  if (/delivered to governor/.test(a)) return { code: 5, desc: "Delivered to Governor" };
  if (/adopted/.test(a)) return { code: 6, desc: "Adopted" };
  if (/stricken/.test(a)) return { code: 9, desc: "Stricken" };
  if (/substituted/.test(a)) return { code: 8, desc: "Substituted" };
  if (/passed senate/.test(a)) return { code: 4, desc: "Passed Senate" };
  if (/passed assembly/.test(a)) return { code: 4, desc: "Passed Assembly" };
  if (ls === 4) return { code: 4, desc: "Passed" };
  if (/third reading|calendar|floor/.test(a)) return { code: 3, desc: `${lastChamber ?? "Senate"} Floor Calendar` };
  if (ls === 3) return { code: 3, desc: "Enrolled" };
  if (/referred to|committee|reported/.test(a)) return { code: 2, desc: `In ${lastChamber ?? "Senate"} Committee` };
  if (ls === 2) return { code: 2, desc: "Engrossed" };
  if (ls === 6) return { code: 9, desc: "Failed" };
  return { code: 1, desc: "Introduced" };
}

interface Rows {
  bills: any[];
  sponsors: any[];
  people: Map<number, any>;
  history: any[];
  documents: any[];
  subjects: any[];
  sameAs: any[];
  rollCalls: any[];
  votes: any[];
  calendar: any[];
  progress: any[];
  referrals: any[];
}
const emptyRows = (): Rows => ({ bills: [], sponsors: [], people: new Map(), history: [], documents: [], subjects: [], sameAs: [], rollCalls: [], votes: [], calendar: [], progress: [], referrals: [] });

/** One LegiScan bill (getBill payload or a dataset file) → rows for every table. */
function mapBill(bill: any, rows: Rows) {
  const id = Number(bill.bill_id);
  if (!id) return;
  const session = Number(bill.session?.year_start ?? bill.session_id ?? 0);
  const history: any[] = Array.isArray(bill.history) ? bill.history : [];
  const last = history[history.length - 1];
  const lastAction = String(last?.action ?? "");
  const lastChamber = chamberName(last?.chamber);
  const st = statusOf(bill, lastAction, lastChamber);
  const state = String(bill.state ?? STATE_BY_ID[Number(bill.state_id)] ?? "NY").toUpperCase();
  rows.bills.push({
    bill_id: id,
    state,
    session_id: session,
    special: Number(bill.session?.special ?? 0) || 0,
    legiscan_session_id: Number(bill.session?.session_id ?? 0) || null,
    session_title: bill.session?.session_title ? String(bill.session.session_title) : null,
    bill_type: bill.bill_type ? String(bill.bill_type) : null,
    bill_type_id: Number(bill.bill_type_id ?? 0) || null,
    body: chamberName(bill.body),
    current_body: chamberName(bill.current_body),
    completed: Boolean(Number(bill.completed ?? 0)),
    pending_committee_id: bill.pending_committee_id ? String(bill.pending_committee_id) : null,
    bill_number: String(bill.bill_number ?? ""),
    status: st.code,
    status_desc: st.desc,
    status_date: bill.status_date ? String(bill.status_date) : null,
    title: String(bill.title ?? "Untitled Bill"),
    description: String(bill.description ?? bill.title ?? "") || null,
    committee_id: bill.committee?.committee_id ? String(bill.committee.committee_id) : null,
    committee: bill.committee?.name ? String(bill.committee.name) : null,
    last_action_date: last?.date ? String(last.date) : bill.status_date ? String(bill.status_date) : null,
    last_action: lastAction || "Introduced",
    url: String(bill.url ?? ""),
    state_link: String(bill.state_link ?? ""),
    change_hash: String(bill.change_hash ?? ""),
  });
  (Array.isArray(bill.sponsors) ? bill.sponsors : []).forEach((s: any, i: number) => {
    const pid = Number(s.people_id);
    if (!pid) return;
    rows.sponsors.push({
      bill_id: id, people_id: pid, position: Number(s.sponsor_order) || i + 1,
      sponsor_type_id: Number(s.sponsor_type_id ?? 0) || 0, committee_sponsor: Boolean(Number(s.committee_sponsor ?? 0)),
      sponsor_committee_id: s.committee_id ? String(s.committee_id) : null,
    });
    if (!rows.people.has(pid)) rows.people.set(pid, mapPerson(s, state));
  });
  history.forEach((h: any, i: number) => {
    rows.history.push({ bill_id: id, date: String(h.date ?? ""), chamber: chamberName(h.chamber), sequence: i + 1, action: String(h.action ?? "") });
  });
  (Array.isArray(bill.texts) ? bill.texts : []).forEach((t: any) => {
    if (!t.doc_id) return;
    rows.documents.push({
      bill_id: id, document_id: Number(t.doc_id), document_type: "text", document_size: Number(t.text_size ?? 0) || null,
      document_mime: String(t.mime ?? ""), document_desc: String(t.type ?? ""), url: String(t.url ?? ""), state_link: String(t.state_link ?? ""),
    });
  });
  (Array.isArray(bill.amendments) ? bill.amendments : []).forEach((t: any) => {
    if (!t.amendment_id) return;
    rows.documents.push({
      bill_id: id, document_id: Number(t.amendment_id), document_type: "amendment", document_size: Number(t.amendment_size ?? 0) || null,
      document_mime: String(t.mime ?? ""), document_desc: String(t.title ?? t.description ?? "Amendment"), url: String(t.url ?? ""), state_link: String(t.state_link ?? ""),
    });
  });
  (Array.isArray(bill.supplements) ? bill.supplements : []).forEach((t: any) => {
    if (!t.supplement_id) return;
    rows.documents.push({
      bill_id: id, document_id: Number(t.supplement_id), document_type: "supplement", document_size: Number(t.supplement_size ?? 0) || null,
      document_mime: String(t.mime ?? ""), document_desc: [t.type, t.title].filter(Boolean).join(": ") || "Supplement", url: String(t.url ?? ""), state_link: String(t.state_link ?? ""),
    });
  });
  (Array.isArray(bill.calendar) ? bill.calendar : []).forEach((c: any, i: number) => {
    rows.calendar.push({ bill_id: id, seq: i + 1, type_id: Number(c.type_id ?? 0) || null, type: String(c.type ?? ""), date: String(c.date ?? ""), time: String(c.time ?? ""), location: String(c.location ?? ""), description: String(c.description ?? "") });
  });
  (Array.isArray(bill.progress) ? bill.progress : []).forEach((p: any, i: number) => {
    const ev = Number(p.event ?? 0);
    rows.progress.push({ bill_id: id, seq: i + 1, date: String(p.date ?? ""), event_id: ev, event: PROGRESS_EVENT[ev] ?? String(ev) });
  });
  (Array.isArray(bill.referrals) ? bill.referrals : []).forEach((r: any, i: number) => {
    rows.referrals.push({ bill_id: id, seq: i + 1, date: String(r.date ?? ""), committee_id: r.committee_id ? String(r.committee_id) : null, chamber: chamberName(r.chamber), name: String(r.name ?? "") });
  });
  (Array.isArray(bill.subjects) ? bill.subjects : []).forEach((s: any) => {
    if (s.subject_id) rows.subjects.push({ bill_id: id, subject_id: Number(s.subject_id), subject: String(s.subject_name ?? "") });
  });
  (Array.isArray(bill.sasts) ? bill.sasts : []).forEach((s: any) => {
    if (s.sast_bill_id) rows.sameAs.push({ bill_id: id, sast_type_id: Number(s.type_id ?? 0), sast_type: String(s.type ?? ""), sast_bill_id: Number(s.sast_bill_id), sast_bill_number: String(s.sast_bill_number ?? "") });
  });
  // Roll-call headers ride on the bill; the per-member votes come from the vote files / getRollCall.
  (Array.isArray(bill.votes) ? bill.votes : []).forEach((v: any) => {
    if (v.roll_call_id) rows.rollCalls.push(mapRollCallHeader(v, id, state));
  });
}

const mapRollCallHeader = (v: any, billId: number, state: string) => ({
  roll_call_id: Number(v.roll_call_id), bill_id: billId, state, date: String(v.date ?? ""), chamber: chamberName(v.chamber),
  description: String(v.desc ?? ""), yea: Number(v.yea ?? 0), nay: Number(v.nay ?? 0), nv: Number(v.nv ?? 0), absent: Number(v.absent ?? 0), total: Number(v.total ?? 0),
});

/** A getRollCall payload (or a dataset vote file) → header + member votes. */
function mapRollCall(rc: any, rows: Rows, state: string) {
  if (!rc?.roll_call_id) return;
  rows.rollCalls.push(mapRollCallHeader(rc, Number(rc.bill_id), state));
  (Array.isArray(rc.votes) ? rc.votes : []).forEach((v: any) => {
    if (v.people_id) rows.votes.push({ roll_call_id: Number(rc.roll_call_id), people_id: Number(v.people_id), vote: Number(v.vote_id ?? 0), vote_desc: String(v.vote_text ?? "") });
  });
}

const mapPerson = (p: any, state: string) => {
  const st = String(STATE_BY_ID[Number(p.state_id)] ?? state).toUpperCase();
  const social = p.bio?.social ?? {};
  const idOrNull = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
  const strOrNull = (v: unknown) => (v ? String(v) : null);
  return {
    people_id: Number(p.people_id), state: st, name: String(p.name ?? ""), first_name: String(p.first_name ?? ""), middle_name: String(p.middle_name ?? "") || null,
    last_name: String(p.last_name ?? ""), party_id: Number(p.party_id ?? 0) || null, party: String(p.party ?? "") || null, role_id: Number(p.role_id ?? 0) || null,
    role: String(p.role ?? "") || null, district: String(p.district ?? "") || null,
    chamber: String(p.role ?? "") === "Sen" ? "Senate" : String(p.role ?? "") === "Rep" ? lowerHouse(st) : null,
    // The bridges to everything outside LegiScan.
    votesmart_id: idOrNull(p.votesmart_id), opensecrets_id: strOrNull(p.opensecrets_id), ballotpedia: strOrNull(p.ballotpedia),
    followthemoney_eid: idOrNull(p.ftm_eid), knowwho_pid: idOrNull(p.knowwho_pid), bioguide_id: strOrNull(p.bioguide_id),
    nickname: strOrNull(p.nickname), suffix: strOrNull(p.suffix), person_hash: strOrNull(p.person_hash),
    email: strOrNull(social.email), phone_capitol: strOrNull(social.capitol_phone), phone_district: strOrNull(social.district_phone),
    bio_url: strOrNull(social.biography), photo_url: strOrNull(social.image),
  };
};

/* ---- writing ------------------------------------------------------------ */

async function prepareSchema(sql: Sql) {
  await sql.query(`ALTER TABLE "Bills" ADD COLUMN IF NOT EXISTS change_hash text`);
  for (const t of ["Bills", "People", "Roll Call"]) await sql.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'NY'`);
  // The two earlier unique indexes ((bill_number, session_id) and (state, bill_number, session_id))
  // are superseded by the one with `special` below — never re-create them here.
  await sql.query(`DROP INDEX IF EXISTS idx_bills_number_session`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_bills_number_session_lookup ON "Bills" (bill_number, session_id)`);
  for (const [c, t] of [["bill_type", "text"], ["bill_type_id", "int"], ["body", "text"], ["current_body", "text"], ["completed", "boolean"], ["pending_committee_id", "text"], ["special", "smallint NOT NULL DEFAULT 0"], ["legiscan_session_id", "bigint"], ["session_title", "text"]])
    await sql.query(`ALTER TABLE "Bills" ADD COLUMN IF NOT EXISTS ${c} ${t}`);
  for (const [c, t] of [["sponsor_type_id", "int"], ["committee_sponsor", "boolean"], ["sponsor_committee_id", "text"]])
    await sql.query(`ALTER TABLE "Sponsors" ADD COLUMN IF NOT EXISTS ${c} ${t}`);
  for (const [c, t] of [["votesmart_id", "bigint"], ["opensecrets_id", "text"], ["ballotpedia", "text"], ["followthemoney_eid", "bigint"], ["knowwho_pid", "bigint"], ["bioguide_id", "text"], ["nickname", "text"], ["suffix", "text"], ["person_hash", "text"], ["bio_url", "text"]])
    await sql.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS ${c} ${t}`);
  // Special sessions share a year with the regular one; a bill number can repeat across them.
  await sql.query(`DROP INDEX IF EXISTS idx_bills_state_number_session`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_state_number_session_special ON "Bills" (state, bill_number, session_id, special) WHERE bill_number IS NOT NULL`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "Calendar" (bill_id bigint NOT NULL, seq int NOT NULL, type_id int, type text, date text, time text, location text, description text, PRIMARY KEY (bill_id, seq))`);
  await sql.query(`CREATE INDEX IF NOT EXISTS calendar_date_idx ON "Calendar" (date)`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "Progress" (bill_id bigint NOT NULL, seq int NOT NULL, date text, event_id int, event text, PRIMARY KEY (bill_id, seq))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "Referrals" (bill_id bigint NOT NULL, seq int NOT NULL, date text, committee_id text, chamber text, name text, PRIMARY KEY (bill_id, seq))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "Subjects" (bill_id bigint NOT NULL, subject_id bigint NOT NULL, subject text, PRIMARY KEY (bill_id, subject_id))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "SameAs" (bill_id bigint NOT NULL, sast_type_id int NOT NULL, sast_type text, sast_bill_id bigint NOT NULL, sast_bill_number text, PRIMARY KEY (bill_id, sast_type_id, sast_bill_id))`);
  // What the weekly national sweep diffs against. One `getDatasetList` names every
  // session's dataset_hash; a row here whose hash still matches is a 20-70 MB zip
  // nobody has to download. Written by this route at the end of a SUCCESSFUL
  // mode=dataset run only, so a dataset that failed is retried, never skipped.
  // A NULL dataset_hash means "imported, hash unknown" — the seed the sweep writes
  // for everything the laptop had already imported before this ledger existed.
  await sql.query(`CREATE TABLE IF NOT EXISTS "LegiscanDatasets" (state text NOT NULL, session_id int NOT NULL, dataset_hash text, dataset_size bigint, year int, special smallint, imported_at timestamptz NOT NULL DEFAULT now(), bills int, ms int, PRIMARY KEY (state, session_id))`);
  await sql.query(`CREATE INDEX IF NOT EXISTS legiscan_datasets_imported_idx ON "LegiscanDatasets" (imported_at)`);
  for (const [name, def] of [
    ["bills_session_idx", `"Bills" (session_id)`],
    ["bills_last_action_idx", `"Bills" (last_action_date)`],
    ["sponsors_bill_idx", `"Sponsors" (bill_id)`],
    ["sponsors_people_idx", `"Sponsors" (people_id)`],
    ["history_bill_idx", `"History Table" (bill_id)`],
    ["documents_bill_idx", `"Documents" (bill_id)`],
    ["rollcall_bill_idx", `"Roll Call" (bill_id)`],
    ["votes_people_idx", `"Votes" (people_id)`],
  ]) await sql.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${def}`);
  // Documents: the key was (document_id) alone, but LegiScan's text, amendment and
  // supplement ids are three id spaces and collided across states — 18% of rows became
  // chimeras (lane IN, F1). Move the key to (document_type, document_id), once.
  await sql.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Documents"'::regclass AND contype = 'p'
               AND pg_get_constraintdef(oid) = 'PRIMARY KEY (document_id)') THEN
      ALTER TABLE "Documents" DROP CONSTRAINT "Documents_pkey";
      ALTER TABLE "Documents" ADD PRIMARY KEY (document_type, document_id);
    END IF;
  END $$`);
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const col = (rows: any[], k: string) => rows.map((r) => r[k]);
const dedupe = <T,>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];

/** Write everything collected so far; the counts come back for the report. */
async function flush(sql: Sql, rows: Rows, counts: Record<string, number>) {
  const add = (k: string, n: number) => (counts[k] = (counts[k] ?? 0) + n);

  for (const b of chunk(dedupe(rows.people.size ? [...rows.people.values()] : [], (p) => String(p.people_id)), BATCH)) {
    await sql.query(
      `INSERT INTO "People" (people_id, name, first_name, middle_name, last_name, party_id, party, role_id, role, district, chamber, state,
                             votesmart_id, opensecrets_id, ballotpedia, followthemoney_eid, knowwho_pid, bioguide_id, nickname, suffix, person_hash, email, phone_capitol, phone_district, bio_url, photo_url)
       SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::text[], $8::bigint[], $9::text[], $10::text[], $11::text[], $12::text[],
                            $13::bigint[], $14::text[], $15::text[], $16::bigint[], $17::bigint[], $18::text[], $19::text[], $20::text[], $21::text[], $22::text[], $23::text[], $24::text[], $25::text[], $26::text[])
       ON CONFLICT (people_id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name, first_name = EXCLUDED.first_name, middle_name = COALESCE(EXCLUDED.middle_name, "People".middle_name),
         last_name = EXCLUDED.last_name, party_id = COALESCE(EXCLUDED.party_id, "People".party_id), party = COALESCE(EXCLUDED.party, "People".party),
         role_id = COALESCE(EXCLUDED.role_id, "People".role_id), role = COALESCE(EXCLUDED.role, "People".role), district = COALESCE(EXCLUDED.district, "People".district),
         chamber = COALESCE(EXCLUDED.chamber, "People".chamber),
         votesmart_id = COALESCE(EXCLUDED.votesmart_id, "People".votesmart_id), opensecrets_id = COALESCE(EXCLUDED.opensecrets_id, "People".opensecrets_id),
         ballotpedia = COALESCE(EXCLUDED.ballotpedia, "People".ballotpedia), followthemoney_eid = COALESCE(EXCLUDED.followthemoney_eid, "People".followthemoney_eid),
         knowwho_pid = COALESCE(EXCLUDED.knowwho_pid, "People".knowwho_pid), bioguide_id = COALESCE(EXCLUDED.bioguide_id, "People".bioguide_id),
         nickname = COALESCE(EXCLUDED.nickname, "People".nickname), suffix = COALESCE(EXCLUDED.suffix, "People".suffix), person_hash = COALESCE(EXCLUDED.person_hash, "People".person_hash),
         email = COALESCE("People".email, EXCLUDED.email), phone_capitol = COALESCE("People".phone_capitol, EXCLUDED.phone_capitol), phone_district = COALESCE("People".phone_district, EXCLUDED.phone_district),
         bio_url = COALESCE(EXCLUDED.bio_url, "People".bio_url), photo_url = COALESCE("People".photo_url, EXCLUDED.photo_url)`,
      ["people_id", "name", "first_name", "middle_name", "last_name", "party_id", "party", "role_id", "role", "district", "chamber", "state",
       "votesmart_id", "opensecrets_id", "ballotpedia", "followthemoney_eid", "knowwho_pid", "bioguide_id", "nickname", "suffix", "person_hash", "email", "phone_capitol", "phone_district", "bio_url", "photo_url"].map((k) => col(b, k)),
    );
    add("people", b.length);
  }
  rows.people.clear();

  for (const b of chunk(dedupe(rows.bills, (r) => String(r.bill_id)), BATCH)) {
    // (bill_number, session_id) is unique. A row already holding that number
    // under another id — the NY Senate sync's minted id, usually — gives way
    // to LegiScan's id: its children are re-imported below, so drop it whole.
    const sessions = [...new Set(b.map((r) => Number(r.session_id)))];
    const states = [...new Set(b.map((r) => String(r.state)))];
    const existing = (await sql.query(
      `SELECT bill_id, bill_number, session_id, state, special FROM "Bills" WHERE state = ANY($3::text[]) AND session_id = ANY($1::bigint[]) AND bill_number = ANY($2::text[])`,
      [sessions, b.map((r) => r.bill_number), states],
    )) as any[];
    const incoming = new Map(b.map((r) => [`${r.state}:${r.session_id}:${r.special}:${r.bill_number}`, Number(r.bill_id)]));
    const stale = existing
      .filter((e) => incoming.has(`${e.state}:${e.session_id}:${Number(e.special ?? 0)}:${e.bill_number}`) && incoming.get(`${e.state}:${e.session_id}:${Number(e.special ?? 0)}:${e.bill_number}`) !== Number(e.bill_id))
      .map((e) => Number(e.bill_id));
    if (stale.length) {
      await sql.transaction([
        sql.query(`DELETE FROM "Sponsors" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "History Table" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Subjects" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "SameAs" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Calendar" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Progress" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Documents" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Referrals" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Bills" WHERE bill_id = ANY($1::bigint[])`, [stale]),
      ]);
      add("replacedIds", stale.length);
    }
    // Status never moves backwards: the NY Senate sync is the authority on the
    // current session, and a newer action on record beats an older one here.
    await sql.query(
      `INSERT INTO "Bills" (bill_id, session_id, bill_number, status, status_desc, status_date, title, description, committee_id, committee,
                            last_action_date, last_action, url, state_link, change_hash, state,
                            special, legiscan_session_id, session_title, bill_type, bill_type_id, body, current_body, completed, pending_committee_id)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                            $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[],
                            $17::smallint[], $18::bigint[], $19::text[], $20::text[], $21::int[], $22::text[], $23::text[], $24::boolean[], $25::text[])
       ON CONFLICT (bill_id) DO UPDATE SET
         state = EXCLUDED.state, session_id = EXCLUDED.session_id, special = EXCLUDED.special, legiscan_session_id = EXCLUDED.legiscan_session_id,
         session_title = EXCLUDED.session_title, bill_type = EXCLUDED.bill_type, bill_type_id = EXCLUDED.bill_type_id, body = EXCLUDED.body,
         current_body = EXCLUDED.current_body, completed = EXCLUDED.completed, pending_committee_id = EXCLUDED.pending_committee_id, bill_number = EXCLUDED.bill_number, title = EXCLUDED.title, description = EXCLUDED.description,
         committee_id = COALESCE(EXCLUDED.committee_id, "Bills".committee_id), committee = COALESCE(EXCLUDED.committee, "Bills".committee),
         url = EXCLUDED.url, state_link = EXCLUDED.state_link, change_hash = EXCLUDED.change_hash,
         status = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.status ELSE "Bills".status END,
         status_desc = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.status_desc ELSE "Bills".status_desc END,
         status_date = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.status_date ELSE "Bills".status_date END,
         last_action = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.last_action ELSE "Bills".last_action END,
         last_action_date = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.last_action_date ELSE "Bills".last_action_date END`,
      ["bill_id", "session_id", "bill_number", "status", "status_desc", "status_date", "title", "description", "committee_id", "committee", "last_action_date", "last_action", "url", "state_link", "change_hash", "state",
       "special", "legiscan_session_id", "session_title", "bill_type", "bill_type_id", "body", "current_body", "completed", "pending_committee_id"].map((k) => col(b, k)),
    );
    add("bills", b.length);
  }

  // Per-bill children: replace whole, per batch of bills.
  const billIds = [...new Set(rows.bills.map((r) => Number(r.bill_id)))];
  for (const ids of chunk(billIds, BATCH)) {
    const idSet = new Set(ids);
    const mine = (r: any) => idSet.has(Number(r.bill_id));
    const sponsors = dedupe(rows.sponsors.filter(mine), (r) => `${r.bill_id}:${r.people_id}`);
    const history = dedupe(rows.history.filter(mine), (r) => `${r.bill_id}:${r.date}:${r.sequence}`);
    const subjects = dedupe(rows.subjects.filter(mine), (r) => `${r.bill_id}:${r.subject_id}`);
    const sameAs = dedupe(rows.sameAs.filter(mine), (r) => `${r.bill_id}:${r.sast_type_id}:${r.sast_bill_id}`);
    const calendar = dedupe(rows.calendar.filter(mine), (r) => `${r.bill_id}:${r.seq}`);
    const progress = dedupe(rows.progress.filter(mine), (r) => `${r.bill_id}:${r.seq}`);
    const referrals = dedupe(rows.referrals.filter(mine), (r) => `${r.bill_id}:${r.seq}`);
    await sql.transaction([
      sql.query(`DELETE FROM "Sponsors" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "History Table" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "Subjects" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "SameAs" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "Calendar" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "Progress" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "Documents" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "Referrals" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      ...(sponsors.length
        ? [sql.query(`INSERT INTO "Sponsors" (bill_id, people_id, position, sponsor_type_id, committee_sponsor, sponsor_committee_id) SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::int[], $5::boolean[], $6::text[])`,
            [col(sponsors, "bill_id"), col(sponsors, "people_id"), col(sponsors, "position"), col(sponsors, "sponsor_type_id"), col(sponsors, "committee_sponsor"), col(sponsors, "sponsor_committee_id")])]
        : []),
      ...(calendar.length
        ? [sql.query(`INSERT INTO "Calendar" (bill_id, seq, type_id, type, date, time, location, description) SELECT * FROM unnest($1::bigint[], $2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])`,
            ["bill_id", "seq", "type_id", "type", "date", "time", "location", "description"].map((k) => col(calendar, k)))]
        : []),
      ...(progress.length
        ? [sql.query(`INSERT INTO "Progress" (bill_id, seq, date, event_id, event) SELECT * FROM unnest($1::bigint[], $2::int[], $3::text[], $4::int[], $5::text[])`,
            ["bill_id", "seq", "date", "event_id", "event"].map((k) => col(progress, k)))]
        : []),
      ...(referrals.length
        ? [sql.query(`INSERT INTO "Referrals" (bill_id, seq, date, committee_id, chamber, name) SELECT * FROM unnest($1::bigint[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[])`,
            ["bill_id", "seq", "date", "committee_id", "chamber", "name"].map((k) => col(referrals, k)))]
        : []),
      ...(history.length
        ? [sql.query(`INSERT INTO "History Table" (bill_id, date, chamber, sequence, action) SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::bigint[], $5::text[])`, [col(history, "bill_id"), col(history, "date"), col(history, "chamber"), col(history, "sequence"), col(history, "action")])]
        : []),
      ...(subjects.length
        ? [sql.query(`INSERT INTO "Subjects" (bill_id, subject_id, subject) SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[])`, [col(subjects, "bill_id"), col(subjects, "subject_id"), col(subjects, "subject")])]
        : []),
      ...(sameAs.length
        ? [sql.query(`INSERT INTO "SameAs" (bill_id, sast_type_id, sast_type, sast_bill_id, sast_bill_number) SELECT * FROM unnest($1::bigint[], $2::int[], $3::text[], $4::bigint[], $5::text[])`, [col(sameAs, "bill_id"), col(sameAs, "sast_type_id"), col(sameAs, "sast_type"), col(sameAs, "sast_bill_id"), col(sameAs, "sast_bill_number")])]
        : []),
    ]);
    add("sponsors", sponsors.length);
    add("history", history.length);
    add("subjects", subjects.length);
    add("sameAs", sameAs.length);
    add("calendar", calendar.length);
    add("progress", progress.length);
    add("referrals", referrals.length);
  }

  // LegiScan's texts, amendments and supplements are three separate id spaces, so the
  // key is (document_type, document_id) — one column collided across states (lane IN, F1).
  for (const b of chunk(dedupe(rows.documents, (r) => `${r.document_type}:${r.document_id}`), BATCH)) {
    await sql.query(
      `INSERT INTO "Documents" (bill_id, document_id, document_type, document_size, document_mime, document_desc, url, state_link)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::text[])
       ON CONFLICT (document_type, document_id) DO UPDATE SET bill_id = EXCLUDED.bill_id, document_size = EXCLUDED.document_size,
         document_mime = EXCLUDED.document_mime, document_desc = EXCLUDED.document_desc, url = EXCLUDED.url, state_link = EXCLUDED.state_link`,
      ["bill_id", "document_id", "document_type", "document_size", "document_mime", "document_desc", "url", "state_link"].map((k) => col(b, k)),
    );
    add("documents", b.length);
  }

  for (const b of chunk(dedupe(rows.rollCalls, (r) => String(r.roll_call_id)), BATCH)) {
    await sql.query(
      `INSERT INTO "Roll Call" (roll_call_id, bill_id, date, chamber, description, yea, nay, nv, absent, total, state)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::text[])
       ON CONFLICT (roll_call_id) DO UPDATE SET state = EXCLUDED.state, bill_id = EXCLUDED.bill_id, date = EXCLUDED.date, chamber = EXCLUDED.chamber, description = EXCLUDED.description,
         yea = EXCLUDED.yea, nay = EXCLUDED.nay, nv = EXCLUDED.nv, absent = EXCLUDED.absent, total = EXCLUDED.total`,
      ["roll_call_id", "bill_id", "date", "chamber", "description", "yea", "nay", "nv", "absent", "total", "state"].map((k) => col(b, k)),
    );
    add("rollCalls", b.length);
  }
  for (const b of chunk(dedupe(rows.votes, (r) => `${r.roll_call_id}:${r.people_id}`), 5000)) {
    await sql.query(
      `INSERT INTO "Votes" (roll_call_id, people_id, vote, vote_desc) SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::text[])
       ON CONFLICT (roll_call_id, people_id) DO UPDATE SET vote = EXCLUDED.vote, vote_desc = EXCLUDED.vote_desc`,
      ["roll_call_id", "people_id", "vote", "vote_desc"].map((k) => col(b, k)),
    );
    add("votes", b.length);
  }

  Object.assign(rows, emptyRows());
}

/**
 * The NY Senate sync mints an id (session·10⁶ + number) for a bill it meets
 * before LegiScan has it. Once LegiScan's own id arrives the minted row is a
 * duplicate of the same bill number — drop it, children and all.
 */
async function dropMintedDuplicates(sql: Sql, sessionYear: number): Promise<number> {
  const dupes = (await sql.query(
    `SELECT m.bill_id FROM "Bills" m JOIN "Bills" l ON l.state = m.state AND l.session_id = m.session_id AND l.bill_number = m.bill_number AND l.bill_id <> m.bill_id
      WHERE m.state = 'NY' AND m.session_id = $1 AND m.bill_id >= $1::bigint * 1000000 AND m.bill_id < ($1::bigint + 1) * 1000000
        AND NOT (l.bill_id >= $1::bigint * 1000000 AND l.bill_id < ($1::bigint + 1) * 1000000)`,
    [sessionYear],
  )) as any[];
  const ids = dupes.map((r) => Number(r.bill_id));
  if (!ids.length) return 0;
  await sql.transaction([
    sql.query(`DELETE FROM "Sponsors" WHERE bill_id = ANY($1::bigint[])`, [ids]),
    sql.query(`DELETE FROM "History Table" WHERE bill_id = ANY($1::bigint[])`, [ids]),
    sql.query(`DELETE FROM "Subjects" WHERE bill_id = ANY($1::bigint[])`, [ids]),
    sql.query(`DELETE FROM "SameAs" WHERE bill_id = ANY($1::bigint[])`, [ids]),
    sql.query(`DELETE FROM "Calendar" WHERE bill_id = ANY($1::bigint[])`, [ids]),
    sql.query(`DELETE FROM "Progress" WHERE bill_id = ANY($1::bigint[])`, [ids]),
    sql.query(`DELETE FROM "Referrals" WHERE bill_id = ANY($1::bigint[])`, [ids]),
    sql.query(`DELETE FROM "Bills" WHERE bill_id = ANY($1::bigint[])`, [ids]),
  ]);
  return ids.length;
}

/* ---- the two modes ------------------------------------------------------ */

async function runDataset(sql: Sql, key: string, state: string, sessionId: number, accessKey: string | undefined, counts: Record<string, number>) {
  if (!accessKey) {
    const list = await legiscan(key, "getDatasetList", { state });
    const hit = (list.datasetlist ?? []).find((d: any) => Number(d.session_id) === sessionId);
    if (!hit) throw new Error(`no ${state} dataset for session ${sessionId}`);
    accessKey = String(hit.access_key);
    counts.queries = (counts.queries ?? 0) + 1;
  }
  const ds = await legiscan(key, "getDataset", { id: sessionId, access_key: accessKey });
  counts.queries = (counts.queries ?? 0) + 1;
  const zip = Buffer.from(String(ds.dataset?.zip ?? ""), "base64");
  counts.zipBytes = zip.length;

  // Stream the archive: each file is mapped to rows the moment it is complete,
  // and the rows are flushed every BATCH bills, so nothing large accumulates.
  const rows = emptyRows();
  let pending: Promise<void> = Promise.resolve();
  let files = 0;
  let year = 0;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    // Decode as the chunks arrive. Some archives (Colorado's) deliver one file in
    // tens of thousands of tiny chunks, and Buffer.concat over that many overflows the stack.
    const decoder = new TextDecoder();
    let text = "";
    file.ondata = (err, data, final) => {
      if (err) throw err;
      text += decoder.decode(data, { stream: !final });
      if (!final) return;
      files += 1;
      const name = file.name;
      try {
        if (/\/bill\/[^/]+\.json$/.test(name)) {
          mapBill(JSON.parse(text).bill, rows);
          if (!year) year = Number(rows.bills[rows.bills.length - 1]?.session_id ?? 0);
        }
        else if (/\/vote\/[^/]+\.json$/.test(name)) mapRollCall(JSON.parse(text).roll_call, rows, state);
        else if (/\/people\/[^/]+\.json$/.test(name)) {
          const p = JSON.parse(text).person;
          if (p?.people_id) rows.people.set(Number(p.people_id), mapPerson(p, state));
        }
      } catch (e) {
        counts.badFiles = (counts.badFiles ?? 0) + 1;
        void e;
      }
      if (rows.bills.length >= BATCH || rows.votes.length >= 20_000) {
        const snapshot = { ...rows, people: new Map(rows.people) };
        Object.assign(rows, emptyRows());
        pending = pending.then(() => flush(sql, snapshot, counts));
      }
    };
    file.start();
  };
  // Feed the zip in small slices: fflate's Unzip recurses once per file boundary
  // inside a slice, and an archive of thousands of 1 KB files overflows the stack at 1 MB.
  const STEP = 1 << 16;
  for (let i = 0; i < zip.length; i += STEP) unzip.push(zip.subarray(i, Math.min(i + STEP, zip.length)), i + STEP >= zip.length);
  await pending;
  await flush(sql, rows, counts);
  counts.files = files;
  counts.session = sessionId;
  if (!year && sessionId === 2188) year = currentSession();
  counts.year = year;
  if (year && state === "NY") counts.mintedDropped = await dropMintedDuplicates(sql, year);
}

async function runDelta(sql: Sql, key: string, state: string, sessionId: number, sessionYear: number, maxBills: number, maxRollCalls: number, counts: Record<string, number>) {
  const master = await legiscan(key, "getMasterListRaw", { id: sessionId });
  counts.queries = (counts.queries ?? 0) + 1;
  const remote = Object.values(master.masterlist ?? {}).filter((v: any) => v && typeof v === "object" && v.bill_id) as any[];
  const known = new Map<number, string>(
    ((await sql.query(`SELECT bill_id, change_hash FROM "Bills" WHERE state = $2 AND session_id = $1`, [sessionYear, state])) as any[]).map((r: any) => [Number(r.bill_id), String(r.change_hash ?? "")]),
  );
  const changed = remote.filter((r) => known.get(Number(r.bill_id)) !== String(r.change_hash));
  counts.remote = remote.length;
  counts.changed = changed.length;
  counts.fetched = 0;

  const rows = emptyRows();
  const seenRollCalls = new Set<number>(((await sql.query(`SELECT roll_call_id FROM "Roll Call" WHERE state = $1`, [state])) as any[]).map((r: any) => Number(r.roll_call_id)));
  const newRollCalls: number[] = [];
  for (const r of changed.slice(0, maxBills)) {
    const b = await legiscan(key, "getBill", { id: r.bill_id });
    counts.queries += 1;
    counts.fetched += 1;
    mapBill(b.bill, rows);
    for (const v of b.bill?.votes ?? []) if (v.roll_call_id && !seenRollCalls.has(Number(v.roll_call_id))) newRollCalls.push(Number(v.roll_call_id));
    if (rows.bills.length >= 200) await flush(sql, rows, counts);
  }
  for (const id of [...new Set(newRollCalls)].slice(0, maxRollCalls)) {
    const rc = await legiscan(key, "getRollCall", { id });
    counts.queries += 1;
    mapRollCall(rc.roll_call, rows, state);
  }
  await flush(sql, rows, counts);
  if (state === "NY") counts.mintedDropped = await dropMintedDuplicates(sql, sessionYear);
  counts.leftForTomorrow = Math.max(0, changed.length - maxBills);
  counts.rollCallsLeft = Math.max(0, newRollCalls.length - maxRollCalls);
}

/** getSessionPeople: the whole roster of a session, members who sponsored nothing included. */
async function runPeople(sql: Sql, key: string, state: string, sessionId: number, counts: Record<string, number>) {
  const d = await legiscan(key, "getSessionPeople", { id: sessionId });
  counts.queries += 1;
  const rows = emptyRows();
  for (const p of d.sessionpeople?.people ?? []) if (p?.people_id) rows.people.set(Number(p.people_id), mapPerson(p, state));
  counts.roster = rows.people.size;
  await flush(sql, rows, counts);
}

/**
 * The monitor list: bills marked in the LegiScan account come back with status
 * and change_hash in ONE query, across states. `?set=<bill_id,…>&action=monitor|remove`
 * marks them; without `set` the list is read and stale ones re-fetched.
 */
async function runMonitor(sql: Sql, key: string, set: string, action: string, maxBills: number, counts: Record<string, number>) {
  if (set) {
    const r = await legiscan(key, "setMonitor", { list: set, action: action === "remove" ? "remove" : "monitor" });
    counts.queries += 1;
    counts.set = Object.keys(r.return ?? {}).length;
  }
  const d = await legiscan(key, "getMonitorListRaw", { record: "current" });
  counts.queries += 1;
  const items = Object.values(d.monitorlist ?? {}).filter((v: any) => v && typeof v === "object" && v.bill_id) as any[];
  counts.monitored = items.length;
  const known = new Map<number, string>(((await sql.query(`SELECT bill_id, change_hash FROM "Bills" WHERE bill_id = ANY($1::bigint[])`, [items.map((i) => Number(i.bill_id))])) as any[]).map((r: any) => [Number(r.bill_id), String(r.change_hash ?? "")]));
  const changed = items.filter((i) => known.get(Number(i.bill_id)) !== String(i.change_hash));
  counts.changed = changed.length;
  const rows = emptyRows();
  for (const i of changed.slice(0, maxBills)) {
    const b = await legiscan(key, "getBill", { id: i.bill_id });
    counts.queries += 1;
    mapBill(b.bill, rows);
  }
  await flush(sql, rows, counts);
}

export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const key = process.env.LEGISCAN_API_KEY;
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!key || !dbUrl) return res.status(503).json({ error: "LEGISCAN_API_KEY and POLICY_DATABASE_URL are both required" });

  const sql = neon(dbUrl);
  const mode = String(req.query?.mode ?? "delta");
  const state = String(req.query?.state ?? "NY").toUpperCase();
  // LegiScan's session id for each current session, and the year our rows carry
  // (year_start). NJ opens its sessions in even years, NY and Congress in odd.
  const CURRENT: Record<string, { id: number; year: number }> = { NY: { id: 2188, year: 2025 }, NJ: { id: 2250, year: 2026 }, US: { id: 2199, year: 2025 } };
  const sessionId = Number(req.query?.session) || CURRENT[state]?.id || 0;
  const sessionYear = Number(req.query?.year) || (sessionId === CURRENT[state]?.id ? CURRENT[state].year : 0);
  if (!sessionId) return res.status(400).json({ error: `no known current session for ${state}; pass ?session=` });
  const t0 = Date.now();
  const counts: Record<string, number> = { queries: 0 };
  try {
    await prepareSchema(sql);
    if (mode === "dataset") {
      await runDataset(sql, key, state, sessionId, req.query?.access_key ? String(req.query.access_key) : undefined, counts);
      // Record what was imported, keyed the way the sweep looks it up. dataset_size is
      // the zip we actually decoded, not the size the list claimed — a measured number
      // is the only one worth keeping.
      await sql.query(
        `INSERT INTO "LegiscanDatasets" (state, session_id, dataset_hash, dataset_size, year, special, imported_at, bills, ms)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
         ON CONFLICT (state, session_id) DO UPDATE SET dataset_hash = EXCLUDED.dataset_hash, dataset_size = EXCLUDED.dataset_size,
           year = COALESCE(EXCLUDED.year, "LegiscanDatasets".year), special = EXCLUDED.special,
           imported_at = EXCLUDED.imported_at, bills = EXCLUDED.bills, ms = EXCLUDED.ms`,
        [state, sessionId, req.query?.hash ? String(req.query.hash) : null, counts.zipBytes ?? null,
         counts.year || Number(req.query?.year) || null, Number(req.query?.special ?? 0) || 0,
         counts.bills ?? 0, Date.now() - t0],
      );
    } else if (mode === "people") await runPeople(sql, key, state, sessionId, counts);
    else if (mode === "monitor") await runMonitor(sql, key, String(req.query?.set ?? ""), String(req.query?.action ?? "monitor"), Math.min(400, Number(req.query?.max ?? 100) || 100), counts);
    else if (mode === "search") {
      // Read-only passthrough of the national full-text search (2,000 hits a page, with change hashes). One query per call.
      const d = await legiscan(key, "getSearchRaw", { state: String(req.query?.scope ?? "ALL"), query: String(req.query?.q ?? ""), page: Number(req.query?.page ?? 1) || 1 });
      counts.queries += 1;
      return res.status(200).json({ ok: true, mode, summary: d.searchresult?.summary, results: Object.values(d.searchresult ?? {}).filter((v: any) => v && typeof v === "object" && v.bill_id), ms: Date.now() - t0 });
    } else if (mode === "sponsored") {
      const d = await legiscan(key, "getSponsoredList", { id: Number(req.query?.people_id) });
      counts.queries += 1;
      return res.status(200).json({ ok: true, mode, sponsor: d.sponsoredbills?.sponsor, sessions: d.sponsoredbills?.sessions, bills: d.sponsoredbills?.bills, ms: Date.now() - t0 });
    } else {
      if (!sessionYear) return res.status(400).json({ error: "delta needs ?year= for a non-current session" });
      await runDelta(sql, key, state, sessionId, sessionYear, Math.min(400, Number(req.query?.max ?? 300) || 300), Math.min(150, Number(req.query?.maxRollCalls ?? 100) || 100), counts);
    }
    return res.status(200).json({ ok: true, mode, state, ...counts, ms: Date.now() - t0 });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message, mode, ...counts, ms: Date.now() - t0 });
  }
}
