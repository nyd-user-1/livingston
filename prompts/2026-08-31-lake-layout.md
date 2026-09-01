# Lane A — Neon → S3 Parquet: the govblock policy lake

**Runs on the worker box. Not on the Mac.** Read-only against Neon. Nothing in
Neon is dropped, altered, truncated, or "cleaned up" by this job. The outcome
is that the same data exists in two places, one of which is cheap.

This lake becomes the read layer for **govblock** (`~/Code/govblock`, Next 16
App Router). Its data layer will be written against the layout below, so the
layout is the contract — not an implementation detail you may improve on
mid-run. If something here is wrong, flag it in the report and stop; do not
silently pick a different scheme.

---

## 0. Non-negotiables

1. **Region is pinned, not passed.** First lines of every script and every
   shell that runs one:
   ```sh
   export AWS_REGION=us-east-1
   export AWS_DEFAULT_REGION=us-east-1
   ```
   The laptop/box CLI default is `us-east-2` (WORKER-BOX §11). A forgotten
   `--region` flag must not be able to write a partition into the wrong region.
   Do not rely on remembering the flag.

2. **Read-only on Neon.** Before running anything, `grep -inE 'drop|truncate|
   alter|delete|update|insert' ` your own scripts and paste the (empty) result
   into the report. A `SELECT`-only job is the whole safety model.

3. **Parallel, not serial.** Shard by table, and within large tables by
   partition. Ramp to the box's ceiling. The FEC 26-hour lesson stands: a
   single-threaded export of billions of rows is a defect, not a long job.

4. **Idempotent and resumable.** Every partition write is atomic (write to a
   temp key, then copy to final). A re-run consults the manifest and skips
   partitions already completed with a matching row count. Killing the job and
   restarting it must be safe and cheap.

5. **Follow the house exporter.** `scripts/fec-candidate-summary-parquet.mjs`
   is the reference implementation — `hyparquet-writer`, explicit typed column
   lists, hive partitioning, a manifest per table, and **exit non-zero on any
   row-count mismatch rather than writing a file that quietly lost rows.**
   Extend that pattern. Do not invent a second one.

---

## 1. Destination

Create (or confirm) one dedicated bucket, us-east-1, following the house
naming convention (`solar-grid-lake-638175140432` is the precedent):

```
s3://govblock-lake-638175140432/
```

Versioning on. No public access. Do not reuse `livingston-fec-bulk-*`,
`livingston-bill-pdfs-*`, or the text sinks — those are harvest inputs; this is
a serving lake and its lifecycle is different.

## 2. Key layout

```
lake/v1/<domain>/<table>/<partition...>/part-<nnnnn>.parquet
lake/v1/_manifest/<table>.json
lake/v1/_manifest/index.json
```

- `v1` is deliberate. When the layout changes incompatibly it becomes `v2` and
  both exist until govblock has cut over. Never mutate `v1` in place.
- **Domains** (top level, keep it to these four unless you flag a fifth):
  `legislative` · `money` · `reference` · `text`
- **Partitioning is hive-style `key=value`** — DuckDB and Athena prune on it
  natively. Use, in this order, only the keys the table actually has:
  ```
  jurisdiction=<two-letter lowercase, us for federal>/session=<yyyy>
  ```
  `session_id = year`, so `session=2025`. A table with neither key gets no
  partition dirs — just `part-*.parquet` under the table.
- Partition on what govblock will **filter** on. Do not partition on
  high-cardinality keys (bill id, transaction id); that produces millions of
  tiny files and is the single fastest way to make this lake slow.

## 3. Parquet conventions

- **zstd** compression, level 3.
- **Target 128–512 MB per file**, row groups ~1M rows. Small-file sprawl is the
  main performance failure mode here — if a partition would produce a 2 MB
  file, widen the partition instead.
- **Explicit schema per table.** No inference. Write the column list and types
  in the script the way the FEC exporter does, so a source change surfaces as a
  diff rather than a silent type drift.
- **IDs are STRING, always** — FEC IDs, bill numbers, and district codes have
  leading zeros and will be corrupted by integer inference.
- Timestamps as TIMESTAMP with timezone, UTC.
- Column names stay snake_case, unchanged from Postgres. No renaming in flight.

## 4. Manifest

Per table, `lake/v1/_manifest/<table>.json`:

```json
{
  "table": "bills",
  "domain": "legislative",
  "source_query": "SELECT ... FROM bills",
  "exporter_sha": "<git rev-parse HEAD>",
  "started_at": "2026-08-31T...Z",
  "completed_at": "2026-08-31T...Z",
  "schema": [["bill_id","STRING"], ["session_id","INT32"]],
  "neon_row_count": 0,
  "lake_row_count": 0,
  "partitions": [
    {"key": "jurisdiction=ny/session=2025", "files": 1, "rows": 0, "bytes": 0}
  ]
}
```

And `lake/v1/_manifest/index.json` listing every table with its domain, row
count, byte size, and completion timestamp. This file is what govblock reads to
know what exists — treat it as a public API.

## 5. Acceptance — this is the job, not a formality

The point of tonight is a copy you can **prove** is complete, because a later
decision (slimming Neon) depends on it. For every table:

1. `SELECT count(*)` in Neon vs `count(*)` over the Parquet via DuckDB. **Exact
   match required.** Any mismatch is reported, not repaired silently.
2. 100 random primary keys per table round-trip identically field-for-field.
3. `lake/v1/_manifest/index.json` reconciles against the per-table manifests.

Report any table you could not export and why. A partial lake that is honestly
documented is a good outcome; a complete-looking lake that lost rows is the
only real failure mode.

## 6. Sequence

1. **Inventory first.** Enumerate every table in Neon with row count, byte
   size, and column list. Write it into the report below **and stop there for a
   read** if anything is surprising (a table you can't classify into a domain, a
   table over 500M rows, anything holding PII or app state rather than policy
   facts). App/mutable tables — chat sessions, form answers, uploads, archive —
   are **out of scope**; list them and skip them.
2. Provision the bucket.
3. Export, sharded, largest tables first so the long pole starts early.
4. Verify per §5.
5. Report.

---

## 7. Amendments — 2026-09-01 03:00 ET, by the lead, before kick-off

Read after §0–6. Where these differ from the above, these win.

**A. Scale, measured tonight.** Neon `neondb` is **76 GB**: 93 tables in two
schemas (`public`, `openstates`), 9 views, 2 matviews. Long poles:
`"BillTexts"` 40 GB / 3.45 M rows · `"Votes"` 17 GB / 89 M · `"History Table"`
5.8 GB / 18 M · `"Bills"` 3.5 GB / 2.56 M · `"Sponsors"` 12 M · `"Progress"`
8.3 M · `"Documents"` 4.3 M. The FEC bulk (5.1 B rows) is **not in Neon** — it is
already on S3 as raw files and is out of scope here. This is a ~76 GB /
~150 M-row job, not a 6 B-row one. The 2026-08-30 inventory is
`docs/LEDGER-2026-08-30.md`.

**B. Identifiers and keys.** Table names are mixed-case and some carry spaces
(`"History Table"`, `"Roll Call"`, `"BillTexts"`): quote every identifier in
SQL. Lake directory names are the lowercase snake_case form (`history_table`,
`roll_call`, `bill_texts`); the manifest records both — `"table": "bill_texts"`,
`"source_table": "public.\"BillTexts\""`. Column names stay exactly as in
Postgres (§3). Confirmed: `"Bills".session_id` **is the year** (2007–2026, 20
values; `legiscan_session_id` is LegiScan's id), so `session=<yyyy>` stands.
`state` is uppercase in Neon (`NY`, `US`): the partition dir is lowercase per
§2, the column value is written unchanged.

**C. Fifth domain, ruled: `derived`.** `public.mv_stream_latest` and
`public.mv_newsroom_latest` are matviews built 2026-09-01 (govblock
`sql/001_policy_matviews.sql`, refreshed nightly from this box). Export them
under `lake/v1/derived/<matview>/` like any table, refresh time in their
manifests. The 9 views are queries, not data: list them in the inventory and
skip them. Classify `bill_chunks` → `text`, `Forms` → `reference`,
`openstates.*` → `legislative`. Anything you cannot place → FLAG (E) and go on.

**D. Where it runs.** Box 2, already up and idle:
`ssh -i ~/.ssh/livingston-worker-2.pem ubuntu@18.208.189.124` — 2 vCPU, 7 GB,
83 GB free on `/`, node 22, aws cli under the **instance role with no region
configured (§0.1 is not optional)**, tmux and systemd-run present, repo at
`~/livingston` (behind `origin/main`: `git pull` first — this file and the FEC
exporter are pushed), `POLICY_DATABASE_URL` in `~/livingston/.env.local`.
**Do not start `44b-worker`.** Two `forms-harvest` node processes are live on
box 2 — leave them alone. Not on the box yet: `node_modules` for the exporter's
deps, and DuckDB (`pip3 install duckdb`) for the §5 counts.
Write the exporter on the Mac under `scripts/lake/`, commit + push, `git pull`
on the box, run it there **detached** (`systemd-run --user --unit lake-<table>`
or tmux) with logs under `~/logs/lake/`, so a dropped ssh cannot kill it.
**The box self-stops.** Read `~/bin/job-janitor` before launching and make sure
the export counts as a live job for it — or hold the janitor off for the night
and say so in the report. A box that stops itself mid-export is the failure
mode of the night. The bucket was confirmed absent at 06:40Z (HeadBucket 404):
create it per §1. If the measured rate projects the long pole past ~10 h, FLAG
it with the numbers; `scripts/box/fleet-launch.sh` is how a bigger box gets
launched, but that is a ruling, not a default.

**E. Reporting tonight — the lead is monitoring this file; Brendan is asleep.**
- Append under `## Report` in place; commit `prompts/` and `scripts/` **by
  explicit path** (`git status` before every commit; never `git add -A` — the
  checkout may be shared) and push. The lead reads this file, not your terminal.
- Every 30 min while exporting, one line:
  `HEARTBEAT <utc> tables <done>/<total> rows <n> gb <n> eta <hh:mm>`
- Anything needing a ruling: one line starting `FLAG:`, then **keep going** on
  everything the flag does not touch; park the flagged table. The lead answers
  in this file as `LEAD:` lines directly under the flag — `grep -n '^LEAD:'`
  before picking parked tables up at the end. §6.1's "stop there for a read"
  becomes: write the inventory, FLAG the surprises, continue.
- Add a subsection **"Shape notes for the app"**: per domain, the tables
  govblock would read first, their natural keys and joins (`bill_id`,
  `people_id`, `session_id`, `state`), row counts per jurisdiction where it
  matters, and anything about the data's shape a page-builder should know. You
  will have looked at all 93 tables; the wiring plan gets written from this.
- The report's **last line** is literally one of:
  `LANE A STATUS: COMPLETE` ·
  `LANE A STATUS: PARTIAL — <n> tables not exported, listed above` ·
  `LANE A STATUS: STOPPED — <reason>`
  The lead's monitor keys on that line; nothing else ends the night.

---

## Report — worker appends below this line

<!-- Amend this file in place with:
     - the Neon inventory table (name, rows, bytes, domain, in/out of scope)
     - the grep result proving the scripts are SELECT-only
     - bucket + region confirmation
     - per-table export result and the count reconciliation
     - anything you stopped on, and anything you'd do differently
     Then report back. Do not commit anything outside prompts/ and scripts/. -->
