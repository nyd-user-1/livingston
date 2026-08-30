#!/usr/bin/env node
// scripts/box/text-backfill.mjs — drive api/bill-text.ts until a source is done.
//
//   node scripts/box/text-backfill.mjs --source nysenate [--session 2025] [--batch 200]
//   node scripts/box/text-backfill.mjs --source govinfo --all-congresses
//   node scripts/box/text-backfill.mjs --source govinfo-billsum --all-congresses
//   node scripts/box/text-backfill.mjs --source govinfo --congress 119
//   node scripts/box/text-backfill.mjs --source state_link --state TX [--since-session 2023]
//   node scripts/box/text-backfill.mjs --source state_link --all-states [--parallel 4] [--max-seconds 14400]
//   node scripts/box/text-backfill.mjs --source state_link --all-states --only-states NM,MT,ND   # a second box's share
//   node scripts/box/text-backfill.mjs --source state_link --bill-ids ids.txt   # exactly these, any session
//   node scripts/box/text-backfill.mjs --source nysenate-bulk                   # 1,000 bills a request
//   node scripts/box/text-backfill.mjs --source ca-pubinfo --session 2025      # one pubinfo_<year>.zip
//   node scripts/box/text-backfill.mjs --source tx-ftp --all-sessions [--ftp-connections 2]   # Texas from the FTP mirror
//   node scripts/box/text-backfill.mjs --source va-lis [--batch 2000] [--api-parallel 8]      # Virginia 2026 via the LIS API (VA_LIS_API_KEY)
//   node scripts/box/text-backfill.mjs --source ma-api [--batch 2000] [--api-parallel 12]     # Massachusetts via malegislature.gov/api
//   node scripts/box/text-backfill.mjs --source ca-pubinfo --all-sessions --since-session 2009
//   node scripts/box/text-backfill.mjs --source ca-pubinfo --session 2025 --zip pubinfo_Sat.zip --sample 5 --keep   # the cheap test
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
// The mirror image, for a SECOND box: --all-states restricted to exactly these.
// Two boxes may walk at once only on disjoint state sets — one connection per
// host is the rule, and a state's hosts are its own — so box 1 --skip-states
// what box 2 --only-states, and the two lists are the same list.
const ONLY_STATES = new Set(val("--only-states").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));
// A file of bill_ids, one per line: fetch text for exactly these, any session.
// Built for lane MB's curated CPI matches, which are 2003-2019 and therefore
// invisible to a walk scoped at session_id >= 2023.
const BILL_IDS = val("--bill-ids");
// --shard i/k: this box takes documents whose id % k = i. A fleet of k boxes,
// one per public IP, covers everything exactly once with no coordination but
// the database. (Brendan, 2026-08-29: "run 4 per instance for as many
// instances as you can … different IPs.")
const SHARD = val("--shard", "");

if (!SOURCE) { console.error("usage: text-backfill.mjs --source nysenate|govinfo|state_link|ca-pubinfo [...]"); process.exit(2); }

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
    // Pass the child's progress through to OUR stdout as it arrives, instead of
    // swallowing it until the call returns. A handler that prints one line a page
    // is useless if the driver holds every line for ninety minutes — which is
    // exactly what happened, and it cost two misdiagnoses of the same job: once
    // "out of memory" (it was not; RSS peaked at 262 MB of a 3 GB heap) and once
    // "stalled" (row counts do not move when every page is `unchanged`). The
    // final `HTTP <n> {…}` line is held back because the driver reports it itself.
    let pending = "";
    const passThrough = (chunk) => {
      out += chunk;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim() && !/^HTTP \d+ /.test(l.trim())) console.log(`   | ${l}`);
    };
    child.stdout.on("data", (b) => passThrough(String(b)));
    child.stderr.on("data", (b) => passThrough(String(b)));
    child.on("close", (code) => {
      // The LAST `HTTP <n> {...}` line, not the whole of stdout. Handlers are
      // allowed to print progress before their answer — the bulk NY run does,
      // deliberately, so a ninety-minute job is distinguishable from a hung one —
      // and parsing the entire stream as JSON turned a healthy run into
      // "(unparseable answer)" and then into a failed job.
      let body = null;
      const lines = out.trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const m = /^HTTP \d+ (\{.*)$/.exec(lines[i].trim());
        if (!m) continue;
        try { body = JSON.parse(m[1]); } catch { body = null; }
        break;
      }
      if (!quiet && body === null) log(`   (no parseable HTTP answer) ${out.trim().slice(-300)}`);
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

if (SOURCE === "nysenate-bulk") {
  log(`nysenate-bulk: every NY session, 1,000 bills a request`);
  const t0 = Date.now();
  const r = await call(["source=nysenate-bulk", ...(SESSION ? [`session=${SESSION}`] : [])]);
  if (r.code !== 0 || !r.body?.ok) { log(`FAILED — ${String(r.body?.error ?? r.out).slice(0, 300)}`); process.exit(1); }
  const b = r.body;
  log(`nysenate-bulk done: ${b.sessions} session(s) · ${b.pages} pages · ${b.queries} requests · ${b.bills} bills · ${b.inserted} versions stored · ${b.memos} memos · ${b.unchanged} unchanged · ${b.unmatched} unmatched · ${((b.chars ?? 0) / 1e6).toFixed(1)}M chars · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  process.exit(0);
}

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

/* ---- ca-pubinfo ---------------------------------------------------------- */

if (SOURCE === "ca-pubinfo") {
  // One zip per two-year session, addressed by its first year. --all-sessions
  // takes the sessions we hold bills for; the zips exist back to 1989.
  let sessions = [];
  if (has("--all-sessions")) {
    const rows = await sql.query(`SELECT DISTINCT session_id FROM "Bills" WHERE state = 'CA' AND session_id >= $1 ORDER BY 1 DESC`, [SINCE]);
    sessions = rows.map((r) => Number(r.session_id));
  } else if (SESSION) sessions = [Number(SESSION)];
  else { console.error("ca-pubinfo: pass --session YYYY or --all-sessions [--since-session 2009]"); process.exit(2); }
  const extra = [];
  if (val("--cache")) extra.push(`cache=${path.resolve(val("--cache"))}`);
  if (val("--zip")) extra.push(`zip=${val("--zip")}`);
  if (val("--sample")) extra.push(`sample=${val("--sample")}`);
  if (has("--keep")) extra.push("keep=1");
  log(`ca-pubinfo: ${sessions.length} session(s) — ${sessions.join(" ")}${extra.length ? ` (${extra.join(" ")})` : ""}`);
  const tot = { versions: 0, bills: 0, chars: 0, real: 0, synthetic: 0, unmatched: 0 };
  let bad = 0;
  for (const s of sessions) {
    if (budgetSpent()) { log("ca-pubinfo: the budget is spent — stopping between sessions"); break; }
    const t0 = Date.now();
    const r = await call([`source=ca-pubinfo`, `session=${s}`, ...extra]);
    if (r.code !== 0 || !r.body?.ok) { bad += 1; log(`session ${s} FAILED — ${String(r.body?.error ?? r.out).slice(0, 260)}`); continue; }
    const b = r.body;
    tot.versions += b.versions ?? 0; tot.bills += b.bills ?? 0; tot.chars += b.chars ?? 0;
    tot.real += b.realIds ?? 0; tot.synthetic += b.syntheticIds ?? 0; tot.unmatched += b.unmatched ?? 0;
    log(`session ${s}: ${((b.zipBytes ?? 0) / 1e6).toFixed(0)} MB${b.zipCached ? " (cached)" : ""} · ${b.versionsInDump ?? 0} versions in dump · ${b.versions ?? 0} written for ${b.bills ?? 0} bills · real ids ${b.realIds ?? 0} · synthetic ${b.syntheticIds ?? 0} · unmatched ${b.unmatched ?? 0} · inserted ${b.inserted ?? 0} · updated ${b.updated ?? 0} · unchanged ${b.unchanged ?? 0} · lob missing ${b.lobMissing ?? 0} · malformed ${b.malformedRows ?? 0} · ${((b.chars ?? 0) / 1e6).toFixed(1)}M chars · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  log(`ca-pubinfo done: ${tot.versions.toLocaleString()} versions · ${tot.bills.toLocaleString()} bills · ${(tot.chars / 1e6).toFixed(1)}M chars · real ${tot.real} / synthetic ${tot.synthetic} · unmatched ${tot.unmatched} · ${bad} session(s) failed`);
  process.exit(bad ? 1 : 0);
}

/* ---- tx-ftp -------------------------------------------------------------- */

if (SOURCE === "tx-ftp") {
  // Sessions are TLO codes (88R, 883). --all-sessions reads them off our own
  // "Documents" links, most outstanding first, so nothing is guessed.
  let sessions = [];
  if (has("--all-sessions")) {
    const rows = await sql.query(
      `SELECT substring(d.state_link from 'tlodocs/([0-9A-Z]+)/') AS s, count(*)::int AS n
         FROM "Documents" d JOIN "Bills" b ON b.bill_id = d.bill_id LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
        WHERE b.state = 'TX' AND d.document_type = 'text' AND t.document_id IS NULL AND b.session_id >= $1 AND d.state_link LIKE '%/billtext/html/%'
        GROUP BY 1 ORDER BY 2 DESC`, [SINCE]);
    sessions = rows.map((r) => r.s).filter(Boolean);
  } else if (SESSION) sessions = [SESSION.toUpperCase()];
  else { console.error("tx-ftp: pass --session 88R or --all-sessions [--since-session 2009]"); process.exit(2); }
  const par = val("--ftp-connections", "2");
  log(`tx-ftp: ${sessions.length} session(s) — ${sessions.join(" ")} · batch ${BATCH} · ${par} FTP connection(s)`);
  let errored = false;
  for (const s of sessions) {
    if (budgetSpent()) { log("tx-ftp: budget spent — stopping between sessions"); break; }
    const r = await drain(`TX ${s}`, () => ["source=tx-ftp", `session=${s}`, `limit=${BATCH}`, `parallel=${par}`]);
    log(`── TX ${s} finished: ${r.inserted} stored · ${r.skipped} skipped · ${(r.secs / 3600).toFixed(2)} h`);
    if (r.errored) errored = true;
  }
  process.exit(errored ? 1 : 0);
}

/* ---- va-lis -------------------------------------------------------------- */

if (SOURCE === "va-lis") {
  if (!process.env.VA_LIS_API_KEY) { console.error("va-lis: VA_LIS_API_KEY is required (https://lis.virginia.gov/apiregistration)"); process.exit(2); }
  const par = val("--api-parallel", "8");
  log(`va-lis: Virginia 2026 documents through the LIS API · batch ${BATCH} · ${par} in flight`);
  const s = await drain("VA lis", () => ["source=va-lis", `limit=${BATCH}`, `parallel=${par}`]);
  log(`va-lis done: ${s.considered} considered · ${s.inserted} stored · ${(s.secs / 60).toFixed(1)} min`);
  process.exit(s.errored ? 1 : 0);
}

/* ---- ma-api -------------------------------------------------------------- */

if (SOURCE === "ma-api") {
  const par = val("--api-parallel", "12");
  log(`ma-api: Massachusetts through malegislature.gov/api · batch ${BATCH} · ${par} in flight`);
  const s = await drain("MA api", () => ["source=ma-api", `limit=${BATCH}`, `parallel=${par}`]);
  log(`ma-api done: ${s.considered} considered · ${s.inserted} stored · ${(s.secs / 60).toFixed(1)} min`);
  process.exit(s.errored ? 1 : 0);
}

/* ---- state_link ---------------------------------------------------------- */

if (SOURCE === "state_link") {
  if (BILL_IDS) {
    if (!fs.existsSync(BILL_IDS)) { console.error(`state_link: no such --bill-ids file: ${BILL_IDS}`); process.exit(2); }
    const n = fs.readFileSync(BILL_IDS, "utf8").split("\n").filter((l) => Number(l.trim()) > 0).length;
    log(`state_link: ${n} named bill_ids from ${BILL_IDS}, any session, batch ${BATCH}, concurrency ${CONCURRENCY}`);
    const s = await drain("bill-ids", () => ["source=state_link", `billIdsFile=${path.resolve(BILL_IDS)}`, `limit=${BATCH}`, `concurrency=${CONCURRENCY}`]);
    log(`bill-ids done: ${s.considered} considered · ${s.inserted} stored · ${s.skipped} skipped · ${(s.secs / 60).toFixed(1)} min`);
    process.exit(s.errored ? 1 : 0);
  }

  if (!ALL_STATES) {
    if (!STATE) { console.error("state_link: pass --state XX, --all-states or --bill-ids <file>"); process.exit(2); }
    log(`state_link: ${STATE} since ${SINCE}, batch ${BATCH}, concurrency ${CONCURRENCY}`);
    const extra = RETRY_ERRORS ? ["requeueErrors=1"] : [];
    const s = await drain(STATE, () => ["source=state_link", `state=${STATE}`, `since=${SINCE}`, `limit=${BATCH}`, `concurrency=${CONCURRENCY}`, ...(SHARD ? [`shard=${SHARD}`] : []), ...extra]);
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
  const states = rows.map((r) => r.state).filter((st) => !SKIP_STATES.has(st) && (ONLY_STATES.size === 0 || ONLY_STATES.has(st)));
  const held = rows.filter((r) => SKIP_STATES.has(r.state));
  if (held.length) log(`state_link --all-states: holding back ${held.map((r) => `${r.state} (${Number(r.docs).toLocaleString()} docs)`).join(", ")} — another job owns that host`);
  log(`state_link --all-states: ${states.length} states, ${rows.filter((r) => !SKIP_STATES.has(r.state)).reduce((n, r) => n + Number(r.docs), 0).toLocaleString()} documents outstanding, ${PARALLEL} at a time${MAX_SECONDS ? `, budget ${(MAX_SECONDS / 3600).toFixed(1)} h` : ""}${SHARD ? ` · shard ${SHARD}` : ""}`);

  let next = 0;
  const done = [];
  const worker = async () => {
    for (;;) {
      if (budgetSpent()) return;
      const st = states[next++];
      if (!st) return;
      const s = await drain(st, () => ["source=state_link", `state=${st}`, `since=${SINCE}`, `limit=${BATCH}`, `concurrency=${CONCURRENCY}`, ...(SHARD ? [`shard=${SHARD}`] : []), ...(RETRY_ERRORS ? ["requeueErrors=1"] : [])]);
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
