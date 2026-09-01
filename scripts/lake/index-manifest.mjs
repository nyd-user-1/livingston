#!/usr/bin/env node
// scripts/lake/index-manifest.mjs — write lake/v1/_manifest/index.json.
//
//   node scripts/lake/index-manifest.mjs
//
// §4: "this file is what govblock reads to know what exists — treat it as a
// public API." So it is written last, from the per-table manifests rather than
// from anything this process remembers, and it carries what a reader needs in
// order not to guess: the domain and path of each table, the partition depth
// actually used (LEAD C), the row and byte counts, and the columns that were
// derived or omitted so nobody hunts for a column that was never written.

import process from "node:process"
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { BUCKET, LAKE, REGION } from "./_lib.mjs"

const s3 = new S3Client({ region: REGION })
const DRY = process.argv.includes("--dry-run")

async function main() {
  const keys = []
  let token
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: `${LAKE}/_manifest/`, ContinuationToken: token,
    }))
    for (const o of page.Contents ?? []) {
      if (o.Key.includes("/_progress/")) continue
      if (o.Key.endsWith("/index.json")) continue
      if (o.Key.endsWith(".json")) keys.push(o.Key)
    }
    token = page.NextContinuationToken
  } while (token)

  const tables = []
  for (const key of keys) {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const m = JSON.parse(await out.Body.transformToString())
    tables.push({
      table: m.table,
      domain: m.domain,
      path: `${LAKE}/${m.domain}/${m.table}/`,
      manifest: `${LAKE}/_manifest/${m.table}.json`,
      source_table: m.source_table,
      partition_keys: m.partition_keys ?? [],
      partitions: (m.partitions ?? []).length,
      files: m.files,
      rows: m.lake_row_count,
      neon_rows: m.neon_row_count,
      parity: m.parity,
      bytes: m.bytes,
      columns: (m.schema ?? []).map(([name, type]) => ({ name, type })),
      derived_columns: m.derived_columns ?? {},
      omitted_columns: m.omitted_columns ?? [],
      completed_at: m.completed_at,
    })
  }
  tables.sort((a, b) => (a.domain === b.domain ? a.table.localeCompare(b.table) : a.domain.localeCompare(b.domain)))

  const byDomain = {}
  for (const t of tables) {
    byDomain[t.domain] ??= { tables: 0, rows: 0, bytes: 0 }
    byDomain[t.domain].tables++
    byDomain[t.domain].rows += t.rows
    byDomain[t.domain].bytes += t.bytes
  }

  const index = {
    lake: `s3://${BUCKET}/${LAKE}/`,
    layout: "lake/v1/<domain>/<table>/<partition...>/part-<nnnnn>.parquet",
    version: "v1",
    compression: "zstd level 3",
    hive_null_partition: "__HIVE_DEFAULT_PARTITION__",
    note:
      "partition_keys is the depth actually used for each table and may be shorter than jurisdiction/session; read it rather than assuming a depth.",
    domains: byDomain,
    total_tables: tables.length,
    total_rows: tables.reduce((s, t) => s + t.rows, 0),
    total_bytes: tables.reduce((s, t) => s + t.bytes, 0),
    tables_with_parity_problems: tables.filter((t) => t.parity !== "ok").map((t) => t.table),
    built_at: new Date().toISOString(),
    tables,
  }

  if (!DRY) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${LAKE}/_manifest/index.json`,
      Body: JSON.stringify(index, null, 2),
      ContentType: "application/json",
      CacheControl: "public, max-age=60",
    }))
  }

  console.log(
    `${index.total_tables} tables · ${index.total_rows.toLocaleString()} rows · ${(index.total_bytes / 1024 ** 3).toFixed(2)} GB`
  )
  for (const [d, v] of Object.entries(byDomain)) {
    console.log(`  ${d}: ${v.tables} tables, ${v.rows.toLocaleString()} rows, ${(v.bytes / 1024 ** 2).toFixed(1)} MB`)
  }
  if (index.tables_with_parity_problems.length) {
    console.error(`parity problems: ${index.tables_with_parity_problems.join(", ")}`)
    process.exit(1)
  }
  console.log(DRY ? "(dry run — index.json not written)" : `wrote s3://${BUCKET}/${LAKE}/_manifest/index.json`)
}

main().catch((e) => { console.error(e); process.exit(1) })
