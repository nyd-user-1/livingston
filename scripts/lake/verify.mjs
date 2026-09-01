#!/usr/bin/env node
// scripts/lake/verify.mjs — the §5 acceptance check. This is the job, not a
// formality: the point of the night is a copy you can PROVE is complete,
// because a later decision (slimming Neon) depends on it.
//
//   node scripts/lake/verify.mjs                 # every table with a manifest
//   node scripts/lake/verify.mjs --table bills
//   node scripts/lake/verify.mjs --keys 100      # round-trip sample size
//
// For every table:
//   1. count(*) in Neon vs count(*) over the Parquet via DuckDB. Exact match.
//   2. N random primary keys round-trip identically, field for field.
//   3. lake/v1/_manifest/index.json reconciles against the per-table manifests.
//
// A mismatch is reported, never repaired silently.

import process from "node:process"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { BUCKET, LAKE, REGION, REPO, connect, qualify } from "./_lib.mjs"

const s3 = new S3Client({ region: REGION })
const args = process.argv.slice(2)
const flag = (n, d = null) => (args.indexOf(n) >= 0 ? (args[args.indexOf(n) + 1] ?? d) : d)
const ONLY = flag("--table")
const KEYS = Number(flag("--keys", "100"))

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")
const log = (...m) => console.log(`${now()} ${m.join(" ")}`)

function duck(sql) {
  const out = execFileSync("python3", [path.join(REPO, "scripts/lake/duck.py"), sql], {
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-east-1" },
  })
  return JSON.parse(out.toString())
}

async function getJson(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return JSON.parse(await out.Body.transformToString())
}

async function listManifests() {
  const keys = []
  let token
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: `${LAKE}/_manifest/`, ContinuationToken: token,
    }))
    for (const o of page.Contents ?? []) {
      // Skip the progress records and index.json itself.
      if (o.Key.includes("/_progress/")) continue
      if (o.Key.endsWith("/index.json")) continue
      if (o.Key.endsWith(".json")) keys.push(o.Key)
    }
    token = page.NextContinuationToken
  } while (token)
  return keys
}

/** Compare one field from Neon against the same field read back from Parquet. */
function same(a, b, type) {
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  switch (type) {
    case "DOUBLE":
    case "FLOAT": {
      const x = Number(a), y = Number(b)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return String(a) === String(b)
      return Math.abs(x - y) <= Math.max(1e-9, Math.abs(x) * 1e-9)
    }
    case "TIMESTAMP": {
      const x = new Date(a).getTime()
      // DuckDB hands back a naive ISO string in UTC; Date parses it as local
      // unless it is marked, so mark it.
      const y = new Date(/[Z+]|-\d\d:\d\d$/.test(b) ? b : b + "Z").getTime()
      return x === y
    }
    case "LIST_FLOAT": {
      const x = Array.isArray(a) ? a : JSON.parse(String(a).replace(/^\[|\]$/g, "[$&]").replace(/^\[\[/, "[").replace(/\]\]$/, "]"))
      const y = Array.isArray(b) ? b : []
      if (x.length !== y.length) return false
      return x.every((v, i) => Math.abs(Number(v) - Number(y[i])) < 1e-5)
    }
    case "BOOLEAN":
      return Boolean(a) === Boolean(b)
    default:
      return String(a) === String(b)
  }
}

async function verifyTable(db, manifest) {
  const { table, domain, source_table } = manifest
  const glob = `s3://${BUCKET}/${LAKE}/${domain}/${table}/**/*.parquet`
  const result = { table, domain, checks: {}, problems: [] }

  // --- 1. counts -----------------------------------------------------------
  const [, schema, name] = source_table.match(/^(\w+)\."(.+)"$/) ?? []
  const { rows: [{ n }] } = await db.query(`select count(*)::bigint as n from ${qualify(schema, name)}`)
  const neon = Number(n)
  let lake = null
  try {
    lake = Number(duck(`select count(*) as n from read_parquet('${glob}')`)[0].n)
  } catch (e) {
    result.problems.push(`duckdb could not read ${glob}: ${String(e.message).split("\n")[0]}`)
  }
  result.checks.neon_rows = neon
  result.checks.lake_rows = lake
  result.checks.manifest_rows = manifest.neon_row_count
  result.checks.counts_match = lake === neon && manifest.lake_row_count === lake
  if (!result.checks.counts_match) {
    result.problems.push(`count mismatch — neon ${neon}, lake ${lake}, manifest ${manifest.lake_row_count}`)
  }

  // --- 2. round-trip N random primary keys ---------------------------------
  const pkRow = await db.query(
    `select a.attname
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace ns on ns.oid = c.relnamespace
       join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      where con.contype = 'p' and ns.nspname = $1 and c.relname = $2
      order by k.ord`,
    [schema, name]
  )
  const pk = pkRow.rows.map((r) => r.attname)
  result.checks.pk = pk

  if (!pk.length) {
    result.checks.round_trip = "skipped — no primary key"
  } else if (lake === null || neon === 0) {
    result.checks.round_trip = "skipped — nothing to compare"
  } else {
    // Columns present in both sides: the manifest schema minus derived columns
    // (which have no Neon counterpart) and minus anything omitted by rule.
    const derived = new Set(Object.keys(manifest.derived_columns ?? {}))
    const cols = manifest.schema.filter(([c]) => !derived.has(c))
    const sample = await db.query(
      `select ${cols.map(([c]) => `"${c.replaceAll('"', '""')}"`).join(", ")}
         from ${qualify(schema, name)} order by random() limit ${KEYS}`
    )
    const rows = sample.rows
    if (!rows.length) {
      result.checks.round_trip = "skipped — no rows sampled"
    } else {
      const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`)
      const pred = rows
        .map((r) => "(" + pk.map((k) => `cast("${k}" as varchar) is not distinct from ${lit(r[k])}`).join(" and ") + ")")
        .join(" or ")
      const back = duck(
        `select ${cols.map(([c]) => `"${c}"`).join(", ")} from read_parquet('${glob}') where ${pred}`
      )
      const keyOf = (r) => pk.map((k) => String(r[k] ?? "")).join("\u0001")
      const byKey = new Map(back.map((r) => [keyOf(r), r]))

      let matched = 0
      const diffs = []
      for (const r of rows) {
        const got = byKey.get(keyOf(r))
        if (!got) { diffs.push(`${keyOf(r)}: missing from the lake`); continue }
        const bad = cols.filter(([c, t]) => !same(r[c], got[c], t)).map(([c]) => c)
        if (bad.length) diffs.push(`${keyOf(r)}: ${bad.join(", ")}`)
        else matched++
      }
      result.checks.round_trip = `${matched}/${rows.length} keys identical field-for-field`
      if (diffs.length) {
        result.problems.push(`round-trip: ${diffs.length} of ${rows.length} keys differ`)
        result.checks.round_trip_diffs = diffs.slice(0, 10)
      }
    }
  }
  return result
}

async function main() {
  const db = await connect()
  await db.query("begin transaction isolation level repeatable read read only")

  let manifests = await listManifests()
  if (ONLY) manifests = manifests.filter((k) => k.endsWith(`/${ONLY}.json`))
  log(`${manifests.length} manifest(s) to verify · ${KEYS} keys each`)

  const results = []
  for (const key of manifests) {
    const manifest = await getJson(key)
    const r = await verifyTable(db, manifest)
    results.push(r)
    const ok = r.problems.length === 0
    log(
      `${ok ? "ok  " : "FAIL"} ${r.domain}/${r.table} · neon ${r.checks.neon_rows?.toLocaleString()} · lake ${r.checks.lake_rows?.toLocaleString()} · ${r.checks.round_trip ?? ""}`
    )
    for (const p of r.problems) log(`       ${p}`)
  }

  // --- 3. index.json reconciles -------------------------------------------
  let index = null
  try { index = await getJson(`${LAKE}/_manifest/index.json`) } catch { /* not written yet */ }
  const indexProblems = []
  if (!index) {
    indexProblems.push("index.json is missing — run scripts/lake/index-manifest.mjs")
  } else {
    const byTable = new Map(index.tables.map((t) => [t.table, t]))
    for (const r of results) {
      const e = byTable.get(r.table)
      if (!e) { indexProblems.push(`${r.table} is not in index.json`); continue }
      if (e.rows !== r.checks.lake_rows) {
        indexProblems.push(`${r.table}: index.json says ${e.rows} rows, the lake has ${r.checks.lake_rows}`)
      }
    }
  }

  await db.query("commit")
  await db.end()

  const failed = results.filter((r) => r.problems.length)
  console.log("")
  log(`${results.length - failed.length}/${results.length} tables verified clean`)
  for (const p of indexProblems) log(`index.json: ${p}`)
  if (failed.length || indexProblems.length) {
    console.error(`\n${failed.length} table(s) with problems:`)
    for (const r of failed) for (const p of r.problems) console.error(`  ${r.table}: ${p}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
