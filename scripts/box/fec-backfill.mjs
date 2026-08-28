#!/usr/bin/env node
// scripts/box/fec-backfill.mjs — pull OpenFEC finance for every crosswalked
// member of Congress, batch after batch, until the handler says nothing is left.
//
//   node scripts/box/fec-backfill.mjs --cycles 2026,2024 --detail basic --batch 8 --refresh 30
//   node scripts/box/fec-backfill.mjs --cycles 2026 --detail extras --batch 8
//
// `api/fec-sync.ts` holds the resume point itself: `People.fec_fetched_at` for
// basic/full, `People.fec_extras_at` for extras. Every call answers with
// `remaining` — how many members are still stale — so this driver keeps no state
// of its own and can be restarted from the top at any moment.
//
// PACING is the only reason this is a loop and not one long call. The api.data.gov
// key allows 1,000 requests an hour and a 60-request burst window; the handler
// already spaces its own calls FEC_PACE_MS (1,100 ms) apart, so the burst is
// covered, and the hourly budget is this driver's job. It measures how many
// queries the batch actually made and sleeps only for the shortfall:
//
//     want = queries × 3600 / PER_HOUR      (PER_HOUR = 950, 5% under the cap)
//     sleep = want − however long the batch already took
//
// The python driver this replaces slept `queries × 3.8 s` on top of the time the
// batch had already spent, which double-counted the handler's own 1.1 s spacing
// and held the real rate down to ~735/h. Same ceiling, a third more throughput.
//
// Failure policy, unchanged from the python: a non-2xx sleeps 60 s, or 900 s if
// the message mentions a rate limit, and twenty consecutive failures stops the
// run non-zero rather than hammering the key all night.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const CYCLES = val("--cycles", "");
const DETAIL = val("--detail", "basic");
const BATCH = Number(val("--batch", "8")) || 8;
const REFRESH = val("--refresh", "");           // empty: let the handler default (7 days)
const PER_HOUR = Number(val("--per-hour", "950")) || 950;
const MAX_ERRORS = Number(val("--max-errors", "20")) || 20;
const MAX_STALL = Number(val("--max-stall", "10")) || 10;
if (!["basic", "extras", "full"].includes(DETAIL)) { console.error(`fec-backfill: --detail must be basic|extras|full, got '${DETAIL}'`); process.exit(2); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("=");
  if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

function call() {
  return new Promise((resolve) => {
    const args = [path.join(HERE, "run-handler.mjs"), "api/fec-sync.ts", `limit=${BATCH}`, `detail=${DETAIL}`];
    if (CYCLES) args.push(`cycles=${CYCLES}`);
    if (REFRESH) args.push(`refresh=${REFRESH}`);
    let out = "";
    const c = spawn(process.execPath, args, { cwd: REPO, env: process.env });
    c.stdout.on("data", (b) => { out += b; });
    c.stderr.on("data", (b) => { out += b; });
    c.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });
}

log(`fec-backfill: detail=${DETAIL} cycles=${CYCLES || "(handler default)"} batch=${BATCH} refresh=${REFRESH || "(handler default)"} pacing=${PER_HOUR}/h`);

let errors = 0, batches = 0, totalQueries = 0, stall = 0;
let lastRemaining = Infinity;
const started = Date.now();

for (;;) {
  const t0 = Date.now();
  const r = await call();
  const elapsed = Date.now() - t0;

  if (r.code !== 0) {
    errors += 1;
    const limited = /rate limit/i.test(r.out);
    log(`batch FAILED (${errors}/${MAX_ERRORS})${limited ? " — RATE LIMIT" : ""} — ${r.out.slice(0, 300)}`);
    if (errors >= MAX_ERRORS) { log(`stopping after ${MAX_ERRORS} consecutive failures`); process.exit(1); }
    await sleep(limited ? 900_000 : 60_000);
    continue;
  }
  errors = 0;
  batches += 1;

  let body = {};
  try { body = JSON.parse(r.out.replace(/^HTTP \d+ /, "")); } catch { body = {}; }
  const queries = Number(body.queries ?? 0);
  const remaining = Number(body.remaining ?? 0);
  totalQueries += queries;
  const rate = totalQueries / Math.max(1 / 3600, (Date.now() - started) / 3_600_000);
  log(`batch ${batches}: ${queries} queries, ${(elapsed / 1000).toFixed(0)}s, remaining ${remaining} — running rate ${rate.toFixed(0)}/h`);

  if (remaining === 0) { log(`done: ${batches} batches, ${totalQueries} queries, remaining 0`); break; }

  // A batch that answers 2xx but moves nothing is a member the handler cannot
  // stamp. Left alone it would spin on the same rows all night, spending the
  // key's quota on no progress at all.
  if (remaining >= lastRemaining) {
    stall += 1;
    if (stall >= MAX_STALL) { log(`stopping: ${MAX_STALL} consecutive batches with remaining stuck at ${remaining}`); process.exit(1); }
  } else stall = 0;
  lastRemaining = remaining;

  const want = queries * 3_600_000 / PER_HOUR;
  const rest = Math.max(0, want - elapsed);
  if (rest > 0) { log(`   pacing: sleeping ${(rest / 1000).toFixed(0)}s (batch spent ${(elapsed / 1000).toFixed(0)}s of the ${(want / 1000).toFixed(0)}s ${queries} queries are worth)`); await sleep(rest); }
}
process.exit(0);
