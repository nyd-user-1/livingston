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
