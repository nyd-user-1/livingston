#!/usr/bin/env node
// scripts/pipeline/scrape.mjs — run one mirrored Open States scraper, politely, ours.
//
//   node scripts/pipeline/scrape.mjs nj --session 222
//   node scripts/pipeline/scrape.mjs tx
//   node scripts/pipeline/scrape.mjs --batch nj,tx,il,mn --minutes 25
//
// The engine for the 40-odd states with no usable feed is Open States' scrapers,
// which we mirrored (GPL-3.0) and run on our own box. This is the driver, and it
// deliberately owns almost nothing:
//
//   * POLITENESS IS NOT TUNABLE HERE. The scrapers' own rate limits stand —
//     --rpm, --fastmode and --retries are never passed. If a state is slow, that
//     is the honest price of scraping it.
//   * THE SECRET NEVER REACHES A LOG. It shells out to ~/bin/os-scrape, lane
//     IN's wrapper, which runs the ARM image and redacts `key=` out of the
//     container's stdout — because openstates' own NY scraper logs the full
//     request URL, API key included, at INFO (lane IN's F3, SCRAPER-DOCTRINE #1).
//   * A SCRAPE THAT PRODUCED NOTHING IS A FAILURE. The container can exit 0 with
//     an empty output directory when a legislature redesigns its site; Open
//     States' own base class raises on it (SCRAPER-DOCTRINE §0) and so does this.
//     ~27% of jurisdictions filed a "scraper broken" issue in the last 90 days
//     and ~9% produced nothing at all, so this is the common case, not the edge.
//
// Output stays as the scrapers' native JSON in ~/cache/os-data/<juris>/, which
// is what load.mjs reads.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { connect, insertRows, log } from "./_lib/db.mjs";
import { prepareSchema } from "./_lib/schema.mjs";

const argv = process.argv.slice(2);
const val = (f, d = "") => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);

const CACHE = val("--out", join(os.homedir(), "cache", "os-data"));
const WRAPPER = join(os.homedir(), "bin", "os-scrape");
const IMAGE = val("--image", "openstates/scrapers:arm64-local");
const MINUTES = Number(val("--minutes", "0")) || 0;      // per-jurisdiction wall-clock cap
const SESSION = val("--session");
const FRESH = has("--fresh");

const batch = val("--batch");
const jurisdictions = batch
  ? batch.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))).map((s) => s.toLowerCase());

if (!jurisdictions.length) { console.error("usage: scrape.mjs <juris> [--session <id>] [--minutes N] | --batch a,b,c"); process.exit(2); }

const countJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("bill_") && f.endsWith(".json")).length : 0);
const bytesOf = (dir) => (existsSync(dir) ? readdirSync(dir).reduce((n, f) => { try { return n + statSync(join(dir, f)).size; } catch { return n; } }, 0) : 0);

/**
 * Run a child with a wall-clock budget that actually stops it.
 *
 * Two things had to be right and neither was, first time:
 *
 *   1. DETACHED + KILL THE PROCESS GROUP. ~/bin/os-scrape is a bash wrapper
 *      around `docker run`. SIGTERM to bash alone killed the wrapper and left
 *      the container running — measured: the tn wrapper was gone while its
 *      `docker run` had been alive 1,211 s past a 1,200 s budget. Spawning
 *      detached puts the wrapper and its docker child in one process group, and
 *      kill(-pid) reaches both. SIGKILL follows if SIGTERM is ignored.
 *   2. RESOLVE ON `exit`, NOT `close`. `close` waits for every stdio pipe to
 *      end, and the ORPHANED container still held stdout — so the driver sat
 *      there believing the job was running long after it had been killed, and
 *      never moved to the next state. `exit` fires when the process does.
 */
function run(cmd, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "", err = "", killed = false, done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code, out, err, killed, seconds: (Date.now() - t0) / 1000 });
    };
    const killGroup = (sig) => { try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch { /* gone */ } } };
    const timer = timeoutMs ? setTimeout(() => {
      killed = true;
      killGroup("SIGTERM");
      // A container that ignores SIGTERM gets 20 s, then the group is killed
      // outright. A budget that can be ignored is not a budget.
      setTimeout(() => { if (!done) killGroup("SIGKILL"); }, 20_000).unref();
    }, timeoutMs) : null;
    p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    p.stderr.on("data", (d) => { err += d; process.stderr.write(d); });
    p.on("exit", (code, sig) => finish(code == null ? (sig ? 143 : 1) : code));
    p.on("error", (e) => { err += String(e.message); finish(127); });
  });
}

const results = [];
let rc = 0;

for (const juris of jurisdictions) {
  const dir = join(CACHE, juris);
  if (FRESH && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const before = countJson(dir);

  const args = [juris, "bills"];
  if (SESSION) args.push("--session", SESSION);

  let r;
  if (existsSync(WRAPPER)) {
    log(`${juris}: scraping via ${WRAPPER} (scrapers' own rate limits, no overrides)`);
    r = await run(WRAPPER, args, { timeoutMs: MINUTES * 60_000 });
  } else {
    // Same container, same mounts, same redaction absent — kept only so the
    // driver is runnable where lane IN's wrapper is not installed.
    log(`${juris}: ${WRAPPER} not found, running the image directly`);
    r = await run("docker", ["run", "--rm",
      "-v", `${CACHE}:/opt/openstates/openstates/_data`,
      "-v", `${join(os.homedir(), "cache", "os-cache")}:/opt/openstates/openstates/_cache`,
      IMAGE, juris, "bills", "--scrape", ...(SESSION ? ["--session", SESSION] : [])],
      { timeoutMs: MINUTES * 60_000 });
  }

  const after = countJson(dir);
  const produced = after - before;
  const rec = { jurisdiction: juris, exit: r.code, killed_on_budget: r.killed, seconds: Number(r.seconds.toFixed(1)),
    bill_files_before: before, bill_files_after: after, produced, megabytes: Number((bytesOf(dir) / 1e6).toFixed(1)) };

  // A scrape is judged on OUTPUT, not on the exit code. Both have to be right.
  if (after === 0) {
    rec.verdict = "failed";
    rec.error = (r.err || r.out).split("\n").filter((l) => /error|Error|Traceback|refused|403|404|429/.test(l)).slice(-3).join(" | ").slice(0, 400)
      || `container exited ${r.code} with no bill_*.json in ${dir}`;
    rc = 1;
    log(`${juris}: FAILED — no bills produced (exit ${r.code}, ${rec.seconds}s)`);
  } else if (r.code !== 0 && !r.killed) {
    rec.verdict = "partial";
    log(`${juris}: PARTIAL — ${after} bill files but exit ${r.code} (${rec.seconds}s)`);
  } else {
    rec.verdict = r.killed ? "partial" : "ok";
    log(`${juris}: ${rec.verdict} — ${after} bill files (+${produced}), ${rec.megabytes} MB, ${rec.seconds}s`);
  }
  results.push(rec);
}

/* A scraper that produced nothing is a fact about that jurisdiction, and facts
 * belong in the ledger rather than in a log nobody reads. Without this,
 * docs/PIPELINE.md shows California, Georgia and Pennsylvania as "not yet run"
 * — which is exactly wrong: they were run, and they failed, for three different
 * reasons worth telling apart. Written as verdict='failed' with the error, so
 * the generated doc carries the reason next to the state. */
const failures = results.filter((r) => r.verdict === "failed");
if (failures.length) {
  try {
    const c = await connect({ label: "scrape" });
    await prepareSchema(c);
    for (const f of failures) {
      await c.query(
        `INSERT INTO openstates.pipeline_reconcile (state, session, source, verdict, bills_theirs, notes)
         VALUES ($1, $2, 'openstates', 'failed', 0, $3)`,
        [f.jurisdiction.toUpperCase(), "(scrape)", `scrape failed after ${f.seconds}s: ${f.error ?? "no bills produced"}`]);
    }
    await c.end();
    log(`recorded ${failures.length} scrape failure(s) in openstates.pipeline_reconcile`);
  } catch (e) {
    // Never let the ledger write mask the scrape result it is reporting on.
    log(`could not record scrape failures: ${e.message}`);
  }
}

console.log(JSON.stringify(results, null, 1));
process.exit(rc);
