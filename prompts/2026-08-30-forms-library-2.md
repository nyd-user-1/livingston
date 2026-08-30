# Lane FL-2 — the forms library, second pass: latest revisions, walled hosts taken live, more agencies, forms vs publications

**Kick-off (paste into an Opus window in `~/Code/livingston`):**
`Read prompts/2026-08-30-forms-library-2.md and do it. Report into that file under ## Report as you go.`

---

## Standing orders (Brendan, 2026-08-30 — read these first, they govern this lane)

> As a citizen I, we, have a right to public information; that is the determining factor in our work. We will not be destructive or hazardous or act with malice, but we are done being polite. Our primary objective is to maximize data ingestion for legitimate purposes, and all of ours are legitimate.

In practice (canonical text: `~/Code/scripts/FLEET-DOCTRINE.md` §0):
1. **Public right over robots.txt.** The fetcher is already `POLITE_ROBOTS=advisory`. A host's preference is not a reason to skip a public form.
2. **A "walled" host is a fact to route around, not a reason to stop.** OTDA and OCFS drop non-browser TLS handshakes; SSA 403s a plain client; DTF is behind Akamai. The first pass went to the Wayback Machine for those. This pass goes **live first** with a browser-grade client (a real TLS fingerprint — `curl-impersonate`, or Playwright/Chromium headless with the identified UA in its string — whichever the host accepts; prove it on ten files), Wayback as the fallback, never as the default. What still holds: an identified User-Agent with a contact address, per-host pacing that backs off on 429/503, no destructive requests, nothing but GETs of public files.
3. **Nothing runs one-at-a-time.** One job per host family, lanes ramped until the host pushes back, then just under. State your concurrency and why before each fetch.

## Where the first pass ended (2026-08-30 23:19Z)

`"Forms"` table: **392,182 catalogued · 275,426 fetched to S3 (139 GB)** under `s3://livingston-bill-pdfs-638175140432/forms/{NYS,NYC,US}/<AGENCY>/`. NYS (10 agencies, 84k) and NYC (3, 9k) are fetched and inspected; federal IRS/SSA/USCIS/Grants.gov/VA/HUD/CMS done; DOL (178k), USDA-FNS, SBA, GSA, ED, OPM are fetching on box 2 as jobs `lv-forms-f..j` — check `tmux ls` and `~/logs/lv-forms-*.log` there before you touch federal sources. Tool: `scripts/forms/forms-harvest.mjs catalog|fetch|inspect --source <name|all> [--lanes N]`; `SOURCES` map at the top of the file; the first lane's memo is `prompts/2026-08-30-forms-library.md` (read its Report). Errors so far: NYS 2,657 · NYC 646 · US 1,424 — mostly 403/404/TLS; they are the first target of step 2.

## Do, in order

**1. Latest revisions on every host that was catalogued from the archive.** The first pass used the CDX with `collapse=urlkey`, which returns the *first* capture per URL, so `wayback_ts` is often years old and the stored file may be a superseded revision. For every source whose fetch went through `web.archive.org` (OTDA, OCFS, DTF, SSA — check `Forms.source`/`wayback_ts`), re-ask the CDX for the **latest** 200 capture per URL (`&from=2023`, `filter=statuscode:200`, sort descending), compare digests, and re-fetch where the digest changed; keep both versions (new `s3_key`, keep the old one — revisions are provenance; add `superseded_by` or a revision column, say which). Report per agency: URLs checked · newer capture found · re-fetched.

**2. The walled hosts, live.** For OTDA (`otda.ny.gov`), OCFS (`ocfs.ny.gov`), DTF (`tax.ny.gov`), SSA (`ssa.gov`): probe with a browser-grade client (step 2 of the standing orders); if the live file is newer than the archive's (Last-Modified / digest), take it. Re-drive every errored row (403/TLS/404) through the live client first, Wayback second. Report per host: what client the host accepts, rows recovered, rows truly gone.

**3. More NYS agencies.** Catalogue, fetch, inspect: **Agriculture & Markets** (`agriculture.ny.gov`), **DEC** (`dec.ny.gov` — permits, applications), **Civil Service** (`cs.ny.gov` — exam applications, forms), **Grants Gateway / Statewide Financial System** (`grantsmanagement.ny.gov`, `sfs.ny.gov`), and while you are there **Workers' Compensation Board** (`wcb.ny.gov` — the C-forms), **Department of State** (`dos.ny.gov` — licensing), **Office for the Aging**, **Education Department** (`nysed.gov` — the forms subtree only), **NYSERDA**, **Housing (HCR)** gaps, **Unemployment (DOL) claimant forms** if the first pass missed them, and **New York City** agencies beyond HRA/DHS/HPD (DOF, DOB, DOE, ACS, DCA). Same recipe: CDX as the catalogue, live fetch, archive fallback, `inspect`. Add each as a `SOURCES` entry with its include regex; report counts.

**4. Forms versus publications — the classification pass.** DTF (38k), HUD (27.6k), CMS (18.6k) and DOL (178k) are those agencies' whole PDF spaces. Build a `kind` column (`form` · `instructions` · `publication` · `notice` · `other`) from what `inspect` already knows (fillable field count, page count, form-number pattern in the file name or first page, title words like "Application", "Form", "Instructions", "Publication", "Notice") plus a first-page text sample (pdftotext -l 1). Rules first, a small model second only where rules are unsure. Report the resulting counts per agency and a 200-row random sample with your labels for Brendan to eyeball.

**5. Federal follow-through.** When `lv-forms-f..j` on box 2 end, re-drive their errors (step 2's client), then add **DHS/FEMA** (disaster assistance), **Treasury/Fiscal Service**, **Dept of State** (passport forms), **DOT/FMCSA**, **Dept of Labor OWCP**, **Federal Student Aid**, **USPS** — catalogue first, size, then fetch in parallel jobs.

**6. Census and report.** Per government and agency: catalogued · fetched · inspected · fillable · kind breakdown · errors remaining and why; S3 object count and bytes; what a future nightly refresh should do (a `lv-forms-refresh` manifest in `ops/box/jobs.d/` — write it, `enabled: false`, and say what it would cost).

## Reporting

Heartbeat under `## Report` before each step with the expected duration and the concurrency you chose; every 15–20 minutes while something runs; a final section with the tables above, the client each walled host accepted, commits, deviations. Commit `scripts/forms/forms-harvest.mjs` changes and this file as you go.

## Report

*(lane writes here)*
