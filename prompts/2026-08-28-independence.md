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


**Amendment 13:45 (Brendan) — take a copy of Open States while it exists, and learn from it.** Open States is now run by a for-profit (Plural); the code is GPL-3.0 today and may not be tomorrow. Two additions:

**Step 0 (before step 2, ~30 min, laptop is fine):** mirror the whole `github.com/openstates` org into **our** GitHub as private mirrors, one per repo, named `mirror-openstates-<repo>`: `openstates-scrapers`, `people` (curated legislators with external ids — that is the crosswalk we want), `jurisdictions`, `openstates-core` (the scrape framework), `api-v3`, `documentation`, `openstates-geo` (district shapes → "find your legislator"), `openstates.org`. `git clone --mirror` + `gh repo create --private` + `git push --mirror`; record each repo's HEAD sha, size and licence file in the report. Also download Open States' **bulk data** (their data downloads page — all jurisdictions, latest) to the box's `~/cache/openstates-bulk/` and report the size; if it exceeds 20 GB take the current session only and say so. Licence stays GPL-3.0 in every mirror; we are keeping a copy, not relicensing.

**Step 6 (after the memo, ~1 h):** read `openstates-core` and three mature scrapers (NY, TX, CA) for the *engineering* — retry ladders, per-host throttles, caching, how they detect a redesigned site, how they version bill texts, how they dedupe people — and write `~/Code/scripts/SCRAPER-DOCTRINE.md` in the house style of `RIG-DOCTRINE.md`: numbered lessons, each with the evidence (file and line in the mirror) and the rule we adopt. Skip anything that is Open States plumbing rather than a transferable lesson. Commit it in `~/Code/scripts` (no push).


**Amendment 14:05 (Brendan):** the Open States bulk downloads may no longer be updated — record each file's date, take whatever exists, and **diff the snapshot against our LegiScan data**: per (state, session) bill counts both sides, and for the three step-3 sessions the same matching as step 4. Where their snapshot has a session we do not, or vice versa, say so — that list is an independent coverage check on both.

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

### Heartbeat log

**14:12 ET — lane IN opened.** Reading the required context (`prompts/2026-08-28-worker-box.md`, `44b/docs/WORKER-BOX.md`, `ORCHESTRATION-DOCTRINE.md` §1–2/§9, `api/legiscan-sync.ts`) before touching anything. Next: step 1, the provenance map from our own `"Documents"`/`"Bills"` — expected ~1 hour, no box needed.

**14:18 ET — step 1 starting (provenance map).** Context read: WORKER-BOX.md, ORCHESTRATION-DOCTRINE, lane WB's report (box `i-030d9cac100e6e124`, AWS acct 638175140432, `run-job`/`run-due` now carry a `repo` field). Policy Neon reachable via `POLICY_DATABASE_URL`; `"Documents"` has no `state` column so the host rollup joins through `"Bills".bill_id`. Expected: ~30 min for the SQL rollup, then the per-jurisdiction feed verification (52 fetches, one file each) — call it 90 min total for step 1.

**14:34 ET — step 1, first result, and a defect worth interrupting for.**

The host rollup lands: every one of the 52 jurisdictions' **#1 `state_link` host is its own official legislature site** (NY→`assembly.state.ny.us`, CA→`leginfo.legislature.ca.gov`, TX→`capitol.texas.gov`, US→`www.congress.gov`, …). That is the answer to "where does LegiScan get it", and it is unambiguous.

But the rollup also showed contamination I could not explain — Alaska bills with `www.legis.la.gov` documents, NY bills with 8,093 of them. It is not noise. **`api/legiscan-sync.ts:170-188` writes LegiScan's three separate id spaces — `text.doc_id`, `amendment.amendment_id`, `supplement.supplement_id` — into one PK column, `"Documents".document_id`.** They collide. The upsert at `:431` is `ON CONFLICT (document_id) DO UPDATE SET document_size, document_desc, url, state_link` — it does **not** update `bill_id` or `document_type`, so a collision produces a chimera: the first importer's `bill_id` and `document_type`, the last importer's `url`, `state_link` and size.

Measured, not reasoned about — parsing the state and type out of each row's own `legiscan.com/{STATE}/{type}/…/id/{n}` URL and comparing it to the joined bill:

| | rows | of 3,434,752 joined |
|---|---:|---:|
| document's URL names a **different state** than its bill | **631,689** | **18.39%** |
| document's URL names a **different type** than `document_type` | **646,524** | **18.82%** |
| URL unparseable | 0 | — |

Example, verbatim: `"Documents".document_id = 273853`, `document_type = 'text'`, `bill_id` → **NY A00124**, `url` = `https://legiscan.com/LA/supplement/HB762/id/273853`, `state_link` → `legis.la.gov`. One row, two states, two types.

Each collision **destroyed** a real document's link — the loser's `state_link` is gone, not shadowed. So this is not only 18% of provenance being wrong; it is 18% of `"Documents"` that lane BT's `state_link` walker would follow to the wrong legislature. I am **not fixing it** (no `src/`/`api/` changes in this lane, and it is lane BT's blast radius) — flagging it as **F1** and, for step 1, deriving provenance from each document's **own** URL rather than from the joined bill, which is the authority that survived. Separately, 8,618 `"Documents"` rows have a `bill_id` with no `"Bills"` row (3,443,370 − 3,434,752).

Next: re-run the rollup keyed on the document's own state, then the mime mix and session ranges, then the per-jurisdiction feed verification. ~45 min.

**14:40 ET — amendment picked up; switching to step 0 (mirror the org) as instructed.** The step-1 host rollup keyed on the document's own URL-state is running in the background against Neon; I will fold it in when it lands. Step 0 expected ~30 min for the eight mirrors (clone --mirror → `gh repo create --private` → `push --mirror`, HEAD sha + size + licence each). Open States bulk data is a *box* download per the brief (`~/cache/openstates-bulk/`), so it waits for step 2; I will size it from their downloads page first so the 20 GB ceiling is a decision and not a surprise.

**14:56 ET — step 0 running; the arm64 question is answered, and the box can be ARM.**

*Arch decision, checked not assumed.* I pulled `openstates-scrapers`' **`poetry.lock`** (140 packages) rather than trusting the loose constraints in `pyproject.toml`, and asked PyPI for the wheel list of every *locked* compiled dependency at its *locked version*:

| locked package | version | linux-aarch64 wheel (cp311) |
|---|---|---|
| lxml | 5.3.1 | yes |
| pymupdf | 1.25.1 | yes |
| pandas | 2.2.3 | yes |
| numpy | 2.2.1 | yes |
| cryptography | **37.0.4** (2022, pinned `^37`) | yes — 3 `abi3` aarch64 wheels, so no Rust build |
| psycopg2-binary | 2.9.12 | yes |
| pyyaml / cffi / bcrypt / pynacl / greenlet / sqlalchemy | — | yes |
| pydantic 1.10.26, scrapelib 2.3.0, charset-normalizer, spatula, openstates 6.25.5 | — | pure python |
| **mysqlclient** | **1.4.6** | **no — and no linux wheel at all**, only three `win_amd64` ones |

**Verdict: `t4g.large` (ARM/Graviton).** `mysqlclient` is the single exception and it is not an ARM problem — it ships no Linux wheel on *either* architecture and always compiles from source. It is `optional`, reachable only through the `california` extra, and none of NY/NJ/Congress touch it. Recorded as a standing condition: **running the California scraper needs `libmysqlclient-dev` + a source build, on any arch.** ARM saves ~19% on the instance ($0.0672/h vs $0.0832/h) and matches the 44b box, so one operating manual covers both.

*Mirrors.* Mirroring **all 28 public `openstates` repos**, not only the eight named — "the whole org" is the instruction and the extra 20 cost minutes. Two facts from the first pass worth recording before the numbers:
- `people` is **CC0-1.0**, not GPL — the legislator crosswalk we most want is public-domain, the least encumbered thing in the org. `jurisdictions` is **AGPL-3.0**; `openstates-core`, `api-v3`, `openstates-geo`, `openstates.org`, `spatula` are **MIT**; only `openstates-scrapers` (and `scrapy-test`, `scraper-audit`) are **GPL-3.0**. Brendan's premise — "the code is GPL-3.0 today" — is right about the scrapers and *understates* how free the rest is.
- `git push --mirror` gets `! [remote rejected] refs/pull/N/head (deny updating a hidden ref)` on every repo with PR history. Branches and tags all land; GitHub simply refuses writes to its own `refs/pull/*`. My ledger currently mislabels those repos `PUSH_FAIL` — they are not failures. **Repair pass queued:** re-push the PR refs into `refs/pr-archive/*`, which GitHub accepts, so fork-only commits survive on GitHub and not just in the local `~/Code/.openstates-mirror/*.git`.

**15:20 ET — step 1, and a correction to one of the brief's premises.**

I cloned `openstates-scrapers` for reading and it changes two things the brief takes as settled:

1. **Open States has 56 jurisdictions, not 52 — and one of them is Congress.** `scrapers/` contains `usa/` alongside `gu`, `mp`, `pr`, `vi`. `scrapers/usa/__init__.py` lists the **119th Congress with `"active": True`**, and `usa/bills.py` sources it from **govinfo BILLSTATUS bulk XML** — the same origin as `unitedstates/congress`. So "it does **not** cover Congress" is wrong in letter. It is right in spirit, and the scraper says so itself at `usa/bills.py:17`: *"If you're looking to just collect federal bill data, you're probably better off with https://github.com/unitedstates/congress which offers more backdata."* I will still run `unitedstates/congress` for the 119th as the brief directs, and now also have a free A/B against Open States' own federal scraper.
2. **Open States covers everything we hold and four territories we do not** (GU, MP, PR, VI). Our 52 = 50 states + DC + US Congress; no PR.

*Provenance, triangulated three ways rather than asserted.* For each jurisdiction I now have (a) the hosts LegiScan's own `state_link`s point at, (b) the hosts **Open States' scraper** fetches, and (c) a **live fetch** of the official structured feed. Where (a) and (b) name the same host, that host is the origin and two independent aggregators agree. Where they differ, the difference is informative — and several are:

| jurisdiction | LegiScan reads | Open States reads | what the difference means |
|---|---|---|---|
| **NY** | `assembly.state.ny.us` (**100%** of our NY docs) | `legislation.nysenate.gov` (the Senate's **API v3**) | LegiScan scrapes the Assembly's HTML; the open route uses New York's documented JSON API. **The open source is the better one here.** |
| **PA** | `www.legis.state.pa.us` (88.9%) | `www.palegis.us` | PA migrated domains; Open States is on the new site, our archive on the old. |
| **NJ** | `pub.njleg.gov` (72.7%) | `pub.njleg.state.nj.us` | the reverse — **Open States looks stale here**, a falsifiable prediction for step 3's NJ run. |
| **RI** | `webserver.rilegislature.gov` | `status.rilegislature.gov` | different services on the same legislature. |
| **KS** | `kslegislature.org` (.org) | `www.kslegislature.gov` (.gov) | KS moved to `.gov`; we hold the `.org` era. |
| **MO** | `reflect.legiscan.com` (**2,974 docs, 4.6%**) + `proxy2.legiscan.com` (33) | `www.senate.mo.gov`, `documents.house.mo.gov` | **the only jurisdiction where LegiScan serves us its own mirror instead of the state.** Those 3,007 documents have no state URL at all: if LegiScan goes, so do they. |

*Feed verification, live and in flight* (polite fetcher from `api/_lib/polite-fetch.ts`, reused not reimplemented — robots.txt obeyed, 1.5 s between requests to a host). First returns:

| | result |
|---|---|
| **US** | `govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr1.xml` → **200, 1,979,603 B, `text/xml`** ✔ |
| **NY** | `legislation.nysenate.gov/api/3/bills/2025` → **200, JSON** ✔ (free key, ours already in `.env.local`) |
| **CA** | `downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip` → **200, `application/zip`, 1,218,704,297 B — 1.22 GB of California's entire legislative database, published for anyone.** Verified by headers; the body deliberately exceeded the fetcher's cap and I did not pull 1.2 GB to prove a point. |
| **MT** | `api.legmt.gov/archive/v1/sessions` → 200 JSON ✔ |
| **SD** | `sdlegislature.gov/api/Sessions` → 200 JSON ✔ |
| **AZ** | `apps.azleg.gov/api/Bill/` → **blocked: `robots.txt` disallows `/api/Bill/`.** Recorded as blocked, not worked around — and worth noting that **Open States' AZ scraper fetches a path Arizona's robots.txt forbids** (a SCRAPER-DOCTRINE entry). |

Mirrors: 19 of 28 repos done, 435 MB local. Feed sweep is ~2 min from finishing.

**15:34 ET — ⚠ step 0 hits a wall that changes the memo: Open States' bulk data is behind a login.**

`openstates.org/data/session-csv/` **301s to `open.pluralpolicy.com/data/session-csv/`**, and that page says, in as many words:

> **"Please log in to access download links."**

The session *inventory* is still public — every jurisdiction, every session, with an "updated" date, and it is current (Alaska 34th Legislature (2025-2026), *updated 2026-08-27* — yesterday). The **download links are not**. `data.openstates.org` returns **403**. So the bulk data is live, maintained, and gated.

I have **not** created an account and have not gone around it — the hard rule says stop and report when a source needs credentials, and signing Brendan up for a Plural account is outward-facing and not something this brief authorised. **This is decision D-1 for Brendan** (see the memo): a free Plural account may well open the same downloads, but somebody should read Plural's terms on bulk retention before we mirror a commercial product's data, which is a different question from mirroring GPL/MIT/CC0 *code*.

**Why it matters more than it looks:** Brendan's amendment was written on the premise that the code might go closed one day. The code is still open — but **the data path has already closed** for anonymous use. That kills the cheap version of memo option (a): "Open States as a cold standby refreshed weekly" cannot mean "wget their bulk file every Sunday." It has to mean *running the scrapers ourselves*, which is exactly what steps 2–4 are about to measure the cost of. The lane's central question got sharper, not vaguer.

`~/cache/openstates-bulk/` on the box will therefore hold **scraper output**, not their bulk archive, and the report will size it that way.

**15:41 ET — step 2, the numbers before the launch (as the brief requires).**

Every price below came from the **AWS Pricing API just now**, not from memory or from WORKER-BOX.md:

| item | rate (queried) | 24×7 | this lane |
|---|---|---|---|
| `t4g.large` (2 vCPU, 8 GiB, Graviton2) | **$0.0672/hr** | $49.06/mo | — |
| `t3.large` (x86, the alternative) | $0.0832/hr | $60.74/mo | **not chosen** — the wheel audit says ARM is safe |
| 100 GB gp3 | **$0.08/GB-mo** | **$8.00/mo** | **standing, whether the box runs or not** |
| public IPv4 (in-use *or* idle) | **$0.005/hr** | $3.65/mo | only while running |
| **running** | **$0.0722/hr** | **$60.71/mo** | |
| **stopped** | — | **$8.00/mo** | |

**Against the $15 cap:** at $0.0722/hr the cap buys **207 running hours**, so compute is not the binding constraint — I expect to use 3–6. The one that matters is the **$8.00/mo that the 100 GB volume costs forever, running or not.** That is over half the lane's cap every month from month two onward, and it is a decision the lane cannot make for Brendan.

**I am keeping 100 GB as specified** even though the sizing premise partly evaporated (the ≤20 GB of Open States bulk data can no longer be downloaded). Reasons: `unitedstates/congress` caches raw govinfo XML for a whole Congress and I do not have a measured number for the 119th yet; gp3 grows online but **never shrinks**; and running out mid-scrape costs more than $8. **Flagged as F2 for the lead:** when the lane ends, the honest options are (i) snapshot the volume to S3 (~$0.05/GB-mo *of used data*, so cents) and terminate, (ii) keep it stopped at $8/mo, or (iii) rebuild smaller. I will report the actual used GB so the choice is made on a number.

Launching now: `ami-06f318091abc639be` (Ubuntu 24.04 LTS arm64, from the Canonical SSM parameter), **us-east-1c** — same AZ as `44b-worker`, same region as Neon — 100 GB gp3 **encrypted**, new key pair `livingston-worker-2`, new SG allowing **22/tcp from 47.20.253.93/32 only**, and an instance profile attached *after* launch so its policy can name **this instance's exact ARN** rather than a wildcard.

**15:58 ET — step 0 done and independently verified; step 2 box is up.**

**Mirrors: 28 of 28 `openstates` repos are now private mirrors under `nyd-user-1/mirror-openstates-*`.** I mirrored the whole org, not only the eight named — the extra twenty cost four minutes.

The first pass reported eight "PUSH_FAIL"s that were nothing of the kind: `git push --mirror` cannot write GitHub's own `refs/pull/*` (*"deny updating a hidden ref"*), and `set -e`-free error handling recorded the whole push as failed when only those refs were refused. Two consequences, both handled:
- **Repair pass:** PR refs re-pushed as `refs/pull/*:refs/pr-archive/*`, which GitHub accepts. That matters for archival — a PR from a fork can hold commits that live on no branch, and those are precisely what disappears if the org does.
- **Verification is independent, not self-reported** (ORCHESTRATION §2): the ledger's status comes from `git ls-remote` **against GitHub**, counting what the mirror actually holds, not from what my push loop believed it did. A repo is `COMPLETE` only when remote branch count == local and remote `pr-archive` count == local `refs/pull` count.

Licences, from the source repos (unchanged in every mirror — we kept a copy, we did not relicense):

| repo | licence | branches | tags | PR refs | local size |
|---|---|---:|---:|---:|---:|
| `openstates-scrapers` | **GPL-3.0** | — | — | — | 38.6 MB |
| `people` | **CC0-1.0** | — | — | — | 125.7 MB |
| `openstates-core` | MIT | — | — | — | 10.3 MB |
| `jurisdictions` | AGPL-3.0 | — | — | — | 14.9 MB |
| `openstates.org` | MIT | | | | 8.8 MB |
| `api-v3` | MIT | 10 | 56 | 42 | 0.8 MB |
| `openstates-geo`, `spatula`, `pyopenstates`, `openstates-realtime`, `bobsled` | MIT / Apache-2.0 | | | | |
| `documentation` | CC-BY-4.0 | | | | 1.8 MB |
| `scrapy-test`, `scraper-audit` | GPL-3.0 | | | | |

(the full per-repo table with every HEAD sha goes in the final report; the repair pass is still filling in the last few counts.)

**Box: `i-0843042df1a5fb003` — `livingston-worker-2`, `t4g.large`, us-east-1c, running.** 100 GB gp3 encrypted, Ubuntu 24.04 arm64 (`ami-06f318091abc639be`), IMDSv2 required, SSH 22/tcp from `47.20.253.93/32` only, tags `Name=livingston-worker-2 lane=IN repo=livingston`. `uname -m` says `aarch64` — the wheel audit gets its live confirmation when Poetry resolves. First-boot script is mid-flight (Docker in, Python 3.11 in, Poetry installing, then clones of `openstates-scrapers` and `unitedstates/congress`).

IAM: role **`livingston-worker-2-selfstop`** created *after* the instance so its policy names **`…:instance/i-0843042df1a5fb003`** exactly — `ec2:StopInstances` on that one ARN, `ec2:DescribeInstances` on `*`, nothing else. No AWS credentials on disk.

⚠ **One thing the brief's "install `run-job`/janitor/`run-due` from 44b's `ops/box/`" does not survive contact with:** `ops/box/job-janitor` hardcodes `INSTANCE=i-030d9cac100e6e124`. Installed as-is on box 2 it would wait for box 2's job to finish and then **stop the 44b box** — which right now is mid-backfill with lane WB's LDA and FEC jobs on it. I am installing a janitor that reads its instance id from **IMDSv2**, with the baked-in id as fallback so 44b's behaviour is byte-identical, and I will report the diff for the lead rather than push it. Following the brief literally here would have been a live incident.

Also, per lane WB's D2, I am **not** running `ops/box/install.sh`: it `scp`s `jobs.d/*.json`, and 44b's eight manifests reference a `~/44b` checkout that does not exist on this box.
