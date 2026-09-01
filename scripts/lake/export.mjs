#!/usr/bin/env node
// scripts/lake/export.mjs — Neon relations to hive-partitioned Parquet on S3.
//
//   node scripts/lake/export.mjs --table 'public."BillTexts"'
//   node scripts/lake/export.mjs --domain money
//   node scripts/lake/export.mjs --shard 0/3
//
// Extends scripts/fec-candidate-summary-parquet.mjs: hyparquet-writer, an
// explicit typed column list, hive partitioning, a manifest per table, and a
// non-zero exit on any row-count mismatch rather than a file that quietly lost
// rows. What is new here is scale — the FEC exporter holds a whole cycle in
// memory and this one cannot, so rows stream from a pg cursor into the writer a
// row group at a time and peak memory is bounded by the group, not the table.
//
// Four properties worth knowing before reading the code:
//
//   1. THE SNAPSHOT. The exact count and every row read happen inside one
//      REPEATABLE READ READ ONLY transaction. Counting in a different
//      transaction than you read from is a race, not a check — the nightly
//      syncs write to these tables — so parity here is exact by construction.
//
//   2. PARTITION DEPTH IS MEASURED, NOT ASSUMED (LEAD C). §2 asks for
//      jurisdiction/session and §3 asks for 128-512 MB files, and for most
//      tables those conflict: `Bills` at full depth is ~1,040 partitions of
//      ~1 MB. §3 resolves it ("if a partition would produce a 2 MB file, widen
//      the partition instead"), so we take the deepest scheme whose median
//      partition still clears the floor. Every manifest carries `partition_keys`
//      so govblock reads the depth rather than assuming it.
//
//   3. TWO READ STRATEGIES, PICKED FROM THE INDEXES. A table whose partition
//      column is native and has an index leading with it is read one partition
//      at a time. Everything else — the nine tables given derived jurisdiction
//      columns by LEAD D, and any table whose partition column is unindexed —
//      is read in ONE sequential pass and routed to per-partition writers,
//      because 52 filtered scans of an unindexed 89M-row table is not an export
//      strategy. The derived columns come from an in-memory bill map rather
//      than a SQL join, so `votes` stays a single scan.
//
//   4. RESUMABLE (§0.4). A progress record goes to S3 as each partition
//      finishes; a re-run skips partitions already complete with a matching row
//      count. Routed tables resume at table granularity, since one pass writes
//      every partition at once.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { execFileSync } from "node:child_process"
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { ParquetWriter, fileWriter, schemaFromColumnData } from "hyparquet-writer"
import {
  BUCKET, LAKE, REGION, REPO, Cursor, coerce, columnExpression,
  connect, lakeName, parquetType, qualify, ZSTD,
} from "./_lib.mjs"
import { domainFor, outOfScopeReason } from "./domains.mjs"

const s3 = new S3Client({ region: REGION })

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback
}
const has = (name) => args.includes(name)

const DRY = has("--dry-run")
const INCLUDE_TSV = has("--include-tsv")
const FORCE = has("--force")
const LIMIT = Number(flag("--limit", "0")) || 0 // benchmark aid: stop after N rows

// A partition whose Parquet would land under this is not worth its own
// directory; the scheme widens instead (§3, LEAD C).
const MIN_PARTITION_BYTES = 2 * 1024 * 1024
const MAX_PARTITIONS = 4096
// Roll a new part file at roughly this much Parquet, inside §3's 128-512 MB band.
const FILE_TARGET_BYTES = 256 * 1024 * 1024
// Row group sizes. §3 asks for ~1M rows, which is right when one writer is open;
// a routed pass holds ~50 writers at once, so its groups are smaller to keep
// peak memory bounded on a 7 GB box. Both are recorded in the manifest.
const ROW_GROUP_ROWS = 1_000_000
const ROUTED_ROW_GROUP_ROWS = 100_000
const ROW_GROUP_BYTES = 128 * 1024 * 1024

// Hive's own name for "this partition column was null", so DuckDB and Athena
// read it back as null instead of as the string (LEAD D).
const HIVE_NULL = "__HIVE_DEFAULT_PARTITION__"

// Separators for the in-memory composite partition key. Control characters,
// because a partition value is arbitrary text and any printable separator could
// occur inside one.
const KEY_SEP = "\u0001"
const KEY_NULL = "\u0000"

/**
 * LEAD D: jurisdiction/session are not on these tables, so they are carried
 * over from `Bills` by the shortest key path and written as extra columns.
 * LEFT JOIN semantics — a row with no matching bill keeps null and lands under
 * the hive null partition, so counts still reconcile exactly with Neon.
 */
const DERIVED = {
  Votes: { on: "roll_call_id", via: '"Roll Call".roll_call_id -> bill_id -> Bills' },
  "History Table": { on: "bill_id", via: "Bills via bill_id" },
  Sponsors: { on: "bill_id", via: "Bills via bill_id" },
  Progress: { on: "bill_id", via: "Bills via bill_id" },
  Documents: { on: "bill_id", via: "Bills via bill_id" },
  Subjects: { on: "bill_id", via: "Bills via bill_id" },
  Referrals: { on: "bill_id", via: "Bills via bill_id" },
  Calendar: { on: "bill_id", via: "Bills via bill_id" },
  SameAs: { on: "bill_id", via: "Bills via bill_id" },
}

const TMP = path.join(os.tmpdir(), "lake-export")
fs.mkdirSync(TMP, { recursive: true })

const SHA = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO }).toString().trim() }
  catch { return "unknown" }
})()

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")
const log = (...m) => console.log(`${now()} ${m.join(" ")}`)
const mb = (b) => (b / 1024 ** 2).toFixed(1)

// ------------------------------------------------------------- inspection ---

/** The typed column list for one relation, in ordinal order. */
async function describe(db, schema, name) {
  const probe = await db.query(`select * from ${qualify(schema, name)} limit 0`)
  const types = new Map(
    (await db.query("select oid, typname, typcategory, typelem from pg_type")).rows.map((t) => [
      Number(t.oid), { name: t.typname, isArray: t.typcategory === "A", elem: Number(t.typelem) },
    ])
  )
  return probe.fields.map((f) => {
    const t = types.get(f.dataTypeID)
    const isArray = t?.isArray ?? false
    const pgType = isArray ? (types.get(t.elem)?.name ?? "text") : (t?.name ?? "text")
    return {
      name: f.name,
      pgType,
      isArray,
      parquet: parquetType(pgType, isArray),
      expr: columnExpression(f.name, pgType, isArray),
    }
  })
}

/** Average stored bytes per row, from a bounded sample. */
async function avgRowBytes(db, schema, name) {
  const { rows } = await db.query(
    `select coalesce(avg(pg_column_size(s.*)), 0)::float8 as avg
       from (select * from ${qualify(schema, name)} limit 5000) s`
  )
  return Math.max(1, Math.round(rows[0].avg))
}

/** Is there an index whose FIRST column is `col`? Decides read strategy. */
async function hasLeadingIndex(db, schema, name, col) {
  const { rows } = await db.query(
    `select 1
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
      where n.nspname = $1 and c.relname = $2 and a.attname = $3
        and i.indpred is null
      limit 1`,
    [schema, name, col]
  )
  return rows.length > 0
}

const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ------------------------------------------------------------- the schema ---

/**
 * An explicit Parquet schema. Scalars go through the library's own element
 * builder so their logical types match what it would otherwise infer; pgvector
 * gets the hand-built 3-level LIST that `list<float>` requires (LEAD B), which
 * the library's auto path would otherwise store as JSON text.
 */
function buildSchema(columns) {
  const children = columns.flatMap((c) => {
    if (c.parquet === "LIST_FLOAT") {
      return [
        { name: c.name, repetition_type: "OPTIONAL", converted_type: "LIST", num_children: 1 },
        { name: "list", repetition_type: "REPEATED", num_children: 1 },
        { name: "element", type: "FLOAT", repetition_type: "OPTIONAL" },
      ]
    }
    const one = schemaFromColumnData({
      columnData: [{ name: c.name, data: [], type: c.parquet, nullable: true }],
    })
    return [one[1]]
  })
  return [{ name: "root", num_children: columns.length }, ...children]
}

// ------------------------------------------------------------------- s3 -----

async function putObject(key, body, contentType, contentLength) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
  }))
}

const progressPrefix = (table) => `${LAKE}/_manifest/_progress/${table}/`
const safe = (partition) => (partition === "" ? "_root" : partition.replaceAll("/", "__"))

async function loadProgress(table) {
  const done = new Map()
  let token
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: progressPrefix(table), ContinuationToken: token,
    }))
    for (const o of page.Contents ?? []) {
      const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }))
      const rec = JSON.parse(await out.Body.transformToString())
      done.set(rec.partition, rec)
    }
    token = page.NextContinuationToken
  } while (token)
  return done
}

/** `jurisdiction=ny/session=2025` (§2 — dir lowercase, column value unchanged). */
function partitionPath(keys, values) {
  return keys
    .map((k, i) => {
      const label = k === "state" ? "jurisdiction" : "session"
      const raw = values[i]
      if (raw === null || raw === undefined) return `${label}=${HIVE_NULL}`
      const v = String(raw)
      return `${label}=${k === "state" ? v.toLowerCase() : v}`
    })
    .join("/")
}

// ------------------------------------------------------------ part writer ---

/**
 * Buffers rows for one partition, writes a row group when the buffer fills, and
 * rolls to a new part file when the current one reaches the target size. The
 * caller only ever calls push() and close().
 */
class PartWriter {
  constructor({ prefix, table, columns, schema, rowGroupRows, dry }) {
    this.prefix = prefix
    this.table = table
    this.columns = columns
    this.schema = schema
    this.rowGroupRows = rowGroupRows
    this.dry = dry
    this.files = []
    this.rows = 0
    this.index = 0
    this.buffered = 0
    this.bufferedBytes = 0
    this.buffers = columns.map(() => [])
    this.pq = null
    this.local = null
    this.fileRows = 0
  }

  open() {
    this.local = path.join(TMP, `${this.table}-${safe(this.prefixKey ?? "")}-${this.index}-${process.pid}.parquet`)
    this.pq = new ParquetWriter({
      writer: fileWriter(this.local),
      schema: this.schema,
      codec: "ZSTD",
      compressors: ZSTD,
      statistics: true,
    })
    this.fileRows = 0
  }

  push(row) {
    let bytes = 0
    for (let i = 0; i < this.columns.length; i++) {
      const v = coerce(row[this.columns[i].name], this.columns[i].parquet)
      this.buffers[i].push(v)
      if (typeof v === "string") bytes += v.length
      else if (v && v.length !== undefined) bytes += v.length * 4
      else bytes += 8
    }
    this.buffered++
    this.bufferedBytes += bytes
    this.rows++
  }

  flushGroup() {
    if (!this.buffered) return
    if (!this.pq) this.open()
    this.pq.write({
      columnData: this.columns.map((c, i) => ({ name: c.name, data: this.buffers[i] })),
    })
    this.fileRows += this.buffered
    this.buffered = 0
    this.bufferedBytes = 0
    this.buffers = this.columns.map(() => [])
  }

  /** True when the current file is big enough to publish. */
  get full() {
    return this.pq !== null && this.pq.writer.offset >= FILE_TARGET_BYTES
  }

  async maybeRoll() {
    // Rows OR bytes, whichever comes first: §3 asks for ~1M-row groups, but a
    // million rows of BillTexts is ~8 GB of text on a 7 GB box.
    if (this.buffered >= this.rowGroupRows || this.bufferedBytes >= ROW_GROUP_BYTES) {
      this.flushGroup()
    }
    if (this.full) await this.rollFile()
  }

  async rollFile() {
    this.flushGroup()
    if (!this.pq || this.fileRows === 0) return
    this.pq.finish()
    const bytes = fs.statSync(this.local).size
    const key = `${this.prefix}/part-${String(this.index).padStart(5, "0")}.parquet`
    if (!this.dry) {
      await putObject(key, fs.createReadStream(this.local), "application/vnd.apache.parquet", bytes)
    }
    fs.rmSync(this.local, { force: true })
    this.files.push({ key, rows: this.fileRows, bytes })
    log(`    ${key}  ${this.fileRows.toLocaleString()} rows  ${mb(bytes)} MB`)
    this.pq = null
    this.index++
  }

  async close() {
    await this.rollFile()
    return {
      files: this.files.length,
      rows: this.rows,
      bytes: this.files.reduce((s, f) => s + f.bytes, 0),
      parts: this.files,
    }
  }
}

// ------------------------------------------------------- derived jurisdiction

/**
 * bill_id (or roll_call_id) -> "STATE|session_id", built once per table.
 * This is a map, not a SQL join, so the base table stays a single sequential
 * scan — the difference between `votes` being one pass and being three.
 */
async function buildBillMap(db, on) {
  const sql =
    on === "bill_id"
      ? `select b.bill_id as k, b.state, b.session_id from public."Bills" b`
      : `select rc.roll_call_id as k, b.state, b.session_id
           from public."Roll Call" rc
           left join public."Bills" b on b.bill_id = rc.bill_id`
  const map = new Map()
  const cursor = db.query(new Cursor(sql))
  const read = (n) => new Promise((res, rej) => cursor.read(n, (e, r) => (e ? rej(e) : res(r))))
  for (;;) {
    const batch = await read(50_000)
    if (!batch.length) break
    for (const r of batch) {
      map.set(Number(r.k), r.state === null ? null : `${r.state}|${r.session_id ?? ""}`)
    }
  }
  if (typeof cursor.close === "function") await cursor.close()
  return map
}

// -------------------------------------------------------------- the work ----

/** Read one partition with a pushed-down filter (index-supported tables). */
async function exportByQuery({ db, schema, name, table, domain, columns, schemaEls, keys, values, expectedRows, dry }) {
  const partition = partitionPath(keys, values)
  const prefix = `${LAKE}/${domain}/${table}${partition ? "/" + partition : ""}`

  let n = 0
  const conds = keys.map((k, i) => (values[i] === null ? `"${k}" is null` : `"${k}" = $${++n}`))
  const where = conds.length ? "where " + conds.join(" and ") : ""
  const params = values.filter((v) => v !== null)
  const sql = `select ${columns.map((c) => c.expr).join(", ")} from ${qualify(schema, name)} ${where}`

  const w = new PartWriter({ prefix, table, columns, schema: schemaEls, rowGroupRows: ROW_GROUP_ROWS, dry })
  w.prefixKey = partition

  const cursor = db.query(new Cursor(sql, params))
  const read = (count) => new Promise((res, rej) => cursor.read(count, (e, r) => (e ? rej(e) : res(r))))
  for (;;) {
    const batch = await read(10_000)
    if (!batch.length) break
    for (const row of batch) w.push(row)
    await w.maybeRoll()
    if (LIMIT && w.rows >= LIMIT) break
  }
  if (typeof cursor.close === "function") await cursor.close()
  const out = await w.close()

  if (expectedRows !== null && !LIMIT && out.rows !== expectedRows) {
    throw new Error(`${table} ${partition || "(whole table)"}: wrote ${out.rows} rows, Neon says ${expectedRows}`)
  }
  const record = { table, domain, partition, key: partition, at: now(), ...out }
  if (!dry) {
    await putObject(`${progressPrefix(table)}${safe(partition)}.json`, JSON.stringify(record), "application/json")
  }
  return record
}

/** One sequential pass, rows routed to a writer per partition. */
async function exportRouted({ db, schema, name, table, domain, columns, schemaEls, keys, billMap, derivedOn, dry }) {
  const sql = `select ${columns.filter((c) => !c.derived).map((c) => c.expr).join(", ")} from ${qualify(schema, name)}`
  const writers = new Map()
  const getWriter = (partition) => {
    let w = writers.get(partition)
    if (!w) {
      w = new PartWriter({
        prefix: `${LAKE}/${domain}/${table}${partition ? "/" + partition : ""}`,
        table, columns, schema: schemaEls, rowGroupRows: ROUTED_ROW_GROUP_ROWS, dry,
      })
      w.prefixKey = partition
      writers.set(partition, w)
    }
    return w
  }

  const cursor = db.query(new Cursor(sql))
  const read = (count) => new Promise((res, rej) => cursor.read(count, (e, r) => (e ? rej(e) : res(r))))
  let total = 0
  for (;;) {
    const batch = await read(10_000)
    if (!batch.length) break
    for (const row of batch) {
      if (billMap) {
        const packed = billMap.get(Number(row[derivedOn]))
        if (packed) {
          const bar = packed.indexOf("|")
          row.state = packed.slice(0, bar)
          const sess = packed.slice(bar + 1)
          row.session_id = sess === "" ? null : Number(sess)
        } else {
          row.state = null
          row.session_id = null
        }
      }
      getWriter(partitionPath(keys, keys.map((k) => row[k] ?? null))).push(row)
      total++
    }
    for (const w of writers.values()) await w.maybeRoll()
    if (LIMIT && total >= LIMIT) break
  }
  if (typeof cursor.close === "function") await cursor.close()

  const records = []
  for (const [partition, w] of writers) {
    const out = await w.close()
    const record = { table, domain, partition, key: partition, at: now(), ...out }
    records.push(record)
    if (!dry) {
      await putObject(`${progressPrefix(table)}${safe(partition)}.json`, JSON.stringify(record), "application/json")
    }
  }
  return records
}

// --------------------------------------------------------------- one table --

async function exportRelation(db, rel) {
  const { schema, name } = rel
  const table = lakeName(name)
  const domain = domainFor(schema, name)
  if (!domain) throw new Error(`${schema}."${name}" has no domain ruling — see scripts/lake/domains.mjs`)

  const startedAt = now()
  log(`${schema}."${name}" -> ${domain}/${table}`)

  await db.query("begin transaction isolation level repeatable read read only")

  let columns = await describe(db, schema, name)

  // LEAD B: every tsvector column is a Postgres search index — derivable, and
  // unusable by DuckDB or Athena. Omitted, and recorded so it is never silent.
  const omitted = []
  if (!INCLUDE_TSV) {
    columns = columns.filter((c) => {
      if (c.pgType !== "tsvector") return true
      omitted.push({
        column: c.name, pg_type: c.pgType,
        why: "postgres search index — derivable from the source text, unusable outside postgres (LEAD B)",
      })
      return false
    })
  }

  // LEAD D: carry jurisdiction and session over from Bills where the table has
  // no such column of its own.
  const derived = DERIVED[name]
  const derivedColumns = {}
  if (derived && !columns.some((c) => c.name === "state")) {
    columns = [
      ...columns,
      { name: "state", pgType: "text", isArray: false, parquet: "STRING", expr: null, derived: true },
      { name: "session_id", pgType: "int8", isArray: false, parquet: "INT64", expr: null, derived: true },
    ]
    derivedColumns.state = `Bills.state via ${derived.via}`
    derivedColumns.session_id = `Bills.session_id via ${derived.via}`
  }

  const { rows: [{ n: neonRows }] } = await db.query(
    `select count(*)::bigint as n from ${qualify(schema, name)}`
  )
  const total = Number(neonRows)
  const avgBytes = await avgRowBytes(db, schema, name)
  log(`  ${total.toLocaleString()} rows · ~${avgBytes} B/row stored · ~${((total * avgBytes) / 1024 ** 3).toFixed(2)} GB`)

  // --- read strategy and partition depth -----------------------------------
  const hasState = columns.some((c) => c.name === "state")
  const hasSession = columns.some((c) => c.name === "session_id")
  const candidateKeys = [hasState && "state", hasSession && "session_id"].filter(Boolean)

  const indexed =
    candidateKeys.length > 0 && !derived &&
    (await hasLeadingIndex(db, schema, name, candidateKeys[0]))
  const routed = candidateKeys.length > 0 && !indexed

  // Partition sizes: exact for indexed tables (a cheap GROUP BY on the index),
  // estimated from the bill distribution for routed ones (whose GROUP BY would
  // cost the very extra scan routing exists to avoid).
  let groups = null
  let billMap = null
  const rejected = []
  let chosenKeys = []
  let reason = "relation has neither state nor session_id (§2)"

  if (candidateKeys.length) {
    if (derived) {
      billMap = await buildBillMap(db, derived.on)
      log(`  bill map: ${billMap.size.toLocaleString()} keys via ${derived.on}`)
    }
    let dist
    if (indexed) {
      const sel = candidateKeys.map((k) => `"${k}"`).join(", ")
      const { rows } = await db.query(
        `select ${sel}, count(*)::bigint as rows from ${qualify(schema, name)}
          group by ${candidateKeys.map((_, i) => i + 1).join(", ")}`
      )
      dist = rows.map((r) => ({ values: candidateKeys.map((k) => r[k]), rows: Number(r.rows) }))
    } else if (billMap) {
      // Weight the table's rows by how the referenced bills distribute.
      const counts = new Map()
      for (const packed of billMap.values()) {
        const key = packed ?? " "
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const denom = billMap.size || 1
      dist = [...counts.entries()].map(([key, c]) => {
        const [st, se] = key === " " ? [null, null] : key.split("|")
        return { values: [st, se === "" ? null : se], rows: Math.round((total * c) / denom) }
      })
    } else {
      const sel = candidateKeys.map((k) => `"${k}"`).join(", ")
      const { rows } = await db.query(
        `select ${sel}, count(*)::bigint as rows from ${qualify(schema, name)}
          group by ${candidateKeys.map((_, i) => i + 1).join(", ")}`
      )
      dist = rows.map((r) => ({ values: candidateKeys.map((k) => r[k]), rows: Number(r.rows) }))
    }

    // A routed pass holds every partition's writer open at once, so its depth is
    // capped at jurisdiction; 1,000 concurrent writers is not a thing a 7 GB box
    // can do. Recorded in the manifest rather than assumed.
    const maxDepth = routed ? Math.min(1, candidateKeys.length) : candidateKeys.length
    if (routed && candidateKeys.length > 1) {
      rejected.push(
        "jurisdiction/session: a routed single-pass export holds one writer per partition open, so depth is capped at jurisdiction"
      )
    }

    for (let depth = maxDepth; depth >= 1; depth--) {
      const active = candidateKeys.slice(0, depth)
      const bucket = new Map()
      for (const g of dist) {
        const k = g.values.slice(0, depth).map((v) => (v === null || v === undefined ? " " : String(v))).join("")
        bucket.set(k, (bucket.get(k) ?? 0) + g.rows)
      }
      const med = median([...bucket.values()].map((r) => r * avgBytes))
      if (bucket.size > MAX_PARTITIONS) {
        rejected.push(`${active.join("/")}: ${bucket.size} partitions exceeds the ${MAX_PARTITIONS} cap`)
        continue
      }
      if (med < MIN_PARTITION_BYTES) {
        rejected.push(
          `${active.join("/")}: ${bucket.size} partitions, median ~${mb(med)} MB is under the ${MIN_PARTITION_BYTES / 1024 ** 2} MB floor`
        )
        continue
      }
      chosenKeys = active
      groups = [...bucket.entries()]
        .map(([k, r]) => ({
          values: k.split("").map((v) => (v === " " ? null : v)),
          rows: r,
        }))
        .sort((a, b) => b.rows - a.rows)
      reason = `${bucket.size} partitions, median ~${mb(med)} MB Parquet${indexed ? "" : " (estimated from the bill distribution)"}`
      break
    }
    if (!chosenKeys.length) reason = "every partitioned scheme fell under the file-size floor (§3)"
  }

  const strategy = chosenKeys.length === 0 ? "single pass, no partitions" : indexed ? "one query per partition (index-supported)" : "single pass, routed to per-partition writers"
  log(`  partitioning: ${chosenKeys.length ? chosenKeys.join("/") : "none"} — ${reason}`)
  log(`  strategy: ${strategy}`)
  for (const r of rejected) log(`    widened past ${r}`)

  const schemaEls = buildSchema(columns)
  const done = FORCE || DRY ? new Map() : await loadProgress(table)

  // --- export ---------------------------------------------------------------
  let records = []
  if (chosenKeys.length && indexed) {
    let soFar = 0
    for (const [i, g] of groups.entries()) {
      const partition = partitionPath(chosenKeys, g.values)
      const prior = done.get(partition)
      if (prior && prior.rows === g.rows) {
        records.push(prior); soFar += prior.rows
        log(`  [${i + 1}/${groups.length}] ${partition} — already complete, skipping`)
        continue
      }
      log(`  [${i + 1}/${groups.length}] ${partition} — ${g.rows.toLocaleString()} rows`)
      const rec = await exportByQuery({
        db, schema, name, table, domain, columns, schemaEls,
        keys: chosenKeys, values: g.values, expectedRows: g.rows, dry: DRY,
      })
      records.push(rec); soFar += rec.rows
      log(`  [${i + 1}/${groups.length}] ok · ${soFar.toLocaleString()}/${total.toLocaleString()} rows`)
    }
  } else if (chosenKeys.length) {
    const anyDone = [...done.values()].reduce((s, r) => s + r.rows, 0)
    if (!FORCE && anyDone === total && done.size) {
      records = [...done.values()]
      log(`  already complete (${anyDone.toLocaleString()} rows), skipping`)
    } else {
      records = await exportRouted({
        db, schema, name, table, domain, columns, schemaEls,
        keys: chosenKeys, billMap, derivedOn: derived?.on, dry: DRY,
      })
    }
  } else {
    const prior = done.get("")
    if (prior && prior.rows === total) {
      records = [prior]
      log("  already complete, skipping")
    } else {
      records = [await exportByQuery({
        db, schema, name, table, domain, columns, schemaEls,
        keys: [], values: [], expectedRows: total, dry: DRY,
      })]
    }
  }

  await db.query("commit")

  const lakeRows = records.reduce((s, r) => s + r.rows, 0)
  const manifest = {
    table,
    domain,
    source_table: `${schema}."${name}"`,
    source_query: `select ${columns.filter((c) => !c.derived).map((c) => c.expr).join(", ")} from ${qualify(schema, name)}`,
    exporter_sha: SHA,
    started_at: startedAt,
    completed_at: now(),
    partition_keys: chosenKeys.map((k) => (k === "state" ? "jurisdiction" : "session")),
    partitioning: {
      source_columns: chosenKeys,
      chosen_because: reason,
      widened_past: rejected,
      strategy,
      hive_null_partition: HIVE_NULL,
    },
    compression: "zstd level 3",
    row_group_rows: chosenKeys.length && !indexed ? ROUTED_ROW_GROUP_ROWS : ROW_GROUP_ROWS,
    schema: columns.map((c) => [c.name, c.parquet, c.pgType + (c.isArray ? "[]" : "")]),
    derived_columns: derivedColumns,
    omitted_columns: omitted,
    neon_row_count: total,
    lake_row_count: lakeRows,
    parity: lakeRows === total ? "ok" : "MISMATCH",
    bytes: records.reduce((s, r) => s + r.bytes, 0),
    files: records.reduce((s, r) => s + r.files, 0),
    partitions: records
      .map((r) => ({ key: r.key, files: r.files, rows: r.rows, bytes: r.bytes }))
      .sort((a, b) => b.rows - a.rows),
  }
  if (!DRY && !LIMIT) {
    await putObject(`${LAKE}/_manifest/${table}.json`, JSON.stringify(manifest, null, 2), "application/json")
  }
  if (lakeRows !== total && !LIMIT) {
    throw new Error(`${table}: parity failed — lake ${lakeRows} vs Neon ${total}`)
  }
  log(`  ${table}: ${lakeRows.toLocaleString()} rows · ${mb(manifest.bytes)} MB · ${manifest.files} files · parity ${manifest.parity}`)
  return manifest
}

// ------------------------------------------------------------------ main ----

async function main() {
  const db = await connect()

  const { rows: rels } = await db.query(`
    select n.nspname as schema, c.relname as name, c.relkind as kind,
           pg_total_relation_size(c.oid) as bytes
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public','openstates') and c.relkind in ('r','p','m')
     order by pg_total_relation_size(c.oid) desc`)

  let targets = rels.filter((r) => domainFor(r.schema, r.name) && !outOfScopeReason(r.schema, r.name))

  const one = flag("--table")
  if (one) {
    const wanted = one.replaceAll('"', "").toLowerCase()
    targets = targets.filter(
      (r) => `${r.schema}.${r.name}`.toLowerCase() === wanted || r.name.toLowerCase() === wanted
    )
    if (!targets.length) throw new Error(`no relation matched --table ${one}`)
  }
  const dom = flag("--domain")
  if (dom) targets = targets.filter((r) => domainFor(r.schema, r.name) === dom)

  const shard = flag("--shard")
  if (shard) {
    const [idx, of] = shard.split("/").map(Number)
    // Largest first, dealt round-robin, so shards finish together rather than
    // one of them drawing every long pole.
    targets = targets.filter((_, i) => i % of === idx)
  }

  log(`${targets.length} relations${DRY ? " · DRY RUN" : ""} · exporter ${SHA.slice(0, 8)}`)

  const failures = []
  for (const rel of targets) {
    try {
      await exportRelation(db, rel)
    } catch (e) {
      failures.push(`${rel.schema}."${rel.name}": ${e.message}`)
      console.error(`${now()} FAILED ${rel.schema}."${rel.name}" — ${e.message}`)
      console.error(e.stack)
      try { await db.query("commit") } catch { /* transaction already unwound */ }
    }
  }

  await db.end()
  if (failures.length) {
    console.error(`\n${failures.length} relation(s) failed:`)
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  log("all relations complete")
}

main().catch((e) => { console.error(e); process.exit(1) })
