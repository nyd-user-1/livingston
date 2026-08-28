# Lane IN — where the data really comes from, and what it takes to not need LegiScan

**Written:** 2026-08-28 13:40 ET, by the lead (Fable). **Window:** `/rename independence`, `/color yellow`.
**Model:** Opus. **Repo:** `~/Code/livingston`. **Runs on:** a *second* worker box (see step 2) — not the 44b box, which is busy and must not get Docker, Python scrapers or GPL code.

## The question, as Brendan put it

> Assume LegiScan just decided not to exist in a week, a month, a year. Where are they getting all this data from, and can we begin getting it ourselves?

This lane answers that with evidence and a working prototype, not an opinion. **It does not replace LegiScan.** It establishes (1) exactly where every jurisdiction's data originates, (2) whether the open-source route — Open States' scrapers — covers what we use, (3) a measured comparison on real sessions, and (4) a costed plan. LegiScan stays primary; this is insurance, and the decision to buy more of it is Brendan's, made on the numbers this lane produces.

Read first: `prompts/2026-08-28-worker-box.md` (brief + Report — the box pattern and its hard-won gotchas), `~/Code/44b/docs/WORKER-BOX.md`, `~/Code/scripts/ORCHESTRATION-DOCTRINE.md` §1–§2, §9, `api/legiscan-sync.ts` (our schema is whatever `mapBill`/`mapPerson`/`mapRollCall` write).

## What we already know, so you don't re-derive it

- LegiScan is an **aggregator**. It scrapes/ingests each legislature's official site or data feed, normalises 52 different shapes into one schema (bill ids, status codes, people ids, roll calls, change hashes) and sells the API. The `state_link` on every one of our 2.3M `"Documents"` rows points at its *source* — that column is the map of where the data comes from, and it is already in our database.
- If LegiScan vanished tomorrow we would lose **updates**, not data: the weekly bulk archives are in Neon (2.2M bills), the worker box holds the ledger, and lane BT is pulling the text from the legislatures directly. The dependency is the daily delta and the id space (`bill_id`, `people_id`, `roll_call_id`).
- **Open States** (openstates.org, the project Plural maintains) is the open-source equivalent: `github.com/openstates/openstates-scrapers`, Python, Poetry, Docker, GPL-3.0, ~22k commits and active; one scraper per state; a public API v3 (`X-API-KEY`, free key) and periodic bulk data. It covers the 50 states + DC + PR; it does **not** cover Congress — federal is `github.com/unitedstates/congress` (govinfo/congress.gov, public domain), which lane BT already touches.

## Step 1 — the provenance map (no box needed; 1 hour)

From our own `"Documents"` and `"Bills"`: for each of the 52 jurisdictions, the `state_link` **hosts** (distinct hostnames, row counts, share of that state's documents), the mime mix, and the earliest/latest session we hold. That table *is* the answer to "where does LegiScan get it" — one row per jurisdiction, with the official site named. Add, per jurisdiction, whether the legislature publishes a **structured feed or bulk download** of its own (many do: NY Open Legislation API, CA's leginfo downloads, TX TLO FTP, FL's data files, govinfo for Congress…) — a column of URL + format + "verified by fetching one file: yes/no". Do not guess; a row you could not verify says so. Commit as `docs/PROVENANCE.md`.

## Step 2 — worker-box-2

Same recipe as lane WB's box, separate instance: `t4g.large` or `t3.large` (**x86 `t3.large` if any Open States dependency lacks an arm64 wheel — check before launching, report which**), 100 GB gp3, us-east-1, SSH from Brendan's IP only, an instance role that can stop only itself, `run-job`/janitor/`run-due` installed from 44b's `ops/box/` (the generalised ones — they carry a `repo` field now), **stopped by default**. Report type, rate, monthly-if-left-running, and storage before launching. **Spend cap for this lane: $15.** Tag it `Name=livingston-worker-2`. Docker + Python 3.11 + Poetry; clone `openstates-scrapers` and `unitedstates/congress`. Secrets on it: `POLICY_DATABASE_URL` only, and **only** because step 4 writes to a separate schema — see the rule below. No LegiScan key on this box, ever; the point is to measure what we get *without* it.

## Step 3 — run the scrapers for three sessions

`openstates-scrapers` for **NY (2025-2026), NJ (2026-2027)** and `unitedstates/congress` for **the 119th** — bills, sponsors, actions, votes, versions/texts, legislators. Record for each: wall clock, requests made, failures, output size, and what broke (Open States scrapers break when a legislature redesigns its site — that is the honest cost of independence, and the lane must show it rather than smooth it over). Output stays as the scrapers' native JSON on the box.

## Step 4 — map, load to a shadow schema, and diff

Create Postgres schema **`openstates`** in policy's Neon (not `public`; never touch `"Bills"` and friends): tables mirroring ours (`bills`, `sponsors`, `actions`, `votes`, `people`, `documents`) loaded from step 3's output with a mapper `scripts/independence/load-openstates.mjs` that emits our column names. Then **diff against LegiScan for the same three sessions**, per table:

- bills: count each side, matched by `(state, session, bill_number)`, % matched, title agreement, last-action-date agreement, status agreement (ours is derived — compare LegiScan's raw `status` to Open States' classification), bills only one side has (list the first 20 of each with a reason if you can find one);
- sponsors and actions: per matched bill, exact-set agreement %, and the common shapes of disagreement;
- votes: roll calls matched by date + chamber + motion; per-member vote agreement %;
- people: matched by name + chamber + district; % with an Open States id; **whether any external id in Open States overlaps ours** (VoteSmart, Ballotpedia, bioguide — LegiScan gave us these; does the open route?);
- texts: does Open States carry version URLs and text? Compare to our `state_link`.

Put the numbers in a table. A number without its denominator is not a number.

## Step 5 — the decision memo (`docs/INDEPENDENCE.md`)

One page, for Brendan, plain language: where the data comes from (step 1, summarised); what the open route gets right and wrong on real data (step 4); **what it would take to run all 52 on our own** — boxes, hours per week, expected breakage rate (Open States' own issue tracker gives a base rate — count the "scraper broken" issues opened in the last 90 days), and the id-space problem (our tables are keyed on LegiScan ids; a switch needs a crosswalk `(state, session, bill_number) → bill_id`, which we can build *now* while both exist, and the memo should say so); **three options with cost per month and freshness**: (a) LegiScan primary + Open States as a cold standby refreshed weekly; (b) both live, diffed nightly (the diff itself becomes a data-quality signal); (c) Open States primary. Recommend one. Also: the LegiScan bulk archives we hold — are they enough to rebuild from if the API stops? (Yes if we keep the zips; we do not keep them. Say whether we should, and where — S3 at ~$0.12/mo for 5 GB is the obvious answer.)

## Hard rules

Second box only; nothing on the 44b box · **no writes outside schema `openstates`** · no `src/` changes · no LegiScan API key on the new box · politeness: the scrapers' own rate limits stand, do not tune them down · spend ≤ $15, box stopped at the end (`run-job` janitor) · never print a secret · **no push, no Linear** · if a scraper needs credentials or a captcha, stop that jurisdiction and report — do not work around a site's access controls.

## Reporting — into this file, under **Report**, and the lead is polling

Heartbeat before each step with the expected duration; a line when it lands; never end a turn with a job in flight and nothing written. Final report: the provenance table's headline (how many of 52 have an official structured feed) · box numbers and burn · scraper runs (wall clock, failures) · the diff tables · the memo's recommendation in one sentence · deviations · what was deliberately not done.

---

## Report

*(lane writes here)*
