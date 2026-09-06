#!/usr/bin/env node
// scripts/pipeline/congress/bill-delta.mjs — the bills that moved, refreshed
// from api.congress.gov the same day, into the tables billstatus.mjs fills
// from govinfo overnight.
//
//   node scripts/pipeline/congress/bill-delta.mjs --days 1        # bills updated in the last day
//   node scripts/pipeline/congress/bill-delta.mjs --since 2026-09-05T00:00:00Z
//   node scripts/pipeline/congress/bill-delta.mjs --days 7 --limit 50
//
// Brendan, 2026-09-06: "now that we filled the shelves shouldn't we be calling
// the api to make sure we always have the freshest product?" The zips are the
// whole congress in eight downloads and are rebuilt overnight; the API sees a
// bill within hours of the action. So: the changed-bill list (one call per 250
// bills, with fromDateTime) names the bills, and each one costs eight calls —
// the record, actions, cosponsors, committees, subjects, summaries, titles and
// related bills — written under the keys billstatus.mjs uses, so the zip's
// pass the next night lands on the same rows and neither side duplicates the
// other. A few hundred bills a night in session is a few thousand calls
// against 20,000 an hour. Text versions stay with sync.mjs.
//
// Env: CONGRESS_API_KEY, CONGRESS_USER_AGENT; Aurora as harvest.mjs finds it.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(path.join(REPO, "noop.js"));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CONGRESS = Number(val("--congress", "119"));
const LIMIT = Number(val("--limit", "0"));
const PAGE = 250;
const PACE_MS = Number(val("--pace", "120"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim(); if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("="); if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}
const KEY = process.env.CONGRESS_API_KEY;
const UA = process.env.CONGRESS_USER_AGENT || "govblock/1.0 (+https://govblock.app)";
if (!KEY) { console.error("congress/bill-delta: CONGRESS_API_KEY is required"); process.exit(2); }
const API = "https://api.congress.gov/v3";
let lastCall = 0, requests = 0;
async function api(q) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wait = PACE_MS - (Date.now() - lastCall); if (wait > 0) await sleep(wait);
    lastCall = Date.now(); requests += 1;
    const res = await fetch(`${API}${q}${q.includes("?") ? "&" : "?"}format=json`, { headers: { "X-Api-Key": KEY, "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) { await sleep(Math.min(60_000, 2000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }
  throw new Error("gave up after 5 attempts");
}
/** Every page of a list endpoint, as one array. */
async function all(pathname, listKey) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await api(`${pathname}?limit=${PAGE}&offset=${offset}`);
    const list = page[listKey] ?? (Object.values(page).find((v) => Array.isArray(v)) ?? []);
    out.push(...list);
    if (list.length < PAGE) break;
  }
  return out;
}

/* ---- credentials, resolved the same way harvest.mjs does ------------------ */
function auroraUrlFromSecret() {
  const region = process.env.AWS_REGION || "us-east-1";
  const cluster = process.env.AURORA_CLUSTER_ID || "aurora-2525";
  const aws = (a) => execFileSync("aws", [...a, "--region", region], { encoding: "utf8" }).trim();
  const arn = aws(["rds", "describe-db-clusters", "--db-cluster-identifier", cluster, "--query", "DBClusters[0].MasterUserSecret.SecretArn", "--output", "text"]);
  const host = aws(["rds", "describe-db-clusters", "--db-cluster-identifier", cluster, "--query", "DBClusters[0].Endpoint", "--output", "text"]);
  const secret = JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", arn, "--query", "SecretString", "--output", "text"]));
  return `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${process.env.POLICY_DATABASE || "policy"}?sslmode=require`;
}
let DB = process.env.AURORA_POLICY_URL;
if (!DB || !/^postgres(?:ql)?:\/\/[^:@/]+:[^@]+@[^@/:]+/.test(DB)) DB = auroraUrlFromSecret();
function pgConfig(url) {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
           database: u.pathname.replace(/^\//, "") || "policy", ssl: { rejectUnauthorized: false } };
}

/* ---- the same vocabulary as billstatus.mjs ------------------------------- */
// congress.gov's type -> our bill_number prefix (LegiScan's vocabulary).
const PREFIX = { hr: "HB", s: "SB", hres: "HR", sres: "SR", hjres: "HJR", sjres: "SJR", hconres: "HCR", sconres: "SCR" };
const yearOfCongress = (c) => (c - 1) * 2 + 1789;
const plain = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const nz = (v) => (v == null || v === "" ? null : String(v));

/* ---- main ---------------------------------------------------------------- */
const { Client } = require_("pg");
const db = new Client(pgConfig(DB));
await db.connect();
const year = yearOfCongress(CONGRESS);

const byBioguide = new Map();
for (const r of (await db.query(`select people_id, bioguide_id from "People" where bioguide_id is not null and bioguide_id <> ''`)).rows) byBioguide.set(String(r.bioguide_id).toUpperCase(), Number(r.people_id));
const known = new Map();
for (const r of (await db.query(`select bill_id, bill_number from "Bills" where state='US' and session_id=$1`, [year])).rows) known.set(String(r.bill_number).toUpperCase(), Number(r.bill_id));
log(`${known.size.toLocaleString()} bills on file for ${year}`);

// The window. --since wins; --days counts back from now; the default is one day.
const since = val("--since") ?? new Date(Date.now() - Number(val("--days", "1")) * 86400e3).toISOString().replace(/\.\d+Z$/, "Z");
const changed = [];
for (let offset = 0; ; offset += PAGE) {
  const page = await api(`/bill/${CONGRESS}?limit=${PAGE}&offset=${offset}&sort=updateDate+asc&fromDateTime=${encodeURIComponent(since)}`);
  const bills = page.bills ?? [];
  changed.push(...bills);
  if (bills.length < PAGE) break;
  if (LIMIT && changed.length >= LIMIT) break;
}
const targets = LIMIT ? changed.slice(0, LIMIT) : changed;
log(`${targets.length} bills changed since ${since}`);

/** Batched upsert, one statement per two hundred rows; last write wins on a repeated key. */
async function flush(table, cols, rows) {
  if (!rows.length) return 0;
  const byKey = new Map();
  for (const r of rows) byKey.set(r.key, r);
  const list = [...byKey.values()];
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const params = [];
    const tuples = chunk.map((r) => `(${cols.map((c) => `$${params.push(r[c] ?? null)}`).join(",")})`).join(",");
    await db.query(
      `insert into ${table} (${cols.join(",")}) values ${tuples}
       on conflict (key) do update set ${cols.filter((c) => c !== "key").map((c) => `${c} = excluded.${c}`).join(", ")}, updated_at = now()`,
      params,
    );
  }
  return list.length;
}

const tally = { bills: 0, actions: 0, cosponsors: 0, committees: 0, subjects: 0, summaries: 0, titles: 0, related: 0, failed: 0 };
for (const b of targets) {
  const type = String(b.type ?? "").toLowerCase();
  const number = String(b.number ?? "");
  if (!PREFIX[type] || !number) continue;
  const bn = `${PREFIX[type]}${number}`;
  const billId = known.get(bn.toUpperCase()) ?? null;
  const apiKey = `${CONGRESS}-${String(b.type).toUpperCase()}-${number}`;
  const base = `/bill/${CONGRESS}/${type}/${number}`;
  try {
    const [record, actions, cosponsors, committees, subjects, summaries, titles, related] = await Promise.all([
      api(base).then((d) => d.bill),
      all(`${base}/actions`, "actions"),
      all(`${base}/cosponsors`, "cosponsors"),
      all(`${base}/committees`, "committees"),
      api(`${base}/subjects`).then((d) => d.subjects ?? {}),
      all(`${base}/summaries`, "summaries"),
      all(`${base}/titles`, "titles"),
      all(`${base}/relatedbills`, "relatedBills"),
    ]);

    // The bill's own row. The sponsor is the first of `sponsors`, as billstatus reads it.
    const sponsor = record?.sponsors?.[0] ?? null;
    const sponsorBio = String(sponsor?.bioguideId ?? "").toUpperCase() || null;
    const popular = titles.find((t) => String(t.titleType ?? "").toLowerCase().includes("popular"))?.title ?? null;
    tally.bills += await flush("congress_bills",
      ["key", "congress", "payload", "bill_id", "bill_number", "bill_type", "number", "display_title", "popular_title", "origin_chamber", "introduced_date", "policy_area", "constitutional_authority", "latest_action_date", "latest_action", "sponsor_bioguide", "sponsor_people_id", "sponsor_name", "sponsor_party", "sponsor_state", "sponsor_district", "sponsor_by_request"],
      [{ key: apiKey, congress: CONGRESS, payload: JSON.stringify({ ...record, source: "api", policyArea: record?.policyArea ?? null }), bill_id: billId, bill_number: bn,
         bill_type: String(b.type).toUpperCase(), number, display_title: nz(record?.title), popular_title: nz(popular),
         origin_chamber: nz(record?.originChamber), introduced_date: nz(record?.introducedDate), policy_area: nz(record?.policyArea?.name),
         constitutional_authority: nz(record?.constitutionalAuthorityStatementText),
         latest_action_date: nz(record?.latestAction?.actionDate), latest_action: plain(record?.latestAction?.text) || null,
         sponsor_bioguide: sponsorBio, sponsor_people_id: sponsorBio ? (byBioguide.get(sponsorBio) ?? null) : null,
         sponsor_name: nz(sponsor?.fullName), sponsor_party: nz(sponsor?.party), sponsor_state: nz(sponsor?.state),
         sponsor_district: nz(sponsor?.district), sponsor_by_request: nz(sponsor?.isByRequest) }]);

    // Actions: keyed on identity, as billstatus does, so the same action from
    // both sources is one row.
    tally.actions += await flush("congress_bill_actions",
      ["key", "congress", "payload", "bill_id", "bill_number", "action_date", "action_time", "text", "action_type", "action_code", "source_system", "source_code", "committee_codes", "committee_names", "roll_number", "roll_chamber", "roll_url", "roll_session", "roll_date", "sequence"],
      actions.map((a, i) => {
        const date = a.actionDate ?? "", body = plain(a.text), code = a.actionCode ?? "", kind = a.type ?? "";
        const cms = a.committees ?? [], rv = a.recordedVotes?.[0] ?? null;
        return { key: `${apiKey}-${date}-${createHash("sha1").update(`${kind}|${code}|${body}`).digest("hex").slice(0, 10)}`,
          congress: CONGRESS, payload: JSON.stringify(a), bill_id: billId, bill_number: bn,
          action_date: date || null, action_time: nz(a.actionTime), text: body, action_type: kind || null, action_code: code || null,
          source_system: nz(a.sourceSystem?.name), source_code: nz(a.sourceSystem?.code),
          committee_codes: cms.length ? cms.map((c) => c.systemCode).filter(Boolean).join(",") : null,
          committee_names: cms.length ? cms.map((c) => c.name).filter(Boolean).join("; ") : null,
          roll_number: nz(rv?.rollNumber), roll_chamber: nz(rv?.chamber), roll_url: nz(rv?.url), roll_session: nz(rv?.sessionNumber), roll_date: nz(rv?.date), sequence: i };
      }));

    tally.cosponsors += await flush("congress_cosponsors",
      ["key", "congress", "payload", "bill_id", "bill_number", "bioguide_id", "people_id", "full_name", "party", "state", "sponsorship_date", "is_original_cosponsor", "sponsorship_withdrawn_date"],
      cosponsors.map((cs) => {
        const bio = String(cs.bioguideId ?? "").toUpperCase();
        return bio ? { key: `${CONGRESS}-${bn}-${bio}`, congress: CONGRESS, payload: JSON.stringify(cs), bill_id: billId, bill_number: bn,
          bioguide_id: bio, people_id: byBioguide.get(bio) ?? null, full_name: nz(cs.fullName), party: nz(cs.party), state: nz(cs.state),
          sponsorship_date: nz(cs.sponsorshipDate), is_original_cosponsor: nz(cs.isOriginalCosponsor), sponsorship_withdrawn_date: nz(cs.sponsorshipWithdrawnDate) } : null;
      }).filter(Boolean));

    const cmRows = [];
    for (const cm of committees) {
      const b0 = { bill_id: billId, bill_number: bn, system_code: nz(cm.systemCode), name: nz(cm.name), chamber: nz(cm.chamber), committee_type: nz(cm.type) };
      const push = (subCode, subName, act) => {
        const when = act.date ?? "";
        cmRows.push({ key: `${apiKey}-${subCode ?? b0.system_code}-${act.name}-${when}`, congress: CONGRESS, payload: JSON.stringify(act), ...b0,
          subcommittee_code: subCode, subcommittee_name: subName, activity: nz(act.name), activity_date: when || null });
      };
      for (const act of cm.activities ?? []) push(null, null, act);
      for (const sub of cm.subcommittees ?? []) for (const act of sub.activities ?? []) push(nz(sub.systemCode), nz(sub.name), act);
    }
    tally.committees += await flush("congress_bill_committees",
      ["key", "congress", "payload", "bill_id", "bill_number", "system_code", "name", "chamber", "committee_type", "subcommittee_code", "subcommittee_name", "activity", "activity_date"], cmRows);

    // Subjects and titles are sets: the bill's are replaced, so a subject
    // congress.gov withdrew does not linger from an earlier pass.
    const sjRows = [];
    if (subjects.policyArea?.name) sjRows.push({ key: `${apiKey}-policyArea`, congress: CONGRESS, payload: JSON.stringify(subjects.policyArea), bill_id: billId, bill_number: bn, name: subjects.policyArea.name, is_policy_area: true });
    for (const sj of subjects.legislativeSubjects ?? []) if (sj.name) sjRows.push({ key: `${apiKey}-${sj.name}`, congress: CONGRESS, payload: JSON.stringify(sj), bill_id: billId, bill_number: bn, name: sj.name, is_policy_area: false });
    await db.query(`delete from congress_bill_subjects where key like $1`, [`${apiKey}-%`]);
    tally.subjects += await flush("congress_bill_subjects", ["key", "congress", "payload", "bill_id", "bill_number", "name", "is_policy_area"], sjRows);

    tally.summaries += await flush("congress_summaries",
      ["key", "congress", "payload", "bill_id", "bill_number", "action_date", "action_desc", "version_code", "text"],
      summaries.map((s, i) => ({ key: `${CONGRESS}-${bn}-${s.actionDate || i}-${s.versionCode ?? i}`, congress: CONGRESS, payload: JSON.stringify(s), bill_id: billId, bill_number: bn,
        action_date: nz(s.actionDate), action_desc: nz(s.actionDesc), version_code: nz(s.versionCode), text: plain(s.text) })));

    await db.query(`delete from congress_titles where key like $1`, [`${CONGRESS}-${bn}-%`]);
    tally.titles += await flush("congress_titles", ["key", "congress", "payload", "bill_id", "bill_number", "title_type", "title", "chamber"],
      titles.map((t, i) => ({ key: `${CONGRESS}-${bn}-${i}`, congress: CONGRESS, payload: JSON.stringify(t), bill_id: billId, bill_number: bn, title_type: nz(t.titleType), title: nz(t.title), chamber: nz(t.chamberName) })));

    tally.related += await flush("congress_related_bills",
      ["key", "congress", "payload", "bill_id", "bill_number", "related_bill_id", "related_bill_number", "relationship"],
      related.map((rb) => {
        const rbn = `${PREFIX[String(rb.type ?? "").toLowerCase()] ?? String(rb.type ?? "")}${rb.number ?? ""}`;
        return { key: `${CONGRESS}-${bn}-${rbn}`, congress: CONGRESS, payload: JSON.stringify(rb), bill_id: billId, bill_number: bn,
          related_bill_id: known.get(rbn.toUpperCase()) ?? null, related_bill_number: rbn, relationship: rb.relationshipDetails?.[0]?.type ?? "related" };
      }));
  } catch (e) { tally.failed += 1; log(`  ${bn}: ${String(e.message).slice(0, 100)}`); }
}

await db.query(`create table if not exists congress_sync_state (step text primary key, last_run timestamptz, last_ok timestamptz, note text)`);
await db.query(`insert into congress_sync_state (step, last_run, last_ok, note) values ('bill-delta', now(), now(), $1)
  on conflict (step) do update set last_run = now(), last_ok = now(), note = excluded.note`,
  [`${targets.length} bills · ${tally.actions} actions · ${tally.cosponsors} cosponsors · ${requests} requests`]);
log(`bill-delta done: ${targets.length} bills · ${tally.failed} failed · ${requests} requests`);
log(`  bills ${tally.bills} · actions ${tally.actions} · cosponsors ${tally.cosponsors} · committees ${tally.committees} · subjects ${tally.subjects} · summaries ${tally.summaries} · titles ${tally.titles} · related ${tally.related}`);
await db.end();
process.exit(tally.failed && !tally.bills ? 1 : 0);
