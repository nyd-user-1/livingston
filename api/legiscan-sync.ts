// /api/legiscan-sync — policy's Neon, fed from LegiScan.
//
// Two modes, one importer:
//
//   ?mode=dataset&session=2188   one query: the session's weekly bulk archive
//                                (every bill, person and roll call) — backfill,
//                                and the Sunday refresh. Any session, any year.
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
  return x.startsWith("S") ? "Senate" : x.startsWith("A") ? "Assembly" : x.startsWith("H") ? "House" : x || null;
};

/** LegiScan state_id → postal code, for the states we carry. */
const STATE_BY_ID: Record<number, string> = { 32: "NY", 31: "NJ", 52: "US" };
const lowerHouse = (state: string) => (state === "US" ? "House" : "Assembly");

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
}
const emptyRows = (): Rows => ({ bills: [], sponsors: [], people: new Map(), history: [], documents: [], subjects: [], sameAs: [], rollCalls: [], votes: [] });

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
    rows.sponsors.push({ bill_id: id, people_id: pid, position: Number(s.sponsor_order) || i + 1 });
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

const mapPerson = (p: any, state: string) => ({
  people_id: Number(p.people_id), state: String(STATE_BY_ID[Number(p.state_id)] ?? state).toUpperCase(), name: String(p.name ?? ""), first_name: String(p.first_name ?? ""), middle_name: String(p.middle_name ?? "") || null,
  last_name: String(p.last_name ?? ""), party_id: Number(p.party_id ?? 0) || null, party: String(p.party ?? "") || null, role_id: Number(p.role_id ?? 0) || null,
  role: String(p.role ?? "") || null, district: String(p.district ?? "") || null,
  chamber: String(p.role ?? "") === "Sen" ? "Senate" : String(p.role ?? "") === "Rep" ? lowerHouse(String(STATE_BY_ID[Number(p.state_id)] ?? state).toUpperCase()) : null,
});

/* ---- writing ------------------------------------------------------------ */

async function prepareSchema(sql: Sql) {
  await sql.query(`ALTER TABLE "Bills" ADD COLUMN IF NOT EXISTS change_hash text`);
  for (const t of ["Bills", "People", "Roll Call"]) await sql.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'NY'`);
  await sql.query(`DROP INDEX IF EXISTS idx_bills_number_session`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_state_number_session ON "Bills" (state, bill_number, session_id) WHERE bill_number IS NOT NULL`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_bills_number_session_lookup ON "Bills" (bill_number, session_id)`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "Subjects" (bill_id bigint NOT NULL, subject_id bigint NOT NULL, subject text, PRIMARY KEY (bill_id, subject_id))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS "SameAs" (bill_id bigint NOT NULL, sast_type_id int NOT NULL, sast_type text, sast_bill_id bigint NOT NULL, sast_bill_number text, PRIMARY KEY (bill_id, sast_type_id, sast_bill_id))`);
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
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const col = (rows: any[], k: string) => rows.map((r) => r[k]);
const dedupe = <T,>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];

/** Write everything collected so far; the counts come back for the report. */
async function flush(sql: Sql, rows: Rows, counts: Record<string, number>) {
  const add = (k: string, n: number) => (counts[k] = (counts[k] ?? 0) + n);

  for (const b of chunk(dedupe(rows.people.size ? [...rows.people.values()] : [], (p) => String(p.people_id)), BATCH)) {
    await sql.query(
      `INSERT INTO "People" (people_id, name, first_name, middle_name, last_name, party_id, party, role_id, role, district, chamber, state)
       SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::text[], $8::bigint[], $9::text[], $10::text[], $11::text[], $12::text[])
       ON CONFLICT (people_id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name, first_name = EXCLUDED.first_name, middle_name = COALESCE(EXCLUDED.middle_name, "People".middle_name),
         last_name = EXCLUDED.last_name, party_id = COALESCE(EXCLUDED.party_id, "People".party_id), party = COALESCE(EXCLUDED.party, "People".party),
         role_id = COALESCE(EXCLUDED.role_id, "People".role_id), role = COALESCE(EXCLUDED.role, "People".role), district = COALESCE(EXCLUDED.district, "People".district),
         chamber = COALESCE(EXCLUDED.chamber, "People".chamber)`,
      ["people_id", "name", "first_name", "middle_name", "last_name", "party_id", "party", "role_id", "role", "district", "chamber", "state"].map((k) => col(b, k)),
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
      `SELECT bill_id, bill_number, session_id, state FROM "Bills" WHERE state = ANY($3::text[]) AND session_id = ANY($1::bigint[]) AND bill_number = ANY($2::text[])`,
      [sessions, b.map((r) => r.bill_number), states],
    )) as any[];
    const incoming = new Map(b.map((r) => [`${r.state}:${r.session_id}:${r.bill_number}`, Number(r.bill_id)]));
    const stale = existing.filter((e) => incoming.get(`${e.state}:${e.session_id}:${e.bill_number}`) !== Number(e.bill_id)).map((e) => Number(e.bill_id));
    if (stale.length) {
      await sql.transaction([
        sql.query(`DELETE FROM "Sponsors" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "History Table" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Subjects" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "SameAs" WHERE bill_id = ANY($1::bigint[])`, [stale]),
        sql.query(`DELETE FROM "Bills" WHERE bill_id = ANY($1::bigint[])`, [stale]),
      ]);
      add("replacedIds", stale.length);
    }
    // Status never moves backwards: the NY Senate sync is the authority on the
    // current session, and a newer action on record beats an older one here.
    await sql.query(
      `INSERT INTO "Bills" (bill_id, session_id, bill_number, status, status_desc, status_date, title, description, committee_id, committee,
                            last_action_date, last_action, url, state_link, change_hash, state)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                            $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[])
       ON CONFLICT (bill_id) DO UPDATE SET
         state = EXCLUDED.state, session_id = EXCLUDED.session_id, bill_number = EXCLUDED.bill_number, title = EXCLUDED.title, description = EXCLUDED.description,
         committee_id = COALESCE(EXCLUDED.committee_id, "Bills".committee_id), committee = COALESCE(EXCLUDED.committee, "Bills".committee),
         url = EXCLUDED.url, state_link = EXCLUDED.state_link, change_hash = EXCLUDED.change_hash,
         status = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.status ELSE "Bills".status END,
         status_desc = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.status_desc ELSE "Bills".status_desc END,
         status_date = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.status_date ELSE "Bills".status_date END,
         last_action = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.last_action ELSE "Bills".last_action END,
         last_action_date = CASE WHEN COALESCE(EXCLUDED.last_action_date, '') >= COALESCE("Bills".last_action_date, '') THEN EXCLUDED.last_action_date ELSE "Bills".last_action_date END`,
      ["bill_id", "session_id", "bill_number", "status", "status_desc", "status_date", "title", "description", "committee_id", "committee", "last_action_date", "last_action", "url", "state_link", "change_hash", "state"].map((k) => col(b, k)),
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
    await sql.transaction([
      sql.query(`DELETE FROM "Sponsors" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "History Table" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "Subjects" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      sql.query(`DELETE FROM "SameAs" WHERE bill_id = ANY($1::bigint[])`, [ids]),
      ...(sponsors.length
        ? [sql.query(`INSERT INTO "Sponsors" (bill_id, people_id, position) SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::bigint[])`, [col(sponsors, "bill_id"), col(sponsors, "people_id"), col(sponsors, "position")])]
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
  }

  for (const b of chunk(dedupe(rows.documents, (r) => String(r.document_id)), BATCH)) {
    await sql.query(
      `INSERT INTO "Documents" (bill_id, document_id, document_type, document_size, document_mime, document_desc, url, state_link)
       SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::text[])
       ON CONFLICT (document_id) DO UPDATE SET document_size = EXCLUDED.document_size, document_desc = EXCLUDED.document_desc, url = EXCLUDED.url, state_link = EXCLUDED.state_link`,
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
    const parts: Uint8Array[] = [];
    file.ondata = (err, data, final) => {
      if (err) throw err;
      parts.push(data);
      if (!final) return;
      files += 1;
      const text = Buffer.concat(parts).toString("utf8");
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
  // Feed the zip in slices so the inflater can run between them.
  const STEP = 1 << 20;
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

export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const key = process.env.LEGISCAN_API_KEY;
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!key || !dbUrl) return res.status(503).json({ error: "LEGISCAN_API_KEY and POLICY_DATABASE_URL are both required" });

  const sql = neon(dbUrl);
  const mode = req.query?.mode === "dataset" ? "dataset" : "delta";
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
    if (mode === "dataset") await runDataset(sql, key, state, sessionId, req.query?.access_key ? String(req.query.access_key) : undefined, counts);
    else {
      if (!sessionYear) return res.status(400).json({ error: "delta needs ?year= for a non-current session" });
      await runDelta(sql, key, state, sessionId, sessionYear, Math.min(400, Number(req.query?.max ?? 300) || 300), Math.min(150, Number(req.query?.maxRollCalls ?? 100) || 100), counts);
    }
    return res.status(200).json({ ok: true, mode, state, ...counts, ms: Date.now() - t0 });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message, mode, ...counts, ms: Date.now() - t0 });
  }
}
