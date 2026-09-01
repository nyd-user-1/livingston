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
            latest_action: (r) => r.latestAction?.text ?? null, latest_action_date: (r) => r.latestAction?.actionDate ?? null } },
  { table: "congress_nominations", path: (c) => `/nomination/${c}`, listKey: "nominations",
    key: (r) => `${r.congress}-${r.number}-${r.partNumber ?? 0}`,
    cols: { number: (r) => String(r.number), part_number: (r) => String(r.partNumber ?? ""), citation: (r) => r.citation ?? null,
            description: (r) => r.description ?? null, organization: (r) => r.organization ?? null,
            received_date: (r) => r.receivedDate ?? null, latest_action: (r) => r.latestAction?.text ?? null } },
  { table: "congress_committee_reports", path: (c) => `/committee-report/${c}`, listKey: "reports",
    key: (r) => String(r.citation ?? `${r.congress}-${r.chamber}-${r.type}-${r.number}-${r.part ?? 1}`),
    cols: { citation: (r) => r.citation ?? null, chamber: (r) => r.chamber ?? null, report_type: (r) => r.type ?? null,
            number: (r) => String(r.number ?? ""), part: (r) => n(r.part) } },
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
    thin: "the list is an eventId and a URL; the date, title, witnesses and documents are one detail request each (2,680)" },
  { table: "congress_hearings", path: (c) => `/hearing/${c}`, listKey: "hearings",
    key: (r) => String(r.jacketNumber ?? `${r.congress}-${r.chamber}-${r.number}`),
    cols: { jacket_number: (r) => String(r.jacketNumber ?? ""), chamber: (r) => r.chamber ?? null, number: (r) => String(r.number ?? "") },
    thin: "transcripts are behind a detail request each (932)" },
];

/* ---- main ---------------------------------------------------------------- */
const { Client } = require_("pg");
const db = new Client(pgConfig(DB));
await db.connect();

const since = val("--since");
const results = [];

for (const fam of FAMILIES) {
  if (ONLY && fam.table !== `congress_${ONLY}` && fam.table !== ONLY) continue;
  const t0 = Date.now();
  const before = requests;

  const cols = Object.keys(fam.cols);
  await db.query(`create table if not exists ${fam.table} (
    key text primary key,
    congress int,
    update_date timestamptz,
    payload jsonb not null,
    updated_at timestamptz not null default now())`);
  for (const c of cols) {
    // Typed columns are added rather than assumed, so a family can grow one
    // without a migration and without dropping what is already there.
    await db.query(`alter table ${fam.table} add column if not exists ${c} text`);
  }

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
    const mins = (Date.now() - t0) / 60000;
    results.push({ table: fam.table, rows, written, requests: requests - before, mins: mins.toFixed(1), thin: fam.thin ?? null });
    log(`${fam.table}: ${rows} rows · ${requests - before} requests · ${mins.toFixed(1)} min${fam.thin ? ` · thin (${fam.thin})` : ""}`);
  } catch (e) {
    results.push({ table: fam.table, rows, written, requests: requests - before, mins: ((Date.now() - t0) / 60000).toFixed(1), error: String(e.message).slice(0, 120) });
    log(`${fam.table}: FAILED after ${rows} rows — ${String(e.message).slice(0, 140)}`);
  }
}

log(`harvest done: ${results.length} families · ${requests} requests total`);
for (const r of results) log(`  ${r.table.padEnd(30)} ${String(r.rows).padStart(6)} rows  ${String(r.requests).padStart(4)} req  ${r.mins} min${r.error ? `  ERROR ${r.error}` : ""}`);

await db.end();
process.exit(results.some((r) => r.error) ? 1 : 0);
