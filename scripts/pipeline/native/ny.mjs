#!/usr/bin/env node
// scripts/pipeline/native/ny.mjs — New York, from New York, all of it.
//
//   node scripts/pipeline/native/ny.mjs --session 2025 [--store-text]
//   node scripts/pipeline/native/ny.mjs --all-sessions            # 2009 .. 2025
//   node scripts/pipeline/native/ny.mjs --session 2025 --max-pages 1   # smoke test
//
// This is the model for "everything from the state". New York publishes the
// richest feed we have — the Senate's Open Legislation API v3 — and LegiScan
// resells a subset of it scraped from the ASSEMBLY's HTML instead (lane IN
// measured that: 100% of our NY state_links point at assembly.state.ny.us).
// So the job here is not to re-derive what we already buy. It is to take the
// things the API offers and LegiScan's schema has nowhere to put:
//
//   every amendment's own text, memo, law code and co-sponsor list
//   committee agendas -> the actual MEETING: chair, room, time, notes
//   floor calendars entry by entry
//   the legislature's own milestone ladder, not our derived status
//   same-as companions, previous sessions' versions, substitutions, reprints
//   veto and approval messages in full
//   which statutes the bill adds to, amends or repeals
//
// THE ONE MEASUREMENT THAT SHAPES THIS FILE. `/bills/{session}?limit=1000&
// offset=N&full=true` returns COMPLETE bill objects, fullText and memo
// included: 1,000 bills, 33.6 MB, 7.7 s, in ONE request. A session is 26
// requests, not 25,402. limit=1000 is the ceiling (1500 -> HTTP 400). The
// per-bill route in api/bill-text.ts is correct and polite and costs 977x more.
//
// Politeness: legislation.nysenate.gov is SHARED with lane BT's lv-text-ny on
// box 1, which runs at a measured 4.1 req/s. The stated ceiling is 5 req/s for
// all of us. api/_lib/polite-fetch.ts is the fetcher (one connection per host,
// robots.txt obeyed, Retry-After honoured) and the pace here is 1,200 ms, so
// this side takes <= 0.83 req/s and the sum stays under.
//
// Writes: schema `openstates` only, source='nysenate'. public.* is never
// written; _lib/db.mjs pins search_path and refuses to start if it did not take.

import { createHash } from "node:crypto";
import { connect, insertRows, log, loadEnv } from "../_lib/db.mjs";
import { prepareSchema, normBillNo } from "../_lib/schema.mjs";
import { feedFetcher, getJson } from "../_lib/polite.mjs";

const API = "https://legislation.nysenate.gov/api/3";
const STATE = "NY";
const SOURCE = "nysenate";
const SESSIONS = [2009, 2011, 2013, 2015, 2017, 2019, 2021, 2023, 2025];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const PAGE = Math.min(1000, Number(val("--limit", "1000")) || 1000);
const MAX_PAGES = Number(val("--max-pages", "0")) || 0;
const PACE = Number(val("--pace-ms", "1200")) || 1200;
const STORE_TEXT = has("--store-text");
const SKIP = new Set(val("--skip").split(",").map((s) => s.trim()).filter(Boolean));

loadEnv();
const KEY = process.env.NYS_LEGISLATION_API_KEY || process.env.NEW_YORK_API_KEY;
if (!KEY) { console.error("ny: NYS_LEGISLATION_API_KEY (or NEW_YORK_API_KEY) is required"); process.exit(2); }

/** The key never reaches a log line. Open States' own scraper leaked ours this
 *  morning by logging the built URL at INFO (lane IN's F3) — SCRAPER-DOCTRINE
 *  lesson #1. Build the URL in one place and redact anything printed. */
const url = (p, q = {}) => {
  const u = new URL(`${API}/${p}`);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
  u.searchParams.set("key", KEY);
  return u.href;
};
const safe = (s) => String(s).replace(new RegExp(KEY, "g"), "<KEY>").replace(/([?&]key=)[^&\s]+/g, "$1<REDACTED>");

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const items = (x) => {
  if (!x) return [];
  const it = x.items ?? x;
  if (Array.isArray(it)) return it;
  if (it && typeof it === "object") return Object.entries(it);
  return [];
};
const listOf = (x) => (Array.isArray(x?.items) ? x.items : Array.isArray(x) ? x : []);
const mapOf = (x) => (x?.items && !Array.isArray(x.items) ? x.items : {});
const chamberOf = (c) => (String(c ?? "").toUpperCase().startsWith("SEN") ? "S" : String(c ?? "").toUpperCase().startsWith("ASS") ? "H" : null);

/* ---- vote codes ---------------------------------------------------------
 * The API groups member votes under codes. Mapping them onto our four tally
 * columns is a lossy choice, so the raw per-member code is ALSO kept in
 * openstates.votes.vote_desc — the tally is a convenience, the member row is the
 * evidence. AYEWR is "aye with reservations", which is a yes.                */
const YEA = new Set(["AYE", "AYEWR"]);
const NAY = new Set(["NAY"]);
const NV = new Set(["ABD"]);                 // abstained
const ABSENT = new Set(["ABS", "EXC"]);      // absent / excused

async function loadSession(c, fetcher, session, tally) {
  const s = String(session);
  let offset = 1, page = 0, total = null;

  for (;;) {
    page += 1;
    if (MAX_PAGES && page > MAX_PAGES) { log(`NY ${s}: stopping at --max-pages ${MAX_PAGES}`); break; }
    const t0 = Date.now();
    let body;
    try {
      body = await getJson(fetcher, url(`bills/${s}`, { limit: PAGE, offset, full: true }));
    } catch (e) {
      log(`NY ${s}: page ${page} FAILED — ${safe(e.message)}`);
      throw e;
    }
    if (!body.success) throw new Error(`NY ${s}: API said ${safe(JSON.stringify(body).slice(0, 200))}`);
    total = body.total ?? total;
    const bills = listOf(body.result);
    if (!bills.length) break;

    const rows = fresh();
    for (const b of bills) mapBill(b, s, rows);
    await writeRows(c, rows, tally);

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    log(`NY ${s}: page ${page} · offset ${offset} · ${bills.length} bills · ${secs}s · of ${total}`);
    tally.bills += bills.length;
    offset += bills.length;
    if (total != null && offset > total) break;
    await new Promise((ok) => setTimeout(ok, PACE));
  }
  return total;
}

const TABLES = [
  "bills", "sponsors", "actions", "roll_calls", "votes", "documents",
  "bill_versions", "bill_texts", "bill_agendas", "bill_calendars",
  "bill_relations", "bill_laws", "bill_milestones", "bill_messages",
  "bill_committees", "legislators",
];
const fresh = () => Object.fromEntries(TABLES.map((t) => [t, []]));

const COLS = {
  bills: ["os_id", "source", "state", "session", "bill_number", "bill_key", "title", "description", "classification",
    "last_action", "last_action_date", "status_desc", "url", "state_link", "scraped_at",
    "n_actions", "n_sponsors", "n_versions", "n_documents",
    "chamber", "bill_type", "is_resolution", "active_version", "program_info",
    "signed", "adopted", "vetoed", "substituted_by", "published_dt", "law_code", "law_section"],
  sponsors: ["source", "state", "session", "bill_number", "bill_key", "name", "classification", "is_primary", "entity_type"],
  actions: ["source", "state", "session", "bill_number", "bill_key", "seq", "date", "action", "chamber", "classification"],
  roll_calls: ["os_rc_id", "source", "state", "session", "bill_number", "bill_key", "date", "chamber", "description", "result", "yea", "nay", "nv", "absent", "total"],
  votes: ["os_rc_id", "source", "voter_name", "vote_desc"],
  documents: ["source", "state", "session", "bill_number", "bill_key", "kind", "note", "date", "url", "media_type"],
  bill_versions: ["source", "state", "session", "bill_key", "version", "print_no", "publish_date", "published", "stricken",
    "uni_bill", "act_clause", "law_code", "law_section", "full_text_chars", "full_text_sha256", "memo_chars", "memo_sha256", "n_cosponsors", "n_multisponsors"],
  bill_texts: ["source", "state", "session", "bill_key", "version", "kind", "chars", "sha256", "mime", "body"],
  bill_agendas: ["source", "state", "session", "bill_key", "agenda_year", "agenda_no", "chamber", "committee"],
  bill_calendars: ["source", "state", "session", "bill_key", "cal_year", "cal_no"],
  bill_relations: ["source", "state", "session", "bill_key", "version", "relation", "related_bill", "related_session"],
  bill_laws: ["source", "state", "session", "bill_key", "version", "relation", "law_code"],
  bill_milestones: ["source", "state", "session", "bill_key", "seq", "status_type", "status_desc", "action_date", "committee", "bill_cal_no"],
  bill_messages: ["source", "state", "session", "bill_key", "kind", "seq", "year", "date", "chapter", "memo"],
  bill_committees: ["source", "state", "session", "bill_key", "chamber", "committee", "reference_date"],
  legislators: ["source", "state", "session", "member_id", "session_member_id", "chamber", "full_name", "short_name", "district", "incumbent", "img"],
};

async function writeRows(c, rows, tally) {
  for (const t of TABLES) {
    const n = await insertRows(c, t, COLS[t], rows[t]);
    tally.rows[t] = (tally.rows[t] ?? 0) + n;
  }
}

function mapBill(b, session, R) {
  const base = b.basePrintNo ?? b.printNo;
  if (!base) return;
  const key = normBillNo(base);
  const common = { source: SOURCE, state: STATE, session, bill_key: key, bill_number: base };
  const st = b.status ?? {};
  const amend = mapOf(b.amendments);
  const versions = Object.keys(amend);

  R.bills.push({
    ...common,
    os_id: `${SOURCE}:${STATE}:${session}:${key}`,
    title: b.title ?? null,
    description: b.summary ?? null,
    classification: b.billType?.desc ?? null,
    last_action: st.statusDesc ?? null,
    last_action_date: st.actionDate ?? null,
    status_desc: st.statusType ?? null,
    url: `https://www.nysenate.gov/legislation/bills/${session}/${base}`,
    state_link: `https://legislation.nysenate.gov/pdf/bills/${session}/${b.printNo ?? base}`,
    scraped_at: new Date().toISOString(),
    n_actions: listOf(b.actions).length,
    n_sponsors: 1 + listOf(b.additionalSponsors).length,
    n_versions: versions.length,
    n_documents: versions.length,
    chamber: chamberOf(b.billType?.chamber),
    bill_type: b.billType?.desc ?? null,
    is_resolution: b.billType?.resolution ?? null,
    active_version: b.activeVersion ?? null,
    program_info: b.programInfo?.name ?? null,
    signed: b.signed ?? null, adopted: b.adopted ?? null, vetoed: b.vetoed ?? null,
    substituted_by: b.substitutedBy?.basePrintNo ?? null,
    published_dt: b.publishedDateTime ?? null,
    law_code: amend[b.activeVersion ?? ""]?.lawCode ?? null,
    law_section: amend[b.activeVersion ?? ""]?.lawSection ?? null,
  });

  /* sponsors: primary, then the three special-sponsor flags New York uses for
   * budget / rules / redistricting bills (a bill "sponsored by the Rules
   * Committee" has no member sponsor, and dropping that loses the bill's
   * origin), then additional sponsors, then per-version co- and multi-sponsors. */
  const m = b.sponsor?.member;
  if (m?.shortName) R.sponsors.push({ ...common, name: m.shortName, classification: "primary", is_primary: true, entity_type: "person" });
  for (const [flag, label] of [["budget", "Budget Bill"], ["rules", "Rules Committee"], ["redistricting", "Redistricting Commission"]]) {
    if (b.sponsor?.[flag]) R.sponsors.push({ ...common, name: label, classification: "primary", is_primary: true, entity_type: "organization" });
  }
  for (const a of listOf(b.additionalSponsors)) {
    if (a?.shortName) R.sponsors.push({ ...common, name: a.shortName, classification: "additional", is_primary: false, entity_type: "person" });
  }

  for (const a of listOf(b.actions)) {
    R.actions.push({ ...common, seq: a.sequenceNo ?? null, date: a.date ?? null, action: a.text ?? null, chamber: chamberOf(a.chamber), classification: null });
  }

  for (const v of listOf(b.votes)) {
    // The committee belongs in the id. Without it, S135's two committee votes on
    // 2025-01-21 — both sequenceNo 1, different committees — collapsed into one
    // roll call whose declared total was 15 while 36 member rows hung off it.
    // Caught by asserting declared == count(members), which is the only reason
    // it was ever visible.
    const cm = v.committee ? `${v.committee.chamber ?? ""}/${v.committee.name ?? ""}` : "";
    const rcId = `${SOURCE}:${STATE}:${session}:${key}:${v.voteType}:${v.voteDate}:${v.sequenceNo ?? 0}:${v.version ?? ""}:${cm}`;
    let yea = 0, nay = 0, nv = 0, absent = 0, tot = 0;
    for (const [code, group] of Object.entries(mapOf(v.memberVotes))) {
      for (const mem of listOf(group)) {
        tot += 1;
        if (YEA.has(code)) yea += 1; else if (NAY.has(code)) nay += 1; else if (NV.has(code)) nv += 1; else if (ABSENT.has(code)) absent += 1;
        R.votes.push({ os_rc_id: rcId, source: SOURCE, voter_name: mem.shortName ?? mem.fullName ?? null, vote_desc: code });
        if (mem.memberId != null) pushMember(R, session, mem);
      }
    }
    R.roll_calls.push({
      ...common, os_rc_id: rcId, date: v.voteDate ?? null,
      chamber: chamberOf(v.committee?.chamber ?? b.billType?.chamber),
      description: v.voteType === "COMMITTEE" ? `${v.committee?.name ?? "Committee"} (committee vote)` : "Floor vote",
      result: yea > nay ? "PASS" : "FAIL",
      yea: String(yea), nay: String(nay), nv: String(nv), absent: String(absent), total: tot,
    });
  }

  for (const [ver, a] of Object.entries(amend)) {
    const ft = a.fullText ?? "", memo = a.memo ?? "";
    const pub = mapOf(b.publishStatusMap)[ver];
    R.bill_versions.push({
      source: SOURCE, state: STATE, session, bill_key: key, version: ver,
      print_no: a.printNo ?? null, publish_date: pub?.effectDateTime ?? a.publishDate ?? null,
      published: pub?.published ?? null, stricken: a.stricken ?? null, uni_bill: a.uniBill ?? null,
      act_clause: a.actClause ?? null, law_code: a.lawCode ?? null, law_section: a.lawSection ?? null,
      full_text_chars: ft.length, full_text_sha256: ft ? sha(ft) : null,
      memo_chars: memo.length, memo_sha256: memo ? sha(memo) : null,
      n_cosponsors: listOf(a.coSponsors).length, n_multisponsors: listOf(a.multiSponsors).length,
    });
    if (ft) R.bill_texts.push({ source: SOURCE, state: STATE, session, bill_key: key, version: ver, kind: "text", chars: ft.length, sha256: sha(ft), mime: "text/plain", body: STORE_TEXT ? ft : null });
    if (memo) R.bill_texts.push({ source: SOURCE, state: STATE, session, bill_key: key, version: ver, kind: "memo", chars: memo.length, sha256: sha(memo), mime: "text/plain", body: STORE_TEXT ? memo : null });

    for (const cs of listOf(a.coSponsors)) if (cs?.shortName) R.sponsors.push({ ...common, name: cs.shortName, classification: `cosponsor${ver ? ` ${ver}` : ""}`, is_primary: false, entity_type: "person" });
    for (const ms of listOf(a.multiSponsors)) if (ms?.shortName) R.sponsors.push({ ...common, name: ms.shortName, classification: `multisponsor${ver ? ` ${ver}` : ""}`, is_primary: false, entity_type: "person" });

    for (const sa of listOf(a.sameAs)) {
      R.bill_relations.push({ source: SOURCE, state: STATE, session, bill_key: key, version: ver, relation: "same_as", related_bill: normBillNo(sa.basePrintNo), related_session: String(sa.session ?? session) });
    }
    for (const [rel, group] of Object.entries(mapOf(a.relatedLaws))) {
      for (const code of listOf(group)) R.bill_laws.push({ source: SOURCE, state: STATE, session, bill_key: key, version: ver, relation: rel, law_code: String(code) });
    }
    for (const fmt of (a.fullTextFormats ?? [])) {
      R.documents.push({ ...common, kind: "version", note: `${ver || "Original"} (${fmt})`, date: a.publishDate ?? null,
        url: `https://legislation.nysenate.gov/pdf/bills/${session}/${a.printNo ?? base}`, media_type: fmt === "PLAIN" ? "text/plain" : fmt === "HTML" ? "text/html" : "application/pdf" });
    }
  }

  for (const pv of listOf(b.previousVersions)) {
    R.bill_relations.push({ source: SOURCE, state: STATE, session, bill_key: key, version: "", relation: "previous_version", related_bill: normBillNo(pv.basePrintNo), related_session: String(pv.session ?? "") });
  }
  if (b.substitutedBy?.basePrintNo) R.bill_relations.push({ source: SOURCE, state: STATE, session, bill_key: key, version: "", relation: "substituted_by", related_bill: normBillNo(b.substitutedBy.basePrintNo), related_session: String(b.substitutedBy.session ?? session) });
  if (b.reprintOf?.basePrintNo) R.bill_relations.push({ source: SOURCE, state: STATE, session, bill_key: key, version: "", relation: "reprint_of", related_bill: normBillNo(b.reprintOf.basePrintNo), related_session: String(b.reprintOf.session ?? session) });

  listOf(b.milestones).forEach((ms, i) => {
    R.bill_milestones.push({ source: SOURCE, state: STATE, session, bill_key: key, seq: i + 1, status_type: ms.statusType ?? null, status_desc: ms.statusDesc ?? null, action_date: ms.actionDate ?? null, committee: ms.committeeName ?? null, bill_cal_no: ms.billCalNo ?? null });
  });

  listOf(b.vetoMessages).forEach((v, i) => {
    R.bill_messages.push({ source: SOURCE, state: STATE, session, bill_key: key, kind: "veto", seq: i + 1, year: v.year ?? null, date: v.signer ? null : (v.vetoDate ?? null), chapter: v.chapter ?? null, memo: v.memoText ?? null });
  });
  if (b.approvalMessage) {
    const a = b.approvalMessage;
    R.bill_messages.push({ source: SOURCE, state: STATE, session, bill_key: key, kind: "approval", seq: 1, year: a.year ?? null, date: a.signedDate ?? null, chapter: a.chapter ?? null, memo: a.text ?? null });
  }

  for (const ca of listOf(b.committeeAgendas)) {
    R.bill_agendas.push({ source: SOURCE, state: STATE, session, bill_key: key, agenda_year: ca.agendaId?.year ?? null, agenda_no: ca.agendaId?.number ?? null, chamber: ca.committeeId?.chamber ?? "", committee: ca.committeeId?.name ?? "" });
  }
  for (const cl of listOf(b.calendars)) {
    R.bill_calendars.push({ source: SOURCE, state: STATE, session, bill_key: key, cal_year: cl.year ?? null, cal_no: cl.calendarNumber ?? null });
  }
  for (const pc of listOf(b.pastCommittees)) {
    R.bill_committees.push({ source: SOURCE, state: STATE, session, bill_key: key, chamber: pc.chamber ?? "", committee: pc.name ?? "", reference_date: pc.referenceDate ?? "" });
  }
  if (m?.memberId != null) pushMember(R, session, m);
}

const seenMembers = new Set();
function pushMember(R, session, m) {
  const k = `${session}:${m.memberId}`;
  if (seenMembers.has(k)) return;
  seenMembers.add(k);
  R.legislators.push({
    source: SOURCE, state: STATE, session, member_id: String(m.memberId),
    session_member_id: m.sessionMemberId != null ? String(m.sessionMemberId) : null,
    chamber: chamberOf(m.chamber), full_name: m.fullName ?? null, short_name: m.shortName ?? null,
    district: m.districtCode != null ? String(m.districtCode) : null, incumbent: m.incumbent ?? null, img: m.imgName ?? null,
  });
}

/* ---- members, agendas, calendars ----------------------------------------
 * These are the parts the brief means by "take everything it offers". They are
 * cheap: 1 request for the roster, ~21 per year for agenda detail, ~1 per year
 * for calendars. The agenda detail is the payload nothing else has — the
 * MEETING, with its chair, room, time and the note the clerk attached.        */

async function loadMembers(c, fetcher, session, tally) {
  const body = await getJson(fetcher, url(`members/${session}`, { limit: 1000, full: true }));
  const src = listOf(body.result);
  // NOT via pushMember(): that dedupes against the members already seen while
  // walking the bills, so the roster pass reported "0 members" over a 219-member
  // API response — a step that ran green and did nothing, which is the failure
  // SCRAPER-DOCTRINE §0 exists to make impossible. The roster is the AUTHORITY
  // for a member's chamber and district (the bill payloads carry a snapshot), so
  // it upserts over whatever the bills pass wrote.
  const rows = src.map((m) => ({
    source: SOURCE, state: STATE, session: String(session), member_id: String(m.memberId),
    session_member_id: m.sessionMemberId != null ? String(m.sessionMemberId) : null,
    chamber: chamberOf(m.chamber), full_name: m.fullName ?? null, short_name: m.shortName ?? null,
    district: m.districtCode != null ? String(m.districtCode) : null, incumbent: m.incumbent ?? null, img: m.imgName ?? null,
  })).filter((r) => r.member_id && r.member_id !== "null");
  const n = await insertRows(c, "legislators", COLS.legislators, rows, {
    conflict: `(source, state, session, member_id) DO UPDATE SET
       session_member_id = EXCLUDED.session_member_id, chamber = EXCLUDED.chamber,
       full_name = EXCLUDED.full_name, short_name = EXCLUDED.short_name,
       district = EXCLUDED.district, incumbent = EXCLUDED.incumbent, img = EXCLUDED.img`,
  });
  tally.rows.legislators_roster = (tally.rows.legislators_roster ?? 0) + n;
  log(`NY ${session}: roster ${n} members upserted (API total ${body.total})`);
  if (!n) throw new Error(`NY ${session}: roster returned ${body.total} members and loaded none`);
}

async function loadAgendas(c, fetcher, session, tally) {
  const years = [Number(session), Number(session) + 1];
  for (const y of years) {
    let list;
    try { list = await getJson(fetcher, url(`agendas/${y}`)); }
    catch (e) { log(`NY ${session}: agendas ${y} unavailable — ${safe(e.message)}`); continue; }
    const heads = listOf(list.result);
    log(`NY ${session}: ${heads.length} agendas in ${y}`);
    for (const h of heads) {
      const no = h.id?.number;
      if (no == null) continue;
      await new Promise((ok) => setTimeout(ok, PACE));
      let d;
      try { d = await getJson(fetcher, url(`agendas/${y}/${no}`)); }
      catch (e) { log(`NY ${session}: agenda ${y}/${no} failed — ${safe(e.message)}`); continue; }
      const rows = fresh();
      const meetings = [];
      for (const ca of listOf(d.result?.committeeAgendas)) {
        for (const ad of listOf(ca.addenda)) {
          const mt = ad.meeting ?? {};
          meetings.push({
            source: SOURCE, state: STATE, session: String(session), agenda_year: y, agenda_no: no,
            addendum: ad.addendumId ?? "", chamber: ca.committeeId?.chamber ?? "", committee: ca.committeeId?.name ?? "",
            chair: mt.chair ?? null, location: mt.location ?? null, meeting_dt: mt.meetingDateTime ?? null,
            notes: (mt.notes ?? "").trim() || null, has_votes: ad.hasVotes ?? null,
            n_bills: listOf(ad.bills).length, week_of: d.result?.weekOf ?? null, modified_dt: ad.modifiedDateTime ?? null,
          });
          for (const ab of listOf(ad.bills)) {
            const bk = normBillNo(ab.billId?.basePrintNo);
            if (bk) rows.bill_agendas.push({ source: SOURCE, state: STATE, session: String(session), bill_key: bk, agenda_year: y, agenda_no: no, chamber: ca.committeeId?.chamber ?? "", committee: ca.committeeId?.name ?? "" });
          }
        }
      }
      await writeRows(c, rows, tally);
      const n = await insertRows(c, "meetings",
        ["source", "state", "session", "agenda_year", "agenda_no", "addendum", "chamber", "committee", "chair", "location", "meeting_dt", "notes", "has_votes", "n_bills", "week_of", "modified_dt"], meetings);
      tally.rows.meetings = (tally.rows.meetings ?? 0) + n;
    }
  }
}

async function loadCalendars(c, fetcher, session, tally) {
  for (const y of [Number(session), Number(session) + 1]) {
    let offset = 1;
    for (;;) {
      let body;
      try { body = await getJson(fetcher, url(`calendars/${y}`, { limit: 50, offset, full: true })); }
      catch (e) { log(`NY ${session}: calendars ${y} unavailable — ${safe(e.message)}`); break; }
      const cals = listOf(body.result);
      if (!cals.length) break;
      const rows = [];
      for (const cal of cals) {
        const push = (kind, cc, version) => {
          if (!cc) return;
          let seq = 0;
          for (const [section, group] of Object.entries(mapOf(cc.entriesBySection))) {
            for (const e of listOf(group)) {
              seq += 1;
              rows.push({
                source: SOURCE, state: STATE, session: String(session), cal_year: cal.year, cal_no: cal.calendarNumber,
                cal_kind: kind, cal_version: version ?? "", section, seq,
                cal_date: cc.calDate ?? cal.calDate ?? null, release_dt: cc.releaseDateTime ?? null,
                bill_key: normBillNo(e.basePrintNo), print_no: e.printNo ?? null,
                sub_bill_key: e.subBillInfo ? normBillNo(e.subBillInfo.basePrintNo) : null,
              });
            }
          }
        };
        push("floor", cal.floorCalendar, cal.floorCalendar?.version);
        for (const sc of listOf(cal.supplementalCalendars)) push("supplemental", sc, sc.version);
        for (const al of listOf(cal.activeLists)) {
          let seq = 0;
          for (const e of listOf(al.entries)) {
            seq += 1;
            rows.push({
              source: SOURCE, state: STATE, session: String(session), cal_year: cal.year, cal_no: cal.calendarNumber,
              cal_kind: "active_list", cal_version: String(al.sequenceNo ?? ""), section: "ACTIVE", seq,
              cal_date: al.calDate ?? cal.calDate ?? null, release_dt: al.releaseDateTime ?? null,
              bill_key: normBillNo(e.basePrintNo), print_no: e.printNo ?? null, sub_bill_key: null,
            });
          }
        }
      }
      const n = await insertRows(c, "calendar_entries",
        ["source", "state", "session", "cal_year", "cal_no", "cal_kind", "cal_version", "section", "seq", "cal_date", "release_dt", "bill_key", "print_no", "sub_bill_key"], rows);
      tally.rows.calendar_entries = (tally.rows.calendar_entries ?? 0) + n;
      log(`NY ${session}: calendars ${y} offset ${offset} · ${cals.length} calendars · ${rows.length} entries`);
      offset += cals.length;
      if (body.total != null && offset > body.total) break;
      await new Promise((ok) => setTimeout(ok, PACE));
    }
  }
}

/* ---- main ---------------------------------------------------------------- */

const wanted = has("--all-sessions") ? SESSIONS : [Number(val("--session", "2025"))];
const c = await connect({ label: "ny" });
await prepareSchema(c, { log });
const fetcher = await feedFetcher({ minDelayMs: PACE });
const tally = { bills: 0, rows: {} };
const t0 = Date.now();
let rc = 0;

try {
  for (const s of wanted) {
    log(`NY ${s}: starting (page ${PAGE}, pace ${PACE} ms, store-text ${STORE_TEXT})`);
    const total = await loadSession(c, fetcher, s, tally);
    if (!SKIP.has("members")) await loadMembers(c, fetcher, s, tally);
    if (!SKIP.has("agendas")) await loadAgendas(c, fetcher, s, tally);
    if (!SKIP.has("calendars")) await loadCalendars(c, fetcher, s, tally);
    log(`NY ${s}: done · API total ${total} · loaded ${tally.bills} bills so far`);
  }
} catch (e) {
  console.error(`ny: ${safe(e.stack || e.message)}`);
  rc = 1;
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(JSON.stringify({ source: SOURCE, state: STATE, sessions: wanted, bills: tally.bills, rows: tally.rows, seconds: Number(secs), requests: fetcher.stats() }, null, 1));
await c.end();

/* A run that fetched nothing is an ERROR, not a quiet success — SCRAPER-DOCTRINE
 * §0, and the exact failure lane IN hit twice today (a green job over three
 * failed tasks, and a loader that wrote NULL into every district). */
if (rc === 0 && tally.bills === 0) { console.error("ny: zero bills — refusing to report success"); rc = 1; }
process.exit(rc);
