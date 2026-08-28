# Lane DP — the direct pipeline: every jurisdiction, from the source, on our boxes

**Written:** 2026-08-28 14:30 ET, by the lead (Fable). **Window:** `/rename direct-pipeline`, `/color magenta`.
**Model:** Opus. **Repo:** `~/Code/livingston`. **Runs on:** worker-box-2 (`livingston-worker-2`, built by lane IN) for scraping; the 44b box keeps the LegiScan/LDA/FEC/text jobs.
**Starts when:** lane IN's Report is complete (`prompts/2026-08-28-independence.md`) — its provenance map, credential map, scraper runs, diff tables and mapper are this lane's inputs. Read that report first, then lane WB's (`prompts/2026-08-28-worker-box.md`) for the runtime, then lane BT's for the text fetcher and the politeness rules.

## The decision (Brendan, 2026-08-28 14:20)

> We use LegiScan now and leverage it as much as possible, maybe for a long time. We get everything we can from Open States. No reinventing the wheel. **And** we establish our own pipeline for all 51, direct to the states, so that we never have to rely on either platform.

So this lane is not a research lane and not a replacement-by-Friday. It is the standing pipeline: **for every jurisdiction, a scheduled job on our box that pulls bills, sponsors, actions, votes, versions/texts, committees and legislators from the legislature's own site or feed, and loads them into our schema** — with LegiScan still writing the canonical tables until, per state, the direct feed is shown to match. The engine for most states is the Open States scrapers we mirrored (GPL-3.0, we run them ourselves); where a legislature publishes a real feed (NY's Senate API, govinfo for Congress, and whatever lane IN's provenance map verified), we use the feed and take *everything* it offers — memos, agendas, calendars, hearing notices, fiscal notes — not the LegiScan subset.


**Amendment 15:20 ET (lead):** lane IN is closed; its usable outputs are committed (`docs/PROVENANCE.md`, `scripts/independence/*`, the 28 mirrors, `~/Code/scripts/SCRAPER-DOCTRINE.md`); there is no memo and no scraper A/B — do not wait for either. Worker-box-2 (`i-0843042df1a5fb003`, `livingston-worker-2`) is **stopped**; start it, touch the maintenance flags within two minutes of boot, and note its SSH key is the one lane IN made (find it in that lane's report §2). **The NY Senate API is shared with `lv-text-ny`** on box 1 (5 req/s, ~15 h left): build and test `native/ny.mjs` on samples of ≤ 200 bills until that job's log ends in `EXIT=0`, then run it in full. Brendan's framing, verbatim: *"what I thought we were doing was creating 51 loaders, that's all"* — that is this lane; keep the deliverable that plain.

## Deliverables

1. **`ops/box2/`** — worker-box-2's manifests and install, mirroring `ops/box/` (one job per jurisdiction or per group of small ones; `run-job`/`run-due` are already there). Nightly for the states in session, weekly otherwise; `run-due` decides from the manifest.
2. **`scripts/pipeline/`**
   - `scrape.mjs <jurisdiction>` — drives the mirrored Open States scraper for that jurisdiction (docker or poetry, whichever lane IN found works), with its default politeness, output to `~/cache/os/<jur>/`.
   - `load.mjs <jurisdiction>` — lane IN's mapper, promoted: Open States JSON → schema `openstates` (our column names). Idempotent, keyed on `(state, session, bill_number)`.
   - `native/ny.mjs` — the NY Senate API, **all of it**: bills with every amendment's text and memo, sponsors and co-sponsors, actions, floor and committee votes, committee agendas, calendars, law references. This is the model for "everything from the state": NY is the product's home and the Senate API is the richest feed we have; it should leave nothing on the table.
   - `native/us.mjs` — govinfo BILLSTATUS (bulk XML, actions/sponsors/committees/votes references) + BILLS (text, already in BT) + `unitedstates/congress` for votes.
   - `native/<st>.mjs` for each jurisdiction whose provenance row says "structured feed, verified" — one per lane-IN finding, in order of size.
   - `reconcile.mjs <jurisdiction> <session>` — the diff, promoted from lane IN step 4 and made routine: per table, matched/unmatched/disagreeing with denominators, written to a `pipeline_reconcile` table with a timestamp so drift is a time series, and a one-line verdict per jurisdiction: **`parity`** (≥ 99% bills matched, ≥ 97% actions/sponsors agree), **`close`**, **`gap`**.
   - `promote.mjs <jurisdiction>` — the switch. For a jurisdiction at `parity` for two consecutive reconciles, the direct pipeline becomes the writer of the canonical tables for *new* rows, using the crosswalk to keep LegiScan ids where a row already has one, and minting ours (negative or a new sequence — say which) where it does not. **Runs only on Brendan's explicit instruction per jurisdiction.** LegiScan's delta keeps running alongside as a check, not a writer, for that jurisdiction.
3. **`docs/PIPELINE.md`** — for each of the 52: source (feed or scraper), credentials needed (from lane IN's credential map — list what Brendan must obtain, e.g. NY/IN/DC API keys), cadence, last reconcile verdict, and who writes canonical today (LegiScan or us).
4. **The crosswalk table** `bill_xref (state, session_id, bill_number, legiscan_bill_id, openstates_id, native_id)` built now from both sides while both exist, plus `people_xref` the same way (name + chamber + district + the `people` repo's ids).

## Order

1. NY native (`native/ny.mjs`) first — full depth, reconcile, report the diff. This proves "everything from the state" on the state that matters.
2. Congress native.
3. The Open States engine: NJ, then the 10 largest states by our bill counts (TX, IL, MN, TN, MA, CA, GA, HI, OK, PA), then the rest in batches of ten — each one: scrape → load → reconcile → `docs/PIPELINE.md` row. States whose scraper fails get a row that says so, with the error, and move to the end of the queue; a scraper we have to fix is a fix we commit to **our mirror**, with the reason.
4. Schedule everything that reached `close` or better on worker-box-2 via `run-due`; report the box's projected weekly hours and cost.
5. Nothing is promoted in this lane unless Brendan says the jurisdiction's name.

## Hard rules

Canonical tables (`"Bills"`, `"People"`, `"Sponsors"`, `"Roll Call"`, `"Votes"`, `"History Table"`, `"Documents"`, `"BillTexts"` …) are **read-only to this lane** except through `promote.mjs` on instruction · schema `openstates` and the two xref tables are yours · scrapers' politeness is not tunable down; native feeds ≤ 5 req/s and honour `Retry-After` · no credentials invented — a state that needs a key goes on Brendan's list with the sign-up URL · both boxes stop themselves; declare burn · no `src/` changes · **no push, no Linear** · never two writers on a table — check `tmux ls` on **both** boxes before starting anything that loads · if a source blocks us, stop that source and report.

## Reporting — into this file, under **Report**, and the lead is polling

Heartbeat before each step with the expected duration; a line when it lands; never end a turn with a job in flight and nothing written. Final report: NY native depth (what the Senate API gave that LegiScan did not, with counts) · Congress · the engine's first ten states with reconcile verdicts · `docs/PIPELINE.md` headline (how many of 52 at parity / close / gap / failed) · credentials Brendan must obtain · box-2 schedule and cost · deviations · what was deliberately not done · **one paragraph: what the search and product lanes should know about a corpus with two writers.**

---

## Report

*(lane writes here)*
