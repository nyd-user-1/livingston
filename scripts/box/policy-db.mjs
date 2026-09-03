#!/usr/bin/env node
// scripts/box/policy-db.mjs — the one place a box job learns where the policy
// database is, and the one driver it uses to get there.
//
// Aurora has been the database the site reads since 2026-09-01. Until
// 2026-09-03 every nightly on box 1 (the lv-* jobs) and the weekly dp-* jobs
// on box 2 still wrote Neon — POLICY_DATABASE_URL in each box's .env.local —
// so the site showed the same twelve Congress bills for three days while Neon
// took deltas nobody read. Two things end that, both here:
//
//   1. policyUrl(): resolve the Aurora URL — AURORA_POLICY_URL if the shell
//      sourced ~/.govblock/aurora.env, else the cluster's own MasterUserSecret
//      through the aws CLI (both box roles hold rds:DescribeDBClusters and
//      secretsmanager:GetSecretValue for exactly that secret; the password
//      rotates every 7 days, which is why it is never a value in a file). The
//      answer is exported as POLICY_DATABASE_URL so code reading that name
//      works unchanged. A Neon URL already in the environment is NOT used: a
//      job that writes the database the site does not read looks like success
//      in every log, and that is the failure this file exists to end.
//      NEON_OK=1 keeps the given URL — for the laptop, and for nothing else.
//
//   2. neon(url): the Neon HTTP driver's surface — sql`…`, sql.query(text,
//      params), sql.transaction([…]) — on `pg`. The HTTP driver speaks only to
//      Neon's proxy; Aurora is plain Postgres on a private endpoint. Dates and
//      timestamps come back as the strings the HTTP driver returned rather than
//      Date objects, so a handler comparing last_action_date sees what it
//      always saw. run-handler.mjs aliases "@neondatabase/serverless" to this
//      file when it bundles an api/ handler; the .mjs box scripts import it.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOOKS_LIKE_URL = /^postgres(?:ql)?:\/\/[^:@/]+:[^@]+@[^@/:]+/;

export function auroraUrlFromSecret() {
  const region = process.env.AWS_REGION || "us-east-1";
  const cluster = process.env.AURORA_CLUSTER_ID || "aurora-2525";
  const aws = (args) => execFileSync("aws", [...args, "--region", region], { encoding: "utf8" }).trim();
  const arn = aws(["rds", "describe-db-clusters", "--db-cluster-identifier", cluster, "--query", "DBClusters[0].MasterUserSecret.SecretArn", "--output", "text"]);
  const host = aws(["rds", "describe-db-clusters", "--db-cluster-identifier", cluster, "--query", "DBClusters[0].Endpoint", "--output", "text"]);
  const secret = JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", arn, "--query", "SecretString", "--output", "text"]));
  const db = process.env.POLICY_DATABASE || "policy";
  return `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${db}?sslmode=require`;
}

let resolved = null;

/** The URL every box job writes. Aurora, or exit 2 — never Neon by accident. */
export function policyUrl(label = "policy-db") {
  if (resolved) return resolved;
  const given = process.env.POLICY_DATABASE_URL || "";
  if (given && (process.env.NEON_OK === "1" || !/neon\.tech/.test(given))) {
    resolved = given;
    return resolved;
  }
  const staged = process.env.AURORA_POLICY_URL;
  let url = staged && LOOKS_LIKE_URL.test(staged) ? staged : null;
  if (!url) {
    try { url = auroraUrlFromSecret(); }
    catch (e) { console.error(`${label}: could not resolve Aurora credentials — ${String(e.message).slice(0, 160)}`); }
  }
  if (!url) {
    console.error(`${label}: no Aurora credentials — source ~/.govblock/aurora.env, or give the box rds:DescribeDBClusters + secretsmanager:GetSecretValue on aurora-2525. Not falling back to Neon: the site does not read it.`);
    process.exit(2);
  }
  if (given) console.error(`${label}: POLICY_DATABASE_URL pointed at Neon; writing Aurora instead`);
  process.env.POLICY_DATABASE_URL = url;
  resolved = url;
  return url;
}

/* ---- the driver ---------------------------------------------------------- */

/** `pg` lives in the repo on the laptop and in ~/livingston on a box. */
function loadPg() {
  const roots = [REPO, path.join(os.homedir(), "livingston"), process.cwd()];
  for (const r of roots) {
    try { return createRequire(path.join(r, "noop.js"))("pg"); } catch { /* next */ }
  }
  throw new Error("pg is not installed — `npm i pg` in the repo or in ~/livingston");
}

/** URL → pg config; lane C's parse, so Aurora's sslmode=require is honoured without a CA file. */
function pgConfig(url) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/);
  if (!m) throw new Error("POLICY_DATABASE_URL is not a postgres URL");
  const [, user, pw, host, port, database, query] = m;
  return {
    user: decodeURIComponent(user),
    password: decodeURIComponent(pw),
    host,
    port: Number(port || 5432),
    database,
    ssl: /sslmode=(require|verify|no-verify)/.test(query ?? "") || /neon\.tech/.test(host) ? { rejectUnauthorized: false } : undefined,
    application_name: "livingston-box",
    max: 4,
    idleTimeoutMillis: 1000,
    allowExitOnIdle: true,
  };
}

const pools = new Map();
function poolFor(url) {
  let pool = pools.get(url);
  if (!pool) {
    const pg = loadPg();
    // date, timestamp, timestamptz: strings, as the HTTP driver returned them.
    for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v) => v);
    pool = new pg.Pool(pgConfig(url));
    pools.set(url, pool);
  }
  return pool;
}

function compile(strings, values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
  return { text, params: values };
}

export const neonConfig = {};

/**
 * neon(url) → sql. sql`…` and sql(text, params) return a lazy query — a
 * thenable that runs when awaited and remembers its text, which is what lets
 * sql.transaction([sql`a`, sql`b`]) replay them inside BEGIN … COMMIT the way
 * the HTTP driver did. sql.query(text, params) is the same lazy query. All
 * return rows.
 */
export function neon(url) {
  const pool = poolFor(url);
  const run = async (client, text, params) => (await client.query(text, params)).rows;
  const lazy = (text, params) => {
    let started = null;
    const q = {
      text,
      params,
      then(onFulfilled, onRejected) {
        started ??= run(pool, text, params);
        return started.then(onFulfilled, onRejected);
      },
      catch(onRejected) { return q.then(undefined, onRejected); },
      finally(fn) { return q.then((v) => { fn(); return v; }, (e) => { fn(); throw e; }); },
    };
    return q;
  };
  const sql = (strings, ...values) => {
    if (Array.isArray(strings) && "raw" in strings) {
      const { text, params } = compile(strings, values);
      return lazy(text, params);
    }
    return lazy(String(strings), values[0] ?? []);
  };
  // Lazy too: the HTTP driver's query() ran only when awaited, and the
  // handlers build transactions as [sql.query(…), sql.query(…)].
  sql.query = (text, params = []) => lazy(text, params);
  sql.unsafe = (text) => lazy(text, []);
  sql.transaction = async (queries) => {
    const list = typeof queries === "function" ? queries(sql) : queries;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = [];
      for (const q of list) out.push(await run(client, q.text, q.params));
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };
  sql.end = () => pool.end();
  return sql;
}
