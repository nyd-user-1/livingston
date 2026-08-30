# Lane RT — the last ~10 % of bill text, and the free enrichments next to it

**Kick-off (paste into an Opus window in `~/Code/livingston`):**
`Read prompts/2026-08-30-remaining-text.md and do it. Report into that file under ## Report as you go. Do not spend LegiScan API queries until the report has Brendan's go for the budget named in step 3.`

---

## Where we are (2026-08-30 ~18:00 ET)

2,128,849 bills · **1,916,065 with text (90.0 %)** · 212,784 without. The S3 text sink is drained; parked PDFs are zero. **Indiana is running from the Mac right now** (new routes, commit after `d66534b`) and should land ~40k documents; do not touch Indiana unless its run has ended — check `pgrep -fl 'text-backfill.mjs --source state_link --state IN'` and the census.

What remains, by cause, best current estimate (documents):

| Set | Docs | Why it has no text | Route |
|---|---|---|---|
| IN 2009–2013 | ~9.3k | `www.in.gov/legislative/bills/<yr>/…` is gone; the new site's archive starts 2014 | **Wayback** |
| DC | ~30k | `lims.dccouncil.gov` origin was down on 08-30 (Cloudflare 522); 17.6k rows were deleted for a retry | retry from a box or the Mac when it answers |
| MT | ~23k | `leg.mt.gov/bills/…` → `archive.legmt.gov` 404s; `api.legmt.gov/docs/v1/documents/getBillText` serves only the current session | **Wayback**, else API |
| AR | ~13.5k | bot wall (42-byte GIF for every document URL) | **Wayback**, else API |
| GA www1 | ~12k | old `www1.legis.ga.gov` archive dead | **Wayback** |
| SD | ~9k | old hosts dead; new API needs internal ids | **Wayback**, else API |
| OH 129th GA | ~8k | archive host dead | **Wayback** |
| VT | ~8k | WAF refuses the driver's pattern even at 1 req / 5 s from a fresh IP; single requests pass; parked at 46 % | Wayback for older sessions; trickle for current |
| DE | ~2k | Lotus-Notes host | Wayback, else API |
| scanned PDFs | ~11k | image-only PDFs (MN, MT, AR, others); pdftotext yields nothing | **OCR** |
| no text link at all | rest | LegiScan lists no text document; nothing to fetch | none (report the count) |

Two facts that bound the routes:
- **legiscan.com is behind a Cloudflare managed challenge** (403 for pages, PDFs and even robots.txt). It is a paid API relationship, not the public record — **never crawl it**. The metered API (`getBillText`, 1 query per document, 30,000 queries per month, `LEGISCAN_MONTHLY_STOP = 25_000` in `api/bill-text.ts`) is the only LegiScan route.
- **Standing orders** (`~/Code/scripts/FLEET-DOCTRINE.md` §0): public right over robots.txt (the fetcher is already `POLITE_ROBOTS=advisory`); max speed, bulk first; the fetch is the resume point.

## Do, in order

**1. The Wayback route for dead hosts.** The Internet Archive captured these sites when they were alive. Build it as a fallback inside the state_link path (or a `--source wayback` mode — your call, say why): for a document whose host is on a known-dead list, look up the nearest capture with the CDX API (`https://web.archive.org/cdx/search/cdx?url=<url>&output=json&limit=1&filter=statuscode:200&from=<session year>`), fetch `https://web.archive.org/web/<ts>id_/<url>` (the `id_` flag returns the original bytes, no toolbar), and pass the body through the same `bodyToText` / PDF-defer path as any other fetch. The forms harvester (`scripts/forms/forms-harvest.mjs`) already talks to the CDX and knows archive.org's manners: **~4 concurrent, `ECONNREFUSED` means back off 30 s**, expect ~3 documents/s. Record `source = 'wayback'` and the capture timestamp in `version` or a new column — provenance matters (`docs/PROVENANCE.md`). Prove it on 200 Indiana 2012 documents, then run IN 2009–13, GA www1, OH-129, MT, SD, DE, AR, VT-older, in that order, from the Mac or a box (archive.org does not care which IP). Report per set: considered · stored · no capture · failed.

**2. DC.** Probe `lims.dccouncil.gov`; when it answers, rerun DC (`--state DC`) from a box (its 17.6k 522 rows were already deleted, so the absence is the queue). If it is still down, note it and move on.

**3. The metered LegiScan route — only with Brendan's go.** Add `--source legiscan` to `scripts/box/text-backfill.mjs` / `api/bill-text.ts`: select text documents with no `"BillTexts"` row (or a row whose error is one of the dead-host/bot-wall verdicts) for the named states, call `getBillText&id=<document_id>`, decode `text.doc` (base64; PDF or HTML — `bodyToText` handles both, PDFs may go through `PDF_DEFER_BUCKET`), write with `source='legiscan'`, count `legiscanQueries`, and **stop hard at the budget** (reuse `legiscanMonthToDate` + `LEGISCAN_MONTHLY_STOP`, and take a `--legiscan-budget N` flag that lowers it for a run). Quota facts: the month resets on the 1st; August has used ≈1,100 queries (20 texts + the dataset imports), so ≈25,000 are spendable before the reset without touching the weekly refresh's headroom; September brings 30,000 more. Priority when Brendan says go: whatever step 1 could not recover, largest state first. Never run this against a state whose host still serves (that is what the fleet is for).

**4. OCR for the scans.** On box 2 (or a fresh `t4g.large`): `pdftoppm -r 200 -gray` → `tesseract` (eng) → text, for rows whose PDF converted to (near) nothing; mark `source='ocr'`. Measure a sample of 50 first (seconds per page, quality), then run. ~11k documents.

**5. Free enrichment next to the text — amendments and supplements.** `"Documents"` holds ~1M rows of `document_type` in (`amendment`, `supplement`) with state links (fiscal notes, analyses, amendment texts). The fleet machinery fetches them unchanged with `--amendments`-style scoping (see `includeAmendments` in `runStateLink`). Size it (rows by state and host), then run it the same way the text pass ran — this is the next biggest lift in the corpus and it costs no API queries. **Watch the `document_id` namespace:** `Documents.document_id` is shared between `text` and `supplement` rows (543650 is both an AZ 2012 bill text and a 2025 supplement) while `"BillTexts"` is keyed on `document_id` alone. Before loading supplements into `"BillTexts"`, either key by (`document_type`, `document_id`) or put them in their own table — say which and why in the report.

**6. Census and report.** Bills with text / without, by state, before and after each step; the "no text link" residue counted honestly; what each route cost (time, boxes, queries).

## Reporting

Heartbeat into `## Report` before each step with the expected duration, every 15–20 minutes while something runs, and a final section: routes built (file:function, flags, commits), documents recovered per set, what remains and why, the quota spent, deviations.

## Report

*(lane writes here)*
