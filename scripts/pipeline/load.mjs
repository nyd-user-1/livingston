#!/usr/bin/env node
// scripts/pipeline/load.mjs — Open States' native JSON -> schema `openstates`, our column names.
//
//   node scripts/pipeline/load.mjs nj --session 222
//   node scripts/pipeline/load.mjs tx --dir ~/cache/os-data
//
// This is lane IN's `scripts/independence/load-openstates.mjs` promoted from a
// one-off into the pipeline's loader, with three changes and no others, because
// the mapping itself was already measured against a whole New Jersey session
// (10,691 bills, 99.85% agreement) and re-deriving it would be re-doing work:
//
//   1. every row carries `source` and `bill_key`, so one reconcile serves both
//      engines and the join key is normalised once (LegiScan pads, nobody else
//      does, and our own "Bills" holds both spellings for New York);
//   2. it is IDEMPOTENT. The inherited tables had no unique key, so "ON CONFLICT
//      DO NOTHING" matched nothing and a second run doubled every row;
//      _lib/schema.mjs declares real keys and this writes through them;
//   3. a load that produces zero bills EXITS NON-ZERO. A scraper whose site was
//      redesigned returns an empty directory, and the honest answer to that is a
//      red job, not a green one over nothing (SCRAPER-DOCTRINE §0).
//
// The status caveat from lane IN stands and is repeated because it matters when
// reading a reconcile: Open States has no equivalent of LegiScan's numeric
// `status`. `status_desc` here is derived from the LAST action's classification
// and is explicitly NOT the same field.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { connect, insertRows, log } from "./_lib/db.mjs";
import { prepareSchema, normBillNo } from "./_lib/schema.mjs";

const argv = process.argv.slice(2);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const JURIS = (argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--")) || "").toLowerCase();
const DIR = val("--dir", join(os.homedir(), "cache", "os-data"));
const SESSION = val("--session");
const SOURCE = "openstates";

if (!JURIS) { console.error("usage: load.mjs <jurisdiction> [--session <id>] [--dir ~/cache/os-data]"); process.exit(2); }
const STATE = JURIS === "usa" ? "US" : JURIS.toUpperCase();

const chamberOf = (org) => {
  const s = String(org ?? "");
  if (s.includes("lower")) return "H";
  if (s.includes("upper")) return "S";
  if (s.includes("legislature")) return "J";
  return null;
};

function readJsonDir(dir, prefix) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix) || !f.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), "utf8"))); }
    catch (e) { log(`skip ${f}: ${e.message}`); }
  }
  return out;
}

const COLS = {
  bills: ["os_id", "source", "state", "session", "bill_number", "bill_key", "title", "description", "classification", "subjects",
    "last_action", "last_action_date", "status_desc", "url", "state_link", "scraped_at", "n_actions", "n_sponsors", "n_versions", "n_documents"],
  sponsors: ["source", "state", "session", "bill_number", "bill_key", "name", "classification", "is_primary", "entity_type"],
  actions: ["source", "state", "session", "bill_number", "bill_key", "seq", "date", "action", "chamber", "classification"],
  documents: ["source", "state", "session", "bill_number", "bill_key", "kind", "note", "date", "url", "media_type"],
  roll_calls: ["os_rc_id", "source", "state", "session", "bill_number", "bill_key", "date", "chamber", "description", "result", "yea", "nay", "nv", "absent", "total"],
  votes: ["os_rc_id", "source", "voter_name", "vote_desc"],
};

const dir = join(DIR, JURIS);
if (!existsSync(dir)) { console.error(`load: no scraper output at ${dir} — run scrape.mjs ${JURIS} first`); process.exit(2); }

const bills = readJsonDir(dir, "bill_");
const ves = readJsonDir(dir, "vote_event_");
const B = [], S = [], A = [], D = [], RC = [], V = [];

for (const b of bills) {
  if (SESSION && b.legislative_session !== SESSION) continue;
  const session = b.legislative_session;
  const num = (b.identifier || "").replace(/\s+/g, "");
  if (!num) continue;
  const key = normBillNo(num);
  const common = { source: SOURCE, state: STATE, session, bill_number: num, bill_key: key };
  const acts = b.actions || [];
  const last = acts.length ? acts[acts.length - 1] : null;
  B.push({
    ...common, os_id: b._id,
    title: b.title, description: b.abstracts?.[0]?.abstract ?? null,
    classification: (b.classification || []).join(","), subjects: b.subject || [],
    last_action: last?.description ?? null,
    last_action_date: last?.date ? String(last.date).slice(0, 10) : null,
    status_desc: last ? (last.classification || []).join(",") : null,   // derived, NOT LegiScan's status
    url: b.sources?.[0]?.url ?? null,
    state_link: b.versions?.[0]?.links?.[0]?.url ?? null,
    scraped_at: b.scraped_at ?? null,
    n_actions: acts.length, n_sponsors: (b.sponsorships || []).length,
    n_versions: (b.versions || []).length, n_documents: (b.documents || []).length,
  });
  for (const sp of b.sponsorships || []) {
    S.push({ ...common, name: sp.name, classification: sp.classification, is_primary: !!sp.primary, entity_type: sp.entity_type });
  }
  acts.forEach((a, i) => A.push({ ...common, seq: i, date: a.date ? String(a.date).slice(0, 10) : null,
    action: a.description, chamber: chamberOf(a.organization_id), classification: (a.classification || []).join(",") }));
  for (const v of b.versions || []) for (const l of v.links || []) {
    D.push({ ...common, kind: "version", note: v.note, date: v.date || null, url: l.url, media_type: l.media_type });
  }
  for (const v of b.documents || []) for (const l of v.links || []) {
    D.push({ ...common, kind: "document", note: v.note, date: v.date || null, url: l.url, media_type: l.media_type });
  }
}

for (const e of ves) {
  if (SESSION && e.legislative_session !== SESSION) continue;
  const num = (e.bill_identifier || "").replace(/\s+/g, "");
  if (!num) continue;
  const key = normBillNo(num);
  const tally = {};
  for (const v of e.votes || []) tally[v.option] = (tally[v.option] || 0) + 1;
  RC.push({
    os_rc_id: e._id, source: SOURCE, state: STATE, session: e.legislative_session, bill_number: num, bill_key: key,
    date: e.start_date ? String(e.start_date).slice(0, 10) : null,
    chamber: chamberOf(e.organization), description: e.motion_text, result: e.result,
    yea: String(tally.yes ?? 0), nay: String(tally.no ?? 0), nv: String(tally["not voting"] ?? 0),
    absent: String(tally.absent ?? 0), total: (e.votes || []).length,
  });
  for (const v of e.votes || []) V.push({ os_rc_id: e._id, source: SOURCE, voter_name: v.voter_name, vote_desc: v.option });
}

const c = await connect({ label: `load-${JURIS}` });
await prepareSchema(c, { log });
const t0 = Date.now();
const n = {
  bills: await insertRows(c, "bills", COLS.bills, B, { key: (r) => `${r.source}|${r.state}|${r.session}|${r.bill_number}`, conflict: `(source, state, session, bill_number) DO UPDATE SET
      title=EXCLUDED.title, description=EXCLUDED.description, last_action=EXCLUDED.last_action,
      last_action_date=EXCLUDED.last_action_date, status_desc=EXCLUDED.status_desc, bill_key=EXCLUDED.bill_key,
      n_actions=EXCLUDED.n_actions, n_sponsors=EXCLUDED.n_sponsors, n_versions=EXCLUDED.n_versions,
      n_documents=EXCLUDED.n_documents, scraped_at=EXCLUDED.scraped_at` }),
  // DO UPDATE SET bill_key, not DO NOTHING: a row that already exists from an
  // earlier load must still gain the join key, or it stays invisible to every
  // reconcile while looking perfectly present in a count(*).
  sponsors: await insertRows(c, "sponsors", COLS.sponsors, S, { key: (r) => `${r.source}|${r.state}|${r.session}|${r.bill_number}|${r.name ?? ""}|${r.classification ?? ""}`, conflict: `(source, state, session, bill_number, coalesce(name,''), coalesce(classification,'')) DO UPDATE SET bill_key = EXCLUDED.bill_key` }),
  actions: await insertRows(c, "actions", COLS.actions, A, { key: (r) => `${r.source}|${r.state}|${r.session}|${r.bill_number}|${r.seq ?? -1}|${r.date ?? ""}|${r.action ?? ""}`, conflict: `(source, state, session, bill_number, coalesce(seq,-1), md5(coalesce(date,'') || '|' || coalesce(action,''))) DO UPDATE SET bill_key = EXCLUDED.bill_key` }),
  documents: await insertRows(c, "documents", COLS.documents, D, { key: (r) => `${r.source}|${r.state}|${r.session}|${r.bill_number}|${r.kind ?? ""}|${r.note ?? ""}|${r.url ?? ""}`, conflict: `(source, state, session, bill_number, coalesce(kind,''), coalesce(note,''), md5(coalesce(url,''))) DO UPDATE SET bill_key = EXCLUDED.bill_key` }),
  roll_calls: await insertRows(c, "roll_calls", COLS.roll_calls, RC, { key: (r) => r.os_rc_id, conflict: "(os_rc_id) DO UPDATE SET bill_key = EXCLUDED.bill_key, date = EXCLUDED.date, chamber = EXCLUDED.chamber" }),
  votes: await insertRows(c, "votes", COLS.votes, V, { key: (r) => `${r.source}|${r.os_rc_id}|${r.voter_name ?? ""}|${r.vote_desc ?? ""}` }),
};

const sessions = [...new Set(B.map((b) => b.session))];
console.log(JSON.stringify({ source: SOURCE, jurisdiction: JURIS, state: STATE, sessions, files: bills.length,
  vote_events: ves.length, rows: n, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)) }, null, 1));
await c.end();

if (!B.length) {
  console.error(`load: ${JURIS} produced ZERO bills from ${dir}${SESSION ? ` for session ${SESSION}` : ""} — refusing to report success`);
  process.exit(1);
}
