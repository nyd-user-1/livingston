#!/usr/bin/env node
// scripts/lake/_lib.mjs — the one place lane A talks to Neon, S3, and Parquet.
//
// Everything here is SELECT-only against Neon by construction, not by promise:
// `connect()` pins `default_transaction_read_only` and then asserts the pin
// took, so a session that could modify a row never gets handed back. §0.2 of
// the work order is checked mechanically by `npm run`-free grep over this
// directory; keep the forbidden SQL verbs out of this file, comments included.
//
// Region is pinned here (§0.1) rather than passed, because the box's CLI
// default is us-east-2 and a partition written into the wrong region is not a
// mistake you notice until govblock reads an empty prefix.

import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

process.env.AWS_REGION = "us-east-1"
process.env.AWS_DEFAULT_REGION = "us-east-1"

export const REGION = "us-east-1"
export const BUCKET = "govblock-lake-638175140432"
export const LAKE = "lake/v1"
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/** KEY=VALUE files, first writer wins, the real environment beats all of them. */
export function loadEnv() {
  const files = [
    path.join(REPO, ".env.local"),
    path.join(os.homedir(), "livingston", ".env.local"),
    path.join(os.homedir(), ".env.lane-in"),
  ]
  for (const f of files) {
    if (!fs.existsSync(f)) continue
    for (const raw of fs.readFileSync(f, "utf8").split("\n")) {
      const s = raw.trim()
      if (!s || s.startsWith("#")) continue
      const eq = s.indexOf("=")
      if (eq < 1) continue
      const k = s.slice(0, eq).trim()
      if (process.env[k] !== undefined) continue
      process.env[k] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    }
  }
}

/** `pg` lives in the repo on the laptop and in ~/livingston on the box. Find it either way. */
function requireFromRepos(name) {
  for (const r of [REPO, path.join(os.homedir(), "livingston"), process.cwd()]) {
    try { return createRequire(path.join(r, "noop.js"))(name) } catch { /* next root */ }
  }
  throw new Error(`${name} is not installed — npm i --no-save ${name}`)
}

export const pg = requireFromRepos("pg")
export const Cursor = requireFromRepos("pg-cursor")

// Timestamps come back as real Date objects in UTC. Postgres `timestamp`
// (oid 1114) has no zone, and node-postgres would otherwise read it in the
// box's local zone; the lake stores UTC (§3), so parse it as UTC explicitly.
pg.types.setTypeParser(1114, (v) => (v === null ? null : new Date(v.replace(" ", "T") + "Z")))
// int8 and numeric arrive as strings so that nothing is silently rounded on the
// way in. The column encoder decides what to do with them per its declared type.
pg.types.setTypeParser(20, (v) => v)
pg.types.setTypeParser(1700, (v) => v)

/**
 * A SELECT-only client. The pin is asserted, not assumed: if the session can
 * still modify rows we throw instead of handing back a client.
 */
export async function connect() {
  loadEnv()
  const connectionString = process.env.POLICY_DATABASE_URL
  if (!connectionString) throw new Error("POLICY_DATABASE_URL is not set")
  const client = new pg.Client({
    connectionString,
    application_name: "lane-a-lake",
    statement_timeout: 0,
    query_timeout: 0,
  })
  await client.connect()
  await client.query("SET default_transaction_read_only = on")
  const { rows } = await client.query("SHOW default_transaction_read_only")
  const pinned = rows[0]?.default_transaction_read_only
  if (pinned !== "on") throw new Error(`read-only pin did not take (got ${pinned})`)
  return client
}

/** `public."BillTexts"` — every identifier quoted (§7.B). */
export const qualify = (schema, table) => `"${schema}"."${table.replaceAll('"', '""')}"`

/** `"History Table"` -> `history_table`; the lake's directory name (§7.B). */
export const lakeName = (table) =>
  table
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()

// ---------------------------------------------------------------- parquet ---

/** zstd level 3 (§3), via node's built-in codec. */
export const ZSTD = {
  ZSTD: (bytes) =>
    zlib.zstdCompressSync(bytes, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 },
    }),
}

// Postgres type -> hyparquet BasicType. Anything not named here is refused
// loudly rather than guessed at, so a new column type surfaces as a failure
// instead of a silently mistyped lake column (§3).
//
// Two deliberate choices, both recorded in every manifest:
//   int8/numeric -> STRING is wrong for arithmetic, so int8 is INT64 and
//   numeric is DOUBLE; `date` has no hyparquet BasicType, so it is an ISO
//   yyyy-mm-dd STRING, which DuckDB casts for free and which cannot drift.
export const TYPE_MAP = {
  bool: "BOOLEAN",
  int2: "INT32",
  int4: "INT32",
  int8: "INT64",
  float4: "FLOAT",
  float8: "DOUBLE",
  numeric: "DOUBLE",
  money: "DOUBLE",
  text: "STRING",
  varchar: "STRING",
  bpchar: "STRING",
  char: "STRING",
  name: "STRING",
  uuid: "STRING",
  citext: "STRING",
  json: "STRING",
  jsonb: "STRING",
  xml: "STRING",
  inet: "STRING",
  cidr: "STRING",
  macaddr: "STRING",
  date: "STRING",
  time: "STRING",
  timetz: "STRING",
  interval: "STRING",
  timestamp: "TIMESTAMP",
  timestamptz: "TIMESTAMP",
  bytea: "BYTE_ARRAY",
  tsvector: "STRING", // omitted from the lake by rule (LEAD B); mapped so inventory can still type it
  vector: "LIST_FLOAT", // pgvector, kept as list<float> rather than text (LEAD B)
  point: "STRING",
  oid: "INT64",
}

/**
 * The SQL expression that reads one column. Most columns are read as-is; the
 * ones whose wire format node-postgres cannot type on its own are cast in the
 * query, which keeps the decision in one visible place per column.
 */
export function columnExpression(name, pgType, isArray) {
  const id = `"${name.replaceAll('"', '""')}"`
  if (isArray) return `to_json(${id})::text as ${id}`
  switch (pgType) {
    case "date":
      return `to_char(${id}, 'YYYY-MM-DD') as ${id}`
    case "time":
    case "timetz":
    case "interval":
    case "tsvector":
    case "vector":
    case "point":
    case "json":
    case "jsonb":
    case "xml":
    case "inet":
    case "cidr":
    case "macaddr":
      return `${id}::text as ${id}`
    default:
      return id
  }
}

/** Parquet type for a column, arrays flattened to their JSON text. */
export function parquetType(pgType, isArray) {
  if (isArray) return "STRING"
  const t = TYPE_MAP[pgType]
  if (!t) throw new Error(`no parquet type mapped for postgres type "${pgType}"`)
  return t
}

/** Coerce one value to what hyparquet-writer wants for its declared type. */
export function coerce(value, type) {
  if (value === null || value === undefined) return null
  switch (type) {
    case "INT32":
      return typeof value === "number" ? value : Number(value)
    case "INT64":
      return typeof value === "bigint" ? value : BigInt(value)
    case "FLOAT":
    case "DOUBLE": {
      const n = typeof value === "number" ? value : Number(value)
      return Number.isFinite(n) ? n : null
    }
    case "BOOLEAN":
      return value === true || value === "t" || value === "true"
    case "TIMESTAMP":
      return value instanceof Date ? value : new Date(value)
    case "BYTE_ARRAY":
      return value
    case "LIST_FLOAT": {
      // pgvector renders as "[0.1,0.2,...]"; keep the numbers, not the text.
      if (Array.isArray(value)) return value
      const t = String(value).trim()
      if (!t || t === "[]") return []
      return t.replace(/^[[{]|[\]}]$/g, "").split(",").map(Number)
    }
    default:
      return typeof value === "string" ? value : String(value)
  }
}
