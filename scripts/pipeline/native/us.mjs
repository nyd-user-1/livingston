#!/usr/bin/env node
// scripts/pipeline/native/us.mjs — Congress, from govinfo, in eight requests a congress.
//
//   node scripts/pipeline/native/us.mjs --congress 119
//   node scripts/pipeline/native/us.mjs --congresses 113,114,115,116,117,118,119
//
// govinfo publishes BILLSTATUS as bulk XML — the whole legislative record of a
// bill except its text: sponsors and every cosponsor with a bioguide id, every
// action with its source system and committee, committee referrals and reports,
// subjects and policy area, CRS summaries, every title the bill has carried,
// related bills, the law it became, its amendments, CBO cost estimates, and
// REFERENCES to every recorded vote.
//
// THE MEASUREMENT, and it is the same one New York gave. The obvious route is
// one XML file per bill: lane IN's us-congress job was doing that at ~113
// files/min against ~20,000 files. govinfo also publishes ONE ZIP PER
// (congress, type) — BILLSTATUS-119-hr.zip is 30.6 MB and was rebuilt three
// hours ago. Eight types, so a whole congress is EIGHT requests. Verified by
// HEAD before this file was written: 200, application/zip, content-length
// 30,649,532, last-modified today.
//
// govinfo's robots.txt has no Disallow touching /bulkdata and in fact SITEMAPS
// it. Public domain, no key. The fetcher is still the polite one, because the
// rule is about our manners and not about their permission.
//
// Text lives in "BillTexts" already (lane BT, source=govinfo). This route takes
// the structure, and records where the roll calls are without fetching them —
// per-member House/Senate vote XML is one request per roll call on two other
// hosts, and that is a separate, schedulable job rather than a hidden cost here.

import { unzipSync } from "fflate";
import { createRequire } from "node:module";
import { connect, insertRows, log, REPO } from "../_lib/db.mjs";
import { prepareSchema, normBillNo } from "../_lib/schema.mjs";
import { feedFetcher } from "../_lib/polite.mjs";
import path from "node:path";
import os from "node:os";

const BULK = "https://www.govinfo.gov/bulkdata/BILLSTATUS";
const STATE = "US";
const SOURCE = "govinfo";
// The eight bill types govinfo publishes. Order is by size so a truncated run
// still has the bills that matter.
const TYPES = ["hr", "s", "hres", "sres", "hjres", "sjres", "hconres", "sconres"];

const argv = process.argv.slice(2);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);

const CONGRESSES = (val("--congresses") || val("--congress", "119")).split(",").map((s) => Number(s.trim())).filter(Boolean);
const PACE = Number(val("--pace-ms", "1500")) || 1500;
const ONLY = new Set(val("--types").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

function xmlParser() {
  for (const r of [path.join(os.homedir(), "livingston"), REPO, process.cwd()]) {
    try {
      const { XMLParser } = createRequire(path.join(r, "noop.js"))("fast-xml-parser");
      return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, trimValues: true });
    } catch { /* next */ }
  }
  throw new Error("fast-xml-parser is not installed — `npm i fast-xml-parser`");
}

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const items = (x) => arr(x?.item);
const txt = (x) => (x == null ? null : typeof x === "object" ? (x["#text"] ?? null) : String(x));

/* ⚠ LegiScan RENAMES the federal bill types into its state vocabulary, and the
 * renaming COLLIDES with govinfo's. Measured against public."Bills" for the
 * 119th rather than assumed:
 *
 *   govinfo   hr  s    hres  sres  hjres  sjres  hconres  sconres
 *   LegiScan  HB  SB   HR    SR    HJR    SJR    HCR      SCR
 *
 * So govinfo's HR1 (House BILL 1) and LegiScan's HR1 (House RESOLUTION 1) are
 * the same string and different bills. Joining on the raw type matched 1,483 of
 * 18,469 — and those matches were mostly WRONG, which is worse than the 8% it
 * looked like. Mapping to LegiScan's vocabulary is what makes the join mean
 * anything. Counts line up exactly on every type: 10,177/10,143, 5,367/5,367,
 * 1,497/1,489, 849/849, 214/214, 212/212, 114/114, 39/39. */
const LEGISCAN_TYPE = { hr: "HB", s: "SB", hres: "HR", sres: "SR", hjres: "HJR", sjres: "SJR", hconres: "HCR", sconres: "SCR" };
const billKey = (type, number) => {
  const t = String(type ?? "").toLowerCase();
  return normBillNo(`${LEGISCAN_TYPE[t] ?? t.toUpperCase()}${number}`);
};

const CHAMBER = { hr: "H", hres: "H", hjres: "H", hconres: "H", s: "S", sres: "S", sjres: "S", sconres: "S" };

const TABLES = ["bills", "sponsors", "actions", "roll_calls", "documents", "bill_relations", "bill_laws", "bill_milestones", "bill_committees", "legislators"];
const fresh = () => Object.fromEntries(TABLES.map((t) => [t, []]));
const COLS = {
  bills: ["os_id", "source", "state", "session", "bill_number", "bill_key", "title", "description", "classification",
    "last_action", "last_action_date", "status_desc", "url", "state_link", "scraped_at", "n_actions", "n_sponsors", "n_versions", "n_documents",
    "chamber", "bill_type", "is_resolution", "active_version", "program_info", "signed", "adopted", "vetoed", "substituted_by", "published_dt", "law_code", "law_section"],
  sponsors: ["source", "state", "session", "bill_number", "bill_key", "name", "classification", "is_primary", "entity_type"],
  actions: ["source", "state", "session", "bill_number", "bill_key", "seq", "date", "action", "chamber", "classification"],
  roll_calls: ["os_rc_id", "source", "state", "session", "bill_number", "bill_key", "date", "chamber", "description", "result", "yea", "nay", "nv", "absent", "total"],
  documents: ["source", "state", "session", "bill_number", "bill_key", "kind", "note", "date", "url", "media_type"],
  bill_relations: ["source", "state", "session", "bill_key", "version", "relation", "related_bill", "related_session"],
  bill_laws: ["source", "state", "session", "bill_key", "version", "relation", "law_code"],
  bill_milestones: ["source", "state", "session", "bill_key", "seq", "status_type", "status_desc", "action_date", "committee", "bill_cal_no"],
  bill_committees: ["source", "state", "session", "bill_key", "chamber", "committee", "reference_date"],
  legislators: ["source", "state", "session", "member_id", "session_member_id", "chamber", "full_name", "short_name", "district", "incumbent", "img"],
};

const seenMembers = new Set();
function pushMember(R, session, m, chamber) {
  const id = txt(m.bioguideId);
  if (!id || seenMembers.has(`${session}:${id}`)) return;
  seenMembers.add(`${session}:${id}`);
  R.legislators.push({
    source: SOURCE, state: STATE, session, member_id: id, session_member_id: null,
    chamber: txt(m.chamber) === "Senate" ? "S" : txt(m.chamber) === "House of Representatives" ? "H" : chamber,
    full_name: txt(m.fullName), short_name: txt(m.lastName), district: txt(m.district) ?? txt(m.state),
    incumbent: null, img: null,
  });
}

function mapBill(b, congress, type, R) {
  const number = txt(b.number) ?? txt(b.billNumber);
  if (!number) return;
  const session = String(congress);
  const key = billKey(type, number);
  const bn = `${LEGISCAN_TYPE[String(type).toLowerCase()] ?? String(type).toUpperCase()}${number}`;
  const common = { source: SOURCE, state: STATE, session, bill_key: key, bill_number: bn };
  const latest = b.latestAction ?? {};
  const laws = items(b.laws);

  R.bills.push({
    ...common,
    os_id: `${SOURCE}:${STATE}:${session}:${key}`,
    title: txt(b.title),
    description: items(b.summaries)[0] ? String(txt(items(b.summaries)[0].text) ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null,
    classification: txt(b.policyArea?.name),
    last_action: txt(latest.text), last_action_date: txt(latest.actionDate),
    status_desc: laws.length ? "Became law" : txt(latest.text)?.slice(0, 120) ?? null,
    url: `https://www.congress.gov/bill/${congress}th-congress/${type === "hr" ? "house-bill" : type === "s" ? "senate-bill" : type}/${number}`,
    state_link: `${BULK}/${congress}/${type}/BILLSTATUS-${congress}${type}${number}.xml`,
    scraped_at: new Date().toISOString(),
    n_actions: items(b.actions).length, n_sponsors: items(b.sponsors).length + items(b.cosponsors).length,
    n_versions: items(b.textVersions).length, n_documents: items(b.textVersions).length,
    chamber: CHAMBER[type] ?? null, bill_type: String(type).toUpperCase(),
    is_resolution: !["hr", "s"].includes(type), active_version: null, program_info: null,
    signed: laws.length > 0 || null, adopted: null, vetoed: null, substituted_by: null,
    published_dt: txt(b.introducedDate), law_code: laws.map((l) => `${txt(l.type)} ${txt(l.number)}`).join("; ") || null, law_section: null,
  });

  for (const s of items(b.sponsors)) {
    // The surname, not the bioguide id: the reconcile joins sponsors on
    // surname across sources, and a bioguide id matched nothing (sponsors 0.0%).
    // The bioguide id is not lost — it is the member_id in openstates.legislators.
    R.sponsors.push({ ...common, name: txt(s.lastName) ?? txt(s.fullName), classification: "primary", is_primary: true, entity_type: "person" });
    pushMember(R, session, s, CHAMBER[type]);
  }
  for (const s of items(b.cosponsors)) {
    R.sponsors.push({ ...common, name: txt(s.lastName) ?? txt(s.fullName), classification: txt(s.isOriginalCosponsor) === "True" ? "original cosponsor" : "cosponsor", is_primary: false, entity_type: "person" });
    pushMember(R, session, s, CHAMBER[type]);
  }

  items(b.actions).forEach((a, i) => {
    R.actions.push({ ...common, seq: i + 1, date: txt(a.actionDate), action: txt(a.text),
      chamber: txt(a.sourceSystem?.name)?.startsWith("Senate") ? "S" : txt(a.sourceSystem?.name)?.startsWith("House") ? "H" : null,
      classification: txt(a.type) });
    for (const cm of items(a.committees)) {
      R.bill_committees.push({ source: SOURCE, state: STATE, session, bill_key: key, chamber: txt(cm.chamber) === "Senate" ? "S" : "H", committee: txt(cm.name) ?? "", reference_date: txt(a.actionDate) ?? "" });
    }
  });
  for (const cm of items(b.committees)) {
    R.bill_committees.push({ source: SOURCE, state: STATE, session, bill_key: key, chamber: txt(cm.chamber) === "Senate" ? "S" : "H", committee: txt(cm.name) ?? "", reference_date: txt(items(cm.activities)[0]?.date)?.slice(0, 10) ?? "" });
  }

  /* Recorded votes are RECORDED, not fetched. govinfo gives the roll number and
   * the URL of the clerk's XML; the per-member detail is one request per roll
   * call on clerk.house.gov and senate.gov. Storing the reference with zero
   * tallies would be a roll call that lies about having no votes, so the tally
   * columns stay NULL and `description` says where the detail is. */
  // recordedVotes is nested inside EACH ACTION item and its child tag is
  // <recordedVote>, not <item> — reading it at bill level with the generic
  // items() helper produced zero roll calls over a congress that has thousands.
  const recorded = [];
  for (const a of items(b.actions)) {
    const rv = a.recordedVotes?.recordedVote;
    for (const v of (rv == null ? [] : Array.isArray(rv) ? rv : [rv])) recorded.push(v);
  }
  const seenRc = new Set();
  for (const v of recorded) {
    const rn = txt(v.rollNumber), ch = txt(v.chamber) === "Senate" ? "S" : "H";
    // The same roll call is attached to several actions (one per source system),
    // so dedupe before writing or one vote becomes four.
    const dk = `${ch}:${txt(v.congress)}-${txt(v.sessionNumber)}-${rn}`;
    if (seenRc.has(dk)) continue;
    seenRc.add(dk);
    R.roll_calls.push({ ...common,
      os_rc_id: `${SOURCE}:${STATE}:${session}:${key}:${ch}:${txt(v.congress)}-${txt(v.sessionNumber)}-${rn}`,
      date: (txt(v.date) ?? "").slice(0, 10), chamber: ch,
      description: `roll ${rn} (detail at ${txt(v.url) ?? "clerk"})`, result: null,
      yea: null, nay: null, nv: null, absent: null, total: null });
  }

  for (const tv of items(b.textVersions)) {
    for (const f of items(tv.formats)) {
      R.documents.push({ ...common, kind: "version", note: txt(tv.type), date: (txt(tv.date) ?? "").slice(0, 10),
        url: txt(f.url), media_type: String(txt(f.url) ?? "").endsWith(".pdf") ? "application/pdf" : "text/xml" });
    }
  }
  for (const rb of items(b.relatedBills)) {
    R.bill_relations.push({ source: SOURCE, state: STATE, session, bill_key: key, version: "",
      relation: (items(rb.relationshipDetails)[0] ? txt(items(rb.relationshipDetails)[0].type) : "related") ?? "related",
      related_bill: billKey(txt(rb.type), txt(rb.number)), related_session: txt(rb.congress) ?? session });
  }
  for (const l of laws) {
    R.bill_laws.push({ source: SOURCE, state: STATE, session, bill_key: key, version: "", relation: txt(l.type) ?? "law", law_code: txt(l.number) ?? "" });
  }
  items(b.titles).forEach((t, i) => {
    R.bill_milestones.push({ source: SOURCE, state: STATE, session, bill_key: key, seq: 1000 + i,
      status_type: "title", status_desc: `${txt(t.titleType)}: ${txt(t.title)}`.slice(0, 500), action_date: null, committee: null, bill_cal_no: null });
  });
  for (const s of items(b.subjects?.legislativeSubjects)) {
    R.bill_relations.push({ source: SOURCE, state: STATE, session, bill_key: key, version: "", relation: "subject", related_bill: String(txt(s.name) ?? "").slice(0, 200), related_session: "" });
  }
}

/* ---- main ---------------------------------------------------------------- */

const parser = xmlParser();
const c = await connect({ label: "us" });
await prepareSchema(c, { log });
const fetcher = await feedFetcher({ minDelayMs: PACE, maxBytes: 512 * 1024 * 1024 });
const tally = { bills: 0, rows: {}, zips: 0, bytes: 0 };
const t0 = Date.now();
let rc = 0;

try {
  for (const congress of CONGRESSES) {
    for (const type of TYPES) {
      if (ONLY.size && !ONLY.has(type)) continue;
      const url = `${BULK}/${congress}/${type}/BILLSTATUS-${congress}-${type}.zip`;
      const r = await fetcher.get(url);
      if (!r.ok) { log(`US ${congress}/${type}: ${r.skipped ?? r.status} ${r.error ?? ""}`); continue; }
      tally.zips += 1; tally.bytes += r.bytes;

      const files = unzipSync(r.body);
      const names = Object.keys(files).filter((n) => n.toLowerCase().endsWith(".xml"));
      let n = 0;
      const rows = fresh();
      for (const name of names) {
        let doc;
        try { doc = parser.parse(new TextDecoder().decode(files[name])); }
        catch (e) { log(`US ${congress}/${type}: ${name} unparseable — ${e.message}`); continue; }
        const b = doc?.billStatus?.bill ?? doc?.bill;
        if (!b) continue;
        mapBill(b, congress, type, rows);
        n += 1;
        if (n % 2000 === 0) { await writeRows(rows); }
      }
      await writeRows(rows);
      tally.bills += n;
      log(`US ${congress}/${type}: ${names.length} files · ${n} bills · ${(r.bytes / 1e6).toFixed(1)} MB zip`);
    }
  }
} catch (e) {
  console.error(`us: ${e.stack || e.message}`);
  rc = 1;
}

async function writeRows(rows) {
  for (const t of TABLES) {
    if (!rows[t].length) continue;
    tally.rows[t] = (tally.rows[t] ?? 0) + await insertRows(c, t, COLS[t], rows[t]);
    rows[t].length = 0;
  }
}

console.log(JSON.stringify({ source: SOURCE, state: STATE, congresses: CONGRESSES, zips: tally.zips,
  megabytes: Number((tally.bytes / 1e6).toFixed(1)), bills: tally.bills, rows: tally.rows,
  seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), requests: fetcher.stats() }, null, 1));
await c.end();
if (rc === 0 && tally.bills === 0) { console.error("us: zero bills — refusing to report success"); rc = 1; }
process.exit(rc);
