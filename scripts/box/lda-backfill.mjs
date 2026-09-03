#!/usr/bin/env node
// scripts/box/lda-backfill.mjs — walk whole filing years of the Senate Lobbying
// Disclosure Act API to the end, resuming from the database.
//
//   node scripts/box/lda-backfill.mjs 2026 2025 2024 2023
//   node scripts/box/lda-backfill.mjs --pages 100 --from 1 2024
//
// `api/lda-sync.ts` already records its own resume point: after every non-delta
// invocation it writes "LobbyingSync" (key = `year:2026`, value = the next page,
// or "done"). So the walker holds no state of its own — it reads that row, calls
// the handler for `pages` pages, reads the `nextPage` the handler answered, and
// goes again. Kill it at any moment and the next run picks up the same page.
//
// That is the whole reason this replaces the throwaway `run-lda-all.py`: the
// python walker started every year at page 1 regardless of what was already
// banked, so restarting it re-walked thousands of pages, and two walkers given
// overlapping year lists fought each other over the same rows.
//
// Failure policy: a non-2xx sleeps 60 s and retries the SAME page — the handler
// is idempotent per filing (upsert keyed on filing uuid), so a repeat is free.
// Twenty consecutive failures is a real outage, not a blip: stop, non-zero.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon, policyUrl } from "./policy-db.mjs";
// Aurora, not Neon, since 2026-09-03 — see policy-db.mjs.
policyUrl("lda-backfill");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PAGES = Number(val("--pages", "100")) || 100;
const FROM = Number(val("--from", "0")) || 0;          // override the resume point
const MAX_ERRORS = Number(val("--max-errors", "20")) || 20;
const years = argv.filter((a) => /^\d{4}$/.test(a)).map(Number);
if (!years.length) { console.error("usage: lda-backfill.mjs [--pages N] [--from PAGE] <year> [year …]"); process.exit(2); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("=");
  if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}
if (!process.env.POLICY_DATABASE_URL) { console.error("lda-backfill: POLICY_DATABASE_URL is required"); process.exit(2); }
const sql = neon(process.env.POLICY_DATABASE_URL);

// The resume point the handler itself wrote. "done" means the year is complete.
async function resumeAt(year) {
  if (FROM) return FROM;
  const rows = await sql.query(`SELECT value FROM "LobbyingSync" WHERE key = $1`, [`year:${year}`]).catch(() => []);
  const v = rows?.[0]?.value;
  if (v === "done") return null;
  return Number(v) > 0 ? Number(v) : 1;
}

function call(year, page) {
  return new Promise((resolve) => {
    const args = [path.join(HERE, "run-handler.mjs"), "api/lda-sync.ts", `year=${year}`, `page=${page}`, `pages=${PAGES}`];
    let out = "";
    const c = spawn(process.execPath, args, { cwd: REPO, env: process.env });
    c.stdout.on("data", (b) => { out += b; });
    c.stderr.on("data", (b) => { out += b; });
    c.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });
}

let hardFail = false;
for (const year of years) {
  let page = await resumeAt(year);
  if (page === null) { log(`year ${year}: already marked done in "LobbyingSync" — nothing to walk`); continue; }
  log(`year ${year}: resuming at page ${page} (${PAGES} pages an invocation)`);
  let errors = 0;
  while (page) {
    const t0 = Date.now();
    const r = await call(year, page);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (r.code !== 0) {
      errors += 1;
      log(`year ${year} page ${page} FAILED (${errors}/${MAX_ERRORS}) after ${secs}s — ${r.out.slice(0, 300)}`);
      if (errors >= MAX_ERRORS) { log(`year ${year}: ${MAX_ERRORS} consecutive failures — stopping`); hardFail = true; break; }
      await new Promise((ok) => setTimeout(ok, 60_000));
      continue;                    // same page: the upsert makes a repeat free
    }
    errors = 0;
    // The handler's own answer is the resume point; do not infer it.
    let next = null;
    try { next = JSON.parse(r.out.replace(/^HTTP \d+ /, "")).nextPage ?? null; } catch { next = null; }
    log(`year ${year} page ${page} → ${next ?? "done"} in ${secs}s — ${r.out.slice(0, 200)}`);
    page = next;
  }
  if (hardFail) break;
  if (!hardFail) log(`year ${year}: complete`);
}
process.exit(hardFail ? 1 : 0);
