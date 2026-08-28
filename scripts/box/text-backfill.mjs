#!/usr/bin/env node
// scripts/box/text-backfill.mjs — drive api/bill-text.ts until a source is done.
//
//   node scripts/box/text-backfill.mjs --source nysenate [--session 2025] [--batch 200]
//   node scripts/box/text-backfill.mjs --source govinfo --all-congresses
//   node scripts/box/text-backfill.mjs --source govinfo-billsum --all-congresses
//   node scripts/box/text-backfill.mjs --source govinfo --congress 119
//   node scripts/box/text-backfill.mjs --source state_link --state TX [--since-session 2023]
//   node scripts/box/text-backfill.mjs --source state_link --all-states [--parallel 4] [--max-seconds 14400]
//
// It holds NO state. Every source's resume point is a column in the database —
// `Bills.text_fetched_at` for NY, a `"BillTexts"` row for everything walked —
// so the loop is simply "ask for the next batch until the handler says there is
// nothing left". Kill it at any moment and the next run picks up mid-state, mid
// batch, having lost at most the one document in flight.
//
// --all-states runs one CHILD PROCESS PER STATE, several at a time. That is safe
// for a specific measured reason and not in general: no host in our data serves
// two states (checked — the overlap query returns zero rows), so per-state
// processes never race each other for a host, and the per-host politeness inside
// api/_lib/polite-fetch.ts stays the only serialisation that has to hold.
//
// States are ordered by how long their slowest host will take (documents ×
// robots.txt Crawl-delay), longest first, so the run's total wall clock is the
// longest state rather than the sum plus bad luck.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const RUNNER = path.join(HERE, "run-handler.mjs");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const SOURCE = val("--source");
const STATE = val("--state").toUpperCase();
const SESSION = val("--session");
const SINCE = Number(val("--since-session", "2023")) || 2023;
const BATCH = Number(val("--batch", "200")) || 200;
const CONCURRENCY = Number(val("--concurrency", "12")) || 12;
const PARALLEL = Number(val("--parallel", "6")) || 6;
const HEAP = val("--heap", "2048");
const MAX_ROUNDS = Number(val("--max-rounds", "100000")) || 100000;
// A wall-clock budget for the night. The walk is ~483,000 documents across 47
// legislature websites at one request per second per host, and the honest shape
// for that is a nightly job that does its four hours and stops, not a marathon
// somebody has to remember is running. Checked BETWEEN rounds and between
// states, never mid-fetch: the point is to stop cleanly, and every document
// already stored stays stored.
const MAX_SECONDS = Number(val("--max-seconds", "0")) || 0;
const DEADLINE = MAX_SECONDS ? Date.now() + MAX_SECONDS * 1000 : Infinity;
const budgetSpent = () => Date.now() >= DEADLINE;
const budgetLeft = () => Math.max(0, Math.round((DEADLINE - Date.now()) / 60000));
const MAX_ERRORS = Number(val("--max-errors", "10")) || 10;
const ALL_STATES = has("--all-states");
const ALL_CONGRESSES = has("--all-congresses");
const RETRY_ERRORS = has("--retry-errors");
// States the --all-states walk must leave alone, because something else owns
// their host. One connection per host is the rule; two processes on
// pub.njleg.gov would break it just as surely as two threads would.
const SKIP_STATES = new Set(val("--skip-states").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));

if (!SOURCE) { console.error("usage: text-backfill.mjs --source nysenate|govinfo|state_link [...]"); process.exit(2); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("=");
  if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}
if (!process.env.POLICY_DATABASE_URL) { console.error("text-backfill: POLICY_DATABASE_URL is required"); process.exit(2); }

/** One handler invocation. Returns the parsed answer, or null with the raw output on failure. */
function call(args, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, "--heap", HEAP, "api/bill-text.ts", ...args], { cwd: REPO, env: process.env });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { out += b; });
    child.on("close", (code) => {
      let body = null;
      try { body = JSON.parse(out.trim().replace(/^HTTP \d+ /, "")); } catch { body = null; }
      if (!quiet && body === null) log(`   (unparseable answer) ${out.trim().slice(0, 300)}`);
      resolve({ code: code ?? 1, body, out: out.trim() });
    });
  });
}

const dropped2 = (b) => (Array.isArray(b.dropped) ? b.dropped : []);

/** Loop one scope until the handler stops finding work. Returns a summary. */
async function drain(label, argsFor) {
  const totals = { rounds: 0, considered: 0, inserted: 0, updated: 0, unchanged: 0, chars: 0, failed: 0, skipped: 0 };
  let errors = 0;
  let zeroText = 0;
  const t0 = Date.now();
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    if (budgetSpent()) {
      log(`${label}: the night's budget is spent — stopping cleanly after ${totals.rounds} round(s); the rest resumes tomorrow from the database`);
      return { ...totals, label, budgeted: true, errored: false, secs: (Date.now() - t0) / 1000 };
    }
    const r = await call(argsFor(round));
    if (r.code !== 0 || !r.body?.ok) {
      errors += 1;
      log(`${label} round ${round} FAILED (${errors}/${MAX_ERRORS}) — ${String(r.body?.error ?? r.out).slice(0, 260)}`);
      if (errors >= MAX_ERRORS) { log(`${label}: stopping after ${MAX_ERRORS} consecutive failures`); return { ...totals, label, errored: true, secs: (Date.now() - t0) / 1000 }; }
      await new Promise((ok) => setTimeout(ok, 30_000));
      continue;
    }
    errors = 0;
    totals.rounds += 1;
    const b = r.body;
    for (const k of ["considered", "inserted", "updated", "unchanged", "chars", "failed"]) totals[k] += Number(b[k] ?? 0);
    const skips = Object.entries(b).filter(([k]) => k.startsWith("skip_")).reduce((n, [, v]) => n + Number(v), 0);
    totals.skipped += skips;
    // A whole batch refused is a verdict about the HOST, not about these 400
    // documents. Recording it once and moving on is the point; grinding through
    // California's 37,772 rows to write 37,772 identical "robots.txt disallows"
    // errors spends an hour and a database connection to learn nothing the first
    // batch did not already prove.
    const refused = Number(b["skip_robots"] ?? 0) + Number(b["skip_host-dropped"] ?? 0);
    if (Number(b.considered ?? 0) > 0 && refused === Number(b.considered)) {
      log(`${label}: every document in this batch was refused by the host (${Number(b["skip_robots"] ?? 0)} robots, ${Number(b["skip_host-dropped"] ?? 0)} dropped) — recording the verdict and leaving the rest of this scope alone`);
      return { ...totals, label, refused: true, errored: false, secs: (Date.now() - t0) / 1000 };
    }
    // A host that five-strikes itself out is only DROPPED for the life of one
    // handler process, so the next round starts a fresh fetcher, takes five more
    // 429s, and drops it again — 400 rows and two minutes per round, for as long
    // as the state has documents. Hawaii did exactly that twice before this
    // existed. Two consecutive batches that yield no text at all is the signal:
    // two, not one, so a transient blip cannot close a state that is merely
    // having a bad minute.
    if (Number(b.considered ?? 0) > 0 && Number(b.chars ?? 0) === 0) {
      zeroText += 1;
      if (zeroText >= 2) {
        log(`${label}: two consecutive batches produced no text at all (last: ${skips} skipped${dropped2(b).length ? `, hosts dropped ${dropped2(b).join(",")}` : ""}) — stopping this scope, the verdict is recorded in "BillTexts"`);
        return { ...totals, label, refused: true, errored: false, secs: (Date.now() - t0) / 1000 };
      }
    } else zeroText = 0;
    const dropped = Array.isArray(b.dropped) ? b.dropped : [];
    log(`${label} round ${round}: considered ${b.considered ?? 0} · inserted ${b.inserted ?? 0} · unchanged ${b.unchanged ?? 0} · skipped ${skips} · ${((b.ms ?? 0) / 1000).toFixed(0)}s${dropped.length ? ` · DROPPED HOSTS ${dropped.join(",")}` : ""}`);

    // The only stop condition that means "done": the handler looked and found
    // nothing left in scope. Everything else is a reason to go round again.
    if (Number(b.considered ?? 0) === 0) break;
  }
  return { ...totals, label, errored: false, secs: (Date.now() - t0) / 1000 };
}

const sql = neon(process.env.POLICY_DATABASE_URL);

/* ---- nysenate ------------------------------------------------------------ */

if (SOURCE === "nysenate") {
  const args = (['source=nysenate', `limit=${BATCH}`]);
  if (SESSION) args.push(`session=${SESSION}`);
  if (RETRY_ERRORS) args.push("retryErrors=1");
  log(`nysenate: session=${SESSION || "all"} batch=${BATCH}${RETRY_ERRORS ? " (retrying errors)" : ""}`);
  const s = await drain("nysenate", () => args);
  log(`nysenate done: ${s.rounds} rounds · ${s.inserted} versions · ${s.chars.toLocaleString()} chars · ${(s.secs / 60).toFixed(1)} min`);
  process.exit(s.errored ? 1 : 0);
}

/* ---- govinfo ------------------------------------------------------------- */

if (SOURCE === "govinfo" || SOURCE === "govinfo-billsum") {
  let congresses = [];
  if (ALL_CONGRESSES) {
    const rows = await sql.query(`SELECT DISTINCT session_id FROM "Bills" WHERE state = 'US' ORDER BY session_id DESC`);
    congresses = rows.map((r) => Math.floor((Number(r.session_id) - 1789) / 2) + 1);
  } else if (val("--congress")) congresses = [Number(val("--congress"))];
  else { console.error(`${SOURCE}: pass --congress N or --all-congresses`); process.exit(2); }

  log(`${SOURCE}: ${congresses.length} congress(es) — ${congresses.join(" ")}`);
  let bad = 0;
  const tot = { rows: 0, chars: 0, unmatched: 0 };
  for (const c of congresses) {
    const t0 = Date.now();
    const r = await call([`source=${SOURCE}`, `congress=${c}`]);
    if (r.code !== 0 || !r.body?.ok) { bad += 1; log(`congress ${c} FAILED — ${String(r.body?.error ?? r.out).slice(0, 260)}`); continue; }
    const b = r.body;
    tot.rows += Number(b.inserted ?? 0) + Number(b.updated ?? 0) + Number(b.unchanged ?? 0);
    tot.chars += Number(b.chars ?? 0);
    tot.unmatched += Number(b.unmatched ?? 0);
    log(`congress ${c}: ${b.zips ?? 0} zips · ${((b.zipBytes ?? 0) / 1e6).toFixed(0)} MB · inserted ${b.inserted ?? 0} · unchanged ${b.unchanged ?? 0} · unmatched ${b.unmatched ?? 0}${b.summaries != null ? ` · summaries ${b.summaries}` : ""} · ${b.chars ? (b.chars / 1e6).toFixed(1) : 0}M chars · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  log(`${SOURCE} done: ${tot.rows.toLocaleString()} rows seen · ${(tot.chars / 1e6).toFixed(1)}M chars written · ${tot.unmatched} unmatched · ${bad} congress(es) failed`);
  process.exit(bad ? 1 : 0);
}

/* ---- state_link ---------------------------------------------------------- */

if (SOURCE === "state_link") {
  if (!ALL_STATES) {
    if (!STATE) { console.error("state_link: pass --state XX or --all-states"); process.exit(2); }
    log(`state_link: ${STATE} since ${SINCE}, batch ${BATCH}, concurrency ${CONCURRENCY}`);
    const extra = RETRY_ERRORS ? ["requeueErrors=1"] : [];
    const s = await drain(STATE, () => ["source=state_link", `state=${STATE}`, `since=${SINCE}`, `limit=${BATCH}`, `concurrency=${CONCURRENCY}`, ...extra]);
    log(`${STATE} done: ${s.considered} considered · ${s.inserted} stored · ${s.skipped} skipped · ${(s.secs / 3600).toFixed(2)} h`);
    process.exit(s.errored ? 1 : 0);
  }

  // Order by the slowest host each state owns: documents × the crawl-delay we
  // will actually be held to. Longest first, so the tail of the run is short
  // states rather than Arizona.
  const rows = await sql.query(
    `SELECT b.state, count(*)::int AS docs
       FROM "Documents" d JOIN "Bills" b ON b.bill_id = d.bill_id
       LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
      WHERE d.document_type = 'text' AND d.state_link <> '' AND b.session_id >= $1
        AND t.document_id IS NULL AND b.state NOT IN ('NY','US')
        AND d.state_link NOT LIKE '%legiscan.com%'
      GROUP BY 1 ORDER BY 2 DESC`,
    [SINCE],
  );
  const states = rows.map((r) => r.state).filter((st) => !SKIP_STATES.has(st));
  const held = rows.filter((r) => SKIP_STATES.has(r.state));
  if (held.length) log(`state_link --all-states: holding back ${held.map((r) => `${r.state} (${Number(r.docs).toLocaleString()} docs)`).join(", ")} — another job owns that host`);
  log(`state_link --all-states: ${states.length} states, ${rows.filter((r) => !SKIP_STATES.has(r.state)).reduce((n, r) => n + Number(r.docs), 0).toLocaleString()} documents outstanding, ${PARALLEL} at a time${MAX_SECONDS ? `, budget ${(MAX_SECONDS / 3600).toFixed(1)} h` : ""}`);

  let next = 0;
  const done = [];
  const worker = async () => {
    for (;;) {
      if (budgetSpent()) return;
      const st = states[next++];
      if (!st) return;
      const s = await drain(st, () => ["source=state_link", `state=${st}`, `since=${SINCE}`, `limit=${BATCH}`, `concurrency=${CONCURRENCY}`, ...(RETRY_ERRORS ? ["requeueErrors=1"] : [])]);
      done.push(s);
      log(`── ${st} finished: ${s.inserted} stored, ${s.skipped} skipped, ${(s.secs / 3600).toFixed(2)} h — ${done.length}/${states.length} states done`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(PARALLEL, states.length)) }, worker));

  const tot = done.reduce((a, s) => ({ inserted: a.inserted + s.inserted, skipped: a.skipped + s.skipped, chars: a.chars + s.chars }), { inserted: 0, skipped: 0, chars: 0 });
  const stoppedOnBudget = done.some((s) => s.budgeted) || (MAX_SECONDS && budgetSpent());
  log(`all-states ${stoppedOnBudget ? "paused on the night's budget" : "done"}: ${done.length}/${states.length} state(s) worked · ${tot.inserted} stored · ${tot.skipped} skipped · ${(tot.chars / 1e9).toFixed(2)}G chars · ${done.filter((s) => s.errored).length} ended on errors${MAX_SECONDS ? ` · ${budgetLeft()} min left` : ""}`);
  process.exit(done.some((s) => s.errored) ? 1 : 0);
}

console.error(`text-backfill: unknown --source '${SOURCE}'`);
process.exit(2);
