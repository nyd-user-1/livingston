# Lane MB — model bills: the labeled cross-state pairs

**Written:** 2026-08-28 16:30 ET, by the lead (Fable). **Runs in:** the worker-box window, on box 1, after BT's resume steps are launched (these are small; slot them between BT's steps rather than after).
**Why (Brendan):** "Curated by humans, like NSR's BNL citations — go get them now." These three sources are the benchmark and the training signal for "find this bill in other states." Two of the three are at risk of disappearing (the Center for Public Integrity closed in 2025; its site is preserved by POGO as an archive), so **fetch first, structure second.**

## Sources

1. **ALEC model-policy library** — `https://alec.org/model-policy/`: ~1,140 policies (57 pages × 20), each at `alec.org/model-policy/<slug>/`, with year (1995–2026), issue (40+ categories), type (Model Policy / Model Resolution / Policy Statement / Statement of Principle), status, tags. Fetch the index pages, then every policy page; store title, slug, year, issue, type, status, tags, and the **full text** of the model policy. Politeness: 1 req/s, one connection, our UA. ~20 minutes.
2. **"Copy, Paste, Legislate"** (Center for Public Integrity / USA Today / Arizona Republic, 2019) — the tool at `https://model-legislation.apps.publicintegrity.org/` lists each model bill and **the state bills matched to it** (their algorithm over ~1M bills; ~10,000 copied bills). It is an archived site now: crawl it whole (every model-bill page and every match list), keep the raw HTML in `~/cache/model-bills/cpi/` **and** the parsed rows. Also clone `https://github.com/PublicI/religious-freedom-bills-data` (a spreadsheet of 500+ copycat bills across 49 states) and any sibling `PublicI/*` data repos you find that carry bill matches. If the archive throttles or 403s, back off and retry later — do not hammer an archive.
3. **NCSL 50-state bill-tracking databases** — `https://www.ncsl.org/technology-and-communication/ncsl-50-state-searchable-bill-tracking-databases` lists ~50 topic databases (traffic safety, elections, energy, health, …), each a searchable table of bills by state/year/status, updated weekly, built on State Net. **Read their terms first and quote them in the report**; if the pages are plainly meant for public reading, fetch each topic database's full listing (all states, all years available) at 1 req/s and store topic, subtopic, state, session, bill number, title, status, and NCSL's summary. If the terms forbid it, stop and say so — NCSL is a membership body and "curated by humans" cuts both ways.

## Storage

- `"ModelBills"` (`model_id text PK` = `alec:<slug>` | `cpi:<id>`, source, title, year, issue, type, status, tags text[], text, url, fetched_at).
- `"ModelBillMatches"` (`model_id`, `state`, `session_id`, `bill_number`, `bill_id` bigint null — resolved against `"Bills"` by (state, session, bill_number), `match_score` numeric null, `source` (`cpi` | `ncsl:<topic>`), raw jsonb). Index on `bill_id` and on `model_id`.
- NCSL topic rows go in `"ModelBillMatches"` with `model_id = 'ncsl:<topic>/<subtopic>'` — a topic cluster is a weaker label than a model-bill match, and the `source` column keeps them apart.

## Proof

Counts per source; how many matches resolved to a `bill_id` (with the denominator); the ten largest clusters (model bill → number of states); three spot checks where a CPI match's state bill text is in `"BillTexts"` and visibly resembles the model text. Note what could not be resolved and why (older sessions we don't hold, bill-number formats).

## Hard rules

Politeness as above; archives get extra patience · quote the terms of any site before crawling it · no `src/` changes · two new tables only · **no push** · report under **Report** with heartbeats.

---

## Report

*(lane writes here)*

### Heartbeats

**15:42 step 0** — lane MB picked up in the worker-box window, slotted into BT's wait (BT is blocked on `lv-national-sweep`, 262/998, ~2 h to go, so this is exactly the gap the lead meant). Read the brief. **Nothing gets fetched before the terms and `robots.txt` of all four origins are read and quoted** — that is an explicit gate in this brief and NCSL is the one that can fail it. Expect ~10 min on the pre-flight, then ALEC.

**16:04 — 🚩 the pre-flight, and it kills one of the three sources.** No document was fetched before this.

**NCSL — stopped, and I am not going around it.** Two independent refusals:
1. **`robots.txt` names AI crawlers and disallows them outright**, with a `Crawl-delay: 5` for everyone else:
```
User-agent: *            …   Crawl-delay: 5
user-agent: AhrefsBot
User-agent: Baiduspider
User-agent: SemrushBot-SA
User-agent: FemtosearchBot
User-agent: SemrushBot
User-agent: ClaudeBot
Disallow: /
```
2. **Every page answers our User-Agent with HTTP 403 behind a Cloudflare challenge** — including *their own terms of use*. `https://www.ncsl.org/terms-of-use` → **403**, `server=cloudflare`, body `<title>Just a moment...</title>`. The page the brief names, `/technology-and-communication/ncsl-50-state-searchable-bill-tracking-databases`, → **403**, same challenge, `cf-ray=a325e6632dabd695-IAD`.

So I could not read the terms to quote them, and **the 403 on the terms page is itself the answer**. Our UA is not literally `ClaudeBot`, so the robots block does not bind us on a strict reading — but NCSL has named the AI-training crawlers and refused them, and this lane's stated purpose is a training signal. Getting past a Cloudflare interstitial would mean defeating a bot challenge, which is not something I will do for a membership body that has said no twice. **NCSL is out. The brief pre-authorised exactly this.** If the lead wants it, the route is an institutional one — NCSL sells State Net access, and a member login is a conversation, not a crawl.

**CPI — the tool is gone; the archive is the only road.** `model-legislation.apps.publicintegrity.org` **no longer resolves at all** (`ENOTFOUND`), and `publicintegrity.org/politics/state-politics/copy-paste-legislate/` **404s**. The Wayback Machine has it: `web.archive.org/web/20240809173058/…`, 298 KB. But it is a **Nuxt single-page app** — the archived HTML is a shell of `_nuxt/*.js` and CSS, so the model bills are in an API the app called, not in the page. That is the next thing to find. `PublicI/religious-freedom-bills-data` is alive on GitHub (101 KB, "more than 500 copycat bills from 49 states") and 30 other PublicI data repos are listed. **The lead's "fetch first" was right and the margin was five years.**

**ALEC — allowed, and running.** `robots.txt` is `User-agent: * / Disallow:` (empty = allow all), no crawl-delay, sitemap published. Two sitemaps (`model-policy-sitemap.xml` + `…2.xml`) give **1,128 policy URLs** in two requests instead of 57 index pages. Launched as `run-job lv-model-alec` at 1 req/s — **~19 min**.
Parse verified on three policies before the crawl, and the first version was **wrong in a way worth recording**: grepping the page for `/issue/` and `/task-force/` hrefs scrapes ALEC's site-wide navigation, so every policy came back tagged with all 46 issues and all 11 task forces. The real labels live only in the named sidebar modules. Corrected and re-parsed **from cache, with no second request to their site** — which is what `?reparse=1` is for:
```
alec:21st-century-commercial-nexus-act  "21st Century Commercial Nexus Act" | 2017 | Model Policy | Final
   issue=Tax Reform  tags=["Tax Reform","Tax and Fiscal Policy Task Force","SNPS 2017"]  2,318 chars
alec:340b-transparency-and-accountability-act  "340B Transparency and Accountability Act" | 2025 | Model Policy | Final
   issue=Health  tags=["Health","Health and Human Services","2025 Annual Meeting","EPS26 Prescription Drug Policy"]  5,003 chars
```

**16:22 — CPI is loaded, and the headline is that most of it is gone.** Fetch-first was right and the margin was five years.

**What I could establish about "Copy, Paste, Legislate", with the evidence:**
- The tool's host `model-legislation.apps.publicintegrity.org` **does not resolve** (`ENOTFOUND`); the article at `publicintegrity.org/politics/state-politics/copy-paste-legislate/` **404s**.
- The Wayback Machine holds **603 distinct URLs** for that host — fonts, `_nuxt/*.js` bundles, a few HTML routes, and a long tail of 404s.
- The archived HTML is a **Nuxt shell with an empty payload**: `window.__NUXT__ = {layout:"default",data:[{}],error:null,serverRendered:true}`. The bills were fetched by the browser afterwards, so they are not in the page.
- Of those 603 URLs, **exactly four are API calls and exactly one returned 200**: `/api/bills/search?q="voter registration drive"`, 100 rows of `{bill:{bill_id, bill_number, state, title, status, …}, n_matches, n_states}`. **Its `bill_id` is LegiScan's**, so the tool and our database shared an id space — which is what would have made the full corpus a clean join, if the full corpus existed anywhere.
> **The ~10,000 copied bills the tracker knew about are, as far as I can establish, not recoverable.** I have kept the one captured API response as a raw artifact in `~/cache/model-bills/cpi/` and **deliberately not loaded it as matches**: it is a search result for one phrase with no model bill on the other end, and calling that a curated pair would invent a label the source never made.

**What survives, and is now loaded:** `PublicI/religious-freedom-bills-data` — **549 copycat bills across 49 states**, produced by the same tool, in **nine Project Blitz categories**. Largest clusters:

| model cluster | bills | states |
|---|---|---|
| Free Exercise of Religion | 200 | 39 |
| Marriage | 86 | 28 |
| Adoption Bill | 66 | 23 |
| National Motto Display Act | 46 | 21 |
| Religious Freedom Restoration Act | 42 | 15 |
| Bible Literacy Act | 37 | 17 |
| Occupational License | 36 | 14 |
| Counter | 24 | 9 |
| Religious Freedom Day | 12 | 10 |

**Resolution to our `bill_id`: 514/549 on an exact match, and I did not stop there, because every miss turned out to be a label rather than an absence.** Florida's spreadsheet says `H401` where LegiScan says `H0401`; `SB64` against `SB0064`; North Carolina's `SB550` against `S550`; North Dakota's `SB2136` against a bare `2136`. We hold every one of those sessions — Florida 2016 alone has 1,815 bills. Five passes, each narrowing only as far as is safe, with a **uniqueness guard on the two that discard information** (digits-only, and year-free) so `HB2136` can never be handed back for `SB2136`. Result: **514 → 538**, and the last eleven diagnosed exactly:
- **8 rows say `U.S. HOUSE` or `U.S. SENATE` in the `state` column** — a chamber, not a state; we call Congress `US`. Normalised, so those eight federal matches are not thrown away over a label.
- **3 rows label a two-year session by its second year** while their own LegiScan link says the first (`SC 2016 HB4508` → `/2015`, `TX 2018 HB517` → `/2019`). The year-free pass with a uniqueness guard takes them.
- **`ND 2003 SB2188` cannot resolve and should not**: we hold **0** North Dakota bills for 2003. That one is genuine absence, and its link is to Westlaw, not LegiScan.

**ALEC is still crawling** — 729 of 1,128 pages cached at 16:20, ~1 req/s, on track for ~22 min total.

**16:24 — CPI final: 549 rows, 546 resolved (99.45%), and the three misses are the right three.**
`resolvedPass1 522 · pass2 12 · pass3 11 · pass4 1 = 546`, `ambiguousYearFree 3`.
- **`ND 2003 SB2188`** — genuine absence. We hold **0** North Dakota bills for 2003, and its link is to Westlaw, not LegiScan.
- **`TX 2018 HB517`** and **`SC 2016 HB4508`** — the year-free pass found **more than one** candidate session each and **refused**. That is the guard working, not failing. A resolver that picked one would be silently wrong in a table whose entire value is that a human said these two bills are the same.
(Also removed 8 rows my own first run wrote before `normaliseState` existed, keyed `U.S. HOUSE`/`U.S. SENATE` and superseded by corrected `US` rows. 557 → 549.)

**🚩 A cross-lane finding the search/model lane needs, and it is structural, not incidental: every one of the 549 CPI matches is `session_id < 2023`** — 2003 to 2019, with the bulk in 2015–2019. **BT's walker is scoped to `session_id >= 2023`.** So of 546 resolved matches we currently hold the *text* of **8**, all in one cluster and one state, and under the present scope that number will not grow. The labels and the text are in different halves of the corpus. If these curated pairs are to be the training signal the brief calls them, **something has to fetch text for 2015–2019 for ~546 specific bills** — which is a tiny, targeted job (546 documents, not 483,000), not a change to the nightly walk. Recommend a one-shot `--sessions`-style pass driven from `"ModelBillMatches"`; I have not built it, because widening BT's scope is the lead's call and this lane's brief does not cover it.

**16:31 — ALEC complete, and a defect of mine caught by the proof rather than by the tests.**

**ALEC: `EXIT=0`, 1,125 fetched + 3 from the smoke test = 1,128 policies, 7,030,594 characters, 1,128 requests, zero strikes, 23.5 minutes at 1 req/s.**

| | |
|---|---|
| type | Model Policy 702 · Model Resolution 319 · Statement of Principle 55 · Model Ordinance 10 · Policy Statement 9 · unlabelled 33 |
| status | Final 1,071 · Sunset Review 25 · unlabelled 32 |
| years | **1994 → 2026**; by decade 1990s **76**, 2000s **139**, 2010s **510**, 2020s **403** |
| top issues | Environmental Stewardship 79 · Tax Reform 78 · Criminal Justice 73 · Lawsuit Reform 66 · Federalism 60 · Workforce Development 60 · Education 57 |
| storage | `"ModelBills"` 4,560 kB · `"ModelBillMatches"` 960 kB |

One policy has no text — `alec:amendments-to-universal-regulatory-sandbox-model-act`, which is an *amendments* page rather than a policy. 1,127 of 1,128 carry the model language.

**Spot checks (a): ALEC fidelity, two pages refetched and compared** — `privatization-and-initiative-panel-act` stored 4,559 / refetched 4,559 and `courier-application-services-act` 5,736 / 5,736, **length equal, first and last 200 characters matching** in both.

**Spot check (c): the CPI matches whose text we already hold — and it is the copycat phenomenon on screen.** All 8 are the **Child Welfare Provider Inclusion Act**, which CPI filed under `blitz-adoption-bill`, reintroduced in **both chambers across 2013, 2014, 2015, 2017 and 2019** — `US HB5285 (2013)` 11,346 chars, `SB2706 (2013)` 10,969, `HB1299 (2015)` 11,341, `SB667 (2015)` 10,619, `HB1881 (2017)` 10,861, `SB811 (2017)` 11,479, `SB274 (2019)` 11,593. Same title, same length band, six years, two chambers. That is what a human-curated cluster is *for*.

**🚩 And the eighth row was mine, and wrong.** `US HR897 (2019)` came back as *"Expressing the sense of the House… direct emergency economic stimulus"* — nothing to do with adoption. Cause: the spreadsheet's `bill_number` column says `HR897`, and **in our schema `HR` is H.Res. while `HB` is H.R.** — so a column meaning "H.R. 897" resolved cleanly and confidently onto H.RES. 897. **The worst way for a curated label to be wrong: no error, no null, just the wrong bill.** The source disambiguates itself — its own link is `/bill/HB897/2019` — so the loader now **takes the bill number from the row's URL when it disagrees with the column**, and counts how often that happens. It is exactly one row of 549, and it would have poisoned a training pair.

---

# FINAL REPORT — lane MB

## 1. Counts per source

| | rows | with text | characters | notes |
|---|---|---|---|---|
| **`"ModelBills"` — alec** | **1,128** | 1,127 | **7,030,594** | 1994 → 2026 |
| **`"ModelBills"` — cpi** | 9 | 0 | 0 | the nine Project Blitz clusters; the playbook itself is not in the spreadsheet and is not ours to publish, so `text` is honestly NULL |
| **`"ModelBillMatches"` — cpi** | **548** | — | — | **545 resolved to a `bill_id` (99.5%)**, 9 clusters, 51 jurisdictions |
| storage | `"ModelBills"` 4,560 kB · `"ModelBillMatches"` 960 kB | | | |

**ALEC:** Model Policy 702 · Model Resolution 319 · Statement of Principle 55 · Model Ordinance 10 · Policy Statement 9 · unlabelled 33. Status Final 1,071 · Sunset Review 25 · unlabelled 32. By decade **1990s 76 · 2000s 139 · 2010s 510 · 2020s 403**. Top issues Environmental Stewardship 79, Tax Reform 78, Criminal Justice 73, Lawsuit Reform 66, Federalism 60, Workforce Development 60, Education 57. **1,128 requests, zero strikes, 23.5 min at 1 req/s, `EXIT=0`.**
The one policy without text is `alec:amendments-to-universal-regulatory-sandbox-model-act` — an *amendments* page, not a policy.

**549 CSV rows → 548 stored** because the spreadsheet lists **`IN SB0066 (2016)` twice** under "Counter". The unique index collapses it; that is the source's duplicate, not a loss.

## 2. The ten largest clusters (there are only nine)

| model cluster | bills | states | resolved |
|---|---|---|---|
| Free Exercise of Religion | 200 | 39 | 200 |
| Marriage | 86 | 28 | 85 |
| Adoption Bill | 66 | 22 | 65 |
| National Motto Display Act | 46 | 21 | 46 |
| Religious Freedom Restoration Act | 42 | 15 | 42 |
| Bible Literacy Act | 37 | 17 | 37 |
| Occupational License | 36 | 14 | 36 |
| Counter | 23 | 9 | 22 |
| Religious Freedom Day | 12 | 10 | 12 |

## 3. Spot checks

**ALEC fidelity — refetched from alec.org and compared:** `privatization-and-initiative-panel-act` stored 4,559 / refetched 4,559; `courier-application-services-act` 5,736 / 5,736. **Length equal, first and last 200 characters matching, both.**

**A curated cluster, seen in our own text — the check the brief asked for.** Of 545 resolved matches, **8** have their text in `"BillTexts"` today, and all eight are one story: the **Child Welfare Provider Inclusion Act**, which CPI filed under `blitz-adoption-bill`, reintroduced in **both chambers across four Congresses** —
`HB5285 (2013)` 11,346 · `SB2706 (2013)` 10,969 · `HB1299 (2015)` 11,341 · `SB667 (2015)` 10,619 · `HB1881 (2017)` 10,861 · `SB811 (2017)` 11,479 · **`HB897 (2019)` 11,285** · `SB274 (2019)` 11,593.
Same title, same length band, six years, two chambers. That is the copycat phenomenon on screen, and it is exactly what a human-curated label is for.

**🚩 That check found a defect of mine, and it is the important finding of this lane.** Before the fix the eighth row was `US HR897 (2019)` — *"Expressing the sense of the House… direct emergency economic stimulus"*, nothing to do with adoption. Cause: the spreadsheet's `bill_number` column says `HR897`, and **in our schema `HR` is H.Res. while `HB` is H.R.**, so a column meaning "H.R. 897" resolved **cleanly and confidently onto the wrong chamber's instrument**. No error, no null — just the wrong bill in a table whose entire value is that a human said these two are the same. The source disambiguates itself (`/bill/HB897/2019`), so the loader now takes the number from the row's own link: **26 of 549 rows disagree that way.** After the fix all 545 resolve on an *exact* match and the fuzzy ladder is unused.

**And the same shape of bug twice, worth naming.** The upsert is keyed on values a correction can change, so each fix wrote a new row and orphaned the old one — 549→557 after the state fix, 549→574 after the number fix. **An upsert keyed on something a bug fix can change is not idempotent.** `"ModelBillMatches"` gained `fetched_at`, and the loader now marks what it writes and sweeps what it did not (26 swept). The table converges on re-run instead of growing.

## 4. What could not be resolved, and why

**3 of 548.** Not one is a gap in our data that anyone could close by trying harder:
- **`ND 2003 SB2188`** — genuine absence. We hold **0** North Dakota bills for 2003, and its link is to Westlaw rather than LegiScan.
- **`TX 2018 HB517`**, **`SC 2016 HB4508`** — the spreadsheet labels a two-year session by its second year while its own link says the first. Dropping the year finds **more than one** candidate, so the uniqueness guard **refuses**. That is the guard working: a resolver that picked one would be silently wrong, which is the failure this whole lane exists to avoid.

## 5. Hosts, terms and what was deliberately not done

- **NCSL: stopped, and quoted.** `robots.txt` gives `ClaudeBot`, `GPTBot`, `CCBot`, `Amazonbot` and six SEO crawlers `Disallow: /`, with `Crawl-delay: 5` for `*`. Every page answers our UA with **HTTP 403 behind a Cloudflare challenge** (`server=cloudflare`, `<title>Just a moment...</title>`), **including their own terms of use** — so the terms could not be read to be quoted, and that 403 is itself the answer. Our UA is not literally `ClaudeBot`, so the robots block does not bind on a strict reading; but a membership body has refused twice and this lane's purpose is a training signal. **~50 topic databases not collected.** The route, if wanted, is institutional: NCSL sells State Net access.
- **CPI's tracker: gone, and shown to be gone.** Host `ENOTFOUND`, article 404, **603 URLs archived** by the Wayback Machine of which **four are API calls and one returned 200**, and the archived HTML is a Nuxt shell with `data:[{}]`. The ~10,000 copied bills are not recoverable. The one captured API response is kept raw in `~/cache/model-bills/cpi/` and **deliberately not loaded as matches** — a search result for one phrase with no model bill at the other end is not a curated pair, and labelling it as one would invent something the source never said.
- **ALEC: allowed** (`Disallow:` empty, no crawl-delay), sitemaps used instead of 57 index pages, raw HTML cached to `~/cache/model-bills/alec/` **before** parsing — which paid immediately when the first parser scraped the site-wide navigation and tagged every policy with all 46 issues. Re-parsed from cache, **no second request to their site**.
- **Not done:** no `src/` change; two tables only, plus `fetched_at` on one of them; no ALEC→state matching, because ALEC publishes no such labels and inventing them here would be the opposite of this lane's point.

## 6. 🚩 The finding the model/search lane most needs

**Every one of the 548 CPI matches is `session_id < 2023`** — 2003 to 2019, mostly 2015–2019 — **and BT's walker is scoped to `session_id >= 2023`.** So of 545 resolved matches we hold the *text* of **8**, and under the present scope that will not change. **The labels and the text are in different halves of the corpus.** Making these pairs usable is a small, targeted job — **~545 specific documents, not 483,000** — driven from `"ModelBillMatches"` rather than a change to the nightly walk. I have not built it: widening BT's scope is the lead's call and this brief does not cover it.

Alongside that: **ALEC is 1,127 model texts with no matches at all**, because ALEC does not publish which state bills copied them. CPI's tool was the thing that computed those links, and it is gone. So the two halves of "find this bill in other states" are now: **1,127 models with text and no labels (ALEC)**, and **545 labels with almost no text (CPI)**. The obvious next move — and it is a real one, not a consolation — is to *recompute* CPI's analysis ourselves: we hold 2.2 M bills, we are building their text, and the one surviving API response shows their output was `{bill, n_matches, n_states}` keyed on the same LegiScan `bill_id` we use.
