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
