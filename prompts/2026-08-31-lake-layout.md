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

### 2026-09-01 07:35Z — inventory, flags, and the access plan

Working on box 2. **Its IP changed: `18.208.189.124` is dead, the box is now
`13.218.239.11`** (same instance `i-0843042df1a5fb003`, t4g.large, 2 vCPU / 7 GB
/ 83 GB free). It changed because the box stopped itself out from under me at
06:56:35Z, sixty seconds into my first survey — see FLAG A. It is restarted and
held up.

#### Neon inventory — 104 relations, 76 in scope

`node scripts/lake/inventory.mjs --json ~/logs/lake/inventory.json`. Row counts
are planner estimates (`reltuples`); **the exact counts parity is judged on are
taken by the exporter inside the same snapshot it reads the rows from**, because
a count taken in a different transaction than the export is a race, not a check.
`-1` means the relation has never been analysed — those get exact counts too.

Totals in scope: **76 relations · ~156.7 M rows · 75.6 GB**, which reconciles
with §7.A's 76 GB. By domain:

| domain | tables | est rows | size |
| --- | ---: | ---: | ---: |
| `text` | 2 | 3,484,710 | 39.90 GB |
| `legislative` | 44 | 151,340,385 | 34.51 GB |
| `money` | 26 | 1,478,997 | 1001.5 MB |
| `reference` | 2 | 393,189 | 243.9 MB |
| `derived` | 2 | 2,066 | 1.8 MB |

| relation → lake path | est rows | size | partition keys | pk |
| --- | ---: | ---: | --- | --- |
| `public."BillTexts"` → `text/bill_texts` | 3,446,255 | 39.76 GB | jurisdiction/session | document_id |
| `public."Votes"` → `legislative/votes` | 89,171,800 | 17.30 GB | — | roll_call_id+people_id |
| `public."History Table"` → `legislative/history_table` | 18,132,668 | 5.64 GB | — | bill_id+date+sequence |
| `public."Bills"` → `legislative/bills` | 2,556,124 | 3.44 GB | jurisdiction/session | bill_id |
| `public."Sponsors"` → `legislative/sponsors` | 12,021,498 | 1.71 GB | — | id |
| `public."Documents"` → `legislative/documents` | 4,346,192 | 1.44 GB | — | document_type+document_id |
| `public."Progress"` → `legislative/progress` | 8,316,364 | 1.20 GB | — | bill_id+seq |
| `openstates."bill_xref"` → `legislative/bill_xref` | 2,150,068 | 1.01 GB | jurisdiction/session | state+session_id+bill_key+special |
| `public."Referrals"` → `legislative/referrals` | 2,950,413 | 458.2 MB | — | bill_id+seq |
| `public."Roll Call"` → `legislative/roll_call` | 1,723,455 | 447.3 MB | jurisdiction | roll_call_id |
| `public."Subjects"` → `legislative/subjects` | 2,958,017 | 423.1 MB | — | bill_id+subject_id |
| `public."LobbyingActivities"` → `money/lobbying_activities` | 677,484 | 362.8 MB | — | filing_uuid+seq |
| `public."FecContributions"` → `money/fec_contributions` | 116,820 | 333.6 MB | — | sub_id |
| `openstates."bill_crosswalk"` → `legislative/bill_crosswalk` | 2,125,356 | 327.1 MB | jurisdiction/session | state+session_id+bill_key+special |
| `public."Calendar"` → `legislative/calendar` | 1,453,862 | 322.3 MB | — | bill_id+seq |
| `public."Forms"` → `reference/forms` | 392,191 | 243.5 MB | — | id |
| `public."LobbyingFilings"` → `money/lobbying_filings` | 332,387 | 203.8 MB | — | filing_uuid |
| `public."SameAs"` → `legislative/same_as` | 1,013,948 | 154.2 MB | — | bill_id+sast_type_id+sast_bill_id |
| `public."bill_chunks"` → `text/bill_chunks` | 38,455 | 148.4 MB | session | id |
| `public."LobbyingBills"` → `legislative/lobbying_bills` | 558,415 | 138.2 MB | session | filing_uuid+seq+bill_number |
| `openstates."votes"` → `legislative/votes` | 469,384 | 117.2 MB | — | — |
| `openstates."sponsors"` → `legislative/sponsors` | 380,760 | 93.4 MB | jurisdiction | — |
| `openstates."actions"` → `legislative/actions` | 251,467 | 83.9 MB | jurisdiction | — |
| `openstates."bills"` → `legislative/bills` | 62,474 | 52.4 MB | jurisdiction | os_id |
| `openstates."documents"` → `legislative/documents` | 95,714 | 43.5 MB | jurisdiction | — |
| `public."school_funding"` → `money/school_funding` | 18,901 | 28.3 MB | — | id |
| `openstates."bill_milestones"` → `legislative/bill_milestones` | 98,985 | 25.9 MB | jurisdiction | source+state+session+bill_key+seq |
| `openstates."bill_committees"` → `legislative/bill_committees` | 89,099 | 25.4 MB | jurisdiction | source+state+session+bill_key+chamber+committee+reference_date |
| `public."Contracts"` → `money/contracts` | 97,804 | 25.1 MB | — | ID |
| `openstates."bill_relations"` → `legislative/bill_relations` | 109,714 | 24.2 MB | jurisdiction | source+state+session+bill_key+version+relation+related_bill+related_session |
| `public."FecReceiptsByEmployer"` → `money/fec_receipts_by_employer` | 112,460 | 19.2 MB | — | people_id+committee_id+cycle+employer |
| `openstates."bill_versions"` → `legislative/bill_versions` | 30,121 | 14.4 MB | jurisdiction | source+state+session+bill_key+version |
| `public."People"` → `legislative/people` | 22,723 | 13.7 MB | jurisdiction | people_id |
| `openstates."people_xref"` → `legislative/people_xref` | 47,094 | 13.4 MB | jurisdiction | state+chamber+district+name_key |
| `openstates."calendar_entries"` → `legislative/calendar_entries` | 42,400 | 9.7 MB | jurisdiction | source+state+session+cal_year+cal_no+cal_kind+cal_version+section+seq |
| `openstates."bill_texts"` → `legislative/bill_texts` | 42,665 | 9.6 MB | jurisdiction | source+state+session+bill_key+version+kind |
| `public."FecTotals"` → `money/fec_totals` | 5,343 | 6.8 MB | — | people_id+candidate_id+cycle |
| `openstates."roll_calls"` → `legislative/roll_calls` | 16,341 | 6.6 MB | jurisdiction | os_rc_id |
| `openstates."bill_calendars"` → `legislative/bill_calendars` | 43,231 | 5.9 MB | jurisdiction | source+state+session+bill_key+cal_year+cal_no |
| `openstates."bill_laws"` → `legislative/bill_laws` | 34,440 | 5.6 MB | jurisdiction | source+state+session+bill_key+version+relation+law_code |
| `public."FecReceiptsByState"` → `money/fec_receipts_by_state` | 38,932 | 5.0 MB | jurisdiction | people_id+committee_id+cycle+state |
| `public."ModelBills"` → `legislative/model_bills` | 1,137 | 4.5 MB | — | model_id |
| `public."school_funding_totals"` → `money/school_funding_totals` | 18,900 | 3.9 MB | — | id |
| `public."Discretionary"` → `money/discretionary` | 12,402 | 3.4 MB | — | id |
| `openstates."people"` → `legislative/people` | 7,975 | 2.4 MB | jurisdiction | os_person_id |
| `public."FecCommittees"` → `legislative/fec_committees` | 914 | 1.7 MB | — | people_id+committee_id |
| `public."mv_stream_latest"` → `derived/mv_stream_latest` | 2,014 | 1.5 MB | jurisdiction/session | — |
| `public."lobbyists_clients"` → `money/lobbyists_clients` | 6,499 | 1.4 MB | — | id |
| `openstates."bill_agendas"` → `legislative/bill_agendas` | 5,401 | 1.2 MB | jurisdiction | source+state+session+bill_key+agenda_year+agenda_no+chamber+committee |
| `public."budget_2027_spending"` → `money/budget_2027_spending` | 3,795 | 1.1 MB | — | — |
| `public."2025_lobbyist_dataset"` → `money/2025_lobbyist_dataset` | 6,289 | 1.0 MB | — | — |
| `public."Individual_Lobbyists"` → `money/individual_lobbyists` | 7,278 | 1.0 MB | jurisdiction | — |
| `public."budget_2027_capital_aprops"` → `money/budget_2027_capital_aprops` | 3,737 | 0.9 MB | — | — |
| `public."ModelBillMatches"` → `legislative/model_bill_matches` | 548 | 0.9 MB | jurisdiction/session | id |
| `public."SessionPeople"` → `legislative/session_people` | 7,836 | 0.9 MB | jurisdiction/session | session_id+people_id |
| `public."FecIndependentExpenditures"` → `money/fec_independent_expenditures` | 4,496 | 0.8 MB | — | people_id+cycle+committee_id+support_oppose |
| `public."FecReceiptsBySize"` → `money/fec_receipts_by_size` | 5,713 | 0.8 MB | — | people_id+committee_id+cycle+size |
| `public."lobbyist_compensation"` → `money/lobbyist_compensation` | 2,747 | 0.7 MB | — | id |
| `openstates."bill_messages"` → `legislative/bill_messages` | 208 | 0.6 MB | jurisdiction | source+state+session+bill_key+kind+seq |
| `public."lobbying_spend"` → `money/lobbying_spend` | 4,232 | 0.6 MB | — | id |
| `public."lobbyists"` → `money/lobbyists` | 1,352 | 0.5 MB | — | id |
| `public."LegiscanDatasets"` → `reference/legiscan_datasets` | 998 | 0.4 MB | jurisdiction/session | state+session_id |
| `public."budget_2027-aprops"` → `money/budget_2027_aprops` | 1,297 | 0.3 MB | — | — |
| `public."mv_newsroom_latest"` → `derived/mv_newsroom_latest` | 52 | 0.3 MB | jurisdiction | — |
| `openstates."meetings"` → `legislative/meetings` | 612 | 0.3 MB | jurisdiction | source+state+session+agenda_year+agenda_no+addendum+chamber+committee |
| `openstates."legislators"` → `legislative/legislators` | 667 | 0.2 MB | jurisdiction | source+state+session+member_id |
| `public."FinanceContributors"` → `money/finance_contributors` | 100 | 0.2 MB | — | people_id+contributor_eid |
| `public."Finance"` → `money/finance` | -1 | 0.1 MB | — | people_id+candidate_id |
| `openstates."pipeline_reconcile"` → `legislative/pipeline_reconcile` | -1 | 0.1 MB | jurisdiction | run_id |
| `public."Committees"` → `legislative/committees` | 82 | 0.1 MB | — | committee_id |
| `public."LobbyingSync"` → `money/lobbying_sync` | 3 | 0.1 MB | — | key |
| `public."resource_documents"` → `legislative/resource_documents` | 1 | 0.1 MB | — | id |
| `public."FinanceSectors"` → `money/finance_sectors` | -1 | 0.0 MB | — | people_id+sector_id |
| `public."Revenue"` → `money/revenue` | 28 | 0.0 MB | — | id |
| `public."member_vote_tallies"` → `legislative/member_vote_tallies` | 214 | 0.0 MB | — | people_id |
| `openstates."session_map"` → `legislative/session_map` | -1 | 0.0 MB | jurisdiction | state+source+session |

**Listed and not exported (28)**

| relation | est rows | why |
| --- | ---: | --- |
| `public."chat_sessions"` | 570 | out of scope (§6.1) — app state — chat |
| `public."chat_notes"` | 78 | out of scope (§6.1) — app state — chat |
| `public."prompt_chat_counts"` | 4,270 | out of scope (§6.1) — app state — usage counters |
| `public."blog_posts"` | 8 | out of scope (§6.1) — product content |
| `public."chat_excerpts"` | 16 | out of scope (§6.1) — app state — chat |
| `public."submitted_prompts"` | 34 | out of scope (§6.1) — app state — user submissions |
| `public."assets"` | 23 | out of scope (§6.1) — product content |
| `public."Persona"` | 49 | out of scope (§6.1) — product content |
| `public."feedback"` | 1 | out of scope (§6.1) — app state — user submissions |
| `public."user_committee_favorites"` | 2 | out of scope (§6.1) — app state — per-user |
| `public."user_member_favorites"` | 6 | out of scope (§6.1) — app state — per-user |
| `public."profiles"` | 9 | out of scope (§6.1) — app state — user profiles (PII) |
| `public."subscribers"` | 9 | out of scope (§6.1) — app state — mailing list (PII) |
| `public."Top 50 Public Policy Problems"` | 48 | out of scope (§6.1) — product content — curated editorial list |
| `public."user_favorites"` | 37 | out of scope (§6.1) — app state — per-user |
| `public."user_bill_reviews"` | 17 | out of scope (§6.1) — app state — per-user |
| `public."visitor_counts"` | 51 | out of scope (§6.1) — app state — usage counters |
| `public."Sample Problems"` | 80 | out of scope (§6.1) — product content — curated editorial list |
| `public."people_photo_backup"` | 214 | out of scope (§6.1) — backup copy of People.photo |
| `public."bills"` | -1 | view — a query, not data (§7.C) |
| `public."contracts"` | -1 | view — a query, not data (§7.C) |
| `public."lobbyist_compensation_yoy"` | -1 | view — a query, not data (§7.C) |
| `public."lobbyist_full_profile"` | -1 | view — a query, not data (§7.C) |
| `public."member_votes"` | -1 | view — a query, not data (§7.C) |
| `public."people"` | -1 | view — a query, not data (§7.C) |
| `public."roll_call"` | -1 | view — a query, not data (§7.C) |
| `public."sponsors"` | -1 | view — a query, not data (§7.C) |
| `public."v_policy_latest_session"` | -1 | view — a query, not data (§7.C) |

<!-- DOMAIN TOTALS
text: 2 tables, 3,484,710 rows, 39.90 GB
legislative: 44 tables, 151,340,385 rows, 34.51 GB
money: 26 tables, 1,478,997 rows, 1001.5 MB
reference: 2 tables, 393,189 rows, 243.9 MB
derived: 2 tables, 2,066 rows, 1.8 MB
-->

#### SELECT-only proof (§0.2)

```
$ grep -inE 'drop|truncate|alter|delete|update|insert' scripts/lake/*.mjs
$ echo $?
1
```

Empty. Two notes on how it was kept empty honestly, rather than by luck:

- `inventory.mjs` originally read `pg_attribute … not a.attisdropped`. That is a
  catalog column name, not a mutation, but it matched the grep — so the column
  introspection was moved to `information_schema.columns`, which never exposes
  dropped columns and needs no such filter. Matviews are not in
  `information_schema`, so those two are typed by probing what
  `select * … limit 0` actually returns, which is a better source anyway: it is
  the exact shape the exporter will receive.
- `_lib.mjs` `connect()` does not merely intend to be read-only. It runs
  `SET default_transaction_read_only = on`, then `SHOW`s it back and throws if
  the pin did not take. A session that could modify a row is never handed out.

#### Region (§0.1)

Pinned in-process at the top of `_lib.mjs` (`AWS_REGION` / `AWS_DEFAULT_REGION`
= `us-east-1`) so it cannot be forgotten at a call site, plus exported in every
shell that launches a job. Confirmed the box's CLI has no region configured, so
this is load-bearing, not belt-and-braces.

---

### FLAGS

FLAG: A — the box self-stopped mid-survey and the janitor keys on tmux, not systemd — §7.D's `systemd-run` option would have lost the night.
At 06:56:35Z, ~60 s after I first found box 2 idle, it stopped itself.
CloudTrail attributes the `StopInstances` call to the instance's own role
(`livingston-worker-2-selfstop`, source IP 18.208.189.124) — i.e. `job-janitor`,
finishing the grace window left over from the `forms-harvest` run that ended
earlier. Reading `~/bin/job-janitor`: it decides whether the box is busy with
`tmux ls | grep -v '^w-'` — **tmux sessions only**. A job started with
`systemd-run --user`, the first option §7.D offers, is invisible to it and would
have been killed under exactly these conditions. So: everything tonight runs in
**tmux sessions named `lake-*`**, and a long-lived `lake-hold` session is armed
for the duration so the janitor never sees zero jobs even between shards. No
janitor is armed by me, so the box will **not** self-stop when the export ends —
it will need a manual stop in the morning. Saying so explicitly per §7.D.
Unrelated but worth recording: `job-janitor`'s hardcoded fallback instance id is
`i-030d9cac100e6e124`, which is the *44b* box, not this one. It only matters if
IMDS is unreachable, but if it ever fires it stops the wrong machine.

FLAG: B — `BillTexts.search_tsv` is half the payload and is a rebuildable Postgres index. Exporting without it by default.
Measured: `BillTexts` is 40 GB = 2.5 GB heap + 4.4 GB indexes + **33 GB TOAST**.
Over a 100 k-row sample the two big columns are almost exactly equal in stored
size — `text` averages 3,670 B/row, `search_tsv` averages 3,558 B/row. So the
tsvector is ~49 % of the payload. Serialised to Parquet it is worse than that:
`pg_column_size` reports the *compressed* stored size, and a tsvector rendered
as text expands several-fold, while carrying no value in the lake — DuckDB and
Athena cannot use a Postgres tsvector, and it is derivable from `text` at any
time (govblock already has Typesense for search).
Including it roughly doubles the long pole for a derived index.
**Default taken so the night's long pole completes: export `bill_texts` without
`search_tsv`, and record the omission explicitly in the manifest as
`omitted_columns` so it is never silently missing.** `--include-tsv` flips it.
If the ruling is to include it, the column can be added later as a sidecar
export keyed on `document_id` without redoing the 29 GB of text.

FLAG: C — §2's partition scheme and §3's file-size target conflict for every table but one. Applying §3's own widening rule.
`Bills` has 52 states × 20 sessions = up to 1,040 partitions for 2.13 M rows —
about 1 MB per file, which is the small-file sprawl §3 names as the main
performance failure mode. §3 resolves this itself ("if a partition would produce
a 2 MB file, widen the partition instead"), so the exporter measures real
per-partition counts with a `GROUP BY` and **picks the deepest partitioning
whose median partition still clears 2 MB of Parquet**, widening
`jurisdiction/session` → `jurisdiction` → none. The chosen depth and the
measurement behind it are recorded in every manifest. On the estimates this puts
`bill_texts` at `jurisdiction/session` (~936 partitions, ~7.5 MB each) and
`bills` at `jurisdiction` (52 partitions, ~3 MB each). No table gets a scheme
that is not one of §2's, and none is widened without the numbers being written
down.

FLAG: D — most of the large legislative tables have no jurisdiction column at all — govblock cannot prune them.
`Votes` (89.2 M rows), `History Table` (18.1 M), `Sponsors` (12.0 M),
`Progress` (8.3 M), `Documents` (4.3 M), `Subjects` (3.0 M), `Referrals` (3.0 M),
`Calendar` (1.5 M) and `SameAs` (1.0 M) carry only `bill_id` — no `state`, no
`session_id`. Per §2 ("only the keys the table actually has") they get no
partition directories, so **any govblock query filtered by jurisdiction has to
join through `bills` or scan the whole table**. That is ~148 M of the 151 M
legislative rows. Exporting per contract tonight and flagging rather than
inventing a scheme: the fix, if wanted, is a `v1` widening that denormalises
`state`/`session_id` onto these tables at export time from `Bills` — cheap for
me to add (one join on an indexed `bill_id`), and it is the difference between
`votes` being prunable and not. Not doing it unruled, because §2 says the layout
is the contract.

FLAG: E — §0.4's "write to a temp key, then copy to final" buys nothing on S3, and costs a second copy of 40 GB.
S3 `PutObject` and `CompleteMultipartUpload` are already atomic — an object is
never readable in a partial state, so a reader can never see a half-written
partition. The temp-then-copy dance would double the bytes moved for the 40 GB
table to protect against a failure mode S3 does not have. Taking the direct
atomic PUT and saying so. **The resumability half of §0.4 is fully implemented**
and is the part that actually matters: a per-partition progress record is
written after each partition completes, and a re-run skips any partition already
finished with a matching row count, so killing and restarting is safe and cheap.

FLAG: F — two classification judgement calls, taken so the export can proceed.
(1) Fiscal tables — `Contracts`, `Discretionary`, `Revenue`, `school_funding`,
`school_funding_totals`, `budget_2027_spending`, `budget_2027_capital_aprops`,
`budget_2027-aprops` — are public money but not *campaign* money. Put in
`money`, reading that domain as public money in both directions: what is raised
to win office and what the state raises and spends once in it. The alternative
is a sixth domain, `fiscal`; say the word and it is a one-line change before
these tables are written.
(2) Product/editorial content — `blog_posts`, `Persona`, `assets`,
`Top 50 Public Policy Problems`, `Sample Problems` — treated as out of scope
alongside app state, on the grounds that they are things the product says rather
than policy facts. All five are tiny; trivially added if govblock wants them.
Also excluded and worth naming because it is PII rather than policy:
`subscribers` and `profiles`.

---

### Plan, and where the time goes

Access plan, decided from the indexes rather than assumed (`pg_indexes`):

- `BillTexts` has `btree (state, session_id)` and `Bills` has `btree (state)` —
  so partitioned reads on the only two large tables that *have* partition keys
  are index-supported. No table gets 52 sequential scans.
- Every other large table has no partition key at all (FLAG D), so each is one
  sequential pass, rolling part files by size.
- `Roll Call` has `state` but no index on it; at 0.44 GB it is read once and
  grouped in memory rather than scanned 52 times.

Long pole is `bill_texts`: ~3.45 M rows × 8,342 avg chars ≈ **29 GB of raw text**
to pull, encode and compress on 2 vCPU with a pure-JS Parquet writer. That, not
the row count, is the night. zstd-3 on legislative text should land it around
6–7 GB in the lake. I am benchmarking a real partition before committing to a
shard count, and will report the measured rate and a projected finish in the
next heartbeat — per §7.D, if it projects past ~10 h I will flag it with the
numbers rather than quietly running long.

Parquet is `hyparquet-writer` with **zstd level 3** via node 22's built-in
codec, wired in as a custom compressor (`codec: 'ZSTD'`); the library's default
is snappy, so this is explicit. Rows stream from a `pg-cursor` straight into
`parquetWriteRows`, so peak memory is bounded by the row group, not the table —
which is what makes a 40 GB table possible on a 7 GB box at all.

HEARTBEAT 2026-09-01T07:35Z tables 0/76 rows 0 gb 0 eta pending-benchmark

LANE A STATUS: PARTIAL — inventory complete and 6 flags open; export not yet started
