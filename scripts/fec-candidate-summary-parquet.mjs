#!/usr/bin/env node
// scripts/fec-candidate-summary-parquet.mjs — the FEC "all candidates" summary
// as typed Parquet on S3, one file per two-year cycle.
//
//   node scripts/fec-candidate-summary-parquet.mjs [--cycles 2020,2022,2024,2026] [--dry-run]
//
// This is hop 1 of the Neon→S3 teaching example. The FEC publishes one small
// pipe-delimited file per cycle (weball<yy>.zip, 60–190 KB zipped, ~4k rows ×
// 30 columns) and we already mirror all 24 cycles at
// s3://livingston-fec-bulk-638175140432/bulk-downloads/<year>/weball<yy>.zip.
//
// It reads the zip straight out of S3, unzips it in memory (the whole corpus
// is kilobytes — nothing touches disk), types the 30 columns, and writes
//
//   parquet/candidate_summary/cycle=<YYYY>/part-0.parquet
//   manifest/candidate_summary.json
//
// Parquet, not JSON, because the app then reads *columns* over HTTP range
// requests: "top candidates in NY by receipts" touches five of thirty columns
// and one cycle's row group, not the whole file. That is the property being
// demonstrated.
//
// Parity is a standing rule: every cycle's row count is checked against the
// FEC bucket's own measured manifest (_manifest/rowcount-*-counts.tsv, the one
// the 2026-08-30 ledger was built from) and the script exits non-zero on any
// mismatch rather than writing a file that quietly lost rows.

import { Buffer } from "node:buffer"
import process from "node:process"
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { unzipSync } from "fflate"
import { parquetWriteBuffer } from "hyparquet-writer"

const BUCKET = "livingston-fec-bulk-638175140432"
const REGION = "us-east-1"
const SRC_PREFIX = "bulk-downloads/"
const DST_PREFIX = "parquet/candidate_summary/"
const MANIFEST_KEY = "manifest/candidate_summary.json"

// The 30 columns of weball, in file order. There is no header row in the data
// — the order is the contract, confirmed against
// bulk-downloads/data_dictionaries/weball.txt and against three cycles' bytes.
const COLUMNS = [
  ["CAND_ID", "STRING"],
  ["CAND_NAME", "STRING"],
  ["CAND_ICI", "STRING"], // I incumbent · C challenger · O open seat
  ["PTY_CD", "STRING"], // 1 Democratic · 2 Republican · 3 other
  ["CAND_PTY_AFFILIATION", "STRING"],
  ["TTL_RECEIPTS", "DOUBLE"],
  ["TRANS_FROM_AUTH", "DOUBLE"],
  ["TTL_DISB", "DOUBLE"],
  ["TRANS_TO_AUTH", "DOUBLE"],
  ["COH_BOP", "DOUBLE"], // cash on hand, beginning of period
  ["COH_COP", "DOUBLE"], // cash on hand, close of period
  ["CAND_CONTRIB", "DOUBLE"],
  ["CAND_LOANS", "DOUBLE"],
  ["OTHER_LOANS", "DOUBLE"],
  ["CAND_LOAN_REPAY", "DOUBLE"],
  ["OTHER_LOAN_REPAY", "DOUBLE"],
  ["DEBTS_OWED_BY", "DOUBLE"],
  ["TTL_INDIV_CONTRIB", "DOUBLE"],
  ["CAND_OFFICE_ST", "STRING"],
  ["CAND_OFFICE_DISTRICT", "STRING"],
  ["SPEC_ELECTION", "STRING"],
  ["PRIM_ELECTION", "STRING"],
  ["RUN_ELECTION", "STRING"],
  ["GEN_ELECTION", "STRING"],
  ["GEN_ELECTION_PRECENT", "DOUBLE"],
  ["OTHER_POL_CMTE_CONTRIB", "DOUBLE"],
  ["POL_PTY_CONTRIB", "DOUBLE"],
  ["CVG_END_DT", "STRING"],
  ["INDIV_REFUNDS", "DOUBLE"],
  ["CMTE_REFUNDS", "DOUBLE"],
]

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? "") : null
}
const DRY = args.includes("--dry-run")
const ONLY = (flag("--cycles") ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean)

const s3 = new S3Client({ region: REGION })

async function body(key) {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  )
  return Buffer.from(await out.Body.transformToByteArray())
}

async function listWeball() {
  const keys = []
  let token
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: SRC_PREFIX,
        ContinuationToken: token,
      })
    )
    for (const item of page.Contents ?? []) {
      // `<year>/weballNN.zip` only — not the loose .dat copies, and not the
      // "Old Format" directories, which are the same cycles in the pre-1996
      // layout and would double-count.
      const m = item.Key.match(/^bulk-downloads\/(\d{4})\/weball\d{2}\.zip$/)
      if (m) keys.push({ cycle: m[1], key: item.Key, size: item.Size })
    }
    token = page.NextContinuationToken
  } while (token)
  return keys.sort((a, b) => a.cycle.localeCompare(b.cycle))
}

// The bucket's own measured line counts — the ledger's source — keyed by
// object. This is what parity is checked against.
async function ledgerCounts() {
  const page = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "_manifest/" })
  )
  const latest = (page.Contents ?? [])
    .filter((o) => /rowcount-.*-counts\.tsv$/.test(o.Key))
    .sort((a, b) => a.Key.localeCompare(b.Key))
    .pop()
  if (!latest) throw new Error("no _manifest/rowcount-*-counts.tsv in the bucket")
  const text = (await body(latest.Key)).toString("utf8")
  const counts = new Map()
  for (const line of text.split("\n")) {
    const [kind, rows, , ...rest] = line.split("\t")
    if (kind !== "lines") continue
    counts.set(rest.join("\t"), Number(rows))
  }
  return { key: latest.Key, counts }
}

const num = (value) => {
  const text = (value ?? "").trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}
const str = (value) => {
  const text = (value ?? "").trim()
  return text === "" ? null : text
}

function parseCycle(bytes) {
  const files = unzipSync(new Uint8Array(bytes))
  const name = Object.keys(files).find((f) => /\.txt$/i.test(f))
  if (!name) throw new Error(`no .txt inside the zip (${Object.keys(files)})`)
  const text = Buffer.from(files[name]).toString("latin1")
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const columns = COLUMNS.map(() => [])
  for (const line of lines) {
    const cells = line.split("|")
    COLUMNS.forEach(([, type], i) => {
      columns[i].push(type === "DOUBLE" ? num(cells[i]) : str(cells[i]))
    })
  }
  return { name, rows: lines.length, columns }
}

async function main() {
  const [weball, ledger] = await Promise.all([listWeball(), ledgerCounts()])
  const cycles = ONLY.length
    ? weball.filter((w) => ONLY.includes(w.cycle))
    : weball
  console.log(
    `${cycles.length} cycles · parity against ${ledger.key}${DRY ? " · DRY RUN" : ""}\n`
  )

  const mismatches = []
  const entries = []

  for (const { cycle, key, size } of cycles) {
    const zip = await body(key)
    const parsed = parseCycle(zip)
    const expected = ledger.counts.get(key)

    if (expected === undefined) {
      mismatches.push(`${cycle}: ${key} is not in the row-count manifest`)
    } else if (expected !== parsed.rows) {
      mismatches.push(
        `${cycle}: parsed ${parsed.rows} rows, manifest says ${expected}`
      )
    }

    const parquet = parquetWriteBuffer({
      columnData: COLUMNS.map(([name, type], i) => ({
        name,
        data: parsed.columns[i],
        type,
      })),
      compressed: true,
      statistics: true,
    })
    const outKey = `${DST_PREFIX}cycle=${cycle}/part-0.parquet`
    const bytes = Buffer.from(parquet)

    if (!DRY) {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: outKey,
          Body: bytes,
          ContentType: "application/vnd.apache.parquet",
          CacheControl: "public, max-age=31536000, immutable",
        })
      )
    }

    entries.push({
      cycle: Number(cycle),
      key: outKey,
      rows: parsed.rows,
      bytes: bytes.length,
      source: { key, bytes: size, rows: expected ?? null },
    })
    console.log(
      `  ${cycle}  ${String(parsed.rows).padStart(5)} rows  zip ${String(size).padStart(7)} B  →  parquet ${String(bytes.length).padStart(7)} B  ${expected === parsed.rows ? "parity ok" : "PARITY FAIL"}`
    )
  }

  if (mismatches.length) {
    console.error(`\nPARITY FAILED — nothing was published as current:\n`)
    for (const m of mismatches) console.error(`  ${m}`)
    process.exit(1)
  }

  const manifest = {
    dataset: "candidate_summary",
    description:
      "FEC all-candidates financial summary (weball), one Parquet file per two-year cycle.",
    source: `s3://${BUCKET}/${SRC_PREFIX}<year>/weball<yy>.zip`,
    parityManifest: ledger.key,
    columns: COLUMNS.map(([name, type]) => ({ name, type })),
    cycles: entries.sort((a, b) => b.cycle - a.cycle),
    totalRows: entries.reduce((sum, e) => sum + e.rows, 0),
    totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    builtAt: new Date().toISOString(),
  }

  if (!DRY) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: MANIFEST_KEY,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
        CacheControl: "public, max-age=300",
      })
    )
  }

  console.log(
    `\n${entries.length} cycles · ${manifest.totalRows.toLocaleString()} rows · ${(manifest.totalBytes / 1024).toFixed(0)} KB of Parquet · parity ok`
  )
  console.log(DRY ? "(dry run — nothing written)" : `wrote s3://${BUCKET}/${MANIFEST_KEY}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
