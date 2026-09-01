#!/usr/bin/env node
// scripts/pipeline/congress/house-votes.mjs — per-member positions on House roll
// calls, keyed to our own people_id.
//
//   node scripts/pipeline/congress/house-votes.mjs            # only votes not yet detailed
//   node scripts/pipeline/congress/house-votes.mjs --all      # re-read every vote
//
// `"Roll Call"` has held the House's roll calls with tallies but no positions:
// LegiScan records the roll number and where the detail lives, and the detail is
// one request per vote on two other hosts. congress.gov's beta house-vote
// endpoint publishes the positions directly — 647 votes for the 119th, one
// request each, and a nightly only pays for the new ones.
//
// The join is bioguide -> people_id. `"People"` carries the bioguide for the
// members LegiScan has one for; a position whose member we cannot place is kept
// with a null people_id rather than dropped, because the vote happened either way.

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
const LIMIT = Number(val("--limit", "0")) || 0;
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
if (!KEY) { console.error("house-votes: CONGRESS_API_KEY is required"); process.exit(2); }

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
  return { user, password: pw, host, database, port: Number(port || 5432), ssl: /sslmode=(require|verify)/.test(query ?? "") ? { rejectUnauthorized: false } : undefined, application_name: "congress-house-votes" };
}

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

const { Client } = require_("pg");
const db = new Client(pgConfig(DB));
await db.connect();

await db.query(`create table if not exists congress_house_vote_positions (
  vote_identifier text not null,
  bioguide_id text not null,
  people_id bigint,
  vote_cast text,
  vote_party text,
  vote_state text,
  first_name text,
  last_name text,
  updated_at timestamptz not null default now(),
  primary key (vote_identifier, bioguide_id))`);
await db.query(`create index if not exists congress_house_vote_positions_people_idx on congress_house_vote_positions (people_id)`);
await db.query(`alter table congress_house_votes add column if not exists positions_fetched_at timestamptz`);
await db.query(`alter table congress_house_votes add column if not exists positions int`);

// bioguide -> our people_id, so a position lands on the member the rest of the
// app links to rather than on a string.
const byBioguide = new Map();
for (const r of (await db.query(`select people_id, bioguide_id from "People" where bioguide_id is not null and bioguide_id <> ''`)).rows) {
  byBioguide.set(String(r.bioguide_id).toUpperCase(), Number(r.people_id));
}
log(`${byBioguide.size.toLocaleString()} members carry a bioguide`);

const votes = (await db.query(
  `select key, session_number, roll_call_number from congress_house_votes
    where congress = $1 ${has("--all") ? "" : "and positions_fetched_at is null"}
    order by start_date desc nulls last ${LIMIT ? `limit ${LIMIT}` : ""}`,
  [CONGRESS],
)).rows;
log(`${votes.length} votes to read`);

const tally = { votes: 0, positions: 0, unplaced: 0, failed: 0 };
for (const v of votes) {
  try {
    const d = await api(`/house-vote/${CONGRESS}/${v.session_number}/${v.roll_call_number}/members`);
    const inner = d.houseRollCallVoteMemberVotes ?? {};
    const results = inner.results ?? [];
    if (!results.length) { tally.failed += 1; continue; }
    for (let i = 0; i < results.length; i += 200) {
      const chunk = results.slice(i, i + 200);
      const params = [];
      const tuples = chunk.map((m) => {
        const bio = String(m.bioguideID ?? m.bioguideId ?? "").toUpperCase();
        const pid = byBioguide.get(bio) ?? null;
        if (!pid) tally.unplaced += 1;
        return `($${params.push(v.key)},$${params.push(bio)},$${params.push(pid)},$${params.push(m.voteCast ?? null)},$${params.push(m.voteParty ?? null)},$${params.push(m.voteState ?? null)},$${params.push(m.firstName ?? null)},$${params.push(m.lastName ?? null)})`;
      }).join(",");
      await db.query(
        `insert into congress_house_vote_positions
           (vote_identifier, bioguide_id, people_id, vote_cast, vote_party, vote_state, first_name, last_name)
         values ${tuples}
         on conflict (vote_identifier, bioguide_id) do update set
           people_id = excluded.people_id, vote_cast = excluded.vote_cast, vote_party = excluded.vote_party,
           vote_state = excluded.vote_state, updated_at = now()`,
        params,
      );
    }
    await db.query(`update congress_house_votes set positions_fetched_at = now(), positions = $2 where key = $1`, [v.key, results.length]);
    tally.votes += 1; tally.positions += results.length;
  } catch (e) {
    tally.failed += 1;
    log(`  vote ${v.key}: ${String(e.message).slice(0, 100)}`);
  }
}

log(`house-votes done: ${tally.votes} votes · ${tally.positions.toLocaleString()} positions · ${tally.unplaced} unplaced members · ${tally.failed} failed · ${requests} requests`);
await db.end();
process.exit(0);
