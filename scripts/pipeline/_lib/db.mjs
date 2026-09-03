#!/usr/bin/env node
// scripts/pipeline/_lib/db.mjs — the one place lane DP talks to Postgres.
//
// Three things live here so that no pipeline script has to be trusted to get
// them right on its own:
//
//   1. env loading. `.env.local` in the repo root on the laptop and box 1,
//      `~/.env.lane-in` on box 2 (lane IN put POLICY_DATABASE_URL and
//      NEW_YORK_API_KEY there). Existing environment always wins, so `run-due`
//      passing --env-file still beats a file on disk.
//
//   2. THE GUARD. Lane DP may write schema `openstates` and nothing else. That
//      is not a promise in a comment, it is a proof at connect time: search_path
//      is pinned, current_schema() is asserted, and `writeGuard()` refuses to
//      hand back a client if the session can reach a writable public."Bills".
//      Lane IN did this and it is worth keeping — the canonical tables are one
//      typo away from every INSERT in this lane.
//
//   3. `pg`, not the neon HTTP driver. Lane BT measured why: the HTTP driver
//      opens a connection per query and Neon's direct endpoint holds them idle
//      for two minutes, so a bulk load starves the whole project of connections.
//      One long-lived TCP session with multi-row INSERTs is the shape a loader
//      wants. (BT's route stays on the pooler; this one does not compete with it.)

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { policyUrl } from "../../box/policy-db.mjs";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Load KEY=VALUE files, first-writer-wins, environment beats all of them. */
export function loadEnv(extra = []) {
  const files = [path.join(REPO, ".env.local"), path.join(os.homedir(), ".env.lane-in"), ...extra];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const raw of fs.readFileSync(f, "utf8").split("\n")) {
      const s = raw.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq < 1) continue;
      const k = s.slice(0, eq).trim();
      if (process.env[k] !== undefined) continue;
      process.env[k] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** `pg` lives in the repo on the laptop and in ~/livingston on box 2. Find it either way. */
function loadPg() {
  const roots = [REPO, path.join(os.homedir(), "livingston"), process.cwd()];
  for (const r of roots) {
    try { return createRequire(path.join(r, "noop.js"))("pg"); } catch { /* next */ }
  }
  throw new Error("pg is not installed — `npm i pg` in the repo or in ~/livingston");
}

/**
 * Connect, pin search_path to openstates, and prove the pin took.
 * `allowPublicRead` is the normal case: reconcile.mjs must READ public."Bills".
 * Reading is fine; what the guard forbids is an unqualified write landing there.
 */
export async function connect({ label = "pipeline" } = {}) {
  loadEnv();
  // Aurora since 2026-09-03 (scripts/box/policy-db.mjs): a Neon URL in the
  // environment is replaced, and a box that cannot reach the secret exits 2.
  policyUrl(label);
  const dsn = process.env.POLICY_DATABASE_URL;
  if (!dsn) { console.error(`${label}: POLICY_DATABASE_URL is required`); process.exit(2); }
  const pg = loadPg();
  const c = new pg.Client({
    connectionString: dsn,
    // Aurora's certificate chain is Amazon's, not in Node's store: lane C's answer.
    ssl: /sslmode=(require|verify)/.test(dsn) ? { rejectUnauthorized: false } : undefined,
    application_name: `livingston-${label}`,
  });
  await c.connect();
  await c.query(`CREATE SCHEMA IF NOT EXISTS openstates`);
  // pg_catalog last, public NOT on the path: an unqualified INSERT cannot find
  // "Bills" even if someone writes one by accident.
  await c.query(`SET search_path TO openstates, pg_catalog`);
  const { rows } = await c.query(`SELECT current_schema() AS s`);
  if (rows[0].s !== "openstates") throw new Error(`search_path resolved to ${rows[0].s}, refusing to run`);
  return c;
}

/**
 * Insert rows in chunks with a fixed column list. Returns rows offered, not written.
 *
 * `key` collapses duplicates BEFORE the statement is built. Postgres refuses
 * "ON CONFLICT ... DO UPDATE" when one statement proposes the same constrained
 * value twice — *"cannot affect row a second time"* — and a scraper's output
 * routinely contains a bill listing the same sponsor twice. Lane BT hit the
 * identical wall writing "BillTexts". Deduping in the caller would mean every
 * caller remembering to; deduping here means none of them has to.
 */
export async function insertRows(c, table, cols, rows, { conflict = "DO NOTHING", chunk = 400, key = null } = {}) {
  if (!rows.length) return 0;
  if (key) {
    const seen = new Map();
    for (const r of rows) seen.set(key(r), r);   // last writer wins, as an upsert would
    rows = [...seen.values()];
  }
  const n = cols.length;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const ph = part.map((_, j) => "(" + cols.map((__, k) => `$${j * n + k + 1}`).join(",") + ")").join(",");
    const vals = [];
    for (const r of part) for (const col of cols) vals.push(r[col] === undefined ? null : r[col]);
    await c.query(`INSERT INTO openstates.${table} (${cols.join(",")}) VALUES ${ph} ON CONFLICT ${conflict}`, vals);
  }
  return rows.length;
}

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
