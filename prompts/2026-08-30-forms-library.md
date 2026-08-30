# Lane FL — the forms library: every significant NYS and federal PDF form, in S3, catalogued

**Written:** 2026-08-30 02:10 ET, by the lead (Fable), as a kick-off + hand-off — the lead started it and may not finish it. **Window:** `/rename forms-library`, `/color yellow`. **Model:** Opus. **Repo:** `~/Code/livingston`.
**Read first:** this file end to end; `/Code/scripts/FLEET-DOCTRINE.md` §3 (operating rules) and §2 (the database rules); `scripts/forms/forms-harvest.mjs` (the tool, built tonight); `docs/TEXT-FLEET.md`.

## Why (Brendan, 02:00 ET)

> "New York State and the Federal government both hand out PDFs for a lot, and I mean a lot of things … find all significant PDF forms relied upon by the state and federal government for benefits, grants, and programs. Livingston began as an effort (v1) to assist one individual in filling out a 28-page NYS public assistance/benefits form. With what you've built we can probably get the full NYS library. Get all of NYS and get the most common federal forms to start."

The 28-page form is OTDA's **LDSS-2921** (Application for Certain Benefits and Services). The goal is the *catalogue* as much as the files: agency, form number, title, program, revision, languages, page count, fillable fields — the raw material for Penny (forms-as-a-service, the keeper from 2026-08-28) and for the interview/fill engine that already exists three times over in this portfolio.

## What the lead found in the first hour (2026-08-30 02:00–02:30 ET)

**The live indexes are mostly hostile or JS-rendered; the files usually are not.** Probed with curl (plain and browser UA):

| Source | Index page | Files | Route |
|---|---|---|---|
| **OTDA** (`otda.ny.gov/programs/applications/`) | connection refused at the TLS handshake — a fingerprint wall, browser UA does not help | same wall | **Wayback CDX + archive fetch** (24,655 PDF URLs indexed) |
| **OCFS** (`ocfs.ny.gov/forms/`) | same wall | same | Wayback (25,955) |
| **DTF / tax.ny.gov** (`/forms/current-forms/`) | 403 to any bot | direct PDF 404 under the guessed path | Wayback (1,751 under `/pdf/current_forms`) — the catalogue gives the real paths |
| **DOH** (`health.ny.gov/forms/`) | 200, 51 category links | 200 | live crawl, depth 2 (Wayback has 1,681) |
| **DOL** (`dol.ny.gov/forms-and-publications`) | 200, JS list | ? | Wayback (10,250) then live fetch |
| **DMV** (`dmv.ny.gov/forms`) | 200, 12 links on page 1 | 200 | live crawl (paginated) |
| **OMH** (`omh.ny.gov/omhweb/forms/`) | 200, 78 PDFs | 200 | live |
| HESC, HCR, OCFS-childcare, OASAS, Ag&Mkts, DEC, Civil Service, Grants Gateway | not yet probed | | Wayback first, always |
| **NYC HRA** (`nyc.gov/assets/hra`) | index 404 (moved) | | Wayback (6,134) |
| **IRS** (`irs.gov/pub/irs-pdf/`) | **200, a plain directory, 63 pages × 50 = ~3,100 PDFs** | 200 | live, trivial |
| **VA** | **`https://api.va.gov/v0/forms` — 800 forms as JSON with URL, title, pages, revision date** | 200 | the API, then live fetch |
| **USCIS** (`uscis.gov/forms/all-forms`) | 200, 103 form pages | 200 (`/sites/default/files/document/forms/i-485.pdf`) | live, depth 2 |
| **SSA** (`ssa.gov/forms/`) | 403 index and 403 files | | Wayback (529) |
| GSA forms library, grants.gov repository, HUD HUDCLIPS, CMS, OPM, DOL-ETA, USDA-FNS, Dept of Ed | JS-rendered; grants.gov/HUD/CMS/OPM not yet probed | | Wayback CDX for each host's PDF space, then live fetch |

**The Wayback CDX is the master catalogue.** `http://web.archive.org/cdx/search/cdx?url=<host>/<path>*&filter=mimetype:application/pdf&fl=original,timestamp,digest,length&collapse=urlkey` returns every PDF URL the archive has ever captured for a site, with a timestamp and a content digest. Where the live host serves it, fetch live (fresher); where it walls us, `https://web.archive.org/web/<timestamp>id_/<url>` serves the archived bytes as-is. Filter by path/name to forms (`/forms/`, `/applications/`, `LDSS-`, `OCFS-`, `DOH-`, `IT-`, `SSA-`, `f1040`, …) and keep the rest catalogued but unfetched.

## The tool — `scripts/forms/forms-harvest.mjs`

```
node scripts/forms/forms-harvest.mjs catalog [--source otda|ocfs|…|all]      # CDX + live indexes → "Forms" rows + s3://…/forms-catalog/<source>.jsonl
node scripts/forms/forms-harvest.mjs fetch   [--source …] [--lanes 4] [--limit N]   # live → archive fallback → s3://livingston-bill-pdfs-638175140432/forms/<gov>/<agency>/<file>
node scripts/forms/forms-harvest.mjs inspect [--source …]                     # pdfinfo pages + AcroForm field names → the row
```
Sources are declared in `SOURCES` at the top of the file (gov, agency, CDX patterns, live index URLs, include/exclude path regexes). Adding an agency is adding an entry. Politeness: 4 lanes per host, browser-style UA, `Retry-After` honoured; archive.org at ≤ 4 in flight (they publish no limit; be a good citizen — the archive is the fallback for everything).

**Storage.** Files: `s3://livingston-bill-pdfs-638175140432/forms/<gov>/<agency>/<basename>` (originals, never converted in place). Table `"Forms"` in the policy Neon (created by the tool): `id, gov, agency, source, url, wayback_ts, s3_key, form_number, title, bytes, sha256, pages, fillable_fields (jsonb), status, error, fetched_at`. Idempotent by `url`; a re-run refreshes changed digests only.

## Do, in order

1. `git pull`; read `SOURCES`; run `catalog --source otda` and look at the rows — the include/exclude regexes are the lead's first guess and the LDSS forms must all be there (`LDSS-2921`, `LDSS-3174`, `LDSS-4826`, `LDSS-3421` are the sanity set).
2. `fetch --source otda --limit 50` → check S3 and the rows (status, bytes, pages). Then the full OTDA fetch.
3. NYS in this order: OTDA, OCFS, DOH, DOL, DTF, DMV, OMH/OASAS, HESC, HCR, NYC HRA. Catalogue each, fetch each. Report per source: catalogued / fetched live / fetched from archive / failed.
4. Federal, most common first: IRS (directory), VA (API), USCIS, SSA (archive), then grants.gov SF-424 family, HUD, CMS, DOL-ETA, USDA-FNS (SNAP/WIC), Dept of Ed (FAFSA), OPM, SBA. Probe each index the way the lead did (curl plain, curl browser UA, CDX count) and add the `SOURCES` entry before fetching.
5. `inspect` everything fetched: page counts and AcroForm field names — the field list is what Penny needs.
6. Report: the table of sources with counts; the ten largest forms by pages; how many have fillable fields; what the catalogue is missing that a human would expect (compare against `otda.ny.gov`'s own applications page as seen in a real browser).

## Hard rules

Originals to S3 untouched; never overwrite a different digest (versions accumulate under `<basename>` + `-<sha8>` when they differ) · 4 lanes per host, archive.org included · no `DELETE`/`DROP` · `"Forms"` is this lane's only table · no push — commit by pathspec, the lead pushes after Q/A · report into this file under **Report**, heartbeat per source.

## Report

*(lane writes here)*

### Heartbeats

**02:30 ET (lead) — proved and launched.** `catalog --source otda` from the Wayback CDX: 1,774 PDFs under `otda.ny.gov/programs/*`, 1,613 kept, 550 under `/applications/` — the LDSS forms are filed by bare number there (`2921.pdf`, `2921-SP.pdf`, `4826-*.pdf` …; 17 captures of 2921, 33 of 4826 across revisions and languages). `fetch --limit 40` through the archive: 40/40 in 20 s, 10 MB, to `s3://livingston-bill-pdfs-638175140432/forms/NYS/OTDA/`. Then two jobs on box 2: `lv-forms-nys` (catalog → fetch → inspect for otda, ocfs, doh, dol, dtf, dmv, omh, oasas, hesc, hcr, nycHra, nycDhs, nycHpd) and `lv-forms-fed` (irs, va, uscis, ssa, grants, hud, cms, dolEta, fns, ed, opm, sba, gsa). First minutes: OCFS 5,421 catalogued, SSA 529. Logs: `~/logs/lv-forms-nys.log`, `~/logs/lv-forms-fed.log` on box 2; catalogue JSONL per source under `forms-catalog/`.
**Owed to whoever picks this up:** the include regex is generous — `inspect`'s page counts and field names plus a human pass separate forms from brochures; `collapse=urlkey` keeps one capture per URL (the first the archive saw), so `wayback_ts` may be old — the live fetch is preferred and the archive is the fallback, but for walled hosts (OTDA, OCFS, DTF, SSA) a second pass asking the CDX for the *latest* capture per URL (`&from=2024`) would refresh revisions; DOL/DMV/HESC/HCR live indexes are JS and were not crawled — their CDX space covers them; NYC HRA's index moved — CDX covers it.

**02:56 ET (lead) — catalogue complete, fetch running as six parallel jobs on box 2.** NYS catalogued ≈ **89k PDFs**: OTDA 1,613 · OCFS 5,421 · DOH 13,530 · DOL 11,794 · DTF 38,121 · DMV 1,175 · OMH 81 · OASAS 2,232 · HESC 344 · HCR 9,703 · NYC HRA 3,528 / DHS 1,316 / HPD 4,251. Federal so far ≈ 50k: IRS 2,155 · VA 790 · USCIS 514 · SSA 529 · Grants.gov 491 · HUD 27,555 · CMS 18,612; DOL-ETA, FNS, ED, OPM, SBA, GSA cataloguing in job `f`. (DTF/HUD/CMS/DOH counts are their whole PDF spaces — instructions, publications, notices included; `inspect` + a human pass narrow to forms.)
Lessons in the first fetch: archive.org sheds load with `ECONNREFUSED` past ~4 concurrent — the walled sources (OTDA, OCFS, DTF, SSA) now share one 4-lane job (`lv-forms-a`) with a 30 s backoff and transient failures retryable (`ccdaeaa`); live sources run in parallel jobs by host family (`b` NYS agencies, `c` NYC, `d` IRS/VA/USCIS/Grants, `e` HUD/CMS, `f` the rest). Rates: IRS 1,600 in 1.5 min live; DOH 400 in 0.7 min; OTDA ~3/s via the archive. Each job ends with `inspect` (pages + fillable field names). Logs `~/logs/lv-forms-{a..f}.log` on box 2; the box stops itself when the last job ends.
