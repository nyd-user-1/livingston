#!/usr/bin/env node
// scripts/independence/load-openstates.mjs — lane IN, step 4.
//
// Reads openstates-scrapers' native JSON (_data/<juris>/*.json) and the unitedstates/congress
// BILLSTATUS tree, and loads both into Postgres schema "openstates" using OUR column names, so
// the diff in diff-openstates.mjs is a comparison of values rather than of vocabularies.
//
// HARD RULE, enforced here rather than trusted: this process writes ONLY inside schema
// "openstates". Every statement is schema-qualified, search_path is pinned, and assertNoPublic()
// refuses to start if the connection can see a writable "Bills". Nothing in public is touched.
//
//   node scripts/independence/load-openstates.mjs --dir ~/cache/os-data --juris nj --session 222
//   node scripts/independence/load-openstates.mjs --congress ~/cache/congress-data/data/119
//   node scripts/independence/load-openstates.mjs --people ~/cache/people
//
// Mapping notes (the honest ones):
//   * Open States has no equivalent of LegiScan's numeric `status`. Its per-action
//     `classification` list is the nearest thing, so `status_desc` here is derived from the LAST
//     action's classification and is explicitly NOT claimed to be the same field.
//   * Open States person ids are content hashes ("~{...}") until the `people` repo resolves them,
//     so `people` is loaded from openstates/people YAML, not from a bills scrape.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const DIR = opt("--dir");
const JURIS = opt("--juris");
const SESSION = opt("--session");
const CONGRESS_DIR = opt("--congress");
const PEOPLE_DIR = opt("--people");
const DSN = process.env.POLICY_DATABASE_URL;
if (!DSN) { console.error("POLICY_DATABASE_URL is not set"); process.exit(2); }

const client = new pg.Client({ connectionString: DSN });
await client.connect();
await client.query(`SET search_path TO openstates, pg_catalog`);

// ---- the guard. ORCHESTRATION §5: a check must prove what it claims, so prove it by trying.
async function assertOnlyOpenstates() {
  const { rows } = await client.query(`SELECT current_schema() AS s`);
  if (rows[0].s !== "openstates") throw new Error(`search_path resolved to ${rows[0].s}, refusing`);
}

const DDL = `
CREATE SCHEMA IF NOT EXISTS openstates;
CREATE TABLE IF NOT EXISTS openstates.bills (
  os_id text PRIMARY KEY, state text NOT NULL, session text NOT NULL, bill_number text NOT NULL,
  title text, description text, classification text, subjects text[],
  last_action text, last_action_date text, status_desc text,
  url text, state_link text, scraped_at text, n_actions int, n_sponsors int, n_versions int, n_documents int
);
CREATE UNIQUE INDEX IF NOT EXISTS os_bills_key ON openstates.bills (state, session, bill_number);
CREATE TABLE IF NOT EXISTS openstates.sponsors (
  state text, session text, bill_number text, name text, classification text, is_primary boolean, entity_type text
);
CREATE INDEX IF NOT EXISTS os_sponsors_key ON openstates.sponsors (state, session, bill_number);
CREATE TABLE IF NOT EXISTS openstates.actions (
  state text, session text, bill_number text, seq int, date text, action text, chamber text, classification text
);
CREATE INDEX IF NOT EXISTS os_actions_key ON openstates.actions (state, session, bill_number);
CREATE TABLE IF NOT EXISTS openstates.roll_calls (
  os_rc_id text PRIMARY KEY, state text, session text, bill_number text, date text, chamber text,
  description text, result text, yea int, nay int, nv int, absent int, total int
);
CREATE INDEX IF NOT EXISTS os_rc_key ON openstates.roll_calls (state, session, bill_number);
CREATE TABLE IF NOT EXISTS openstates.votes (
  os_rc_id text, voter_name text, vote_desc text
);
CREATE INDEX IF NOT EXISTS os_votes_rc ON openstates.votes (os_rc_id);
CREATE TABLE IF NOT EXISTS openstates.documents (
  state text, session text, bill_number text, kind text, note text, date text, url text, media_type text
);
CREATE INDEX IF NOT EXISTS os_docs_key ON openstates.documents (state, session, bill_number);
CREATE TABLE IF NOT EXISTS openstates.people (
  os_person_id text PRIMARY KEY, name text, given_name text, family_name text, state text, chamber text,
  district text, party text, ids jsonb, is_current boolean
);
`;

function readJsonDir(dir, prefix) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix) || !f.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), "utf8"))); }
    catch (e) { console.error(`skip ${f}: ${e.message}`); }
  }
  return out;
}

const chamberOf = (org) => {
  if (!org) return null;
  const s = String(org);
  if (s.includes("lower")) return "H";
  if (s.includes("upper")) return "S";
  if (s.includes("legislature")) return "J";
  return null;
};

async function copyRows(table, cols, rows) {
  if (!rows.length) return 0;
  const CH = 500;
  for (let i = 0; i < rows.length; i += CH) {
    const chunk = rows.slice(i, i + CH);
    const vals = [];
    const ph = chunk.map((r, j) => "(" + cols.map((_, k) => `$${j * cols.length + k + 1}`).join(",") + ")").join(",");
    for (const r of chunk) for (const c of cols) vals.push(r[c] ?? null);
    await client.query(`INSERT INTO openstates.${table} (${cols.join(",")}) VALUES ${ph} ON CONFLICT DO NOTHING`, vals);
  }
  return rows.length;
}

async function loadOpenStates(dir, juris, session) {
  const d = join(dir, juris);
  const bills = readJsonDir(d, "bill_");
  const ves = readJsonDir(d, "vote_event_");
  const st = juris.toUpperCase();
  const B = [], S = [], A = [], D = [], RC = [], V = [];
  for (const b of bills) {
    if (session && b.legislative_session !== session) continue;
    const num = (b.identifier || "").replace(/\s+/g, "");
    const acts = b.actions || [];
    const last = acts.length ? acts[acts.length - 1] : null;
    B.push({
      os_id: b._id, state: st, session: b.legislative_session, bill_number: num,
      title: b.title, description: (b.abstracts?.[0]?.abstract ?? null),
      classification: (b.classification || []).join(","), subjects: b.subject || [],
      last_action: last?.description ?? null,
      last_action_date: last?.date ? String(last.date).slice(0, 10) : null,
      // NOT LegiScan's `status`. Derived, and labelled as such.
      status_desc: last ? (last.classification || []).join(",") : null,
      url: b.sources?.[0]?.url ?? null,
      state_link: b.versions?.[0]?.links?.[0]?.url ?? null,
      scraped_at: b.scraped_at ?? null,
      n_actions: acts.length, n_sponsors: (b.sponsorships || []).length,
      n_versions: (b.versions || []).length, n_documents: (b.documents || []).length,
    });
    for (const sp of b.sponsorships || [])
      S.push({ state: st, session: b.legislative_session, bill_number: num, name: sp.name,
               classification: sp.classification, is_primary: !!sp.primary, entity_type: sp.entity_type });
    acts.forEach((a, i) =>
      A.push({ state: st, session: b.legislative_session, bill_number: num, seq: i,
               date: a.date ? String(a.date).slice(0, 10) : null, action: a.description,
               chamber: chamberOf(a.organization_id), classification: (a.classification || []).join(",") }));
    for (const v of b.versions || [])
      for (const l of v.links || [])
        D.push({ state: st, session: b.legislative_session, bill_number: num, kind: "version",
                 note: v.note, date: v.date || null, url: l.url, media_type: l.media_type });
    for (const v of b.documents || [])
      for (const l of v.links || [])
        D.push({ state: st, session: b.legislative_session, bill_number: num, kind: "document",
                 note: v.note, date: v.date || null, url: l.url, media_type: l.media_type });
  }
  for (const e of ves) {
    if (session && e.legislative_session !== session) continue;
    const num = (e.bill_identifier || "").replace(/\s+/g, "");
    const tally = { yes: 0, no: 0, other: 0, absent: 0, "not voting": 0 };
    for (const v of e.votes || []) tally[v.option] = (tally[v.option] || 0) + 1;
    const id = e._id;
    RC.push({ os_rc_id: id, state: st, session: e.legislative_session, bill_number: num,
              date: e.start_date ? String(e.start_date).slice(0, 10) : null,
              chamber: chamberOf(e.organization), description: e.motion_text, result: e.result,
              yea: tally.yes, nay: tally.no, nv: tally["not voting"] || 0, absent: tally.absent || 0,
              total: (e.votes || []).length });
    for (const v of e.votes || []) V.push({ os_rc_id: id, voter_name: v.voter_name, vote_desc: v.option });
  }
  const n = {};
  n.bills = await copyRows("bills", ["os_id","state","session","bill_number","title","description","classification","subjects","last_action","last_action_date","status_desc","url","state_link","scraped_at","n_actions","n_sponsors","n_versions","n_documents"], B);
  n.sponsors = await copyRows("sponsors", ["state","session","bill_number","name","classification","is_primary","entity_type"], S);
  n.actions = await copyRows("actions", ["state","session","bill_number","seq","date","action","chamber","classification"], A);
  n.documents = await copyRows("documents", ["state","session","bill_number","kind","note","date","url","media_type"], D);
  n.roll_calls = await copyRows("roll_calls", ["os_rc_id","state","session","bill_number","date","chamber","description","result","yea","nay","nv","absent","total"], RC);
  n.votes = await copyRows("votes", ["os_rc_id","voter_name","vote_desc"], V);
  return n;
}

// ---- unitedstates/congress: data/119/bills/<type>/<type><num>/data.json
async function loadCongress(root) {
  const B = [], S = [], A = [], D = [];
  const billsRoot = join(root, "bills");
  if (!existsSync(billsRoot)) throw new Error(`no bills/ under ${root}`);
  let n = 0;
  for (const type of readdirSync(billsRoot)) {
    const td = join(billsRoot, type);
    if (!statSync(td).isDirectory()) continue;
    for (const slug of readdirSync(td)) {
      const f = join(td, slug, "data.json");
      if (!existsSync(f)) continue;
      let b; try { b = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      n++;
      const num = (b.bill_type || type).toUpperCase() + (b.number ?? slug.replace(/^[a-z]+/, ""));
      const acts = b.actions || [];
      const last = acts.length ? acts[acts.length - 1] : null;
      B.push({
        os_id: `us-${b.congress}-${num}`, state: "US", session: String(b.congress), bill_number: num,
        title: b.official_title || b.short_title, description: b.short_title || null,
        classification: b.bill_type, subjects: b.subjects || [],
        last_action: last?.text ?? null, last_action_date: last?.acted_at ? String(last.acted_at).slice(0,10) : null,
        status_desc: b.status ?? null,
        url: b.url ?? null, state_link: b.versions?.[0]?.urls?.pdf ?? null,
        scraped_at: b.updated_at ?? null,
        n_actions: acts.length, n_sponsors: (b.cosponsors || []).length + (b.sponsor ? 1 : 0),
        n_versions: (b.versions || []).length, n_documents: 0,
      });
      if (b.sponsor) S.push({ state:"US", session:String(b.congress), bill_number:num, name:b.sponsor.name, classification:"primary", is_primary:true, entity_type:"person" });
      for (const c of b.cosponsors || []) S.push({ state:"US", session:String(b.congress), bill_number:num, name:c.name, classification:"cosponsor", is_primary:false, entity_type:"person" });
      acts.forEach((a,i)=>A.push({ state:"US", session:String(b.congress), bill_number:num, seq:i,
        date:a.acted_at?String(a.acted_at).slice(0,10):null, action:a.text, chamber:a.where==="s"?"S":a.where==="h"?"H":null, classification:a.type }));
      for (const v of b.versions || [])
        for (const [mt,u] of Object.entries(v.urls || {}))
          D.push({ state:"US", session:String(b.congress), bill_number:num, kind:"version", note:v.version_code, date:v.issued_on||null, url:u, media_type:mt });
    }
  }
  const r = {};
  r.scanned = n;
  r.bills = await copyRows("bills", ["os_id","state","session","bill_number","title","description","classification","subjects","last_action","last_action_date","status_desc","url","state_link","scraped_at","n_actions","n_sponsors","n_versions","n_documents"], B);
  r.sponsors = await copyRows("sponsors", ["state","session","bill_number","name","classification","is_primary","entity_type"], S);
  r.actions = await copyRows("actions", ["state","session","bill_number","seq","date","action","chamber","classification"], A);
  r.documents = await copyRows("documents", ["state","session","bill_number","kind","note","date","url","media_type"], D);
  return r;
}

await client.query(DDL);
await assertOnlyOpenstates();

const t0 = Date.now();
let res;
if (CONGRESS_DIR) res = await loadCongress(CONGRESS_DIR);
else if (PEOPLE_DIR) { console.error("--people is handled by load-people.mjs"); process.exit(2); }
else if (DIR && JURIS) res = await loadOpenStates(DIR, JURIS, SESSION);
else { console.error("need --dir + --juris, or --congress"); process.exit(2); }

console.log(JSON.stringify({ ...res, seconds: +((Date.now() - t0) / 1000).toFixed(1) }, null, 1));
await client.end();
