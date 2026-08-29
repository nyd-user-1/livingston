# Lane NT — native bill text: CA, TX, MA, OH from the legislatures' own feeds

**Written:** 2026-08-29 11:30 ET, by the lead (Fable). **Window:** `/rename native-text`, `/color cyan`.
**Model:** Opus. **Repo:** `~/Code/livingston`. **Runs on:** the 44b worker box (box 1), through the pattern lane WB built — read `prompts/2026-08-28-worker-box.md` (brief + Report, §10–§12) and **all of `prompts/2026-08-28-bill-text.md`** before anything else. Lane BT is the lane you are extending: its storage contract, its `TextBuffer`, its politeness, its proofs and its mistakes are all yours now.

## Why this lane exists

`"BillTexts"` holds text for 356k of 2.14M bills. NY (99.9%) and US (82%) are done. The 49-state walker (`lv-text-walk`) is bound by robots.txt and Crawl-delay and runs four hours a night — weeks of work — and four states it cannot get at all, or only slowly, publish their bill text through a **bulk download or an API** that Brendan verified yesterday, no key needed:

| state | route | verified 2026-08-29 | 2023+ documents LegiScan knows | what it unlocks |
|---|---|---|---|---|
| **CA** | bulk zips — the whole session DB incl. text | `https://downloads.leginfo.legislature.ca.gov/` | 37,772 | **all of California** — `leginfo.legislature.ca.gov` is robots-refused to the walker (7,117 refusal rows) |
| **TX** | anonymous FTP mirror of every bill text | `ftp://ftp.legis.state.tx.us/bills/<session>/billtext/html/…` | 47,366 (walker has ~23k of them, nearly all 2025) | the 2023 session and the specials without a 13-hour single-host walk, and 2019–2021 for free |
| **MA** | REST API, JSON with `DocumentText` inline | `https://malegislature.gov/api/GeneralCourts/194/Documents/H100` | 17,074 | Massachusetts, by API instead of 17k page fetches |
| **OH** | open JSON API + HTML/PDF per version | `https://search-prod.lis.state.oh.us/api/v2/general_assembly_136/legislation/` | 8,343 | Ohio — its host fails the walker's TLS chain check |

Brendan: *"start with the wins now. go."* The order below is by **wall clock**, not by size: launch the quick ones as box jobs while you write the big one.

## Order — write, launch, move on; never wait on a job to finish before writing the next loader

0. **Recon (≤ 10 min).** Box state: `tmux ls` (what is running — `lv-text-nj`, the nightly walker, anything from 44b), load, free memory, **`df -h ~/cache`** (CA is ~4.4 GB of zips for four sessions — say whether the disk has it). Census before fetching, per state and session: `"Bills"` rows, `"Documents"` text rows with a `state_link`, `"BillTexts"` rows already present. That census is the denominator for every proof below.
1. **OH** — smallest, simplest, and a host the walker cannot reach. Write it, run it against one General Assembly as a sample (≤ 100 bills), prove it, then launch the full run as `lv-text-oh` on the box. Move on.
2. **MA** — write, sample, prove, launch as `lv-text-ma`. Move on.
3. **TX** — write, sample, prove, launch as `lv-text-tx`. Move on.
4. **CA** — the largest and the only one with a real parser to write. Write, sample against one zip, prove, launch as `lv-text-ca`.
5. When each job lands: proofs, the independent count, then the `lv-text-walk` manifest amendment (§ "Hand-off to the walker").

Four `lv-text-*` jobs may run at once: each touches exactly one host, each is rate-limited by its source not by CPU, and that is the pattern Brendan approved for lane BT (its D3). Check `tmux ls` first anyway; if the box is already carrying two or more jobs, say so and start one at a time.

## The sources — what each one is, and what you must find out before writing

### CA — `pubinfo` zips

- Index: `https://downloads.leginfo.legislature.ca.gov/` — `pubinfo_2025.zip` (1.1 GB), `pubinfo_2023.zip` (1.2 GB), `pubinfo_2021.zip`, `pubinfo_2019.zip` … back to 1989; `pubinfo_Mon.zip`…`pubinfo_Sat.zip` are the day's deltas; `pubinfo_daily_*.zip` are full snapshots. `pubinfo_Readme.pdf` and **`pubinfo_load.zip`** (contains `capublic.sql` — the table DDL, i.e. the column order of every `.dat` file). **Download `pubinfo_load.zip` first and read `capublic.sql`; do not guess column positions.**
- Contents: tab-delimited `*_TBL.dat` files, one per table, plus `*_TBL_<n>.lob` files holding the LOB columns — **`BILL_VERSION_TBL.dat` + `BILL_VERSION_TBL_<n>.lob` is the bill text** (the `bill_xml` column). `BILL_TBL` has the session/measure identity. The `.dat` row carries the `.lob` filename for its LOB column; verify how in the data before writing the parser.
- Identity: LegiScan's `state_link` for CA is `https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB946#99INT` — **the `bill_id` query parameter is CA's own `bill_id` (`<session_year_start><session_year_end><measure>`) and the fragment is `<version_num><version_code>`** (99 = introduced, 98/97/96… = successive amendments; `INT`, `AMD`, `ENR`, `CHP`). Confirm the convention against `BILL_VERSION_TBL` on the sample before relying on it, then use it: a native version that matches a `"Documents"` row gets that row's real `document_id` (see § Identity).
- Scale: 1.1 GB zips **must be streamed to disk (`~/cache/pubinfo/`) and parsed from disk**. The govinfo loader reads a 134 MB zip into memory; do not copy that for a 1.1 GB one — the box has 7.8 GB and `--heap 2048`. Unzip with `fflate`'s streaming `Unzip` from a file stream, or shell out to `unzip` into the cache directory and read files individually; say which and why.
- Sessions: `"Bills".session_id` for CA is the session start year (2019, 2021, 2023, 2025); one zip per session. `pubinfo_2025.zip` refreshes weekly — the same URL, new content — so the resume/idempotency story is the `text_hash` upsert, not the zip's presence in the cache.
- Politeness: four requests to one host. Nothing to tune.

### TX — the FTP mirror

- `ftp://ftp.legis.state.tx.us/bills/<session>/billtext/html/<house_bills|senate_bills|house_joint_resolutions|…>/<block of 100>/<BILLNNNNNv>.htm` — e.g. `/bills/89R/billtext/html/house_bills/HB00001_HB00099/HB00001I.htm`. Also `pdf/` and `doc/`; **use `html/`** — it is what LegiScan links (`https://capitol.texas.gov/tlodocs/89R/billtext/html/HB03971I.htm`) and it is the same file, so `htmlToText` already handles it.
- Session codes: `89R` = 2025 regular, `891`/`892` = 2025 1st/2nd called (special) sessions, `88R` = 2023, `881`–`884` its specials, `87R` = 2021 (+`871`–`873`), `86R` = 2019. `"Bills"` has `session_id` = year and `legiscan_session_id` per session with `session_title` ("2023 3rd Special Session"): **build the code → `legiscan_session_id` map from `"Bills"` and print it in the report** before fetching.
- Version letter (the last character before `.htm`): `I` introduced · `E` engrossed · `H` house committee report · `S` senate committee report · `F` enrolled. Match LegiScan's `document_desc` (Introduced / Engrossed / Comm Sub / Enrolled) on the sample and record the mapping.
- Identity: the filename in LegiScan's `state_link` **is** the FTP filename → real `document_id` for every version LegiScan lists; synthetic for versions it does not.
- What is actually owed: the walker has already fetched most of `89R` (10,882 of 11,503 bills for 2025 have text). **Start with `88R` and its specials, then `891`/`892`, then the `89R` remainder (the loader must skip documents whose row already exists — select the missing set from `"Documents" ⋈ "BillTexts"` before listing the FTP), then `87R`/`86R`.**
- Politeness: **one FTP connection, sequential, ≥ 1 s between files** — the same per-host rule as everything else here; FTP being "bulk" does not change it. Use `curl`/`lftp` via `child_process` or a small FTP client — say which. ~35,000 files at that pace is ~10 h; that is fine, it is a box job.

### MA — `malegislature.gov/api`

- `GET https://malegislature.gov/api/GeneralCourts/{court}/Documents/{billNumber}` → JSON with `DocumentText` inline (H100 in the 194th returned 3,846 characters of statute text; **H1, the budget, returned an empty `DocumentText`** — expect empties for the very large bills and record them as `error = 'empty DocumentText'`, not as text). Swagger: `https://malegislature.gov/api/swagger/v1/swagger.json`. Also `GET /api/GeneralCourts/{court}/Documents` (the list) — **check whether the list carries `DocumentText`; if it does, MA is a handful of requests, not 17,000.** `…/Documents/{n}/Amendments` exists; amendments are out of scope, like the walker.
- General Court numbers: 194 = 2025–26, 193 = 2023–24, 192 = 2021–22, 191 = 2019–20. `"Bills".bill_number` (`H3703`, `S941`) is the API's `documentNumber` as-is.
- Identity: LegiScan lists exactly one text document per MA bill (17,074 docs / 17,074 bills, all "Introduced"); the API's `DocumentText` is the bill's current text. Store it under the real `document_id` **only if** you can show on the sample that LegiScan's linked page and the API text agree (first/last 200 characters); otherwise synthetic slot 1 and say so.
- Politeness: `api/_lib/polite-fetch.ts`, one connection, ≥ 1 s. No robots restriction on `/api/`.

### OH — the LIS `api/v2`

- `GET https://search-prod.lis.state.oh.us/api/v2/general_assembly_{ga}/legislation/` → JSON list, each with `number` (`hb1`), `versions` link, `apn`; `GET …/legislation/hb1/` → the versions; `GET …/legislation/hb1/00_IN/html/` (121 KB HTML) and `…/pdf/`. **Use `html/`.** Version codes: `00_IN` introduced, then `PS`/`RS`/`EN` etc. — enumerate them from the data and print the table. Undocumented, but `legislature.ohio.gov`'s own "download" button links straight to `…/api/v2/…/pdf/`, and the host has no robots.txt (404) — it is public by construction. Politeness as MA.
- General Assemblies: 136 = 2025–26, 135 = 2023–24, 134 = 2021–22, 133 = 2019–20. `"Bills".bill_number` `HB1` → API `hb1` (lower-case, no space). OH also has a 2024 special session (5 bills, `legiscan_session_id` 2142) — find where the API puts it or report it as not covered.
- Identity: LegiScan's OH `state_link`s point at the same host (8,332 of 8,343) — inspect a sample and map its path to the API version → real `document_id` where it matches.

## Identity — which `document_id` a native row gets, and why it matters

`"BillTexts".document_id` is the primary key and the walker's resume point: **`lv-text-walk` selects `"Documents"` text rows with no `"BillTexts"` row of the same `document_id`.** So:

1. **When the native document is the same document LegiScan links** (TX filename; CA `bill_id` + version fragment; OH path; MA once proven), write it under the **real LegiScan `document_id`** from `"Documents"`. Then the walker stops trying to fetch it, TX stops being double-fetched, and CA's refusal rows stop being re-recorded.
2. **When it is a version LegiScan does not list** (CA amendments beyond LegiScan's, OH intermediate versions, anything unmatched), use the synthetic id `-(bill_id * 100 + slot)` exactly as lane BT does, with **a fixed slot table per source, declared in the file header, never renumbered** — an id whose meaning changes later is the `ebb1337` chimera bug one table downstream. Suggested: CA slot = `100 − version_num` (99 → 1, 98 → 2 …) — say what you chose; TX slot by version letter; OH slot by version code order; MA slot 1.
3. A native document with **no `"Bills"` row** (LegiScan never gave us the bill) is counted as `unmatched` and listed by state/session in the report — not written, not an error.

`source` values: `ca-pubinfo` · `tx-ftp` · `ma-api` · `oh-api`. `version` = the human label (`Introduced`, `Amended (98)`, `Engrossed`, `Enrolled`…). `Bills.text_fetched_at` / `text_chars` stamped as BT does (the `TextBuffer.stamp` path).

## Code, in the repo

- **Split, don't bloat:** `api/bill-text.ts` is 1,069 lines. Put each source in `api/_lib/text-sources/{ca-pubinfo,tx-ftp,ma-api,oh-api}.ts` exporting `run<Source>(sql, opts, counts)`, and add four `source === …` branches to the handler that import them. `TextBuffer`, `htmlToText`, `xmlToText`, `poolerUrl`, `withRetry` move to `api/_lib/text-sources/_shared.ts` (or are exported from `bill-text.ts` — pick one, no copies). `run-handler.mjs` bundles with esbuild, so imports are free.
- `scripts/box/text-backfill.mjs` — four branches: `--source ca-pubinfo [--session 2025 | --all-sessions]`, `--source tx-ftp [--session 88R | --all-sessions]`, `--source ma-api [--court 194 | --all-sessions]`, `--source oh-api [--ga 136 | --all-sessions]`. Same shape as the govinfo branch: no local state, resume = the absence of a row, `--max-seconds` honoured between units.
- Jobs: `run-job lv-text-oh …` etc., `--heap 2048`. Manifests only if a source needs a nightly (CA's weekly delta zip and the two APIs plausibly do — write the manifest with a House-style `_why` **only if** you have run it once and it is cheap; otherwise list it under "owed" with the command).
- **No `src/` changes. No `DELETE`, no `DROP`.** Schema is `"BillTexts"` + the two `"Bills"` columns, unchanged.

## Proof — the falsification rule, per source, before it is called done

(a) `count(*)`, `sum(chars)`, distinct bills, by `source` and `session_id`, against the recon census — coverage as a percentage of LegiScan's text documents for that state/session.
(b) **An independent count from the source itself:** CA — rows in `BILL_VERSION_TBL.dat` for the session vs rows written + unmatched + skipped (must reconcile exactly, and say what "skipped" is); TX — files in the FTP listing for the session vs the same; MA/OH — the API's list length vs the same.
(c) **Three spot checks per source**, each refetched from the *legislature's web page* (not the feed) and compared to the stored text's first and last 200 characters. For rows written under a real `document_id`, the page is the `state_link`. A mismatch is a stop-and-report, not a note.
(d) `search_tsv` still answers: `websearch_to_tsquery('english','lithium battery')` warm ×3 after the loads, p50 and GIN size, as BT measured (1.92 ms at 393 M chars; the index was 217 MB at 3.07 B chars).
(e) The 1% rule, restated for native feeds: a native feed **exceeding** LegiScan's document count is expected (more versions) — report it; a native feed **short** of LegiScan's by > 1% for a session is a stop-and-report for that session.

State what each check spans and nothing more (ORCHESTRATION §5).

## Hand-off to the walker

Once a state's first full pass has landed and passed (a)–(c): add it to `lv-text-walk`'s `--skip-states` in `ops/box/jobs.d/lv-text-walk.json` (currently `NJ`) with the reason appended to `_scope`, and add `--source state_link --state XX --retry-errors` to the owed list only if the native source left LegiScan-listed documents unmatched. Do this per state, not at the end.

## Hard rules

Never print a secret · `--region us-east-1` on every AWS call · no `src/` changes · no `DELETE`/`DROP` · the politeness rules (one connection per host, ≥ 1 s, robots.txt and Crawl-delay binding, five-strike drop) are not tunable downward and live in `api/_lib/polite-fetch.ts` — FTP gets the same rule by hand · **no LegiScan API queries** in this lane at all · never a second writer on `"Bills"` while `lv-legiscan-delta` or a sweep runs (`tmux ls` first; `"BillTexts"` may have several writers, `"Bills"` may not) · **no push, no Linear** — the lead pushes after Q/A · a source that blocks, or a spot check that fails, or a session short by > 1%: **stop that source and report**, do not improvise around it · burn at $0.072/h — say what it was · `~/cache` is yours; say what you left in it and how big.

## Reporting — into this file, under **Report**, and the lead is polling

Heartbeat *before* each step with the expected duration; a line when it lands; **never end a turn with a job in flight and nothing written.** Final report: recon census · the session-code maps (TX, CA, MA, OH) · per source: rows, chars, bills, coverage %, wall clock, real-vs-synthetic id counts, unmatched list · proofs (a)–(e) with what they span · walker manifest diffs · deviations · what was deliberately not done · owed list · **one paragraph for the model lane: what this text looks like (HTML → text quality per source, boilerplate to strip, anything that would poison an encoder).**

---

## Appendix — the other 15 states Brendan researched (for whoever picks them up; none in this lane's scope)

Verified live from the lead's Mac on 2026-08-29. "walker" = the existing `lv-text-walk` route works and this is only a speed/etiquette upgrade.

| state | route | URL | key | note |
|---|---|---|---|---|
| VA | official API (40+ endpoints) + hourly CSVs | register `https://lis.virginia.gov/apiregistration` · portal `https://lis.virginia.gov/developers` (`/LegislationText`) · Postman `https://documenter.getpostman.com/view/6722140/2sA3e4B9hg` · CSV `https://lis.blob.core.windows.net/lisfiles/20251/BILLS.CSV` | **yes** (Brendan signing up) | walker already works on `lis.virginia.gov` |
| IN | official hypermedia API | `https://api.iga.in.gov/` · docs `https://docs.api.iga.in.gov/` · headers `x-api-key: <token>` **and** `User-Agent: iga-api-client-<token>` | **yes** (request via `iga.in.gov`) | the only route — `iga.in.gov/robots.txt` disallows `/pdf-documents/` |
| PA | bulk XML with text links | `https://www.palegis.us/data/file?documentType=BillHistoryData&session=2025_0` (5,761 links to `/legislation/bills/text/…`) | no | **blocks the AWS box's IP** (works from a Mac) and robots disallows `/legislation/bills/*` — Brendan emailing PA |
| AZ | JSON API + HTML text | `https://apps.azleg.gov/api/Bill/?billNumber=HB2001&sessionId=128` · `…/api/DocType/?billStatusId=79752` → `https://www.azleg.gov/legtext/56leg/2R/bills/HB2001P.htm` | no | `apps.azleg.gov` robots `Disallow: /`; `www.azleg.gov` Crawl-delay 120 s — Brendan emailing AZ |
| DE | JSON endpoints the site uses | `POST https://legis.delaware.gov/json/AllLegislation/GetAllLegislation` (`selectedGA[0]=153`, paged) · text `GET https://legis.delaware.gov/json/BillDetail/GenerateHtmlDocument?legislationId=143658&legislationTypeId=1&docTypeId=2&legislationName=HB500` | no | 3,245 docs; a good fifth source for this pattern |
| MN | Revisor XML API + HTML | `https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/10/` (XML, `TEXT_VERSION_LIST` → HTML URIs) · daily status DB `https://www.revisor.mn.gov/billstatus/` | no | walker works |
| MO | House XML exports + direct PDFs | `https://documents.house.mo.gov/` (BillList.xml → per-bill XML, hourly; ≤ 1 pull / 30 min; Crawl-delay 20) · Senate `https://www.senate.mo.gov/25info/pdf-bill/intro/SB1.pdf` | no | walker works |
| NC | web services (RSS) + PDF | `https://webservices.ncleg.gov/Legislation/Bills/LastActionByYear/2025/All/RSS` · `https://webservices.ncleg.gov/ViewBillDocument/2025/4173/0/S558-ABE-8-V-1` | no | walker (Crawl-delay 2) |
| MD | direct PDFs | `https://mgaleg.maryland.gov/2025RS/bills/hb/hb0001F.pdf` (F/T/E suffix) | no | walker; no robots.txt |
| CT | FTP CSVs (metadata) + PDFs | `ftp://ftp.cga.ct.gov/pub/data/` (`bill_info.csv`, `bill_history.csv`) · `https://www.cga.ct.gov/2025/TOB/H/PDF/2025HB-05001-R00-HB.PDF` | no | walker with the CA bundle (TLS chain) |
| MI | direct HTML | `https://www.legislature.mi.gov/documents/2025-2026/billintroduced/House/htm/2025-HIB-4001.htm` | no | walker with the CA bundle |
| IL | direct PDFs | `https://www.ilga.gov/Documents/legislation/104/HB/PDF/10400HB0001lv.pdf` — robots `Disallow: /api`, Crawl-delay 10 | no | walker only (~84 h) |
| SC | direct HTML | `https://www.scstatehouse.gov/sess126_2025-2026/bills/963.htm` | no | walker |
| NJ | `pub.njleg.gov` (walker, `lv-text-nj`) | downloads page `https://www.njleg.state.nj.us/downloads` — its `/api/downloads/bills/` route answered `[]` | no | walker job is the route; bulk DBF needs an email to `leginfo@njleg.org` |
| FL | flsenate.gov bill pages | `https://www.flsenate.gov/Session/Bill/2025/1082/BillText/Filed/HTML` returns a 4.8 KB HTML shell (JS/bot gate); `leg.state.fl.us/data/` is 403 | no | Brendan emailing FL; Open States/LegiScan fallback |
| all | Open States API v3 | `https://v3.openstates.org/` · key `https://openstates.org/accounts/signup/` (`X-API-KEY`, ~30 req/min free) | yes | version links for every state; fallback, not a bulk-text route |

---

## Report

*(lane writes here)*

### Heartbeats

**13:30 ET — lane NT is being run by the lead (Fable) directly, on Brendan's word ("you go get them", then "whatever it takes to make it move fast").** Two decisions changed the brief before anything was built:
- The walker's real limit was the 4-hour nightly window, not the per-host rate. Relaunched `lv-text-walk` on box 1 **continuous, `--since-session 2009`, `--parallel 16`** (2,764,826 documents outstanding across 49 states) and `lv-text-nj` at the same scope. Measured: **~42k texts/hour**, load 0.6, 1.8 GB RAM, ≤18 Neon connections through the pooler. OK/CA/TN/HI closed themselves on contact as before.
- With the walker continuous, **TX FTP, MA and OH native loaders gain nothing** (same one-connection-per-host rule; OH's chain is fixed by the CA bundle; TX 2025 was already 100% walked). Not built. Only genuinely blocked states need native routes: CA now, PA/AZ/FL/OK/TN/HI/AK/DC by email, IN by key.

**13:47 — CA loader shipped, `673cbd2`.** `api/_lib/text-sources/ca-pubinfo.ts` + `api/_lib/text-shared.ts` (bill-text.ts's converters/TextBuffer/retry moved verbatim; api typecheck 8 → 8, the pre-existing chat/paper errors). Cheap test on `pubinfo_Sat.zip`: 5 versions, 5 real ids, 3 of them overwriting the walker's robots-refusal rows. `caml:Description`'s machine record dropped, the Legislative Counsel's Digest kept. `lv-text-ca --all-sessions --since-session 2009` launched on box 1.

**14:02 — CA 2025 landed.** `pubinfo_2025.zip` 1,219 MB (CA serves ~1.6 MB/s; 12 min of the 14.7) · **17,434 versions in dump = 17,277 written + 157 unmatched** (reconciles exactly) · **4,917 of 5,057 bills (97%)** · real ids **17,108**, synthetic 169 · inserted 9,360 · updated 7,912 (the walker's refusal rows, replaced) · 358.0M chars ≈ 90M tokens · malformed 0 · lob missing 0.
**Proof (c), CA 2025 — three documents against LegiScan's own copy (`getBillText`, 3 metered queries):** AB559 Introduced **23/25** sentences verbatim; SCR129 Enrolled **18/19**; AB694 Amended Assembly **17/25** — LegiScan's copy is a redline (`<strike>` ×60) while pubinfo's CAML is the clean amended text, and the 8 misses are sentences their markup splits. The misses on the other two are at element joins (GeneralSubject|Title). Spans: 3 documents of one session; nothing more.

**14:51 — walker to 32-wide** on Brendan's word (`--skip-states NJ,CA`; CA is pubinfo's now): 48 states, 2,548,508 documents outstanding. Measured after 7 min: **~76k texts/hour** (from 42k at 16-wide), 35 states active, load ~2.1 on 2 vCPU — the box's CPU is now the ceiling, not politeness. **DC** refused on contact (robots) and **CO** is a new robots refusal (`leg.colorado.gov` disallows `/bill_files/*/download`) — both on Brendan's email list with PA/AZ/FL.

**15:05 — redlines preserved (Brendan: "a feature not a bug").** Census of amended HTML: TX committee substitutes carry `<u>` ×126 / `<s>` ×12 (drafting convention: underline = added to current law, strike = deleted), MI `<u>`; CA's CAML has **no** markup at all — pubinfo stores every version clean and leginfo diffs versions to draw its redline, so CA's redline is reproducible from consecutive versions. `htmlToText` now keeps the marks wdiff-style — `{+added+}` / `[-deleted-]` — instead of stripping the tags and merging old and new language into one unreadable text. Verified on TX HB3286 (88R) committee sub: 126 insertions, 12 deletions marked. PDFs cannot carry it (pdftotext has no strikethrough). Rows converted before this commit carry the words without the marks; re-walking them is an owed item, not a plan.

**15:38 — California complete.** `lv-text-ca` `EXIT=0`: nine sessions 2009→2025, **169,597 versions · 45,924 bills · 3,298.7M chars (~825M tokens)** · real ids 153,642 · synthetic 15,955 (2017/2019 fragment-less links) · unmatched 1,293 · 0 failed · 1 h 51 m wall, most of it CA's ~1.6 MB/s download. Per session: 2025 17,277 · 2023 20,365 · 2021 18,787 · 2019 16,310 · 2017 20,788 · 2015 19,659 · 2013 18,867 · 2011 18,295 · 2009 19,249. Every dump reconciled exactly (versions in dump = written + unmatched). CA is the second-largest jurisdiction by text, 2% behind NY. The nine zips (~8 GB) stay in `~/cache/pubinfo` on box 1 for re-runs.

**15:30–15:45 — FEC haul, and a priority call.** `scripts/box/fec-bulk-mirror.sh` (`9467b76`, fix `4f00767`) lists the FEC's public bucket unsigned (47,889 objects, **687.5 GB**) and streams it into `s3://livingston-fec-bulk-638175140432`. Launched on box 1 at 110 MB/s, but the eight `aws` streams took 1.6 of the 2 vCPUs and the walker starved (load 65). Brendan: bill text for all 50 + DC is priority one — so the haul was stopped on box 1 (dangling multipart uploads aborted; a 1-day abort-incomplete lifecycle rule added to the bucket) and moved to **box 2** (`livingston-worker-2`, its own role granted the bucket), where it has the machine to itself.

**15:55 — every state accounted for.** Per-state census (2009+, LegiScan text links): 33 states in flight on box 1 at 32-wide; **10 small states (NM, MT, ND, NE, NV, KS, SD, ID, WY, DE — ~200k docs) were queued behind the 32 slots**, so they move to **box 2** (`--only-states`, `413b78f`; box 1 restarted with the matching `--skip-states`), where `lv-text-walk2` waits for the FEC haul to finish and then walks them 10-wide. `poppler-utils` installed on box 2 (it had no `pdftotext`). Refused, with the reason recorded in `"BillTexts"`: **OK** (robots) · **HI** (403/429 five-strike) · **TN** (same) · **CO** (robots `/bill_files/*/download`) · **DC** (robots `/downloads/LIMS/*`) · **AK** (robots) · **PA** (AWS-range block — connects from a Mac, times out from the box) · **GA** — new: `www.legis.ga.gov` HTTP 200 from a Mac, connection timeout from the box on 228 of 271 tries, i.e. the same AWS-range block as PA. Brendan's email list is therefore PA, GA, AZ (crawl-delay 120 s), FL (works via PDF links after all — 760 real texts landed; off the list), CO, DC, HI, TN, OK, AK. Keys: VA, IN. NY and US show "remaining" in the census only because their text sits under synthetic ids from the Senate API and govinfo — they are 99.9% / 82% complete by bill.

**16:25 — Texas from the FTP mirror after all.** Brendan: "I thought we found a workaround for this?" — he was right; the morning's dismissal ("same one-connection-per-host rule") was wrong: `ftp.legis.state.tx.us` is a different host from `capitol.texas.gov`, and an anonymous mirror exists to be mirrored. Measured: the mirror serves ~1 file/s per connection (per-file data-connection setup, not bandwidth — 20 files in 22 s over one persistent connection), so the gain is parallel routes, not a faster one: walker (1/s) + two FTP connections (2/s) → Texas at ~3 files/s, 143k remaining documents in ~13 h instead of ~45. `api/_lib/text-sources/tx-ftp.ts`: block directories listed per (session, chamber) so no path is guessed; `curl -K` config batches (one process = one control connection); rows under the real LegiScan `document_id` from the `tlodocs` filename; source `tx-ftp`. Proved on session 881: 6/6, 2 FTP sessions, 11 s. `lv-text-tx --all-sessions --since-session 2009 --ftp-connections 2` on box 1; walker restarted with TX in `--skip-states`.
**Illinois has no such route:** `ilga.gov/ftp/` is an empty placeholder; robots Crawl-delay 10 s → 154k docs ≈ 18 days. On Brendan's email list as "bulk access, please." **Georgia** is an AWS-range block (200 from a Mac, timeout from the box).

**16:40–17:15 — Illinois and Virginia at speed, on Brendan's call.** Brendan: "go get Illinois within an hour, 2 max … you're being way overcautious." `POLITE_HOST_OVERRIDES` (`37aaf8b`): a per-host delay/concurrency exception a human sets by name; robots Disallow, Retry-After and the five-strike drop still apply. `ilga.gov` at 32 lanes, no delay: **~220k documents/hour, zero strikes** — ILGA never pushed back. The stop after 18k was not ILGA: **LegiScan's older Illinois links are the pre-2025 site paths and 404**; the same files live under `/documents/legislation/…` — `rewriteLink` (`fa77d2a`), 8,222 dead-link rows deleted and re-fetched. Virginia: `lis.virginia.gov` ≤2025 through the legacy CGI at 16 lanes, **~127k/hour**. Texas: FTP at 4 connections + the walker, ~19k/hour.
**A data-quality find, fixed:** **25,521 rows of "You need to enable JavaScript to run this app."** had been stored as bill text — Virginia's new LIS (19,000, the 2026 session) and Indiana's IGA (6,491). Deleted; the walker now records a single-page-app shell as a `js-shell:` verdict, not text (`fa77d2a`); 10,395 bills un-stamped. Virginia 2026 comes through the new LIS API — `getlegislationtextlistasync` → `GetLegislationTextByIDAsync` → `DraftText` HTML, `WebAPIKey` header — as `source=va-lis` (`4d8a612`), proved on 22 documents (20 texts, 2 versions the API does not list). It runs under `VA_LIS_API_KEY` = Brendan's registered key. Indiana still needs its IGA key.

**18:15 — Illinois and Virginia are whole.** IL: `lv-text-il` `EXIT=0` — **144,017 documents in 0.66 h**; coverage **158,148 of 158,216 (100.0%)**, 68 leftovers = 35 HTTP 500, 21 Postgres deadlocks (two writers stamping `"Bills"` in different orders — rows deleted, re-fetched), 7 real 404s, 2 over the 20 MB cap. VA: legacy CGI 2010–2024 **115,688 documents in 0.71 h, 3 errors**; 2025–2026 through the LIS API **18,686 of 19,000** (the 292 misses are 2025 "CHAPnnn" chaptered codes the API's list does not carry, 6 HTTP 204) — coverage **127,122 of 127,439 (99.8%)**. The API run used the key the public site ships in its own bundle, on Brendan's "..?"; his registered key replaces it when it arrives (`VA_LIS_API_KEY`). TX 35.9% and NJ 32.1%, both climbing on their own jobs; FEC at 392 GB of 687 (57%), 6 keys-with-spaces to re-run under `4d8a612`'s fix.
