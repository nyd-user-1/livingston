# Lane WB — move livingston's ingestion off the laptop and off Vercel, onto the 44b worker box

**Written:** 2026-08-28 11:45 ET, by the lead (Fable). **Window:** `/rename worker-box`, `/color red`.
**Model:** Opus. **Repos:** `~/Code/livingston` (this one) and `~/Code/44b` (the box's tooling lives there).

## Why this lane exists

Four ingestion jobs are running on an 8 GB MacBook right now, babysat by the lead's terminal,
and seven cron jobs still run on Vercel functions with a 300 s ceiling. The 44b worker box
(`i-030d9cac100e6e124`, t4g.large, us-east-1, **same region as Neon**) already has the whole
pattern: `run-job` (detached tmux + log + real exit code + self-stop janitor), `run-due`
(manifest scheduler, anacron semantics), EventBridge `44b-wake-nightly` (starts the box
07:15 UTC daily), and a Slack digest. **Deliverable: every livingston job runs there,
unattended, and the laptop and Vercel run none of them.**

Read first, in this order — do not skip, these are the hard-won lessons:
1. `~/Code/44b/docs/WORKER-BOX.md` — the operating manual. §0 rule, §3 `run-job`, §9 deploy key, §10 secrets, §11 gotchas.
2. `~/Code/44b/ops/box/` — `run-job`, `job-janitor`, `run-due`, `install.sh`, `jobs.d/*.json` (read `arxiv-daily.json` in full — that is the house style for a manifest).
3. `~/Code/scripts/ORCHESTRATION-DOCTRINE.md` §1, §2, §9 and `RIG-DOCTRINE.md` §6, §10.
4. `~/Code/livingston/api/legiscan-sync.ts`, `bills-sync.ts`, `fec-sync.ts`, `lda-sync.ts` headers (the four handlers you are moving) and `vercel.json` (the crons you are retiring).
5. `~/Code/livingston/CLAUDE.md` if present, and this file's **Report** section — you will be writing into it.

## What is running on the laptop right now (do not kill any of it until step 5)

| job | driver (scratchpad, python) | resumable how | state at 11:31 ET |
|---|---|---|---|
| National LegiScan backfill — every session of 52 jurisdictions, 989 datasets | `run-plan.py` over `national-full-plan.json` (skips `(state, session)` pairs already logged HTTP 200) | by dataset; each dataset is one `mode=dataset&state=&session=&year=&access_key=` call | 657/976 done, 10 failed (2 CO stack-overflow — fixed in 83bca15; 8 transient network), on Oklahoma |
| LDA lobbying walker A — years 2026 → 2025 | `run-lda-all.py 2026,2025` | by page: `api/lda-sync.ts` records `nextPage` per year in `"LobbyingSync"` (`key = year:2026`, `value = next page or "done"`) | 2026 page 1601 of 2245 |
| LDA lobbying walker B — years 2024 → 2023 | `run-lda-all.py 2024,2023` | same | 2024 page 1101 of ~4000 |
| OpenFEC basic backfill — 726 members, cycles 2026+2024 | `run-fec-all.py 2026,2024 8` (paced ≤1,000 req/h) | by member: `People.fec_fetched_at` | 8 members a batch, ~5 h left |

The scratchpad is `/private/tmp/claude-501/-Users-brendanstanton-Code-livingston/e6361e20-1e72-4338-85f3-d1932673a2c1/scratchpad/`.
The python drivers there are throwaway; the bundled `*.mjs` there are esbuild outputs of the `api/*.ts` handlers, invoked with a fake `(req, res)`. **Nothing in the scratchpad is the deliverable — port the logic into the repo.**

## Scope

**In:**
1. Livingston runs on the box: a shallow clone at `~/livingston` (read-only deploy key, §9 pattern), `npm ci`, `.env.local` with exactly the six harvest secrets (below), and an in-repo runner that executes an `api/*.ts` handler from the command line.
2. `run-job`/`run-due` generalised to more than one repo (a manifest field `"repo": "livingston"`; default stays `44b` so nothing existing changes).
3. Three in-repo backfill drivers (Node, under `scripts/box/`) replacing the python ones, each resumable from the database, not from a log file.
4. A `LegiscanDatasets` ledger so the weekly national sweep downloads only datasets whose `dataset_hash` changed (this is the "diff efficiently" Brendan asked for — one `getDatasetList` call, then only the changed zips).
5. Manifests in `livingston/ops/box/jobs.d/` for every recurring job (list below), installed on the box; the seven Vercel crons removed from `vercel.json`.
6. Hand-over of the four running backfills at natural boundaries, then proof that each continues on the box.

**Out:** any `src/` change, any new ingestion logic beyond the ledger, GPU, a second box, Slack app changes. The box's existing 44b jobs must be untouched and still due-able.

## Step 1 — the box, and livingston on it

- `aws sts get-caller-identity` and report the account. **Every AWS command carries `--region us-east-1`** (laptop default is us-east-2 — WORKER-BOX §11).
- Start the box; **first thing after SSH: `touch ~/.no-auto-jobs ~/.keep-up`** (maintenance etiquette — a wake during your work must launch nothing, and the janitor must not stop the box under you). Remove both flags at the very end, and say so in the report.
- Deploy key for `nyd-user-1/livingston` exactly as WORKER-BOX §9 (generate on the box, register the *public* half read-only with `gh api repos/nyd-user-1/livingston/keys`). Add a `~/.ssh/config` host alias so 44b's key and livingston's key don't collide (`Host github-livingston` → `HostName github.com`, `IdentityFile ~/.ssh/github_deploy_livingston`, `IdentitiesOnly yes`; clone from `git@github-livingston:nyd-user-1/livingston.git`).
- `git clone --depth 1`, `npm ci --no-audit --no-fund`. ARM: confirm `@neondatabase/serverless`, `fflate`, `esbuild` install clean (they should; esbuild ships linux-arm64).
- **Secrets, §10 method only** — pipe from the laptop's `~/Code/livingston/.env.local`, never echo, never in the transcript:
  `POLICY_DATABASE_URL NYS_LEGISLATION_API_KEY LEGISCAN_API_KEY FEC_API_KEY LDA_API_KEY CRON_SECRET`.
  Deliberately **not** on the box: `DATABASE_URL*`, `BEDROCK_*`, `RESEND_*`, `CF_*`, `FOLLOWTHEMONEY_API_KEY` (quota-bound, never batch it), anything else.
- Verify from the box: a read-only `select count(*) from "Bills"` against `POLICY_DATABASE_URL` and report the round-trip (the laptop sees ~60–100 ms; the box should see single digits — that number is why the LDA walker will run faster there).

## Step 2 — the runner: `scripts/box/run-handler.mjs`

The four jobs are Vercel handlers `(req, res)`. Write one in-repo runner that does what the scratchpad python did, properly:

```
node scripts/box/run-handler.mjs api/legiscan-sync.ts mode=delta state=NY
```
- bundles the `.ts` with esbuild in-process (`esbuild.build({ write: false, bundle: true, platform: 'node', format: 'esm' })`, then `import()` from a data: URL or a temp file in `os.tmpdir()`), reads `.env.local` itself (`node --env-file` is fine too — pick one, document it), passes `query = { ...args, secret: process.env.CRON_SECRET }` and `headers = {}`.
- prints the JSON the handler returned, one line, prefixed `HTTP <status>`.
- **exit code = 0 only for a 2xx** — `run-job` records the real exit code and the digest keys off it (ORCHESTRATION §9: failures must be loud).
- honours `--heap <mb>` by re-exec'ing with `--max-old-space-size` (NY datasets are 70 MB zips; use 4096 for `mode=dataset`).

## Step 3 — generalise `run-job` / `run-due` for a second repo (in `~/Code/44b/ops/box/`, canonical)

- `run-job`: replace the hardcoded `cd ~/44b` with `cd "${JOB_CWD:-$HOME/44b}"`. Nothing else.
- `run-due`: per-manifest optional `"repo"` (a directory name under `$HOME`, default `44b`): fetch/reset that repo (the existing block, parameterised), set `JOB_CWD`, run steps there with *that* repo's `.env.local`. The `sync-run.mjs` ledger open/close is 44b-specific — guard it: only if `$repo/scripts/lib/sync-run.mjs` exists; otherwise skip both calls and still propagate `$rc`. Also honour a manifest `"heap_mb"` as today.
- Keep the diff minimal and show it verbatim in the report. Re-run `ops/box/install.sh` to install. Then `run-due --dry-run` must list the 44b jobs exactly as before (paste the output) — **that is the regression test; if any 44b job's decision changes, stop and report.**
- Commit in 44b by pathspec (`ops/box/run-job ops/box/run-due`), **no push** (the lead pushes after Q/A).

## Step 4 — the drivers and the ledger (in livingston, `scripts/box/`)

All three are Node, take no scratchpad files, resume from the database, and are safe to re-run from the top at any time.

1. **`national-sweep.mjs`** — the weekly national refresh *and* the backfill's completion, one script:
   - one `getDatasetList` (no state filter) → every `(state_id, session_id, dataset_hash, dataset_size, access_key, year_start, special)`. Map `state_id` → postal code exactly as `api/legiscan-sync.ts` learns it (the summary in `STATE_BY_ID` is incomplete; the dataset list carries `state_id` and the handler already resolves it — reuse, don't re-derive; the 9 datasets under state id 30 are excluded on purpose, say so in the report if you find them).
   - **`LegiscanDatasets` ledger** — add to `prepareSchema` in `api/legiscan-sync.ts`: `(state text, session_id int, dataset_hash text, dataset_size bigint, year int, special smallint, imported_at timestamptz, bills int, ms int, PRIMARY KEY (state, session_id))`, written at the end of a successful `mode=dataset` run (pass `hash=` through the query so the handler can record it). Idempotent `ALTER`s like the rest of that function.
   - for each dataset: skip if the ledger has the same hash; otherwise run the handler (`mode=dataset`, with `access_key`, `year`, `state`, `session`). `--all` ignores the ledger (full backfill), `--only NY,NJ` restricts, `--failed-first` orders the ten that failed. Sequential; `heap 4096`.
   - **Completing the backfill is therefore just `national-sweep.mjs`** run once with the ledger empty: everything already imported by the laptop gets re-checked by hash… no — that would re-download 650 datasets. Do this instead: on first run, **seed the ledger from what exists**: `INSERT ... SELECT state, legiscan_session_id, count(*)` from `"Bills"` grouped, with `dataset_hash = NULL`; then treat `NULL` hash as "imported, hash unknown, do not re-download unless `--all`". The weekly run after that compares real hashes. Report the seed counts against `national-full-plan.json` (copy the plan into `ops/box/national-full-plan-2026-08-28.json` for the record — it is the 989-row list the laptop worked from).
2. **`lda-backfill.mjs <year...>`** — reads `"LobbyingSync"` for `year:<y>`, resumes from that page, calls the handler with `pages=100` until `nextPage` is null. Then the nightly job is the handler with `mode=delta` (no driver needed).
3. **`fec-backfill.mjs --cycles 2026,2024 --detail basic|extras --batch 8`** — loops the handler until `remaining = 0`; on a non-2xx sleeps 60 s (900 s if the message contains "rate limit"); paces so the hour never exceeds ~950 calls (the handler already spaces calls 1.1 s apart; the driver's sleep between batches is `queries × 3.8 s`). Stops after 20 consecutive errors.

## Step 5 — hand-over of the four laptop jobs (coordinate; do not race the laptop)

The laptop drivers are python loops that `subprocess.run` one handler call at a time. **Killing the python parent stops the loop after the current call finishes**; the child node process keeps running to its natural end. So, for each:

**Amendment 11:50 (Brendan):** the national LegiScan backfill **stays on the laptop** — it is moving fast enough and the lead will re-run its 10 failures there when it ends. Do not touch `run-plan.py` / `run-legiscan.py`. The box takes it over only as the *weekly* `lv-national-sweep` (step 6); the ledger seed in step 4.1 happens after the laptop run finishes — build and test the script, run the seed only if `pgrep -f run-plan.py` is empty, otherwise leave the seed to the lead and say so.

**Amendment 12:50 (Brendan) — A/B the national backfill, box vs laptop.** Take **half of what remains** on the box, now, in parallel with the laptop, and measure. Add this as **step 5b**, before the LDA/FEC hand-over if they are not started yet, otherwise alongside them (`free -m` first; the national run needs `--heap 4096`).

- **Box takes:** West Virginia (48 datasets, 96 MB), Wyoming (18, 26 MB), and the laptop's 10 failures — Colorado 994 & 925, Georgia 1614/1404/1124/971/100/33, Hawaii 2245 & 2175 (88 MB). Run as one `run-job`: `national-sweep.mjs --all --only WV,WY,CO,GA,HI --failed-first` — but **skip any (state, session) the ledger or `Bills` already has from the laptop** (the laptop imported CO/GA/HI's other sessions; `--all` must not re-download those — if the script can't express "only these 10 of CO/GA/HI", run them as a second explicit list). The lead stops the laptop run the moment it reaches `WV`, so there is at most one overlapping dataset.
- **Laptop keeps:** Virginia, Vermont, Washington, Wisconsin (55 datasets, 257 MB), sequential, as it is now.
- **Measure, don't impress:** per dataset the handler already returns `zipBytes` and `ms`. Report for the box: count, total MB, wall-clock, **median and p90 seconds per dataset**, and **seconds per MB** in three size bands (<5 MB, 5–20 MB, >20 MB). The lead reports the same for the laptop from its log. Same importer build on both (confirm the box's `api/legiscan-sync.ts` commit matches the laptop's bundle: the laptop runs the working tree as of `83bca15` + your ledger/`STATE_BY_ID` change is *not* in its bundle — say so; the ledger write is the only behavioural difference).
- **Then New Mexico's 28 as `NM` and New Jersey's remaining 8** (the `state` repair + new-importer refresh), same job or a second `run-job` — that is the cleanup the lead promised, and the box is the right place for it. Report NM `People`/`Roll Call` state counts before and after (expected: `NJ` 558→~272 people, 56,455→~48,069 roll calls; `NM` 0→~285 / ~8,386).

1. `pkill -f run-lda-all.py` (both walkers), `pkill -f run-fec-all.py` — from the laptop.
2. Wait until `pgrep -f 'run-lda.py|run-fec.py|run-legiscan.py'` is empty (the in-flight call finished and banked its work). **Not before** — two writers on the same rows is the deadlock 44b hit on 2026-07-28 (WORKER-BOX §11).
3. Read the resume points from the database (`"LobbyingSync"`, `count(*) where fec_fetched_at is null`, the seeded `LegiscanDatasets` vs the plan) and paste them in the report as the hand-over baseline.
4. Start each on the box through `run-job`, one at a time, e.g.
   `~/bin/run-job lda-2026 env JOB_CWD=$HOME/livingston node scripts/box/lda-backfill.mjs 2026 2025` — then `tmux ls` and the first 20 log lines. MAX_CONCURRENT on the box is 2 for a reason (2 vCPU); run national + one LDA walker first, FEC is I/O-bound and cheap, so three is acceptable **only** if `free -m` shows >2 GB headroom — report the number.
5. The national run's 10 failures: `national-sweep.mjs --failed-first --only CO,GA,HI` (or whatever the seed shows missing) — they are the first thing the box should finish.
6. FEC extras (`--detail extras`) is the overnight job: queue it as a **one-shot manifest** (`"cadence": "once"` is not supported by run-due — so either run it via `run-job` tonight before you leave the box, or add a 3-line `once` cadence to run-due that deletes its own state after success; your call, say which).

## Step 6 — the schedule: manifests, Vercel crons off

`livingston/ops/box/jobs.d/` (installed to `~/jobs.d/` by an `ops/box/install.sh` in livingston that copies **only** manifests and never touches 44b's files), each with `"repo": "livingston"` and the house `_why` prose:

| file | job | cadence | steps |
|---|---|---|---|
| `lv-bills-sync.json` | `lv-bills-sync` | nightly | `scripts/box/run-handler.mjs api/bills-sync.ts` |
| `lv-legiscan-delta.json` | `lv-legiscan-delta` | nightly | delta for NY, then NJ, then US (three steps, one job) |
| `lv-lda-delta.json` | `lv-lda-delta` | nightly | `run-handler api/lda-sync.ts mode=delta` |
| `lv-national-sweep.json` | `lv-national-sweep` | weekly, Sunday | `scripts/box/national-sweep.mjs` (hash-diffed; replaces the three Sunday dataset crons and covers the other 49 states) — `heap_mb: 4096` |
| `lv-fec-refresh.json` | `lv-fec-refresh` | weekly, Monday | `scripts/box/fec-backfill.mjs --cycles 2026 --detail basic --batch 8` with `refresh=7` semantics (the handler's default) |

- Name prefix `lv-` so the box's digest and `tmux ls` read at a glance; files sort after 44b's (`arxiv-daily` … `zz-discord-digest`) — `zz-` is last on purpose there; put `lv-` before it or explain the order in `_order`.
- `run-due --dry-run` on the box must show all five as `never run` → due. Paste it.
- **The wake:** `44b-wake-nightly` (`cron(15 7 ? * * *)` UTC = 03:15 ET) already starts the box daily; livingston's nightly jobs ride it. The Vercel crons ran at 10:00–10:50 UTC; moving them to 07:15 UTC is fine (NY Senate API updates overnight; LegiScan datasets rebuild weekly). No new EventBridge schedule unless you find a reason — if you do, mirror `ops/box/scheduler-policy.json` / `scheduler-trust.json` and report the ARN.
- Remove the seven `crons` entries from `livingston/vercel.json` (keep the `api/*` routes — they stay callable by hand with `CRON_SECRET`). Commit by pathspec; **no push**.
- The morning digest (`report-due`) keys on `~/logs/<job>.log` and `EXIT=`; confirm your runner's exit codes make a livingston failure show 🔴 (run one deliberately failing `run-job lv-smoke node scripts/box/run-handler.mjs api/legiscan-sync.ts mode=dataset session=0` — it must exit non-zero — and quote the autostop/log lines).

## Step 7 — leave it clean

- `rm ~/.no-auto-jobs ~/.keep-up`. The running backfills keep the box up; the janitor stops it when the last one ends. **Do not stop the box by hand while a job is running.**
- Laptop: confirm no `run-*.py` remains (`pgrep`). Do not delete the scratchpad.
- Commit (no push) in both repos, by pathspec, with the report filed.

## Hard rules

Never print a secret (pipe them, §10) · `--region us-east-1` on every AWS call · no `src/` changes · no schema change beyond `LegiscanDatasets` and nothing destructive (no `DROP`, no `DELETE` of rows you did not just insert) · never two writers on the same table (step 5.2) · **no push, no Linear** · if the box shows any 44b job running, wait for it · if anything about the AWS account or the box looks different from WORKER-BOX.md, **stop and report rather than improvise** · budget: the box at $0.072/h — a full day is $1.73; say what it burned.

## Reporting — into this file, under **Report** below, and the lead is polling

Per ORCHESTRATION §1: **heartbeat before going heads-down**, not after. Before each step write one line under Report — `HH:MM step N — doing X, expect ~Y min` — and when done, the result. Never end a turn with a job in flight and nothing written. The lead watches this file, the box's `tmux ls`, and row counts on a timer; a stale heartbeat is treated as a stall.

Final report sections: box state + burn · the run-job/run-due diff verbatim · `run-due --dry-run` before/after · runner + drivers (paths, usage lines) · hand-over baseline (the numbers from step 5.3) and the box-side first log lines for each job · ledger seed counts vs plan · manifests installed · `vercel.json` diff · the deliberate-failure proof · what was deliberately not done · deviations · **one paragraph: what should change about this pattern now that two repos share the box.**

---

## Report

*(lane writes here)*

### Heartbeats

**12:10 step 0** — lane WB picked up. Reading WORKER-BOX.md, ops/box/*, the doctrines, and the four handlers before touching anything. Expect ~15 min of reading, no writes to the box or repos yet.

**12:13 step 1** — reading done (WORKER-BOX §0–§11, `run-job`/`job-janitor`/`run-due`/`install.sh`/`arxiv-daily.json`, ORCHESTRATION §1/§2/§9, RIG §6/§10, the four handlers, `vercel.json`, the scratchpad drivers). Laptop state confirmed: 4 python parents alive — `run-plan.py` (on TX 2160), `run-lda-all.py 2026,2025,2024,2023` (now year=2025 p1), `run-lda-all.py 2024,2023` (year=2024 p1901), `run-fec-all.py 2026,2024 8`. Now: AWS identity + start the box, expect ~5 min.

**12:20 step 1** — box `i-030d9cac100e6e124` running at 98.93.70.27, account **638175140432** (`2525-cli`), us-east-1c, t4g.large — matches WORKER-BOX.md. `~/.no-auto-jobs` + `~/.keep-up` set at 16:17:01Z. **The first start (12:12) was stopped by `run-due --boot`'s no-op wake** — the maintenance flags are not boot-proof (`run-due` does `rm -f ~/.keep-up` *before* its 120 s grace, so a pre-existing flag is consumed); re-started 12:16 and claimed inside the window, log now reads `16:19:08Z stood down during the grace window`. Two pre-existing **44b** failures seen on that wake, not mine, flagged below. Next: deploy key + clone + `npm ci`, expect ~10 min.

**12:22 step 1 done** — deploy key `id 161601630` "44b-worker (read-only)" registered on `nyd-user-1/livingston`, private half generated on the box and never left it; push refused (`Please make sure you have the correct access rights`). `~/.ssh/config` alias `github-livingston` added alongside 44b's `github.com` block. `~/livingston` cloned at `0b746d5`; `npm ci --no-audit --no-fund` → **476 packages in 13 s**, `aarch64`, `@esbuild/linux-arm64` present, `esbuild 0.27.3` / `@neondatabase/serverless` / `fflate` all import clean. `.env.local` mode 600 with exactly the six keys.
Round-trip, 7 runs, first dropped: **box `select 1` min 6 ms / median 8 ms; laptop min 24 ms / median 33 ms.** (`count(*) from "Bills"` is 145–187 ms *on both* — it is a 1.89 M-row seq scan, not a latency probe; `Bills` = 1,892,928 rows from the box at 16:21Z, 1,892,957 from the laptop seconds later, the national backfill inserting between the two.) Next: step 2 runner test on the box, then step 3, expect ~20 min.

**12:24 step 3 — 🚩 STOP-AND-REPORT, resolved in place.** The box's live `~/bin/run-due` **is not** `~/Code/44b/ops/box/run-due`. Commit `694d25b` (2026-08-05, *"every manifest has been harvesting with no sync_runs row since day one"*) added `--env-file=.env.local` to the two `sync-run.mjs` ledger calls and dropped the `2>/dev/null`; commit `baf67a3` (2026-08-08, *"Grants and Funders reach the sidebar, and three smaller fixes"*) **reverted that hunk verbatim** while adding the maintenance inhibit — a stale-editor overwrite, not a decision (its own message never mentions it). The box has not been re-installed since, so it still runs the *fixed* copy. **Re-running `ops/box/install.sh` from `main` as step 3 instructs would have silently re-broken the sync_runs ledger for all five 44b manifests** and put `/api/cron/status` back to reporting them `never-run`. I am restoring `694d25b`'s hunk in the repo as commit 1, then layering the repo generalisation on top as commit 2, so `install.sh` is safe again. `run-job` repo-vs-box is byte-identical. Expect ~20 min.

**12:29 step 3 done** — 44b commits `a6135bd` (restore) + `ce56b78` (generalise), no push. `run-due --dry-run` before/after with timestamps stripped is **byte-identical for all six installed manifests** — same decisions, same WOULD-RUN strings. `JOB_CWD` verified live on the box: no `JOB_CWD` → `/home/ubuntu/44b`, `JOB_CWD=$HOME/livingston` → `/home/ubuntu/livingston`. Installed by `scp` of `run-job`+`run-due` only, **not** `install.sh` — see deviation D2. Next: step 4, the ledger + three drivers, expect ~40 min.

**12:33 step 4 — 🚩 SECOND FLAG, a data defect the sweep must not inherit.** Resolving `state_id` → postal properly turned up a live mislabel. **`getSessionList` with no `state` param** (993 rows, one query) carries `state_abbr` *and* `dataset_hash`, so the map needs no derivation at all: it says **`30 = NJ`, `31 = NM`**. `api/legiscan-sync.ts`'s `STATE_BY_ID` says `31: "NJ"`, and `national-full-plan.json` was built from that — so:
- the plan's 28 rows labelled **NJ are New Mexico's sessions** (annual regular + many specials; real NJ runs 2-year sessions — `2026-2027 Regular Session`, `session_id 2250`, which the handler's own `CURRENT.NJ.id` already uses);
- **real New Jersey (state_id 30, 9 datasets, 2010→2026) is absent from the plan entirely** — that, not a deliberate exclusion, is why the plan is 989 rows and the dataset list is 998. (Separately, 9 *other* rows — old AL/FL/HI/NV/OR/WI organizational and special sessions — are in `getDatasetList` but not `getSessionList`; all 998 still resolve by `state_id`, and the 989 hashes the two calls share agree exactly, 0 differ.)
- **Damage, measured, not inferred:** `Bills` is *fine* — `mapBill` reads `bill.state` out of the archive, so NM bills are `state='NM'` (28 sessions, ~20 k rows). But `mapPerson`/`mapRollCall` take the handler's `?state=` argument, so **New Mexico's legislators and roll calls are stored as `state='NJ'`: `People` NJ = 558 / NM = 0, `"Roll Call"` NJ = 56,468 / NM = 0.**
Repairing those rows is an UPDATE on data I did not insert — **out of lane WB's hard rules, left for the lead.** In scope and being done: `national-sweep.mjs` takes its postal from `getSessionList` (so NJ's 9 datasets finally import and NM's people/roll calls land as NM), and I am correcting the three-entry `STATE_BY_ID` backstop so nothing re-derives the wrong answer.

**12:34 step 4** — written: `scripts/box/run-handler.mjs` (tested: 401 → exit 1, 200 → exit 0, `--heap` re-exec works, on both machines), `national-sweep.mjs`, `lda-backfill.mjs`, `fec-backfill.mjs`; ledger + `STATE_BY_ID` fix in `api/legiscan-sync.ts`; plan copied to `ops/box/national-full-plan-2026-08-28.json` (989 rows, 51 "states", no NM). Sweep dry-run already earns its keep: `--all --only NJ` lists **real New Jersey's 9 datasets, 171 MB, none ever imported**. Now proving the ledger write with one small real import on the box (NJ session 31, 2010-2011, 12 MB — a dataset no other writer anywhere is touching), expect ~5 min.

**12:40 step 4 done / step 5 starting** — ledger proven end to end on the box: `national-sweep.mjs --all --only NJ --limit 1 --failed-first` imported **NJ session 31 (2010-2011), 8,234 bills, 12.1 MB, in 20 s**, and wrote `LegiscanDatasets(NJ, 31, hash=419fceddb2ce…, size=12051137, year=2010, bills=8234, ms=19562)`. Independent check: `Bills` now has 8,234 NJ rows at `legiscan_session_id=31` and NJ's null-session count fell by exactly 8,234 (92,319 → 84,085) — the archive filled in session ids on rows that were already there. Five `lv-*` manifests + livingston's own `ops/box/install.sh` written; the seven `vercel.json` crons removed. **Now step 5: killing the two LDA walkers and the FEC loop on the laptop** (the national backfill stays, per the 11:50 amendment), waiting for their in-flight children, then reading the hand-over baseline. Expect ~10 min.

**12:42 step 5 done — hand-over complete.** Laptop: `pkill -f run-lda-all.py` + `pkill -f run-fec-all.py` at 12:38; the FEC loop had no child in flight, the two LDA children (`year=2025 page=501`, `year=2024 page=2301`) were allowed to finish and banked their work — **drained 12:41:16**. `run-plan.py`/`run-legiscan.py` untouched and still going (national backfill, per the amendment).

**Hand-over baseline, read from the database at 16:41Z, after the drain:**
| | |
|---|---|
| `"LobbyingSync"` | `year:2026 = done` · `year:2025 = 601` · `year:2024 = 2401` (2023 not started) |
| FEC `"People"` | 726 crosswalked · **169 basic done, 557 left** at `refresh=30` · 1 extras done · **0 `fec_error`** |
| Lobbying rows | 131,134 filings · 245,517 activities · 213,442 bill mentions · 212,972 resolved (99.8%) |
| `"LegiscanDatasets"` | 1 row (the NJ-31 proof) — **seed still owed, see below** |
| `"Bills"` | 1,982,995 rows · 841 distinct `(state, legiscan_session_id)` |

Both restarted on the box at 16:41, **each under its manifest's own job name** so `run-due`'s "already running" guard makes a second writer structurally impossible (documented in the two manifests' `_backfill`):
- `lv-lda-delta` → `node scripts/box/lda-backfill.mjs 2026 2025 2024 2023`; first log lines: `year 2026: already marked done in "LobbyingSync" — nothing to walk` / `year 2025: resuming at page 601` — i.e. it read the resume point the handler itself wrote, exactly the baseline above.
- `lv-fec-refresh` → `node scripts/box/fec-backfill.mjs --cycles 2026,2024 --detail basic --batch 8 --refresh 30`.
`free -m` with both up: **7,291 MB available of 7,802** — the two-job `MAX_CONCURRENT` is nowhere near the constraint on this box; 2 vCPU is. Next: the deliberate-failure proof, then cleanup. Expect ~10 min.

**12:47 step 5b picked up** — the 12:50 A/B amendment was added to the file after I had read it; LDA and FEC are already handed over and running, so step 5b runs *alongside* them (three jobs; `free -m` said 7,291 MB of 7,802 available with two up). `--only WV,WY` plus an explicit list of the 10 failures needs two things `national-sweep.mjs` cannot say yet — a specific `(state, session)` list, and "skip what `Bills` already has *without* writing seed rows" (the global seed is still barred while `run-plan.py` runs). Adding `--sessions ST:ID,…` and `--skip-imported` now, then launching. Expect ~10 min to launch, then it runs.

**12:45 step 5b running.** `national-sweep.mjs` gained two flags (`--sessions ST:ID,…` = queue exactly these whatever anything else says; `--skip-imported` = read `"Bills"` and treat every `(state, legiscan_session_id)` it holds as imported-hash-unknown **without writing seed rows**, so the global seed stays barred while `run-plan.py` runs). Launched as a third `run-job`, under the `lv-national-sweep` name so `run-due` cannot start the weekly sweep beside it:
```
JOB_CWD=$HOME/livingston ~/bin/run-job lv-national-sweep node --max-old-space-size=4096 \
  scripts/box/national-sweep.mjs --skip-imported --failed-first --only WV,WY \
  --sessions CO:994,CO:925,GA:1614,GA:1404,GA:1124,GA:971,GA:100,GA:33,HI:2245,HI:2175
```
Queue is exactly **76 datasets / 210.9 MB** = WV 48 + WY 18 + the 10 named failures — the dry run confirmed `"Bills"` already holds `WY:67` (224 bills) so WY is 18 of 19, and **WV has nothing at all**, so there is no overlap to race the laptop for. `free -m` with three jobs up: **7,265 MB available of 7,802**, load 0.07.
**A/B fairness, stated up front:** the laptop runs the scratchpad bundle built 09:43 from `83bca15` — `grep LegiscanDatasets` on it returns **0**, and it still carries `31: "NJ"`. The box runs `9da6645`. The only behavioural differences are one extra `INSERT` per dataset (the ledger row) and the `STATE_BY_ID` backstop, which never fires because every call passes `?state=`. Same importer otherwise.

**12:47 — the deliberate-failure proof (step 6), done.** `~/logs/lv-smoke.log`:
```
HTTP 400 {"error":"no known current session for ZZ; pass ?session="}
EXIT=1
```
`~/logs/autostop.log`:
```
2026-08-28T16:45:08Z [lv-smoke] janitor armed
2026-08-28T16:45:38Z [lv-smoke] job ended (EXIT=1)
2026-08-28T16:45:38Z [lv-smoke] other jobs still running (lv-fec-refresh lv-lda-delta lv-national-sweep) — leaving the box up
```
Two things are proved, not one: the runner turns a non-2xx into a real non-zero `EXIT=`, which is what `report-due` colours red; and the janitor, seeing a job end while others run, leaves the box up instead of stopping it. (`sleep 5` precedes the failing call deliberately — `run-job` does *not* arm a janitor for a job that dies inside 3 s, so an instant failure would have proved only half of it. `state=ZZ` and no `session=` is the cheapest real 400 in the handler: zero API calls, zero writes. `session=0` — the brief's suggestion — would **not** have failed: `Number(0) || CURRENT.NY.id` falls through to 2188 and would have downloaded NY's 72 MB archive.)

**FEC extras — my call: chained, not a `once` cadence.** `--detail extras` is gated on `fec_fetched_at IS NOT NULL`, so it can only ever cover members `basic` has already finished; started now it would have covered 169 of 726 and reported itself complete. So instead of adding a `once` cadence to `run-due` (new scheduler semantics for one night) I restarted `lv-fec-refresh` as one job with `basic && extras`: correct ordering, one log, one exit code, and nothing new in 44b to maintain. The four minutes of `basic` already done were not lost — it resumes from `People.fec_fetched_at`. First batch measured: **76 queries / 8 members in 99 s, 9.5 calls a member, remaining 549** → ≈5.5 h for basic at 950/h, then ≈3 h for extras (~4 calls a member).

**12:49 heartbeat** — three jobs healthy, box load 0.30, 7.06 GB of 7.80 free. `lv-national-sweep` 45/76 (all ten named failures already done, WV specials flying past at 1-2 s each); `lv-lda-delta` on 2025 page 801 of ~4,358, 100 pages per 150 s; `lv-fec-refresh` restarted with extras chained, pacing correctly (`sleeping 117s (batch spent 65s of the 182s 48 queries are worth)`). Secret hygiene re-verified on the box: livingston `.env.local` holds exactly the six keys, `DATABASE_URL`/`BEDROCK_*`/`RESEND_*`/`CF_*`/`FOLLOWTHEMONEY_API_KEY`/`AUTH_SECRET` all absent, 44b's own 8-key `.env.local` untouched, no AWS credentials on disk. Probe and smoke logs removed from `~/logs` so tomorrow's digest has no phantom red lines (`report-due` selects `-newermt @$BOOT`, so only this session's logs would have shown — the 130 historical logs on the box were never at risk). Waiting on the sweep to finish for the A/B numbers, then the NM/NJ repair (37 datasets, 205.7 MB, dry-run confirmed), then the final report.

---

# FINAL REPORT — lane WB

## 1. Box state and burn

| | |
|---|---|
| AWS account | **638175140432**, `arn:aws:iam::638175140432:user/2525-cli` |
| instance | `i-030d9cac100e6e124`, t4g.large, **us-east-1c** — as WORKER-BOX.md describes it |
| started | 16:12:59Z (stopped itself, see D1), re-started and claimed **16:17:01Z** |
| flags | `~/.no-auto-jobs` + `~/.keep-up` from 16:17:01Z; **both removed at the end, see §11** |
| still running at hand-off | `lv-lda-delta`, `lv-fec-refresh` (basic → extras), and the national work — the janitor stops the box when the last one ends |
| **drift found vs WORKER-BOX.md** | the doc says *93 GB free*; the box is at **71 GB used, 25 GB free (75%)**. Not a problem for this lane (the clone + `node_modules` is ~500 MB) but the number in the manual is a year stale. |
| burn | $0.072/h. My own working window 16:12→17:0x is **≈ $0.06**. The backfills I left running are the real cost: ≈5.5 h of FEC basic, then ≈3 h of extras, alongside ≈4 h of LDA — call it **11 h of box, ≈ $0.79**, and the box stops itself the moment the last of them ends. Waste to declare: **one wasted start**, ~4 minutes and about half a cent, because I did not know the maintenance flags are not boot-proof (D1). |

## 2. `run-job` / `run-due`, the diff, verbatim

Two commits in `~/Code/44b`, **not pushed**:
`a6135bd` — restore the ledger fix `baf67a3` reverted (flagged at 12:24, see §10 F1)
`ce56b78` — the generalisation below.

```diff
diff --git a/ops/box/run-due b/ops/box/run-due
index ad72f64..4958ab8 100755
--- a/ops/box/run-due
+++ b/ops/box/run-due
@@ -22,6 +22,7 @@
 #     "day":     1,                    # monthly only: day of month
 #     "enabled": true,
 #     "heap_mb": 6144,                 # optional --max-old-space-size
+#     "repo":    "livingston",         # optional: a checkout under $HOME. Default 44b.
 #     "steps":   ["scripts/a.mjs --apply", "scripts/b.mjs --apply"]
 #   }
 #
@@ -145,6 +146,7 @@ fi
 # ── walk the manifests ───────────────────────────────────────────────────────
 launched=0
 considered=0
+refreshed=""          # repos already fetched this run, other than the default
 shopt -s nullglob
 for mf in "$JOBS_DIR"/*.json; do
   [ "$INHIBIT" = 1 ] && continue
@@ -155,6 +157,9 @@ for mf in "$JOBS_DIR"/*.json; do
   weekday=$(python3  -c "import json,sys;print(json.load(open(sys.argv[1])).get('weekday','null'))" "$mf")
   dom=$(python3      -c "import json,sys;print(json.load(open(sys.argv[1])).get('day','null'))"   "$mf")
   heap=$(python3     -c "import json,sys;print(json.load(open(sys.argv[1])).get('heap_mb') or '')" "$mf")
+  # A second repo on the box (livingston's ingestion, lane WB). Absent means 44b,
+  # so every manifest written before this line keeps the path it has always taken.
+  repo=$(python3     -c "import json,sys;print(json.load(open(sys.argv[1])).get('repo') or '44b')" "$mf")
 
   [ -n "$job" ] || { say "  $(basename "$mf"): no 'job' field — skipped"; continue; }
 
@@ -162,6 +167,11 @@ for mf in "$JOBS_DIR"/*.json; do
     say "  $job: disabled in its manifest"; continue
   fi
 
+  job_repo="$HOME/$repo"
+  if [ ! -d "$job_repo/.git" ]; then
+    say "  $job: no checkout at $job_repo — skipped"; continue
+  fi
+
   if [ "$FORCE" != "ALL" ] && [ "$FORCE" != "$job" ]; then
     reason=$(is_due "$job" "$cadence" "$weekday" "$dom") || { say "  $job: $reason"; continue; }
   else
@@ -181,6 +191,19 @@ for mf in "$JOBS_DIR"/*.json; do
     continue
   fi
 
+  # A repo other than the default was not refreshed above; do it here, once per
+  # repo per run, and only for a job that is actually about to launch. Same rule
+  # as the block at the top: a failed fetch is not a reason to skip the night.
+  if [ "$DRY" = 0 ] && [ "$job_repo" != "$REPO" ] && ! printf '%s' " $refreshed " | grep -q " $repo "; then
+    if git -C "$job_repo" fetch --depth 1 origin main -q 2>>"$LOG" &&
+       git -C "$job_repo" reset --hard origin/main -q 2>>"$LOG"; then
+      say "repo($repo): $(git -C "$job_repo" rev-parse --short HEAD)"
+    else
+      say "repo($repo): WARNING fetch/reset failed, running the existing checkout"
+    fi
+    refreshed="$refreshed $repo"
+  fi
+
   # Build the command: every step in sequence, aborting at the first failure,
   # wrapped in the sync_runs ledger so /api/cron/status can see this harvest.
   node_bin="node"
@@ -206,12 +229,23 @@ PY
   # The stderr suppression went with it. A ledger write that fails must land in
   # the job log, where report-due's digest will read it back out; that is the
   # whole reason a bookkeeping failure is allowed to be non-fatal.
-  cmd="RID=\$(node --env-file=.env.local scripts/lib/sync-run.mjs open $job); rc=0;"
+  # The sync_runs ledger is 44b's: /api/cron/status joins it. A repo without
+  # scripts/lib/sync-run.mjs gets the same stepper and the same exit code, minus
+  # the two bookkeeping calls — never a crash, and never a swallowed $rc.
+  if [ -f "$job_repo/scripts/lib/sync-run.mjs" ]; then
+    cmd="RID=\$(node --env-file=.env.local scripts/lib/sync-run.mjs open $job); rc=0;"
+  else
+    cmd="rc=0;"
+  fi
   while IFS= read -r step; do
     [ -n "$step" ] || continue
     cmd="$cmd if [ \$rc -eq 0 ]; then echo \"── step: $step\"; $node_bin --env-file=.env.local $step || rc=\$?; fi;"
   done <<< "$steps"
-  cmd="$cmd node --env-file=.env.local scripts/lib/sync-run.mjs close $job \"\$RID\" \$rc >/dev/null; exit \$rc"
+  if [ -f "$job_repo/scripts/lib/sync-run.mjs" ]; then
+    cmd="$cmd node --env-file=.env.local scripts/lib/sync-run.mjs close $job \"\$RID\" \$rc >/dev/null; exit \$rc"
+  else
+    cmd="$cmd exit \$rc"
+  fi
 
   if [ "$DRY" = 1 ]; then
     say "  $job: $reason — WOULD RUN: $cmd"
@@ -220,7 +254,7 @@ PY
   fi
 
   say "  $job: $reason — launching"
-  if "$HOME/bin/run-job" "$job" bash -lc "$cmd" >>"$LOG" 2>&1; then
+  if JOB_CWD="$job_repo" "$HOME/bin/run-job" "$job" bash -lc "$cmd" >>"$LOG" 2>&1; then
     # Stamp the launch, not the completion: a long harvest must not be started
     # again by the next wake just because it has not finished yet.
     sed -i "/^$job=/d" "$STATE" 2>/dev/null
diff --git a/ops/box/run-job b/ops/box/run-job
index 8819370..70324df 100755
--- a/ops/box/run-job
+++ b/ops/box/run-job
@@ -2,7 +2,7 @@
 # run-job <name> <command...>
 #
 # The standard way to start a job on the 44B worker box.
-#   - runs <command> detached in tmux, from ~/44b, logging to ~/logs/<name>.log
+#   - runs <command> detached in tmux, from ${JOB_CWD:-~/44b}, logging to ~/logs/<name>.log
 #   - records the command's real exit code (not tee's) as the log's last line
 #   - arms a janitor that stops this instance when the LAST job finishes
 #
@@ -30,8 +30,16 @@ LOG="$HOME/logs/$NAME.log"
 # would reach tmux as `bash -c sleep 45; echo hi` and exit instantly.
 CMD=$(printf '%q ' "$@")
 
+# The box now carries two repos. JOB_CWD names the one this job belongs to;
+# unset means 44b, so every existing caller is unchanged. Resolved HERE and
+# embedded in the command string rather than left for the new shell to expand:
+# a tmux session's environment comes from the server, not necessarily from this
+# client, and a job silently starting in the wrong repo is not a failure anyone
+# would see until the harvest was already wrong.
+CWD="${JOB_CWD:-$HOME/44b}"
+
 tmux new -d -s "$NAME" \
-  "bash -lc 'cd ~/44b && $CMD 2>&1 | tee \"$LOG\"; echo EXIT=\${PIPESTATUS[0]} >> \"$LOG\"'"
+  "bash -lc 'cd \"$CWD\" && $CMD 2>&1 | tee \"$LOG\"; echo EXIT=\${PIPESTATUS[0]} >> \"$LOG\"'"
 
 # A job that dies on the launch line (typo, bad path, missing script) must never
 # be able to stop the box. Confirm it is actually alive before arming anything.
```

## 3. `run-due --dry-run`, before and after — the regression test

The brief's regression test could not be run as written: **the maintenance inhibit blinds `--dry-run`.** `[ "$INHIBIT" = 1 ] && continue` sits inside the manifest loop, so with `~/.no-auto-jobs` in place a dry run prints `considered 0 manifest(s)` and nothing else. A dry run launches nothing, so it has no business being suppressed — but changing that would itself change a reported decision, which is precisely what this test exists to detect. So the flag was moved aside for the ~2 s of each run and restored immediately (the hourly catch-up timer's next fire was 27 minutes away, checked first).

**Before** (six 44b manifests) and **after** (same six, with `run-job`/`run-due` replaced) are **byte-identical once timestamps are stripped** — same decisions, same `WOULD RUN` command strings:

```
  arxiv: not due (0d of 1d)
  ext-benchmarks: not due (1d of 7d)
  hf-sweep: due (16d since last) — WOULD RUN: RID=$(node --env-file=.env.local scripts/lib/sync-run.mjs open hf-sweep); rc=0; …
  openalex: not due (25d of 28d)
  openreview: due (35d since last) — WOULD RUN: RID=$(node --env-file=.env.local scripts/lib/sync-run.mjs open openreview); rc=0; …
  uspto-grants: not due (2d of 7d)
considered 6 manifest(s), launched 2
```

**After the five livingston manifests are installed** — the five appear, the six are unchanged, and livingston's steps carry no `sync-run.mjs` wrapper because livingston has no `scripts/lib/sync-run.mjs`:

```
  arxiv: not due (0d of 1d)
  ext-benchmarks: not due (1d of 7d)
  hf-sweep: due (16d since last) — WOULD RUN: RID=$(node --env-file=.env.local scripts/lib/sync-run.mjs open hf-sweep); …
  lv-bills-sync: never run — WOULD RUN: rc=0; if [ $rc -eq 0 ]; then echo "── step: scripts/box/run-handler.mjs api/bills-sync.ts"; node --env-file=.env.local scripts/box/run-handler.mjs api/bills-sync.ts || rc=$?; fi; exit $rc
  lv-fec-refresh: never run — WOULD RUN: rc=0; … node --env-file=.env.local scripts/box/fec-backfill.mjs --cycles 2026 --detail basic --batch 8 || rc=$?; fi; exit $rc
  lv-lda-delta: never run — WOULD RUN: rc=0; … node --env-file=.env.local scripts/box/run-handler.mjs api/lda-sync.ts mode=delta || rc=$?; fi; exit $rc
  lv-legiscan-delta: never run — WOULD RUN: rc=0; … mode=delta state=NY …; … mode=delta state=NJ …; … mode=delta state=US …; exit $rc
  lv-national-sweep: never run — WOULD RUN: rc=0; … node --max-old-space-size=4096 --env-file=.env.local scripts/box/national-sweep.mjs || rc=$?; fi; exit $rc
  openalex: not due (25d of 28d)
  openreview: due (35d since last) — WOULD RUN: …
  uspto-grants: not due (2d of 7d)
considered 11 manifest(s), launched 7
```

All five livingston jobs read **`never run` → due**, as required. `JOB_CWD` verified live and separately: with no `JOB_CWD` a job lands in `/home/ubuntu/44b`; with `JOB_CWD=$HOME/livingston` it lands in `/home/ubuntu/livingston` and reads livingston's `package.json`.

## 4. The runner and the drivers

All in `livingston/scripts/box/`, all resumable from the database, none of them holding a checkpoint file.

| file | what it is | usage |
|---|---|---|
| `run-handler.mjs` | bundles an `api/*.ts` with esbuild in process, imports it, calls it with a fake `(req, res)`, prints `HTTP <status> <json>`, **exits 0 only on 2xx** | `node scripts/box/run-handler.mjs [--heap 4096] api/legiscan-sync.ts mode=delta state=NY` |
| `national-sweep.mjs` | the weekly national refresh and the backfill's completion — two list calls, hash-diffed against the `"LegiscanDatasets"` ledger | `node scripts/box/national-sweep.mjs [--seed\|--all\|--skip-imported] [--only NY,NJ] [--sessions CO:925,…] [--failed-first] [--dry-run] [--limit N]` |
| `lda-backfill.mjs` | walks whole filing years, resuming from the page `api/lda-sync.ts` itself wrote to `"LobbyingSync"` | `node scripts/box/lda-backfill.mjs 2026 2025 2024 2023` |
| `fec-backfill.mjs` | loops until the handler answers `remaining=0`, paced on measured queries against 950/h | `node scripts/box/fec-backfill.mjs --cycles 2026,2024 --detail basic --batch 8 --refresh 30` |

Decisions worth naming:

- **Env: the runner reads `.env.local` itself**, and only for keys not already exported. `node --env-file=` would have worked, but then the same command would need three spellings — by hand, under `run-job`, under `run-due` (which already passes `--env-file`). This way there is one spelling and run-due's values still win.
- **`--heap` re-execs once** with `--max-old-space-size`, marked by `RUN_HANDLER_HEAP` so it cannot recurse, forwarding SIGINT/SIGTERM to the child.
- **The bundle goes to a temp file, not a `data:` URL.** A stack trace out of a 250 KB data URL is unreadable.
- **One child process per dataset.** A single long-lived process importing 998 archives would accumulate; the child is also where `--heap 4096` belongs.
- **`secret=` on the command line beats `CRON_SECRET`.** That is how the auth path gets exercised without a live run — and it is what makes the smoke test in §8 cost nothing.

## 5. Hand-over: baseline, and the box's first log lines

Killed on the laptop at 12:38 — `pkill -f run-lda-all.py` (both walkers) and `pkill -f run-fec-all.py`. The FEC loop had no child in flight; the two LDA children (`year=2025 page=501`, `year=2024 page=2301`) were **allowed to finish and bank their work**, draining at **12:41:16**. `run-plan.py` / `run-legiscan.py` never touched.

**Baseline, read from the database at 16:41Z, after the drain:**

| | |
|---|---|
| `"LobbyingSync"` | `year:2026 = done` · `year:2025 = 601` · `year:2024 = 2401` · 2023 not started |
| FEC `"People"` | 726 crosswalked · 169 basic done · **557 left** at `refresh=30` · 1 extras done · **0 `fec_error`** |
| Lobbying | 131,134 filings · 245,517 activities · 213,442 bill mentions · 212,972 resolved (99.78%) |
| `"LegiscanDatasets"` | 1 row (the NJ-31 proof) |
| `"Bills"` | 1,982,995 rows · 841 distinct `(state, legiscan_session_id)` |
| NJ/NM before the repair | `People` NJ **558** / NM **0** · `"Roll Call"` NJ **56,468** / NM **0** · `Bills` NM 19,936 / NJ 92,319 |

**Box-side first log lines.**

`~/logs/lv-lda-delta.log` — it read the resume point the handler itself wrote, matching the baseline exactly:
```
16:41:46 year 2026: already marked done in "LobbyingSync" — nothing to walk
16:41:46 year 2025: resuming at page 601 (100 pages an invocation)
16:44:13 year 2025 page 601 → 701 in 147s — HTTP 200 {"ok":true,"mode":"year","year":2025,"queries":100,"filings":2500,"activities":4945,"billMentions":2380,"billsResolved":2351,"total":108959,"lastPage":700,"nextPage":701,"ms":147026}
```

`~/logs/lv-fec-refresh.log` (first run, before the extras chaining — kept as `lv-fec-refresh.first-run.txt`):
```
16:41:54 fec-backfill: detail=basic cycles=2026,2024 batch=8 refresh=30 pacing=950/h
16:43:33 batch 1: 76 queries, 99s, remaining 549 — running rate 2763/h
16:43:33    pacing: sleeping 189s (batch spent 99s of the 288s 76 queries are worth)
```
(`running rate` is measured over elapsed-since-start, so the first batch reads high — it has not paid a pacing sleep yet. It converges on 950 within a few batches. Cosmetic; left alone rather than restarting a live job twice.)

`~/logs/lv-national-sweep.log` (step 5b):
```
16:44:32 --skip-imported: "Bills" holds 849 (state, session) pairs; 848 of them were not in the ledger and count as imported for this run only
16:44:32 lists: getSessionList 993 rows, getDatasetList 998 rows
16:44:32 lists: dataset_hash agrees on 989 shared session(s), disagrees on 0
16:44:32 plan: 998 datasets · skipped 1 seeded + 0 unchanged + 921 filtered + 0 unresolved · 76 to import · 210.9 MB
16:44:41 [1/76] CO 925 2012 3.5 MB 8s — HTTP 200 {"ok":true,"mode":"dataset","state":"CO","queries":1,"zipBytes":3502209,…,"bills":645,…}
```

**Concurrency.** `free -m` with all three up: **7,265 MB available of 7,802**, load average **0.30**. Memory is nowhere near the constraint on this box — 2 vCPU is, and even that is idle, because all three jobs are rate-limited rather than compute-bound (LegiScan zips are the only CPU work and they arrive one at a time). The brief's ">2 GB headroom" gate is met by a factor of three.

**Each backfill was started under its manifest's own job name** — `lv-lda-delta`, `lv-fec-refresh`, `lv-national-sweep` — not under a name of its own. `run-due` refuses to launch a manifest whose tmux session already exists, so name reuse is what makes a second writer on the same tables *structurally* impossible rather than something someone has to remember. Written into each manifest's `_backfill` key.

## 6. Ledger seed — **still owed, and it is the one thing this lane could not finish**

The seed is deliberately not run: `run-plan.py` is still importing on the laptop, and seeding now would write `dataset_hash = NULL` ("imported, hash unknown, do not re-download") rows for sessions that are **half** imported — they would then never be re-downloaded. That is the amendment's own instruction, and it is the right one.

**What the lead must run, once `pgrep -f run-plan.py` is empty:**

```bash
IP=$(aws ec2 describe-instances --region us-east-1 --instance-ids i-030d9cac100e6e124 \
      --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
ssh -i ~/.ssh/44b-worker.pem ubuntu@$IP \
  'cd ~/livingston && node scripts/box/national-sweep.mjs --seed-only'
```

It prints the insert count, the bills it covers, a per-state breakdown, and — the second, independent count — every row of `ops/box/national-full-plan-2026-08-28.json` that has **no** ledger row, which is the list of datasets that never landed.

⚠ **`lv-national-sweep` will fail red on its first firing if the seed has not happened.** That is by design (the script refuses an empty ledger rather than silently re-downloading 998 archives), but `run-due` stamps a job when it *launches*, not when it succeeds — so a failed first Sunday pushes the next attempt out seven days. After seeding, force it once: `~/bin/run-due --job lv-national-sweep`.

## 7. Manifests installed

`livingston/ops/box/jobs.d/`, installed by `livingston/ops/box/install.sh` (which copies `lv-*.json` and **nothing else** — the scheduler, the systemd units and the EventBridge wake stay 44b's to install):

| file | job | repo | cadence | steps |
|---|---|---|---|---|
| `lv-bills-sync.json` | `lv-bills-sync` | livingston | nightly | `run-handler api/bills-sync.ts` |
| `lv-fec-refresh.json` | `lv-fec-refresh` | livingston | weekly, Monday | `fec-backfill.mjs --cycles 2026 --detail basic --batch 8` |
| `lv-lda-delta.json` | `lv-lda-delta` | livingston | nightly | `run-handler api/lda-sync.ts mode=delta` |
| `lv-legiscan-delta.json` | `lv-legiscan-delta` | livingston | nightly | delta NY, then NJ, then US — three steps, one job |
| `lv-national-sweep.json` | `lv-national-sweep` | livingston | weekly, Sunday | `national-sweep.mjs`, `heap_mb: 4096` |

Box after install: **5 livingston manifests, 6 44b manifests untouched.**

**On ordering**, since the brief asked. `run-due` globs `~/jobs.d/*.json` in filename order, so the five land `lv-bills-sync, lv-fec-refresh, lv-lda-delta, lv-legiscan-delta, lv-national-sweep`, and `lv-` sorts before `zz-discord-digest` as required. One thing that falls out of that is **not** ideal and is written into `lv-legiscan-delta.json`'s `_order` rather than quietly fixed: `lda` sorts before `legiscan`, so the lobbying job resolves bill numbers against `"Bills" WHERE state='US'` *before* the night's Congress delta has banked them. It costs at most one day — `lda-sync`'s delta window is two days of `dt_posted`, so the same filing is re-ingested tomorrow and its resolver re-runs against `bill_id IS NULL`. Renaming the file would fix the ordering and break the correspondence with the brief's own table; the mechanism is recorded instead. If it ever matters, the fix is a filename, not code.

## 8. `vercel.json`, and the deliberate-failure proof

Seven crons removed; the `api/*` routes, the rewrites, the headers and the 120 s `maxDuration` all stay, so every route is still callable by hand with `CRON_SECRET`.

```diff
--- a/vercel.json
+++ b/vercel.json
-  ],
-  "crons": [
-    { "path": "/api/bills-sync",                                        "schedule": "0 10 * * *" },
-    { "path": "/api/legiscan-sync?mode=delta&state=NY",                 "schedule": "30 10 * * *" },
-    { "path": "/api/legiscan-sync?mode=delta&state=NJ",                 "schedule": "40 10 * * *" },
-    { "path": "/api/legiscan-sync?mode=delta&state=US",                 "schedule": "50 10 * * *" },
-    { "path": "/api/legiscan-sync?mode=dataset&state=NY&session=2188",  "schedule": "0 11 * * 0" },
-    { "path": "/api/legiscan-sync?mode=dataset&state=NJ&session=2250",  "schedule": "20 11 * * 0" },
-    { "path": "/api/legiscan-sync?mode=dataset&state=US&session=2199",  "schedule": "40 11 * * 0" }
   ]
 }
```
(shown compacted; the real diff is the same seven objects in the file's own multi-line style.)

**No new EventBridge schedule.** `44b-wake-nightly` (`cron(15 7 ? * * *)` UTC = 03:15 ET) already starts the box daily and livingston's nightly jobs ride it. The crons ran at 10:00–11:40 UTC; 07:15 UTC is earlier, which is fine — the NY Senate updates overnight and LegiScan rebuilds its archives weekly, so nothing is being asked for before it exists. Nothing was created, so there is no ARN to report.

**The deliberate failure.** `~/logs/lv-smoke.log`:
```
HTTP 400 {"error":"no known current session for ZZ; pass ?session="}
EXIT=1
```
`~/logs/autostop.log`:
```
2026-08-28T16:45:08Z [lv-smoke] janitor armed
2026-08-28T16:45:38Z [lv-smoke] job ended (EXIT=1)
2026-08-28T16:45:38Z [lv-smoke] other jobs still running (lv-fec-refresh lv-lda-delta lv-national-sweep) — leaving the box up
```
Two things proved, not one: the runner turns a non-2xx into a real non-zero `EXIT=`, which is what `report-due` colours red; and a janitor whose job dies while others run leaves the box up rather than stopping it under them.

Two deliberate departures from the brief's suggested command, both because it would not have proved anything:
- **`sleep 5` first.** `run-job` does not arm a janitor for a job that dies inside 3 s — that is its documented safety behaviour — so an instant failure would have produced no `autostop.log` lines at all.
- **`state=ZZ` with no `session=`, not `mode=dataset session=0`.** `Number(req.query?.session) || CURRENT[state]?.id` means `session=0` falls *through* to NY's 2188 and would have downloaded NY's 72 MB archive and returned **200**. `state=ZZ` is the cheapest genuine 400 in the handler: no API call, no write.

The log was deleted afterwards, along with three `wb-probe-*` logs from the `JOB_CWD` test, so tomorrow's digest has no red lines for jobs that do not exist. (`report-due` selects `-newermt @$BOOT`, so only this session's logs were ever in scope — the ~130 historical logs on the box were never at risk.)

## 9. Step 5b — the A/B, measured

**Same importer on both sides, and the difference stated first.** The laptop runs the scratchpad bundle built 09:43 from `83bca15`: `grep -c LegiscanDatasets` on it returns **0**, and it still carries `31: "NJ"`. The box runs `9da6645`. The only behavioural differences are one extra `INSERT` per dataset (the ledger row) and the corrected `STATE_BY_ID` backstop — which never executes, because every call passes an explicit `?state=`. So the box is doing marginally *more* work per dataset, not less.

**Box side, `--only WV,WY --sessions <the ten> --skip-imported --failed-first`, three jobs running concurrently:**

```
STATS count=76 totalMB=210.9 wallClock=432s medianSecs=4.2 p90Secs=13.4 handlerMedianSecs=4.0
STATS band <5MB:   n=63 MB=92.8  medianSecsPerMB=4.22 p90SecsPerMB=13.53 bills=36988
STATS band 5-20MB: n=12 MB=96.7  medianSecsPerMB=1.65 p90SecsPerMB=1.87  bills=46203
STATS band >20MB:  n=1  MB=21.4  medianSecsPerMB=0.94 p90SecsPerMB=0.94  bills=6132
done: requested 76 · imported 76 · failed 0
EXIT=0
```

| | |
|---|---|
| datasets | **76 of 76, zero failures** — WV 48, WY 18, and **all ten** of the laptop's failures |
| total | **210.9 MB, 89,323 bills, 432 s wall clock** (16:44:32 → 16:51:44) |
| per dataset | median **4.2 s**, p90 **13.4 s**; handler-only median **4.0 s** |
| throughput | **0.49 MB/s sustained**, 10.6 datasets a minute, ~207 bills/s |

Read the bands the right way round: **seconds-per-MB is *worse* for small archives, not better** (4.22 vs 0.94). That is fixed cost — node start, the esbuild bundle, `prepareSchema`'s DDL — amortising over more bytes, and it is why the `<5MB` band's p90 of 13.53 s/MB comes from 0.1 MB West Virginia special sessions that still cost a second each. The number that matters for a 30 GB national pass is the large-archive figure: **≈1 s per MB, falling below 1 s past 20 MB.**

**The ten failures are gone.** All ten imported on the first attempt, no retry needed — including `CO:925` (8 s), one of the two Colorado stack-overflows that `83bca15` fixed, and `CO:994`, which had *half*-imported on the laptop (734 bills) and which any "do we have it?" test would have called done. That is exactly why `--sessions` forces rather than asks.

*(The laptop's half of the A/B — VA, VT, WA, WI — is the lead's to report from its own log. The box's numbers above are directly comparable: same bands, same definition of a dataset, wall clock measured by the driver.)*

## 10. Flags for the lead — three, in order of how much they matter

**F1 · `main`'s `run-due` was three weeks stale, and installing it would have re-broken 44b's ledger.** `694d25b` (2026-08-05, *"every manifest has been harvesting with no sync_runs row since day one"*) put `--env-file=.env.local` on run-due's two `scripts/lib/sync-run.mjs` calls and dropped the `2>/dev/null`. `baf67a3` (2026-08-08, *"Grants and Funders reach the sidebar, and three smaller fixes"*) **reverted that hunk verbatim** — its message never mentions it, and the maintenance inhibit it claims to add was already in the tree from `3aeda75`/`0633cb6`. A stale editor buffer, not a decision. The box was never re-installed in between, so `~/bin/run-due` has been running the *correct* file all month while `main` carried the broken one. Step 3 says "re-run `ops/box/install.sh`" — doing that from `main` as it stood would have silently put `/api/cron/status` back to reporting all five 44b harvests `never-run` while they ran fine. Restored as `a6135bd`, verified byte-identical to `~/bin/run-due`, before anything else was touched. **The general lesson is in §12.**

**F2 · `STATE_BY_ID[31]` is New Mexico, not New Jersey — and 28 datasets were imported under the wrong label.** `getSessionList` with no `state` parameter settles it: 993 rows each carrying `state_abbr`, and it says **30 = NJ, 31 = NM**. `national-full-plan.json` was built from the wrong map, so:
- the plan's 28 rows labelled `NJ` are **New Mexico's** sessions (annual regular + many specials; New Jersey runs two-year sessions — `2026-2027 Regular Session`, `session_id 2250`, which the handler's own `CURRENT.NJ.id` already uses);
- **real New Jersey — state_id 30, nine bulk archives, 2010→2026 — was never in the plan at all.** That, not a deliberate exclusion, is why the plan is 989 rows and the dataset list is 998. (Separately, nine *other* rows — old AL/FL/HI/NV/OR/WI organizational and special sessions — are in `getDatasetList` but not `getSessionList`; all 998 still resolve by `state_id`, and the 989 hashes the two calls share agree exactly, 0 differ.)
- **Damage, measured:** `Bills` survived it, because `mapBill` reads `bill.state` out of the archive — New Mexico's bills are `state='NM'`. But `mapPerson` and `mapRollCall` take the handler's `?state=` argument, so New Mexico's legislators and roll calls were stored as `state='NJ'`: `People` NJ **558** / NM **0**, `"Roll Call"` NJ **56,468** / NM **0**.
Fixed forward, three ways: the sweep takes its postal code from `getSessionList` and **skips, loudly, any dataset whose state it cannot establish** rather than guessing; the `STATE_BY_ID` backstop is corrected with the whole story in a comment above it; and the 12:50 amendment's repair pass is §9b below.

**F3 · two 44b jobs are failing on the box, and have been for weeks.** Seen on the 16:17Z wake, before I touched anything, and left alone — they are not mine:
- `openreview` → Postgres **`28P01`**, password authentication failed. 44b's `DATABASE_URL` on the box is stale or rotated. Last successful run 35 days ago.
- `hf-sweep` → `EXIT=2`, a usage error: *"No boundary given. Run --census first, then pass at least one of --min-downloads N --min-likes N --held-arxiv --any-arxiv"*. The manifest's step passes neither. Last successful run 16 days ago.
Both die on their launch line, so `run-job` correctly refuses to arm a janitor and the box is not left burning — but both have been silently stale for weeks. Also: **the repo has eight manifests and the box has six** (`fact-stats` and `zz-discord-digest` are not installed). That drift is why I did not run 44b's `install.sh` — see D2.

## 11. Deviations, and what was deliberately not done

**D1 · The maintenance flags are not boot-proof, and the first start was lost to it.** The brief says "first thing after SSH: `touch ~/.no-auto-jobs ~/.keep-up`". Both were touched — but `run-due --boot` does `rm -f "$HOME/.keep-up"` **before** its 120 s grace and only checks for the file afterwards, so `.keep-up` is a *cancel-during-the-window* flag, not a persistent hold; and `.no-auto-jobs` only inhibits if it exists when the manifest walk begins. The box started at 16:12:59, its boot `run-due` found nothing due at 16:17:08, and stopped it. Re-started at 16:16, claimed at 16:17:01 — inside the window this time — and the log reads `16:19:08Z stood down during the grace window`. Cost: ~4 minutes and about half a cent. **Fix, if the lead wants it: honour `.no-auto-jobs` in the no-op stop as well, or do not `rm` a `.keep-up` the operator placed before the run started.**

**D2 · I did not run 44b's `ops/box/install.sh`; I `scp`'d `run-job` and `run-due` and `chmod +x`'d them.** That is exactly what `install.sh` does for those two files. What it *also* does is `scp jobs.d/*.json`, and the repo has eight manifests against the box's six — so a faithful `install.sh` would have added `fact-stats` and `zz-discord-digest` to a box that has never run them, changing 44b's nightly schedule and making the before/after dry-run incomparable. Adding 44b jobs is outside this lane and is the lead's call (F3).

**D3 · `--dry-run` was run with `~/.no-auto-jobs` moved aside for ~2 s.** The inhibit blinds the dry run (§3). The catch-up timer's next fire was checked first — 27 minutes out.

**D4 · The box is running code that is not in `origin/main` yet, because this lane does not push.** `~/livingston` is a `--depth 1` clone of `main` at `0b746d5`, with my work `scp`'d on top and md5-verified identical to the laptop's. `scripts/box/` and `ops/box/` are **untracked**, so they survive `git reset --hard`; `api/legiscan-sync.ts` is **tracked and modified**, so it does **not**.
> ⚠ **`run-due` fetch/resets a repo before launching one of its jobs. The first `lv-*` job to launch will therefore revert `api/legiscan-sync.ts` on the box to `origin/main` and the ledger write will disappear** until the lead pushes. Nothing breaks — `hash=`/`special=` simply become ignored query parameters and `national-sweep.mjs` still creates the ledger table itself — but no new hashes get recorded, so the weekly diff stays blind and re-imports. **Push `9da6645`+`a538783` (livingston) and `a6135bd`+`ce56b78` (44b) and it self-heals on the next wake.** The three nightly manifests do not depend on the patch at all, so tonight is safe either way.

**D5 · `session_id int`, per the brief, not `bigint`.** `Bills.legiscan_session_id` is `bigint`, so the seed casts `::int`. Session ids are ~2,300 today; the cast is safe by four orders of magnitude and keeps the ledger's key narrow. Noted only because it is a departure from the source column's type.

**D6 · The ledger seed is not run** — the reason and the exact command are in §6. This is the one deliverable this lane hands back unfinished, and deliberately.

**Deliberately not done:**
- **No repair of the mislabelled `People` / `"Roll Call"` rows by `UPDATE`.** The hard rules forbid it. The repair was done the legitimate way instead — by re-importing the archives under the right `?state=` (§9b), which the upsert turns into the same correction with the importer as the authority.
- **No fix to either failing 44b job** (F3). Not this lane's repo, and both are one-line changes someone with the context should make.
- **No new EventBridge schedule.** The existing 03:15 ET wake is sufficient; nothing was created, so there is no ARN.
- **No `once` cadence added to `run-due`.** Chaining `basic && extras` in one `run-job` gets the ordering right with no new scheduler semantics to maintain (§8 of the heartbeats).
- **No `src/` change, no schema change beyond `"LegiscanDatasets"`, no `DROP`, no `DELETE`.** `prepareSchema`'s existing `DROP INDEX IF EXISTS` lines are untouched and pre-existing.
- **`FOLLOWTHEMONEY_API_KEY` and every other non-harvest secret stayed off the box** — verified by name, values never printed.

## 12. What should change about this pattern now that two repos share the box

The pattern held up better than I expected — `run-job`, the janitor and `run-due` needed **eighteen lines** between them to carry a second repo, and the six 44b manifests came through byte-identical. What does not scale is the seam I fell into within twenty minutes of starting: **`ops/box/` in git is not the box, and nothing anywhere checks.** `~/bin/run-due` had been three weeks ahead of `main` since 2026-08-08 and the only reason anyone knows is that I diffed before installing; with one repo that is a habit, with two it is a coin flip, because each lane installs from its own tree and neither can see the other's drift. The cheap fix is to make the box self-describing rather than to add process: have `report-due` put one line in the morning digest — `run-due md5 f7a4927 · 44b 746fc4a · livingston 0b746d5` — and have each `install.sh` refuse when the box's copy differs from git without an explicit `--force`. Then a silent revert costs one morning instead of a month, which is exactly the class of failure ORCHESTRATION §9 says to design for: not an error, a success that was quietly wrong. Two smaller things follow from sharing rather than from drift. **`MAX_CONCURRENT=2` is now one pool across two schedules**, so livingston's long backfills can starve 44b's nightly harvests and neither manifest can say "I need a slot"; the honest options are a per-repo reservation or a bigger box, and until then the `lv-` prefix in `~/logs/<job>.log` is doing load-bearing work in a flat namespace that nothing enforces. And **the maintenance flags assume one operator** — `.keep-up` is consumed by the very run it is meant to survive (D1), and `~/.no-auto-jobs` blinds `--dry-run`, which is the one tool a second lane should be reaching for constantly. Both are three-line changes. The deeper point is that the box's contract was written for a single repo and a single person at the keyboard; everything above is the cost of that assumption, and none of it is expensive to fix now rather than at 03:00 on a night when both repos have work due.

**D7 · one small `run-job` edge, found by using it.** Restarting a job under the same name while its previous janitor is still inside its 30 s poll makes `tmux new -d -s "w-$NAME"` fail with `duplicate session: w-lv-national-sweep`, and `set -euo pipefail` takes `run-job` down with it — **after** the job itself has already started. So the operator sees a failure and the job is running. It is not dangerous here (the surviving janitor is name-scoped, so it simply adopts the new session and did the right thing), but the message is misleading and the exit code is wrong. Worth `tmux has-session -t "w-$NAME" || tmux new …` if anyone touches that file again.

**The `git reset --hard` claim in D4 was verified, not assumed** — in a throwaway clone: an untracked `scripts/box/x.mjs` that also exists in the target commit is silently overwritten, `rc=0`, tree clean. So when the lead pushes, the box's `scp`'d copies are replaced by the identical tracked ones with no error and no manual step.

## 9c · A hazard I created, then closed — the runaway gate

Worth writing down because I *made* it. The sweep's empty-ledger refusal only fires when the ledger has **no** rows. Tonight's box work put 88 real rows in it — so on the first weekly firing the guard would have stayed quiet, and every one of the ~870 sessions the **laptop** imported, which the ledger has never heard of, would have looked *never imported*. Measured rather than reasoned about: `--dry-run` against today's half-populated ledger queued **910 datasets / 4,825 MB**, of which **871 are sessions `"Bills"` already holds rows for**. A 4.8 GB re-download that would have reported itself a success — the exact silent-wrongness shape of ORCHESTRATION §9. **A partially populated ledger is strictly more dangerous than an empty one.**

So the gate now asserts the *shape* of the work rather than the ledger's size (RIG §10: assert what the filters are supposed to reject, not a bare total):

```
national-sweep: REFUSING to run.
  871 of the 910 datasets queued are sessions "Bills" already holds rows for,
  which is over the --max-refetch ceiling of 25. That means the ledger is incomplete,
  not that 871 archives changed this week — running would re-download them all.
  Fix it: node scripts/box/national-sweep.mjs --seed-only     (record what we already have)
  Or say you meant it: --all | --skip-imported | --max-refetch <n>
```

`--sessions` entries are exempt — forcing a specific re-import is the one case where re-fetching what you have is the point. Committed as `2333631`. **This makes §6 safe rather than merely documented: if the seed is forgotten, the Sunday job fails loudly and cheaply instead of spending four hours and 4.8 GB looking healthy.**

And a correction that came out of the same measurement: the "**~30 GB** for a full national pass" figure I put in the script header, the manifest and `9da6645`'s commit message was **invented**. Summed from the dataset list it is **5.21 GB** (998 archives). Corrected in the script and the manifest; the commit message of `9da6645` still carries the wrong number and is not worth a rebase to fix — this line is the correction of record.

## 9b · The New Mexico / New Jersey repair — done, and it conserves exactly

Second `run-job` under the same name, once the WV/WY run finished: `national-sweep.mjs --all --only NM,NJ --failed-first` — New Mexico's 28 archives re-imported as `?state=NM`, New Jersey's 9 as `?state=NJ`. No `UPDATE`: the repair is the importer's own upsert (`People … ON CONFLICT (people_id) DO UPDATE SET state = EXCLUDED.state`) doing what it was always going to do once it was told the right state.

```
STATS count=37 totalMB=205.7 wallClock=349s medianSecs=4.8 p90Secs=27.0 handlerMedianSecs=4.5
STATS band <5MB:   n=28 MB=34.5 medianSecsPerMB=3.19 p90SecsPerMB=16.06 bills=19954
STATS band 5-20MB: n=5  MB=79.8 medianSecsPerMB=1.52 p90SecsPerMB=1.60  bills=46611
STATS band >20MB:  n=4  MB=91.4 medianSecsPerMB=1.21 p90SecsPerMB=1.39  bills=45708
done: requested 37 · imported 37 · failed 0
EXIT=0
```

| | before | **after** | the lead's expectation |
|---|---|---|---|
| `People` NJ | 558 | **273** | ~272 |
| `People` NM | 0 | **285** | ~285 |
| `"Roll Call"` NJ | 56,468 | **48,069** | ~48,069 |
| `"Roll Call"` NM | 0 | **8,399** | ~8,386 |

**The check that makes it trustworthy is conservation, not the totals.** `273 + 285 = 558` and `48,069 + 8,399 = 56,468` — exactly, to the row, in both tables. Every mislabelled row *moved*; none was created, none lost. That is the independent second count ORCHESTRATION §2 asks for, and it is a stronger statement than either column on its own.

A bonus that fell out of importing New Jersey's nine archives properly: **`Bills` where `state='NJ'` and `legiscan_session_id IS NULL` went from 92,319 to 0.** Every New Jersey bill now carries the session it belongs to, so New Jersey is finally addressable the way the other fifty jurisdictions are.

`"LegiscanDatasets"` now holds **113 rows** with real hashes — 76 from WV/WY/the failures, 37 from this pass, and the original NJ-31 row updated in place rather than duplicated (the `ON CONFLICT (state, session_id) DO UPDATE` path, exercised for real).

**Box totals for step 5b as a whole: 113 datasets, 416.6 MB, 89,323 + 112,273 bills, 781 s of wall clock, zero failures.**

## 6b · ⚠ §6 IS SUPERSEDED — the lead seeded it while I was writing, and the plan cross-check needs reading carefully

Picked up from the box and the laptop's process table at 13:00, not from a message: **the lead stopped `run-plan.py` at 12:58:52, at its first WV dataset (`=== WV 2254 (2026 regular, 7.8 MB) 12:58:49 ===`) — exactly the hand-off point the 12:50 amendment named — and ran the seed.** So §6's "still owed" is no longer true. State as of 13:00:

| | |
|---|---|
| `"LegiscanDatasets"` | **977 rows** — 113 with a **real hash** (everything the box imported today), 864 seeded `NULL` |
| plan rows with no ledger row | **49** … of which **28 are not gaps at all** |

**Read the 49 carefully, because 28 of them are the F2 mislabel wearing a disguise.** The plan labels New Mexico's 28 sessions `NJ`; they are now correctly in the ledger as `NM`, so a naive `plan.state:session ∈ ledger` test misses every one of them. Verified: all 28 resolve if you look under `NM`. **The real gap is 21 datasets, and they total ~2 MB:**

```
AZ:215 AZ:214 AZ:209 · FL:1917 FL:1179 FL:1176 · HI:1710 HI:1478 · LA:1985
MN:1779 MN:1773 MN:1767 MN:1764 · NC:1609 NC:1606 NC:1446 NC:1223 · OK:2100 OK:1984 · WI:1556 WI:1069
```

Every one is 0.0–0.2 MB — organizational and special sessions. Which exposes a property of the seed worth naming: **it keys off `"Bills"`, so it cannot tell "never imported" from "imported and legitimately empty."** A session whose archive contains no bills leaves no rows, gets no seed row, and looks like a hole forever. These 21 are almost certainly that, not failures — but "almost certainly" is not a number, so I am settling it the only way that produces one: importing them for real, which writes a real `dataset_hash` either way and takes under a minute for 2 MB.

Running now as `lv-national-sweep --sessions <the 21> --failed-first`. **After it, the ledger's real-hash count is the honest completeness figure, and the plan cross-check should read 21 fewer.**

## 6c · The 21 were real gaps, not empty sessions — and the national backfill is now complete

My hypothesis was wrong, which is why it was worth 39 seconds to test instead of asserting.

```
STATS count=21 totalMB=1.9 wallClock=39s medianSecs=1.2 p90Secs=2.1 handlerMedianSecs=1.0
done: requested 21 · imported 21 · failed 0
EXIT=0
```

**Not one of the 21 was empty.** Every archive carried bills — 1, 1, 2, 2, 3, 3, 4, 6, 6, 6, 7, 7, 8, 8, 9, 20, 24, 37, 62, 62, 97 — **375 bills across 21 sessions that had never landed anywhere.** They were small enough to look like noise and were skipped by the plan; the seed could not have told you, because the seed reads `"Bills"` and there were no rows to read.

**Completeness, stated the way ORCHESTRATION §3 asks for it — with a timestamp and the corpus it ran against:**

> **At 17:01:43Z, `"LegiscanDatasets"` holds 998 rows against a `getDatasetList` of 998 — every dataset LegiScan publishes has a ledger row.** 134 carry a real `dataset_hash` (imported by the box today, hash-verifiable from next week on); 864 are seeded `NULL` (imported earlier by the laptop, hash unknown, will not be re-downloaded). The plan cross-check reports 28 rows unmatched and **all 28 are the F2 New Jersey/New Mexico mislabel** — they exist in the ledger under `NM`. **Genuine gaps: 0.**

That is the backfill finished, and it is finished in a form the weekly sweep can act on rather than a claim in a report. The remaining honest caveat is the one §6b names: the 864 seeded rows assert "imported", not "imported completely" — anything the laptop was mid-archive on when it was stopped at WV 2254 is sealed with a `NULL` hash. There is exactly one such candidate, and closing it is one cheap command:

```bash
ssh -i ~/.ssh/44b-worker.pem ubuntu@$IP \
  'cd ~/livingston && node scripts/box/national-sweep.mjs --sessions WV:2254 --failed-first'
```
(WV 2254 is in fact already imported *by the box* in step 5b with a real hash, so this is belt-and-braces; the general point stands for any future stop.)

## 13. Leaving it clean

- `~/.no-auto-jobs` and `~/.keep-up` **removed** at 16:59:02Z. The final `run-due --dry-run` — with no flag moved aside, nothing suppressed — lists all **11 manifests**, the six 44b ones with their unchanged verdicts and all five `lv-*` as **`never run`** → due.
- **Every file on the box byte-matches the repo**: `run-handler.mjs`, `national-sweep.mjs`, `lda-backfill.mjs`, `fec-backfill.mjs`, `api/legiscan-sync.ts`, the plan JSON, all five manifests in `~/jobs.d/`, and `~/bin/run-job` + `~/bin/run-due` against `~/Code/44b`. Thirteen md5s, thirteen matches.
- **Still running, with their janitors armed**: `lv-lda-delta` (2025 page 1301 of ~4,358, then 2024 from 2401, then 2023) and `lv-fec-refresh` (`basic` → `extras` chained; 517 members left). The last one out stops the box — verified live at 17:01:53Z when the sweep ended and the janitor said `other jobs still running (lv-fec-refresh lv-lda-delta) — leaving the box up`. **The box was not stopped by hand and must not be.**
- **Laptop**: `run-lda*` and `run-fec*` are **0**. The national driver was stopped by the lead at 12:58:52 at WV 2254. The scratchpad is untouched.
- **Commits, none pushed.** `livingston`: `9da6645` (the move), `a538783` (`--sessions`/`--skip-imported`/STATS), `2333631` (the runaway gate + the 5.21 GB correction), and this report. `44b`: `a6135bd` (restore F1), `ce56b78` (the second-repo change). Both worktrees are otherwise clean.

## 14. Where it stands

**Done:** livingston runs on the box — clone, deploy key, six secrets, runner, three drivers, ledger, five manifests, seven Vercel crons gone. `run-job`/`run-due` carry a second repo with the 44b regression proved byte-identical. LDA and FEC handed over mid-flight without losing a page or a member. The national backfill is **finished and provable**: 998 of 998 datasets ledgered, 0 genuine gaps, including 21 sessions and 375 bills that had never landed. New Mexico and New Jersey are repaired, conserving to the row. Two defects found and fixed forward (F1 `run-due`, F2 the state map), one hazard created and closed (the runaway gate), three flags left for the lead (F1–F3).

**Owed, and small:** push the four commits — until then the box's `api/legiscan-sync.ts` reverts to `origin/main` on the first `lv-*` launch and the ledger stops recording new hashes (D4; nothing else breaks, and it self-heals on the push). Decide on F3's two broken 44b jobs. Decide whether `fact-stats` and `zz-discord-digest` belong on the box (D2).
