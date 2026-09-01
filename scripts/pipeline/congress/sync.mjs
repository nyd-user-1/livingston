#!/usr/bin/env node
// scripts/pipeline/congress/sync.mjs — keep Congress current from api.congress.gov,
// writing to **Aurora**, the database the site actually reads.
//
//   node scripts/pipeline/congress/sync.mjs --days 7
//   node scripts/pipeline/congress/sync.mjs --since 2026-08-25T00:00:00Z
//   node scripts/pipeline/congress/sync.mjs --all            # the whole congress
//   node scripts/pipeline/congress/sync.mjs --days 7 --dry-run
//
// Why this exists: HB10160 was referred to committee on 2026-08-27 and
// congress.gov has carried its introduced text since that day, while govblock
// said "No text on file yet". The two pipelines that should have caught it both
// could not — `dp-us-native` dies on an undeclared `fast-xml-parser`, and the
// nightly LegiScan/text deltas write to Neon, which the site no longer reads.
//
// Scope of this step: the bills whose text moved, and their text. The other
// per-bill families (actions, cosponsors, committees, subjects, related) are
// the same walk with more endpoints and are added on top of this; the text is
// what the site was visibly missing.
//
// Env: AURORA_POLICY_URL, CONGRESS_API_KEY, CONGRESS_USER_AGENT.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(path.join(REPO, "noop.js"));

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const CONGRESS = Number(val("--congress", "119"));
const DRY = has("--dry-run");
const LIMIT = Number(val("--limit", "0")) || 0;
const PAGE = 250;
// 20,000 requests/hour is the ceiling, not the target. At 120 ms between calls a
// full night's walk sits near 500/hour against the API.
const PACE_MS = Number(val("--pace", "120"));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- env ----------------------------------------------------------------- */
// Same precedence the other box scripts use: the real environment wins, then
// .env.local for a laptop run.
for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("=");
  if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

const DB = process.env.AURORA_POLICY_URL;
const KEY = process.env.CONGRESS_API_KEY;
const UA = process.env.CONGRESS_USER_AGENT || "govblock/1.0 (+https://govblock.app)";
if (!DB) { console.error("congress/sync: AURORA_POLICY_URL is required — this writes to Aurora, not Neon"); process.exit(2); }
if (!KEY) { console.error("congress/sync: CONGRESS_API_KEY is required"); process.exit(2); }

/* ---- htmlToText, the one the govinfo path uses --------------------------- */
// Bundled rather than reimplemented: two strippers that disagree would put two
// different renderings of the same bill in the same column.
async function loadShared() {
  const { build } = await import("esbuild");
  // Inside the repo, not /tmp: the bundle keeps its dependencies external, and a
  // bare import only resolves if the file sits under the tree that owns
  // node_modules. From /tmp it fails on @aws-sdk/client-s3.
  const cache = path.join(REPO, "node_modules", ".cache");
  fs.mkdirSync(cache, { recursive: true });
  const out = path.join(cache, `congress-text-shared-${process.pid}.mjs`);
  await build({
    entryPoints: [path.join(REPO, "api/_lib/text-shared.ts")],
    outfile: out, bundle: true, format: "esm", platform: "node",
    packages: "external", logLevel: "silent",
  });
  const mod = await import(`file://${out}`);
  fs.rmSync(out, { force: true });
  return mod;
}

/* ---- the API ------------------------------------------------------------- */
const API = "https://api.congress.gov/v3";
let requests = 0;
let lastCall = 0;

async function api(pathAndQuery) {
  const url = pathAndQuery.startsWith("http") ? pathAndQuery : `${API}${pathAndQuery}`;
  const sep = url.includes("?") ? "&" : "?";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wait = PACE_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    requests += 1;
    // It 403s any request without a real User-Agent, which is the first thing
    // that happens to anyone who tries this with curl's default.
    const res = await fetch(`${url}${sep}format=json`, { headers: { "X-Api-Key": KEY, "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) {
      const back = Math.min(60_000, 2000 * 2 ** attempt);
      log(`  ${res.status} on ${url.slice(API.length) || url} — backing off ${back / 1000}s`);
      await sleep(back);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
  }
  throw new Error(`gave up after 5 attempts: ${url}`);
}

/** The .htm text bodies are on www.congress.gov, not the API, and take no key. */
async function fetchText(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sleep(PACE_MS);
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(Math.min(30_000, 1500 * 2 ** attempt)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.text();
  }
  return null;
}

/* ---- identity ------------------------------------------------------------ */
// congress.gov's bill type -> our bill_number prefix. Same table api/bill-text.ts
// carries for govinfo, so the three sources agree on what a bill is called.
const PREFIX_BY_TYPE = { HR: "HB", S: "SB", HJRES: "HJR", SJRES: "SJR", HCONRES: "HCR", SCONRES: "SCR", HRES: "HR", SRES: "SR" };
const yearOfCongress = (c) => (c - 1) * 2 + 1789;

// Index+1 is the synthetic-id slot, exactly as api/bill-text.ts numbers them, so
// a version fetched here and the same version later fetched from govinfo are one
// row rather than two.
const VERSION_CODES = ["as", "ash", "ath", "ats", "cdh", "cds", "cph", "cps", "eah", "eas", "ech", "eh", "enr", "eph", "es", "fah", "fph", "fps", "hdh", "hds", "ih", "iph", "ips", "is", "lth", "lts", "oph", "ops", "pap", "pcs", "pp", "pwah", "rah", "ras", "rch", "rcs", "rdh", "rds", "reah", "renr", "res", "rfh", "rfs", "rh", "rih", "ris", "rs", "rth", "rts", "sas", "sc"];

/** BILLS-119hr10160ih.htm -> "ih" */
const versionCodeOf = (url) => (/BILLS-\d+[a-z]+\d+([a-z]+)\.(htm|xml|pdf)$/i.exec(url || "")?.[1] ?? "").toLowerCase();

/* ---- main ---------------------------------------------------------------- */
const { htmlToText } = await loadShared();
const { Client } = require_("pg");
const db = new Client({ connectionString: DB, application_name: "congress-sync" });
await db.connect();

const year = yearOfCongress(CONGRESS);
const t0 = Date.now();

await db.query(`
  create table if not exists congress_sync_state (
    step text primary key,
    last_run timestamptz,
    last_ok  timestamptz,
    note     text
  )`);

let since = val("--since");
if (!since && !has("--all")) {
  const days = Number(val("--days", "7"));
  const prior = (await db.query(`select last_ok from congress_sync_state where step = $1`, [`bills-${CONGRESS}`])).rows[0]?.last_ok;
  // A window, not a point: re-reading a day already read is cheap and idempotent,
  // and it closes the gap a crash mid-run would otherwise leave behind.
  since = prior ? new Date(new Date(prior).getTime() - 24 * 3600e3).toISOString() : new Date(Date.now() - days * 86400e3).toISOString();
}
const fromDateTime = since ? since.replace(/\.\d+Z$/, "Z") : null;
log(`congress ${CONGRESS} (session ${year}) · ${fromDateTime ? `changed since ${fromDateTime}` : "the whole congress"}${DRY ? " · DRY RUN" : ""}`);

// Our bills, by number, so a text can find its bill_id.
const known = new Map();
for (const r of (await db.query(`select bill_id, bill_number from "Bills" where state = 'US' and session_id = $1`, [year])).rows) {
  known.set(String(r.bill_number).toUpperCase(), Number(r.bill_id));
}
log(`  ${known.size.toLocaleString()} bills on file for ${year}`);

/* 1. the bills that changed */
const changed = [];
for (let offset = 0; ; offset += PAGE) {
  const q = `/bill/${CONGRESS}?limit=${PAGE}&offset=${offset}&sort=updateDate+asc${fromDateTime ? `&fromDateTime=${encodeURIComponent(fromDateTime)}` : ""}`;
  const page = await api(q);
  const bills = page.bills ?? [];
  for (const b of bills) changed.push(b);
  log(`  page ${offset / PAGE + 1}: ${bills.length} bills (${changed.length} so far)`);
  if (bills.length < PAGE) break;
  if (LIMIT && changed.length >= LIMIT) break;
}
const work = LIMIT ? changed.slice(0, LIMIT) : changed;
log(`  ${work.length.toLocaleString()} bills changed`);

/* 2. their text versions */
const counts = { bills: 0, versions: 0, inserted: 0, updated: 0, unchanged: 0, kept: 0, empty: 0, unmatched: 0, chars: 0 };

for (const b of work) {
  const prefix = PREFIX_BY_TYPE[String(b.type).toUpperCase()];
  const number = String(b.number);
  const billId = prefix ? known.get(`${prefix}${number}`) : undefined;
  if (!billId) { counts.unmatched += 1; continue; }
  counts.bills += 1;

  let versions = [];
  try {
    versions = (await api(`/bill/${CONGRESS}/${String(b.type).toLowerCase()}/${number}/text?limit=250`)).textVersions ?? [];
  } catch (e) { log(`  ${prefix}${number}: text list failed — ${String(e.message).slice(0, 120)}`); continue; }

  for (const v of versions) {
    const htm = (v.formats ?? []).find((f) => /Formatted Text/i.test(f.type ?? ""))?.url;
    if (!htm) continue;
    const code = versionCodeOf(htm);
    const slot = VERSION_CODES.indexOf(code);
    if (slot < 0) { log(`  ${prefix}${number}: unknown version code ${code || "(none)"} — skipped`); continue; }
    const documentId = -(billId * 100 + slot + 1);
    counts.versions += 1;

    // Never replace a govinfo row: it came from the XML, which carries the
    // amendment marks this .htm has already flattened. Fill a gap, refresh our
    // own, and otherwise leave it alone (§0.3).
    const existing = (await db.query(`select source, chars from "BillTexts" where document_id = $1`, [documentId])).rows[0];
    if (existing && existing.source && existing.source !== "congress.gov" && Number(existing.chars) > 0) { counts.kept += 1; continue; }

    const html = await fetchText(htm);
    const text = html ? htmlToText(html) : "";
    if (!text.trim()) { counts.empty += 1; continue; }
    counts.chars += text.length;

    if (DRY) { counts.inserted += 1; continue; }

    // The version link belongs in "Documents" too — that is where the bill page
    // looks for "the text we hold", and where a reader gets the official URL.
    await db.query(
      `insert into "Documents" (bill_id, document_id, document_type, document_desc, url, state_link, document_mime)
       values ($1,$2,'text',$3,$4,$4,'text/html')
       -- Documents is keyed on (document_type, document_id), not document_id alone.
       on conflict (document_type, document_id) do update set
         document_type = excluded.document_type,
         document_desc = coalesce(excluded.document_desc, "Documents".document_desc),
         url = coalesce(excluded.url, "Documents".url),
         state_link = coalesce(excluded.state_link, "Documents".state_link)`,
      [billId, documentId, v.type ?? code.toUpperCase(), htm],
    );

    const res = await db.query(
      `insert into "BillTexts" (document_id, bill_id, state, session_id, version, source, mime, chars, text, fetched_at, error)
       values ($1,$2,'US',$3,$4,'congress.gov','text/html',$5,$6, now(), null)
       on conflict (document_id) do update set
         version = excluded.version, source = excluded.source, mime = excluded.mime,
         chars = excluded.chars, text = excluded.text, fetched_at = now(), error = null
       where "BillTexts".text is distinct from excluded.text
       returning (xmax = 0) as inserted`,
      [documentId, billId, year, v.type ?? code.toUpperCase(), text.length, text],
    );
    if (!res.rows.length) counts.unchanged += 1;
    else if (res.rows[0].inserted) counts.inserted += 1;
    else counts.updated += 1;
  }
}

if (!DRY) {
  await db.query(
    `insert into congress_sync_state (step, last_run, last_ok, note) values ($1, now(), now(), $2)
     on conflict (step) do update set last_run = now(), last_ok = now(), note = excluded.note`,
    [`bills-${CONGRESS}`, `${counts.bills} bills · ${counts.inserted + counts.updated} versions written`],
  );
}

const mins = (Date.now() - t0) / 60000;
log(
  `done: ${counts.bills} bills · ${counts.versions} versions seen · ${counts.inserted} inserted · ${counts.updated} updated · ` +
  `${counts.unchanged} unchanged · ${counts.kept} kept (better source) · ${counts.empty} empty · ${counts.unmatched} unmatched · ` +
  `${(counts.chars / 1e6).toFixed(1)}M chars · ${requests} requests · ${mins.toFixed(1)} min`,
);

await db.end();
process.exit(0);
