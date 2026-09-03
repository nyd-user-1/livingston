#!/usr/bin/env node
// scripts/box/national-sweep.mjs — the weekly national LegiScan refresh, and the
// completion of the 989-dataset backfill, in one script.
//
//   node scripts/box/national-sweep.mjs                    # the weekly run
//   node scripts/box/national-sweep.mjs --seed             # first run ever: seed, then sweep
//   node scripts/box/national-sweep.mjs --seed-only        # seed the ledger and stop
//   node scripts/box/national-sweep.mjs --all              # ignore the ledger: full backfill
//   node scripts/box/national-sweep.mjs --only NY,NJ       # restrict to states
//   node scripts/box/national-sweep.mjs --failed-first     # never-imported sessions first
//   node scripts/box/national-sweep.mjs --skip-imported --only WV,WY        # treat what "Bills" holds as done
//   node scripts/box/national-sweep.mjs --sessions CO:925,GA:1614           # exactly these, no matter what
//   node scripts/box/national-sweep.mjs --max-refetch 200                   # raise the runaway gate
//   node scripts/box/national-sweep.mjs --dry-run [--limit 20]
//
// WHY IT IS CHEAP. LegiScan rebuilds each session's bulk archive weekly, but only
// a handful actually change in any given week. Two list calls name every session's
// `dataset_hash`; the "LegiscanDatasets" ledger records the hash of what we last
// imported; anything whose hash still matches is a 20-70 MB zip nobody downloads.
// A full pass is 998 datasets and 5.21 GB. A steady-state week is a few dozen MB.
//
// WHERE THE POSTAL CODE COMES FROM, and why it is not a table in this file:
// `getSessionList` with NO state parameter returns every session LegiScan has,
// each carrying `state_abbr` — 993 rows, one query. That is the authority.
// `api/legiscan-sync.ts`'s `STATE_BY_ID` had 31 as New Jersey; 31 is New Mexico
// and New Jersey is 30, which is how 28 New Mexico datasets came to be imported
// as `?state=NJ` and New Jersey's own nine were never imported at all. A derived
// map cannot make that mistake, so this script derives.
//
// Resumable by construction: the ledger is the only state, it lives in the
// database, and re-running from the top is always safe.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon, policyUrl } from "./policy-db.mjs";
// Aurora, not Neon, since 2026-09-03 — see policy-db.mjs.
policyUrl("national-sweep");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const API = "https://api.legiscan.com/";
const HEAP_MB = 4096;   // NY is a 72 MB zip; several states are larger

/* ---- argv --------------------------------------------------------------- */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ALL = has("--all");
const SEED = has("--seed") || has("--seed-only");
const SEED_ONLY = has("--seed-only");
const FAILED_FIRST = has("--failed-first");
const DRY = has("--dry-run");
const LIMIT = Number(val("--limit", "0")) || 0;
const RETRIES = Number(val("--retries", "1"));
// How many datasets the run may fetch that "Bills" already has rows for, before it
// decides the ledger is wrong rather than the world. See the runaway gate below.
const MAX_REFETCH = Number(val("--max-refetch", "25"));
const ONLY = new Set(val("--only").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
// An explicit `STATE:session` list. These are queued whatever the ledger, `--only`
// or `--skip-imported` say — it is how an operator names the ten that failed and
// gets exactly those ten, including one that half-imported before it died.
const SESSIONS = new Set(val("--sessions").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
// Read "Bills" and treat every (state, legiscan_session_id) it holds as imported,
// hash unknown — the same verdict a seed row gives, WITHOUT writing seed rows.
// That distinction is the point: the global seed must not run while the laptop's
// backfill is still importing, because it would record half-finished sessions as
// done. This is read-only and decides one run.
const SKIP_IMPORTED = has("--skip-imported");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---- env ---------------------------------------------------------------- */

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("=");
  if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}
const KEY = process.env.LEGISCAN_API_KEY;
const DB = process.env.POLICY_DATABASE_URL;
if (!KEY || !DB) { console.error("national-sweep: LEGISCAN_API_KEY and POLICY_DATABASE_URL are both required"); process.exit(2); }
const sql = neon(DB);

async function legiscan(op, params = {}) {
  const qs = new URLSearchParams({ key: KEY, op, ...params });
  const r = await fetch(`${API}?${qs}`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`LegiScan ${op} answered ${r.status}`);
  const d = await r.json();
  if (d?.status !== "OK") throw new Error(`LegiScan ${op}: ${d?.alert?.message ?? d?.status}`);
  return d;
}

/* ---- the ledger --------------------------------------------------------- */

// Same DDL as prepareSchema() in api/legiscan-sync.ts. Whichever runs first wins;
// both are idempotent. Duplicated so the sweep can read the ledger on a database
// where the route has not run since the ledger was added.
await sql.query(`CREATE TABLE IF NOT EXISTS "LegiscanDatasets" (state text NOT NULL, session_id int NOT NULL, dataset_hash text, dataset_size bigint, year int, special smallint, imported_at timestamptz NOT NULL DEFAULT now(), bills int, ms int, PRIMARY KEY (state, session_id))`);

const ledgerRows = await sql.query(`SELECT state, session_id, dataset_hash FROM "LegiscanDatasets"`);
const ledger = new Map(ledgerRows.map((r) => [`${r.state}:${Number(r.session_id)}`, r.dataset_hash]));

if (ledger.size === 0 && !SEED && !ALL && !SKIP_IMPORTED && !SESSIONS.size) {
  console.error(
    "national-sweep: the ledger is empty.\n" +
    "  --seed  seeds it from what \"Bills\" already holds (hash NULL = imported, hash unknown)\n" +
    "          — run it only once the laptop's national backfill has finished, or the\n" +
    "          seed will record sessions that are still half-imported.\n" +
    "  --all   ignores the ledger entirely and re-downloads all 998 datasets (~30 GB).",
  );
  process.exit(2);
}

// What the database already has, independent of the ledger. Loaded on every run:
// --skip-imported folds it into the ledger, and the runaway gate below needs it
// even when it does not. One query, ~850 rows.
const billsHave = new Set((await sql.query(
  `SELECT DISTINCT state, legiscan_session_id::int AS session_id FROM "Bills" WHERE legiscan_session_id IS NOT NULL AND state IS NOT NULL`,
)).map((r) => `${r.state}:${Number(r.session_id)}`));

if (SKIP_IMPORTED) {
  let added = 0;
  for (const k of billsHave) if (!ledger.has(k)) { ledger.set(k, null); added += 1; }
  log(`--skip-imported: "Bills" holds ${billsHave.size} (state, session) pairs; ${added} of them were not in the ledger and count as imported for this run only`);
}

if (SEED) {
  // Everything the laptop imported before this ledger existed. dataset_hash stays
  // NULL — "imported, hash unknown" — so the weekly run does not re-download 650
  // archives to learn what it already has. The run after this one compares real
  // hashes, because every import from here on records the hash it used.
  const before = ledger.size;
  const seeded = await sql.query(
    `INSERT INTO "LegiscanDatasets" (state, session_id, dataset_hash, year, special, imported_at, bills)
     SELECT state, legiscan_session_id::int, NULL, min(session_id)::int, max(COALESCE(special, 0))::smallint, now(), count(*)::int
       FROM "Bills"
      WHERE legiscan_session_id IS NOT NULL AND state IS NOT NULL
      GROUP BY state, legiscan_session_id
     ON CONFLICT (state, session_id) DO NOTHING
     RETURNING state, session_id, bills`,
  );
  log(`seed: ${seeded.length} row(s) inserted (ledger was ${before}), covering ${seeded.reduce((n, r) => n + Number(r.bills), 0).toLocaleString()} bills`);
  const byState = {};
  for (const r of seeded) byState[r.state] = (byState[r.state] ?? 0) + 1;
  log(`seed: ${Object.keys(byState).length} states — ${Object.entries(byState).sort().map(([s, n]) => `${s}:${n}`).join(" ")}`);
  for (const r of seeded) ledger.set(`${r.state}:${Number(r.session_id)}`, null);

  // Second, independent count: the 989-row plan the laptop worked from, kept in
  // the repo. A plan row with no ledger row is a dataset that never landed.
  const planFile = path.join(REPO, "ops", "box", "national-full-plan-2026-08-28.json");
  if (fs.existsSync(planFile)) {
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const missing = plan.filter((d) => !ledger.has(`${d.state}:${Number(d.session)}`));
    log(`seed: plan has ${plan.length} rows; ${plan.length - missing.length} are in the ledger, ${missing.length} are not`);
    for (const m of missing.slice(0, 40)) log(`   missing: ${m.state} ${m.session} (${m.year}${m.special ? " special" : ""}) ${(m.size / 1e6).toFixed(1)} MB`);
    if (missing.length > 40) log(`   … and ${missing.length - 40} more`);
  } else {
    log(`seed: no plan file at ${planFile} — skipping the plan cross-check`);
  }
  if (SEED_ONLY) process.exit(0);
}

/* ---- the two list calls ------------------------------------------------- */

const sessions = (await legiscan("getSessionList")).sessions ?? [];
const datasets = (await legiscan("getDatasetList")).datasetlist ?? [];
log(`lists: getSessionList ${sessions.length} rows, getDatasetList ${datasets.length} rows`);

const abbrBySession = new Map(sessions.map((s) => [Number(s.session_id), String(s.state_abbr)]));
const abbrByStateId = new Map();
for (const s of sessions) {
  const id = Number(s.state_id), a = String(s.state_abbr);
  if (abbrByStateId.has(id) && abbrByStateId.get(id) !== a) throw new Error(`getSessionList disagrees with itself: state_id ${id} is both ${abbrByStateId.get(id)} and ${a}`);
  abbrByStateId.set(id, a);
}

// The two calls both carry dataset_hash. Where both know a session they must
// agree; a disagreement means one list is stale and the diff cannot be trusted.
let agree = 0, disagree = 0;
const hashBySession = new Map(sessions.map((s) => [Number(s.session_id), String(s.dataset_hash ?? "")]));
for (const d of datasets) {
  const h = hashBySession.get(Number(d.session_id));
  if (h === undefined) continue;
  if (h === String(d.dataset_hash)) agree += 1; else { disagree += 1; log(`   hash disagreement on session ${d.session_id}: sessionList=${h} datasetList=${d.dataset_hash}`); }
}
log(`lists: dataset_hash agrees on ${agree} shared session(s), disagrees on ${disagree}`);

/* ---- decide ------------------------------------------------------------- */

const unresolved = [];
const queue = [];
let skippedHash = 0, skippedSeed = 0, skippedOnly = 0;

for (const d of datasets) {
  const sid = Number(d.session_id);
  const state = abbrBySession.get(sid) ?? abbrByStateId.get(Number(d.state_id));
  if (!state) { unresolved.push(d); continue; }
  if (ONLY.size && !ONLY.has(state) && !SESSIONS.has(`${state}:${sid}`)) { skippedOnly += 1; continue; }

  const k = `${state}:${sid}`;
  const known = ledger.has(k) ? ledger.get(k) : undefined;
  const named = SESSIONS.has(k);
  if (!ALL && !named) {
    if (known === null) { skippedSeed += 1; continue; }                       // seeded: imported, hash unknown
    if (known && known === String(d.dataset_hash)) { skippedHash += 1; continue; }  // unchanged since our import
  }
  queue.push({
    state, session: sid, year: Number(d.year_start) || 0, special: Number(d.special) || 0,
    hash: String(d.dataset_hash ?? ""), size: Number(d.dataset_size) || 0,
    access_key: String(d.access_key ?? ""), neverImported: known === undefined,
  });
}

// A named session that matched nothing is a typo or a session LegiScan has retired.
// Saying so is the difference between "ran the ten" and "ran the eight it could find".
const matched = new Set(queue.map((d) => `${d.state}:${d.session}`));
const unmatched = [...SESSIONS].filter((k) => !matched.has(k));
if (unmatched.length) log(`WARNING --sessions named ${unmatched.length} pair(s) that no dataset matches: ${unmatched.join(" ")}`);

if (unresolved.length) {
  // Loud, never silent: a dataset whose postal code we cannot establish is NOT
  // imported under a guess. That guess is exactly how New Mexico became NJ.
  log(`WARNING ${unresolved.length} dataset(s) have a state_id no list resolves — skipped, not guessed:`);
  for (const u of unresolved) log(`   state_id=${u.state_id} session=${u.session_id} ${u.year_start} ${JSON.stringify(u.session_title)}`);
}

// Never-imported first when asked: those are the backfill's holes, and they are
// worth finishing before spending the run on refreshes.
if (FAILED_FIRST) queue.sort((a, b) => (b.neverImported - a.neverImported) || a.state.localeCompare(b.state) || a.session - b.session);
else queue.sort((a, b) => a.state.localeCompare(b.state) || a.session - b.session);

const work = LIMIT ? queue.slice(0, LIMIT) : queue;
const mb = (n) => (n / 1e6).toFixed(1);
log(`plan: ${datasets.length} datasets · skipped ${skippedSeed} seeded + ${skippedHash} unchanged + ${skippedOnly} filtered + ${unresolved.length} unresolved · ${queue.length} to import${LIMIT ? ` (limited to ${work.length})` : ""} · ${mb(work.reduce((n, d) => n + d.size, 0))} MB`);

// ── the runaway gate ────────────────────────────────────────────────────────
// A PARTIALLY populated ledger is more dangerous than an empty one: the empty
// check above does not fire, and every session the ledger has never heard of
// looks "never imported" — so a steady-state Sunday quietly turns into a 30 GB
// re-download of archives we demonstrably already hold. Assert the SHAPE of the
// work instead of trusting the ledger's size: if the queue is mostly sessions
// "Bills" already has rows for, the ledger is wrong, not the world.
const refetch = work.filter((d) => d.neverImported && billsHave.has(`${d.state}:${d.session}`) && !SESSIONS.has(`${d.state}:${d.session}`));
if (refetch.length > MAX_REFETCH && !ALL && !SKIP_IMPORTED) {
  console.error(
    `national-sweep: REFUSING to run.\n` +
    `  ${refetch.length} of the ${work.length} datasets queued are sessions "Bills" already holds rows for,\n` +
    `  which is over the --max-refetch ceiling of ${MAX_REFETCH}. That means the ledger is incomplete,\n` +
    `  not that ${refetch.length} archives changed this week — running would re-download them all.\n` +
    `  Fix it: node scripts/box/national-sweep.mjs --seed-only     (record what we already have)\n` +
    `  Or say you meant it: --all | --skip-imported | --max-refetch <n>`,
  );
  process.exit(2);
}

if (DRY) {
  for (const d of work) log(`   WOULD IMPORT ${d.state} ${d.session} ${d.year}${d.special ? " special" : ""} ${mb(d.size)} MB ${d.neverImported ? "(never imported)" : "(hash changed)"}`);
  process.exit(0);
}

/* ---- import ------------------------------------------------------------- */

function runOne(d) {
  return new Promise((resolve) => {
    const args = [
      path.join(HERE, "run-handler.mjs"), "--heap", String(HEAP_MB), "api/legiscan-sync.ts",
      "mode=dataset", `state=${d.state}`, `session=${d.session}`, `year=${d.year}`,
      `special=${d.special}`, `hash=${d.hash}`, `access_key=${d.access_key}`,
    ];
    let out = "";
    const c = spawn(process.execPath, args, { cwd: REPO, env: process.env });
    c.stdout.on("data", (b) => { out += b; });
    c.stderr.on("data", (b) => { out += b; });
    c.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });
}

let imported = 0, failed = 0;
const failures = [];
const timings = [];
const runStarted = Date.now();
for (const [i, d] of work.entries()) {
  const t0 = Date.now();
  let r = await runOne(d);
  for (let attempt = 0; r.code !== 0 && attempt < RETRIES; attempt += 1) {
    log(`   ${d.state} ${d.session} failed, retrying in 30 s — ${r.out.slice(0, 200)}`);
    await new Promise((ok) => setTimeout(ok, 30_000));
    r = await runOne(d);
  }
  const wallMs = Date.now() - t0;
  const secs = (wallMs / 1000).toFixed(0);
  if (r.code === 0) {
    imported += 1;
    let body = {};
    try { body = JSON.parse(r.out.replace(/^HTTP \d+ /, "")); } catch { body = {}; }
    // The handler's own numbers, not the list's claims: zipBytes is what was
    // decoded and ms is what the import itself took. wallMs is what an operator
    // actually waits — node start plus the esbuild bundle on top.
    timings.push({ state: d.state, session: d.session, wallMs, handlerMs: Number(body.ms ?? 0), bytes: Number(body.zipBytes ?? d.size), bills: Number(body.bills ?? 0) });
    log(`[${i + 1}/${work.length}] ${d.state} ${d.session} ${d.year} ${mb(d.size)} MB ${secs}s — ${r.out.slice(0, 220)}`);
  } else { failed += 1; failures.push(d); log(`[${i + 1}/${work.length}] ${d.state} ${d.session} ${d.year} ${secs}s FAILED — ${r.out.slice(0, 400)}`); }
}

// The A/B numbers, computed here rather than grepped out of the log afterwards.
if (timings.length) {
  const pct = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]; };
  const wall = timings.map((t) => t.wallMs / 1000);
  const bytes = timings.reduce((n, t) => n + t.bytes, 0);
  const elapsed = (Date.now() - runStarted) / 1000;
  log(`STATS count=${timings.length} totalMB=${(bytes / 1e6).toFixed(1)} wallClock=${elapsed.toFixed(0)}s medianSecs=${pct(wall, 0.5).toFixed(1)} p90Secs=${pct(wall, 0.9).toFixed(1)} handlerMedianSecs=${(pct(timings.map((t) => t.handlerMs), 0.5) / 1000).toFixed(1)}`);
  for (const [label, lo, hi] of [["<5MB", 0, 5e6], ["5-20MB", 5e6, 20e6], [">20MB", 20e6, Infinity]]) {
    const band = timings.filter((t) => t.bytes >= lo && t.bytes < hi);
    if (!band.length) { log(`STATS band ${label}: none`); continue; }
    const secsPerMb = band.map((t) => (t.wallMs / 1000) / Math.max(0.001, t.bytes / 1e6));
    log(`STATS band ${label}: n=${band.length} MB=${(band.reduce((n, t) => n + t.bytes, 0) / 1e6).toFixed(1)} medianSecsPerMB=${pct(secsPerMb, 0.5).toFixed(2)} p90SecsPerMB=${pct(secsPerMb, 0.9).toFixed(2)} bills=${band.reduce((n, t) => n + t.bills, 0)}`);
  }
}

// The gate reports what was emitted against what was requested MINUS the skips it
// was designed to make (RIG §10) — never `imported == datasets.length`.
log(`done: requested ${work.length} · imported ${imported} · failed ${failed}`);
if (failures.length) log(`failed: ${failures.map((d) => `${d.state}:${d.session}`).join(" ")}`);
process.exit(failed ? 1 : 0);
