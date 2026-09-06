#!/usr/bin/env node
// scripts/pipeline/congress/hearing-texts.mjs — the transcripts of the hearings
// congress.gov holds, into Aurora, the way the text walk fetches a bill.
//
//   node scripts/pipeline/congress/hearing-texts.mjs             # every hearing with a text URL and no text yet
//   node scripts/pipeline/congress/hearing-texts.mjs --all       # re-read them all
//   node scripts/pipeline/congress/hearing-texts.mjs --limit 50
//
// harvest.mjs writes each hearing's `text_url` (congress.gov's formatted text,
// a .htm) and `pdf_url`. This reads the .htm — no API key, no quota, one plain
// request per hearing — keeps the HTML and the text stripped from it, and
// writes both to congress_hearing_texts keyed on the jacket number. Brendan,
// 2026-09-05: "want transcripts for sure! They will slot nicely into the
// github style view we use." 934 hearings on the 119th; a nightly pays only
// for the new ones.

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
const LIMIT = Number(val("--limit", "5000"));
const PACE_MS = Number(val("--pace", "500"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim(); if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("="); if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}
const UA = process.env.CONGRESS_USER_AGENT || "govblock/1.0 (+https://govblock.app)";

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

/* ---- the text out of congress.gov's .htm ---------------------------------- */
// The formatted transcript is a <pre> inside a small page. Keep the HTML as
// published, and a plain text with the tags gone and entities resolved, which
// is what the reader and the search index want.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function textOf(html) {
  let s = html;
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(s);
  if (pre) s = pre[1];
  else s = s.replace(/<head[\s\S]*?<\/head>/i, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
  return s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

async function fetchText(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (res.status === 429 || res.status >= 500) { await sleep(Math.min(60_000, 2000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  }
  throw new Error("gave up after 4 attempts");
}

/* ---- main ---------------------------------------------------------------- */
const { Client } = require_("pg");
const db = new Client(pgConfig(DB));
await db.connect();
await db.query(`create table if not exists congress_hearing_texts (
  key text primary key,
  jacket_number text,
  congress int,
  chamber text,
  title text,
  hearing_date text,
  committee_code text,
  url text not null,
  html text,
  text text,
  chars int,
  fetched_at timestamptz not null default now())`);

const targets = await db.query(
  `select h.key, h.jacket_number, h.congress, h.chamber, h.title, h.hearing_date, h.committee_code, h.text_url
     from congress_hearings h
     where coalesce(h.text_url, '') <> ''
       ${has("--all") ? "" : "and not exists (select 1 from congress_hearing_texts t where t.key = h.key)"}
     order by h.hearing_date desc nulls last limit $1`,
  [LIMIT],
);
log(`${targets.rows.length} hearings to fetch`);
let done = 0, failed = 0, bytes = 0;
for (const h of targets.rows) {
  try {
    const html = await fetchText(h.text_url);
    const text = textOf(html);
    bytes += text.length;
    await db.query(
      `insert into congress_hearing_texts (key, jacket_number, congress, chamber, title, hearing_date, committee_code, url, html, text, chars, fetched_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       on conflict (key) do update set title = excluded.title, hearing_date = excluded.hearing_date, committee_code = excluded.committee_code,
         url = excluded.url, html = excluded.html, text = excluded.text, chars = excluded.chars, fetched_at = now()`,
      [h.key, h.jacket_number, h.congress, h.chamber, h.title, h.hearing_date, h.committee_code, h.text_url, html, text, text.length],
    );
    done += 1;
    if (done % 50 === 0) log(`  ${done} fetched · ${(bytes / 1e6).toFixed(1)} MB of text`);
  } catch (e) { failed += 1; log(`  ${h.key} (${h.text_url}): ${String(e.message).slice(0, 80)}`); }
  await sleep(PACE_MS);
}
log(`hearing texts done: ${done} fetched · ${failed} failed · ${(bytes / 1e6).toFixed(1)} MB of text`);
await db.end();
process.exit(failed && !done ? 1 : 0);
