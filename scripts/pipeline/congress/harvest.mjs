#!/usr/bin/env node
// scripts/pipeline/congress/harvest.mjs — the congress.gov families we never held,
// into Aurora, one table each.
//
//   node scripts/pipeline/congress/harvest.mjs                 # every family, 119th
//   node scripts/pipeline/congress/harvest.mjs --family members
//   node scripts/pipeline/congress/harvest.mjs --since 2026-08-25T00:00:00Z
//
// Shape, per §2b: `congress_` prefix, the API's own key as the primary key, typed
// columns for what a page will read, and `payload jsonb` carrying the record
// verbatim so a page can reach a field nobody has typed yet. Nothing here
// overwrites LegiScan or govinfo — these are tables we did not have.
//
// Only the list endpoints are walked. Every family below carries enough in its
// list record to be worth serving; the ones that do not (committee-meeting and
// hearing are an eventId and a URL) need one detail request each and are marked
// `detail: true` so the cost is a decision rather than a surprise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(path.join(REPO, "noop.js"));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const CONGRESS = Number(val("--congress", "119"));
const ONLY = val("--family");
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
if (!KEY) { console.error("congress/harvest: CONGRESS_API_KEY is required"); process.exit(2); }

/* ---- credentials, resolved the same way sync.mjs does -------------------- */
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
  const m = /^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/.exec(url);
  if (!m) throw new Error("cannot parse the Aurora URL");
  const [, user, password, host, port, database, query] = m;
  let pw = password; try { pw = decodeURIComponent(password); } catch { pw = password; }
  return { user, password: pw, host, database, port: Number(port || 5432), ssl: /sslmode=(require|verify)/.test(query ?? "") ? { rejectUnauthorized: false } : undefined, application_name: "congress-harvest" };
}

/* ---- the API ------------------------------------------------------------- */
const API = "https://api.congress.gov/v3";
let requests = 0, lastCall = 0;
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

/* ---- the families -------------------------------------------------------- */
// `key` must be the API's own identity for the record, so a re-run upserts.
const n = (v) => (v == null || v === "" ? null : Number(v));
const FAMILIES = [
  { table: "congress_members", path: (c) => `/member/congress/${c}`, listKey: "members",
    key: (r) => String(r.bioguideId),
    cols: { bioguide_id: (r) => r.bioguideId, name: (r) => r.name, party: (r) => r.partyName,
            state: (r) => r.state, district: (r) => n(r.district),
            // The official portrait — the one thing LegiScan's People rows do not carry.
            portrait_url: (r) => r.depiction?.imageUrl ?? null } },
  { table: "congress_amendments", path: (c) => `/amendment/${c}`, listKey: "amendments",
    key: (r) => `${r.congress}-${r.type}-${r.number}`,
    cols: { amendment_type: (r) => r.type, number: (r) => String(r.number), description: (r) => r.description ?? null,
            latest_action: (r) => r.latestAction?.text ?? null, latest_action_date: (r) => r.latestAction?.actionDate ?? null },
    // The list record carries no sponsor, so a Sponsor column reads as 493 em
    // dashes on H.R. 1. The detail has it. `since` is wide because the pass is
    // gated on detail_fetched_at: the first run pays for all 7,035, a later one
    // only for amendments that have moved.
    detail: { since: 3650, path: (r) => `/amendment/${r.congress}/${String(r.type).toLowerCase()}/${r.number}`,
              unwrap: (d) => d.amendment,
              cols: { sponsors: (r) => (r.sponsors ? JSON.stringify(r.sponsors) : null),
                      sponsor_name: (r) => (r.sponsors?.[0]?.fullName ?? null),
                      sponsor_bioguide: (r) => (r.sponsors?.[0]?.bioguideId ?? null),
                      purpose: (r) => r.purpose ?? null } } },
  { table: "congress_nominations", path: (c) => `/nomination/${c}`, listKey: "nominations",
    key: (r) => `${r.congress}-${r.number}-${r.partNumber ?? 0}`,
    cols: { number: (r) => String(r.number), part_number: (r) => String(r.partNumber ?? ""), citation: (r) => r.citation ?? null,
            description: (r) => r.description ?? null, organization: (r) => r.organization ?? null,
            received_date: (r) => r.receivedDate ?? null, latest_action: (r) => r.latestAction?.text ?? null } },
  { table: "congress_committee_reports", path: (c) => `/committee-report/${c}`, listKey: "reports",
    // The citation alone is NOT the identity: H. Rept. 119-608 exists as part 1
    // and part 2, two different documents, and keying on the citation dropped
    // the second. The part belongs in the key.
    key: (r) => `${r.citation ?? `${r.congress}-${r.chamber}-${r.type}-${r.number}`}-p${r.part ?? 1}`,
    cols: { citation: (r) => r.citation ?? null, chamber: (r) => r.chamber ?? null, report_type: (r) => r.type ?? null,
            number: (r) => String(r.number ?? ""), part: (r) => n(r.part) },
    // The committee that filed it, and the bill it is about, are on the report
    // record — neither is in the list. 921 requests, once.
    detail: { since: 3650, path: (r) => `/committee-report/${r.congress}/${r.type}/${r.number}`,
              unwrap: (d) => (Array.isArray(d.committeeReports) ? d.committeeReports[0] : d.committeeReports),
              cols: { committees: (r) => (r.committees ? JSON.stringify(r.committees) : null),
                      committee_code: (r) => (r.committees?.[0]?.systemCode ?? null),
                      committee_name: (r) => (r.committees?.[0]?.name ?? null),
                      title: (r) => r.title ?? null,
                      issue_date: (r) => r.issueDate ?? null } } },
  { table: "congress_laws", path: (c) => `/law/${c}`, listKey: "bills",
    key: (r) => `${r.congress}-${r.type}-${r.number}`,
    cols: { bill_type: (r) => r.type, number: (r) => String(r.number), title: (r) => r.title ?? null,
            law_number: (r) => (r.laws?.[0]?.number ?? null), law_type: (r) => (r.laws?.[0]?.type ?? null),
            latest_action: (r) => r.latestAction?.text ?? null } },
  { table: "congress_committees", path: (c) => `/committee/${c}`, listKey: "committees",
    key: (r) => String(r.systemCode),
    cols: { system_code: (r) => r.systemCode, name: (r) => r.name ?? null, chamber: (r) => r.chamber ?? null,
            committee_type: (r) => r.committeeTypeCode ?? null, parent: (r) => r.parent?.systemCode ?? null } },
  { table: "congress_committee_prints", path: (c) => `/committee-print/${c}`, listKey: "committeePrints",
    key: (r) => String(r.jacketNumber ?? `${r.congress}-${r.chamber}-${r.number}`),
    cols: { jacket_number: (r) => String(r.jacketNumber ?? ""), chamber: (r) => r.chamber ?? null, number: (r) => String(r.number ?? "") } },
  { table: "congress_treaties", path: (c) => `/treaty/${c}`, listKey: "treaties",
    key: (r) => `${r.congress}-${r.number}-${r.suffix ?? ""}`,
    cols: { number: (r) => String(r.number ?? ""), suffix: (r) => r.suffix ?? null, topic: (r) => r.topic ?? null,
            transmitted_date: (r) => r.transmittedDate ?? null } },
  { table: "congress_committee_meetings", path: (c) => `/committee-meeting/${c}`, listKey: "committeeMeetings",
    key: (r) => String(r.eventId),
    cols: { event_id: (r) => String(r.eventId), chamber: (r) => r.chamber ?? null },
    // The list is an eventId and a URL. The date — which is what a calendar
    // needs — lives only in the detail, so the [today-7, today+60] window cannot
    // be applied before fetching. updateDate is the way in: a meeting being
    // scheduled or amended is a meeting being updated. 76 in the last 30 days
    // against 2,680 for the archive.
    detail: { since: 30, path: (r) => `/committee-meeting/119/${String(r.chamber).toLowerCase()}/${r.eventId}`, unwrap: (d) => d.committeeMeeting,
              cols: { meeting_date: (r) => r.date ?? null, title: (r) => r.title ?? null,
                      location: (r) => (r.location ? JSON.stringify(r.location) : null),
                      meeting_status: (r) => r.meetingStatus ?? null } } },
  { table: "congress_hearings", path: (c) => `/hearing/${c}`, listKey: "hearings",
    key: (r) => String(r.jacketNumber ?? `${r.congress}-${r.chamber}-${r.number}`),
    cols: { jacket_number: (r) => String(r.jacketNumber ?? ""), chamber: (r) => r.chamber ?? null, number: (r) => String(r.number ?? "") },
    thin: "transcripts are behind a detail request each (932)" },
  { table: "congress_house_votes", path: (c) => `/house-vote/${c}`, listKey: "houseRollCallVotes",
    key: (r) => String(r.identifier),
    cols: { identifier: (r) => String(r.identifier), session_number: (r) => String(r.sessionNumber ?? ""),
            roll_call_number: (r) => String(r.rollCallNumber ?? ""), legislation_type: (r) => r.legislationType ?? null,
            legislation_number: (r) => r.legislationNumber ?? null, result: (r) => r.result ?? null,
            vote_type: (r) => r.voteType ?? null, start_date: (r) => r.startDate ?? null } },
  // Not congress-scoped: /crsreport is the whole library, 14,076 of them.
  { table: "congress_crs_reports", path: () => `/crsreport`, listKey: "CRSReports",
    key: (r) => String(r.id),
    cols: { report_id: (r) => r.id, title: (r) => r.title ?? null, publish_date: (r) => r.publishDate ?? null,
            status: (r) => r.status ?? null, version: (r) => String(r.version ?? ""), content_type: (r) => r.contentType ?? null },
    detail: { since: 90, path: (r) => `/crsreport/${r.id}`, unwrap: (d) => d.CRSReport,
              cols: { summary: (r) => (r.summary ? String(r.summary).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null),
                      topics: (r) => (r.topics ? JSON.stringify(r.topics) : null),
                      authors: (r) => (r.authors ? JSON.stringify(r.authors) : null) } } },
  { table: "congress_record_daily", path: () => `/daily-congressional-record`, listKey: "dailyCongressionalRecord",
    key: (r) => `${r.volumeNumber}-${r.issueNumber}`,
    cols: { volume_number: (r) => String(r.volumeNumber ?? ""), issue_number: (r) => String(r.issueNumber ?? ""),
            issue_date: (r) => r.issueDate ?? null, session_number: (r) => String(r.sessionNumber ?? "") },
    detail: { since: 30, path: (r) => `/daily-congressional-record/${r.volumeNumber}/${r.issueNumber}`,
              unwrap: (d) => (Array.isArray(d.issue) ? d.issue[0] : d.issue),
              cols: { articles_count: (r) => String(r.fullIssue?.articles?.count ?? ""),
                      entire_issue: (r) => (r.fullIssue?.entireIssue ? JSON.stringify(r.fullIssue.entireIssue) : null) } } },
  { table: "congress_communications", label: "house-communications", path: (c) => `/house-communication/${c}`, listKey: "houseCommunications",
    key: (r) => `${r.congress}-H-${r.communicationType?.code ?? "?"}-${r.number}`,
    cols: { chamber: (r) => r.chamber ?? "House", communication_type: (r) => r.communicationType?.name ?? null,
            type_code: (r) => r.communicationType?.code ?? null, number: (r) => String(r.number ?? "") } },
  { table: "congress_communications", label: "senate-communications", path: (c) => `/senate-communication/${c}`, listKey: "senateCommunications",
    key: (r) => `${r.congress}-S-${r.communicationType?.code ?? "?"}-${r.number}`,
    cols: { chamber: (r) => r.chamber ?? "Senate", communication_type: (r) => r.communicationType?.name ?? null,
            type_code: (r) => r.communicationType?.code ?? null, number: (r) => String(r.number ?? "") } },
];

/* ---- main ---------------------------------------------------------------- */
const { Client } = require_("pg");
const db = new Client(pgConfig(DB));
await db.connect();

const since = val("--since");
const results = [];

for (const fam of FAMILIES) {
  const label = fam.label ?? fam.table;
  if (ONLY && fam.table !== `congress_${ONLY}` && fam.table !== ONLY && label !== ONLY) continue;
  const t0 = Date.now();
  const before = requests;

  const cols = Object.keys(fam.cols);
  await db.query(`create table if not exists ${fam.table} (
    key text primary key,
    congress int,
    update_date timestamptz,
    payload jsonb not null,
    updated_at timestamptz not null default now())`);
  const detailCols = Object.keys(fam.detail?.cols ?? {});
  for (const c of [...cols, ...detailCols]) {
    // Typed columns are added rather than assumed, so a family can grow one
    // without a migration and without dropping what is already there.
    await db.query(`alter table ${fam.table} add column if not exists ${c} text`);
  }
  if (fam.detail) await db.query(`alter table ${fam.table} add column if not exists detail_fetched_at timestamptz`);

  let rows = 0, written = 0;
  try {
    for (let offset = 0; ; offset += PAGE) {
      const q = `${fam.path(CONGRESS)}?limit=${PAGE}&offset=${offset}${since ? `&fromDateTime=${encodeURIComponent(since)}` : ""}`;
      const page = await api(q);
      const list = page[fam.listKey] ?? (Object.values(page).find((v) => Array.isArray(v)) ?? []);
      for (const r of list) {
        rows += 1;
        const values = [fam.key(r), r.congress ?? CONGRESS, r.updateDate ?? null, JSON.stringify(r), ...cols.map((c) => {
          const v = fam.cols[c](r);
          return v == null ? null : String(v);
        })];
        const placeholders = cols.map((_, i) => `$${i + 5}`).join(", ");
        const setters = cols.map((c) => `${c} = excluded.${c}`).join(", ");
        await db.query(
          `insert into ${fam.table} (key, congress, update_date, payload${cols.length ? ", " + cols.join(", ") : ""})
           values ($1,$2,$3,$4${cols.length ? ", " + placeholders : ""})
           on conflict (key) do update set congress = excluded.congress, update_date = excluded.update_date,
             payload = excluded.payload, updated_at = now()${cols.length ? ", " + setters : ""}`,
          values,
        );
        written += 1;
      }
      if (list.length < PAGE) break;
    }
    // The detail pass, bounded. Only the recently-updated records: a meeting
    // being scheduled or amended is a meeting being updated, and the archive can
    // wait. Without this the family costs one request per record, forever.
    let detailed = 0;
    if (fam.detail && !has("--no-detail")) {
      const cutoff = new Date(Date.now() - fam.detail.since * 86400e3).toISOString();
      const targets = await db.query(
        `select key, payload from ${fam.table}
          where update_date >= $1 and (detail_fetched_at is null or detail_fetched_at < update_date)
          order by update_date desc limit $2`,
        [cutoff, Number(val("--detail-limit", "400"))],
      );
      for (const t of targets.rows) {
        try {
          const raw = await api(fam.detail.path(t.payload));
          const rec = fam.detail.unwrap ? fam.detail.unwrap(raw) : raw;
          if (!rec) continue;
          const dcols = Object.keys(fam.detail.cols);
          const setters = dcols.map((c, i) => `${c} = $${i + 3}`).join(", ");
          await db.query(
            `update ${fam.table} set payload = $2, detail_fetched_at = now()${dcols.length ? ", " + setters : ""} where key = $1`,
            [t.key, JSON.stringify({ ...t.payload, ...rec }), ...dcols.map((c) => { const v = fam.detail.cols[c](rec); return v == null ? null : String(v); })],
          );
          detailed += 1;
        } catch (e) { log(`  ${label} detail ${t.key}: ${String(e.message).slice(0, 80)}`); }
      }
    }

    const mins = (Date.now() - t0) / 60000;
    results.push({ table: label, rows, written, detailed, requests: requests - before, mins: mins.toFixed(1), thin: fam.thin ?? null });
    log(`${label}: ${rows} rows${detailed ? ` · ${detailed} detailed` : ""} · ${requests - before} requests · ${mins.toFixed(1)} min${fam.thin ? ` · thin (${fam.thin})` : ""}`);
  } catch (e) {
    results.push({ table: label, rows, written, requests: requests - before, mins: ((Date.now() - t0) / 60000).toFixed(1), error: String(e.message).slice(0, 120) });
    log(`${label}: FAILED after ${rows} rows — ${String(e.message).slice(0, 140)}`);
  }
}

log(`harvest done: ${results.length} families · ${requests} requests total`);
for (const r of results) log(`  ${r.table.padEnd(30)} ${String(r.rows).padStart(6)} rows ${String(r.detailed ?? 0).padStart(4)} detailed ${String(r.requests).padStart(4)} req  ${r.mins} min${r.error ? `  ERROR ${r.error}` : ""}`);

await db.end();
process.exit(results.some((r) => r.error) ? 1 : 0);
