# Lane F — the Forms surface: 369,735 government PDFs, on the site, now

**Brendan, 2026-09-02 09:20 ET:** *"We have to get a PDFs surface on the site
immediately. We have tens of thousands of PDFs that would be good to
showcase."* It is more than that. The forms library lane of 2026-08-30
(`prompts/2026-08-30-forms-library.md`, `-2.md`; tool
`scripts/forms/forms-harvest.mjs`) left a `"Forms"` table that came to Aurora
with everything else. Measured this morning over the Data API:

| | rows |
|---|---|
| total | 392,182 |
| fetched, live | 238,793 |
| fetched, from the Wayback archive | 130,942 |
| failed | 16,745 |
| catalogued, not fetched | 5,702 |

Largest families (rows · fetched · inspected-fillable): US DOL 177,998 ·
176,284 · 0 (never inspected); NYS DTF 38,121 · 36,563 · 3,635; US HUD
27,555 · 26,464 · 1,195; USDA-FNS 25,732 · 19,246 · 0; SBA 22,379 · 16,472 ·
522; GSA 19,391 · 17,111 · 224; CMS 18,612 · 18,517 · 312; NYS DOH 13,530;
NYS DOL 11,794; HCR 9,703; OCFS 5,421; NYC HPD 4,251; NYC HRA 3,528; ED
2,519; OASAS 2,232; IRS 2,155; OTDA 1,613; NYC DHS 1,316; DMV 1,175; VA 790.
Pages known for ~3.2 M. Originals:
`s3://livingston-bill-pdfs-638175140432/forms/<gov>/<agency>/<file>`
(private, same account as Amplify), `s3_key` on the row.

Columns: `id, gov, agency, source, url, wayback_ts, digest, s3_key,
form_number, title, bytes, sha256, pages, fillable_fields (jsonb), status,
error, catalogued_at, fetched_at, inspected_at`. There is no program or
description column — do not invent one.

Work in `~/Code/govblock`. Read `prompts/2026-09-02-item-canon.md` §1 (the
item canon) and `prompts/2026-09-01-congress-pages.md` (the docs-shell pages
and the verification method) first.

## 0. Rules

1. **Three lanes share this checkout right now** (U: items and lists; D: the
   bill page and `lib/policy/db-queries.ts` + `app/api/policy/[resource]`;
   you). Explicit paths, `git status` before every commit, never `git add
   -A`, pull before every commit. You add **new files only**:
   `lib/policy/forms-queries.ts`, `app/api/policy/forms/route.ts` (its own
   route, not the `[resource]` route), `app/docs/forms/**`,
   `components/policy/forms-*.tsx`. The two shared files you may touch are
   `components/directory-rail.tsx` (a card) and, last, `components/main-nav.tsx`.
2. One change, one deploy, one look (headless screenshot of the production
   deploy at 1714 px). Amplify gates on type errors; a red push stalls the
   queue. No dev server on the Mac.
3. Aurora over the Data API: 1 MB per result; page every list; PDF bytes
   never pass through it — they come from S3.
4. Surfaces render and say what **we** lack: "not yet inspected", "no forms
   harvested for Ohio yet". Never hide a hole.
5. Never rename an existing surface. This is a new one: **Forms**.
6. `HEARTBEAT` every 45 min, `FLAG:` for rulings (keep going), one
   `LANE F STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>` at the end.

## 1. Triage first — forms versus documents (one query, one FLAG)

US DOL's 178 k rows were never inspected and many are not forms (reports,
brochures). Before building, measure: how many rows carry a `form_number`;
how many titles match `form|application|worksheet|request|claim|certif|
notice|affidavit|schedule`; how many have `fillable_fields` with at least
one field; how many have `pages`. Propose the default cut — the lead's
starting position is **default to rows with a form number or a fillable
field, and a visible "All documents" toggle for the rest** — FLAG the numbers
and build to your proposal while the lead rules.

## 2. The API — `/api/policy/forms` (new route, your file)

`?gov=&agency=&q=&fillable=1&page=&limit=` → `{count, rows[], facets{gov,
agency}}`. Search on `form_number` and `title` — add a `pg_trgm` GIN on
`lower(title)` and a btree on `form_number` (measure the build; 392 k rows is
small). Scope follows the site's jurisdiction: `US` → `gov='US'`; `NY` →
`gov in ('NYS','NYC')`; any other state → empty with the honest sentence.
`/api/policy/forms/[id]` → the row plus a **presigned S3 GET** (server-side,
15-minute TTL) for `s3_key`. The Amplify compute role
`govblock-amplify-compute` will need `s3:GetObject` on
`arn:aws:s3:::livingston-bill-pdfs-638175140432/forms/*` — add that one
statement, nothing broader, and record it in the report.

## 3. `/docs/forms` — the list, in the docs shell

The canon item (lane U's shared component if it has landed — check `git
log` for `record-item` — else build to §1 of the canon file and switch when
it lands): agency seal in the avatar slot (lane U is committing seals to
`public/seals/` with a `SOURCES.md`; reuse, extend for the agencies above,
Wikimedia Commons, U.S. and NYS government works); **form number bold**
(the filename stem when there is none) + title muted on row 1; meta line
`text-xs`: `US · HUD · 12 pages · fillable · rev. Mar 2024` (revision from
`wayback_ts` or `fetched_at`, say which); no description row — there is no
description column; 1 px bottom border; hover + ↗; the item links to the
form's page. Search box at the top like `/docs/bills` (number, title,
agency). Rail: an **Agencies** card (counts per agency, click to filter) in
the pattern of the Chambers and Party cards. Page copy, one sentence, honest:
*"Every form the state and federal government hand out for benefits, grants
and programs — 369,735 PDFs from N agencies, searchable by number and
title."* Use the measured numbers.

## 4. `/docs/forms/[id]` — the form's page

Title = the form's title; kicker = number · agency · gov. Facts block:
pages, size, revision, source URL (linked), fetched-live or from-archive
with the date, sha256 (small, monospace). **The PDF inline** below the
facts, full width, from the presigned URL — an `<object>`/`<iframe>` of the
PDF is enough; `~/Code/tariffs/src/components/PanelDoc.tsx` is the family's
side-panel viewer if you want the pattern. "Open original" and "Download"
buttons. **Fields** section when `fillable_fields` has entries: the field
names as a list (name · type if present) with the count in the heading —
this is the schema the Clerk agent will interview against. When the row was
never inspected, the section renders and says so.

## 5. Wiring — after the pages are live

- Records menu: add **Forms** (`components/main-nav.tsx`). Lane U's edit 6
  is making that panel four columns × two rows with eight items; Forms makes
  nine. Land yours after lane U's is on the deploy, keep four columns, and
  FLAG the row count for Brendan.
- Global search (⌘K and `/search`): a Forms section — FLAG it for lane U or
  the lead; do not edit `app/search/page.tsx` yourself (lane U owns it).
- Home: nothing this lane.

## 6. Acceptance — the output, not the assertion

The triage table with the cut. `/docs/forms?state=US` and `?state=NY` at
1714 px. A search for `LDSS-2921`, `HUD-1`, `IT-201` each landing the form.
A form page rendering its PDF from S3 on the deploy, with the fields list.
The per-agency seal coverage and the fallback list. The IAM statement added.
The page's headline count equal to Aurora's for the same scope.

## 7. Reporting — the lead monitors this file

Append below the marker. `HEARTBEAT <UTC> §N <where> <commit> job <n> next …`;
`FLAG:` for rulings; the last line, once:
`LANE F STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>`.

---

## Report — worker appends below this line
### 2026-09-02 — lane F

`HEARTBEAT 14:05Z §1 triage complete — no commit yet, next the API and the indexes`

**Method.** Aurora over the Data API (`aws rds-data execute-statement`,
cluster `aurora-2525`, db `policy`), so every number below is the production
table's own. Nothing is sampled except where it says sampled.

## §1 — the triage. The lead's cut is right in shape and 4× too small.

Fetched rows — the corpus the surface can actually show — are **369,735**
(`status in ('fetched-live','fetched-archive')`), which is the headline number
in the brief. Against that:

| signal | rows | of fetched |
|---|---|---|
| `form_number` present | 11,872 | 3.2% |
| ≥1 entry in `fillable_fields` | 7,467 | 2.0% |
| title matches the form/application/… regex | 38,174 | 10.3% |
| `pages` present | 169,033 | 45.7% |
| `title` present at all | 121,311 | **32.8%** |
| `inspected_at` present | 170,586 | 46.1% |
| `s3_key` present | 369,735 | 100% |

**The lead's proposed cut — form number OR fillable field — is 17,163 rows
(4.6%), and only 5,654 of them under `?state=US`.** Brendan asked to showcase
tens of thousands of PDFs; that cut showcases five thousand. It is not that the
corpus is thin. It is that `form_number` was never populated: the harvest wrote
it on 3.2% of rows.

**What the harvest did leave is the filename.** The stem of `s3_key` carries
the form number on **46,548** rows — four times the column — because a
government form PDF is usually named after itself: `it201_2016.pdf`,
`2921-DD.pdf`, `wh347.pdf`. Adding a form-number-shaped stem
(`^[a-z][a-z0-9]{0,9}[-_ ]?[0-9]{1,6}([-_][0-9a-z]{1,6})?\.pdf$`) to the cut
takes it from 17,163 to 58,853.

**But the stem alone is imprecise, and exactly where the brief suspected.**
Sampled 20 DOL rows admitted by the stem: `TEN_21-21.pdf` (Training and
Employment Notice), `TEGL_26-16.pdf` (advisory), `op_01-81.pdf` (EBSA opinion
letter), `cba_8628.pdf` (a collective bargaining agreement), `cbrp1451.pdf`.
None is a form. DOL numbers its *document* families the way other agencies
number their forms.

**The clean discriminator is whether we ever opened the PDF.** Only two
agencies were never inspected — and they are the two the brief flagged:

| never inspected | rows |
|---|---|
| US DOL | 176,284 |
| US USDA-FNS | 19,246 |
| **total** | **195,530** (52.9% of fetched) |

Every other agency is inspected in full (GSA is the one partial: 13,492 of
17,111). An uninspected row has no title, no page count and no field list — on
the metadata we hold, we cannot tell a form from a decision. So:

### The cut I propose, and am building to

> **`form_number` present · OR ≥1 `fillable_fields` entry · OR (a
> form-number-shaped filename stem AND the row was inspected)`**

| | rows |
|---|---|
| **forms (default view)** | **48,684** |
| under `?state=US` | 9,957 |
| under `?state=NY` (NYS+NYC) | 38,727 |
| DOL rows admitted | **0** |
| of the 48,684, carrying a title | 43,512 (89%) |
| of the 48,684, carrying a page count | 48,580 (99.8%) |

and everything else reachable behind the **All documents** toggle the brief
asks for, which shows all 369,735 and says plainly why the rest are not called
forms.

Per agency, under that cut (this is also the rail's Agencies card):

| gov | agency | fetched | inspected | forms |
|---|---|---|---|---|
| NYS | DTF | 36,563 | 36,563 | 29,393 |
| NYS | OCFS | 5,394 | 5,394 | 2,800 |
| US | HUD | 26,464 | 26,464 | 2,572 |
| NYS | DOH | 13,312 | 13,312 | 2,385 |
| US | SBA | 16,472 | 16,472 | 2,305 |
| NYS | DOL | 11,399 | 11,399 | 2,022 |
| US | IRS | 2,155 | 2,155 | 1,513 |
| US | CMS | 18,517 | 18,517 | 1,310 |
| US | VA | 685 | 685 | 685 |
| NYC | HRA | 3,444 | 3,444 | 518 |
| US | SSA | 529 | 529 | 470 |
| NYS | HCR | 9,489 | 9,489 | 446 |
| NYS | DMV | 1,156 | 1,156 | 403 |
| US | USCIS | 489 | 489 | 346 |
| US | GSA | 17,111 | 13,492 | 313 |
| NYS | OASAS | 2,135 | 2,135 | 308 |
| US | OPM | 335 | 335 | 293 |
| NYS | OTDA | 1,528 | 1,528 | 239 |
| NYC | HPD | 3,852 | 3,852 | 113 |
| US | Grants.gov | 482 | 482 | 90 |
| US | ED | 1,160 | 1,160 | 60 |
| NYC | DHS | 1,153 | 1,153 | 59 |
| NYS | HESC | 302 | 302 | 21 |
| NYS | OMH | 79 | 79 | 20 |
| US | **DOL** | 176,284 | **0** | **0** |
| US | **USDA-FNS** | 19,246 | **0** | **0** |

**FLAG 1 (the cut) — ruling wanted, not blocking; I am building to the above.**
The lead's cut is right in shape and wrong in size, and the fix is the filename,
gated on inspection. If the lead prefers the literal proposal, it is one
predicate to change in `lib/policy/forms-queries.ts`.

**FLAG 2 — over half the corpus cannot be triaged at all.** DOL's 176,284 and
USDA-FNS's 19,246 were fetched and never opened. They will appear only under
"All documents", with the honest line *"not yet inspected — we have the PDF but
have not opened it."* An inspection pass over those 195,530 is a lane, not an
edit; sizing it is not mine to decide, so I am flagging rather than starting it.

**FLAG 3 — `fillable_fields` is partly mojibake, and it is the Clerk's schema.**
The column is a JSON array of field-name strings on 170,586 rows, but on
encrypted or compressed PDFs the extractor wrote the raw bytes: DMV `mv-994`
carries `["ð4¶:C", "*Pku", "Z³§Ì", …]`. The Fields section on the form page will
render only names that are printable and say how many were unreadable, rather
than printing garbage as if it were a schema. This matters beyond the surface:
§4 calls this list the schema the Clerk agent interviews against, and on those
rows it is not one.

**FLAG 4 — `HUD-1` is not in the corpus.** §6 names it as one of three search
acceptances. `IT-201` (12 rows, NYS DTF) and `LDSS-2921` (6 rows, NYS OTDA /
NYC HRA / NYS DOH) are both there and both will be shown. HUD-1 — the
settlement statement — returns nothing under `form_number` or any filename
spelling. I will report the search as it actually answers rather than make it
answer; substituting a HUD form we do hold is the lead's call.

`HEARTBEAT 14:25Z §2–4 /docs/forms live, e56e86e job 166 green, ordering fix 419a36b building — next the form page and the three searches`

## §2–3 — the API, the list, and what the first deploy taught

**Commit `e56e86e`, Amplify job 166, green.** `/docs/forms?state=US` and
`?state=NY` render. Counts are Aurora's, checked against the same predicate:

| scope | page says | Aurora says |
|---|---|---|
| `?state=US` forms | 9,957 | 9,957 |
| `?state=US` all documents | 279,929 | 279,929 |
| `?state=NY` forms | 38,727 | 38,727 |
| `?state=NY` all documents | 89,806 | 89,806 (81,357 NYS + 8,449 NYC) |

`?state=TX` renders the shell and no rows, with the honest sentence. No console
errors on any of the three.

**Indexes, measured, all on `"Forms"` (392,182 rows):** `forms_title_trgm_idx`
(GIN trgm on `lower(title)`) 2 s · `forms_form_number_idx` (btree on
`upper(form_number)`) 1 s · `forms_s3key_trgm_idx` (GIN trgm on `lower(s3_key)`)
4 s · `forms_scope_idx` `(gov, agency)` partial on fetched 1 s ·
`forms_isform_idx` `(gov, agency, id)` **partial on the cut itself** 1 s. That
last one is what makes the surface cheap: `explain analyze` on the list query is
**1.3 ms** (index scan, 1,128 buffers), the agency facets **117 ms**, a search
**9.8 ms**. Without it every page load is a sequential scan with a regex.

### The look that changed the build

Screenshotting the deploy at 1714 px did what it is for. Sorted by agency then
number, **the page about forms opened on the least form-like rows in the cut** —
alphabetical order rewards a filename beginning with a digit:

- `?state=US`: `01-chapter1-ncci-medicaid-policy-manual-2025finalcleanpdf`,
  `03092020-covid-19-faqs-508`, `1332-DE-extension-approval-letter-STCs-final`,
  `2013nqfmeasuresunderconsideration` — CMS policy manuals and rulemaking
  transcripts, every one admitted by a single stray fillable field.
- `?state=NY`: eleven rows reading `brc-1062-a`, `brc-1062-al`, `brc-1062-b`,
  `brc-1062-e` …, no titles, all NYC DHS.

**Fixed in `419a36b`:** the list ranks by evidence — three or more fillable
fields first (one stray field is what a PDF picks up by accident; three is
somebody building something to be filled in), then rows that say what they are,
then rows with a published number, then agency and number so the order stays
legible. It ranks and hides nothing; the counts are untouched. Congress now
opens on the Medicare EDI Registration Form (59 fields), SF-424 (96) and
HUD-4741 On-Site Monitoring Review (466); New York on the bottled-water
certificate of approval, DOH-3667, and the controlled-substance licence
application.

**FLAG 5 — CMS's `form_number` is a docket number, not a form number.** 661 CMS
rows carry one and they are Federal Register dockets: `CMS-0053-P` (proposed
rule), `CMS-0056-F` (final), `CMS-0032-IFC` (interim final), titled "Subject:"
or "Transcript: Administrative Simplification Listening Session". The evidence
ordering sinks them, but they are still inside the count. Excluding
`CMS-\d{4}-(P|F|IFC|N)` is a two-line predicate if the lead wants the count to
mean only forms; I have not done it unasked because it is agency-specific
surgery on a number the agency itself published.

**FLAG 6 — no date on this corpus is a revision date, so none is labelled one.**
§3 asks for `rev. Mar 2024`. `fetched_at` falls on **two days** across all
369,735 rows (the 30 Aug – 1 Sep harvest), so it dates our copy and nothing
about the form. `wayback_ts` is populated on 46,448 of the 48,684 forms and is
the Internet Archive's capture. The meta line therefore reads `archived Mar 2024`
and the form page says "From the Internet Archive, captured Mar 2024" or
"Downloaded from the agency". One word to change to `rev.` if the lead wants it;
I think `rev.` would be claiming a fact the harvest did not bring back.

**Not duplicates, as they first looked.** DOH-4328 drew five identical rows.
They are the Yiddish, Korean, Spanish, Bengali and Urdu editions of one form —
distinct files, distinct digests — for which the extractor recovered only the
number as the title. Row 1 now carries the filename where the title merely
restates the number. Genuinely byte-identical rows are 1,657 of 48,684 (3.4%),
kept: a duplicate in the corpus is a fact about the harvest.

## The IAM statement, added and verified

One statement appended to the inline policy `govblock-data-access` on role
`govblock-amplify-compute`. Nothing else in that policy was touched.

```json
{ "Sid": "FormsRead", "Effect": "Allow", "Action": ["s3:GetObject"],
  "Resource": ["arn:aws:s3:::livingston-bill-pdfs-638175140432/forms/*"] }
```

No `ListBucket`, no bucket ARN, no other prefix. Read back live after the put.

**No new npm dependency, deliberately.** Presigning normally means
`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, which means a
`pnpm-lock.yaml` change in a checkout three lanes are pushing to this morning —
and `package.json` is not one of the two shared files this lane may touch.
SigV4 for a GET is ~40 lines of `node:crypto`, and the credential provider
comes from the `RDSDataClient` the app already uses for Aurora. Verified against
real S3 objects before it shipped: `206`, magic bytes `%PDF-`, on
`forms/NYS/OTDA/2921.pdf` and `forms/NYS/DTF/it201_2018_fill_in_2d.pdf`.

`HEARTBEAT 14:50Z §4–5 done — 83ffa07, 03f2019, 4d2bffe, jobs 171/173 green — next nothing; closing`

## §4 — the form's page, seen rendering

Verified in a **headed** Chromium, because headless has no PDF plugin and paints
the iframe blank — a false negative I nearly reported as a pass. Shot:
`shots/form-pdf-headed.png`.

`/docs/forms/54021` (HUD-4741) draws the kicker with HUD's seal, the title, the
facts table (12 pages · 1.2 MB · downloaded from the agency, the Archive's copy
from Mar 2021 · source hud.gov · 466 fillable · sha256), **the PDF itself inline
from S3** — Chrome's viewer, page thumbnails, 12 pages, zoom — then Open the PDF
/ Save a copy, then Fields: *"466 of 466 fields named in the PDF"* over the real
names (`HUD Reviewer`, `a Agency Name`, `b Agency Address`…).

The signed URL was checked from outside the browser as well: `206`,
`content-type: application/pdf`, magic bytes `%PDF-`, no attachment
disposition, on all three test rows. (A fetch from *inside* the page fails CORS
— the bucket has no CORS policy and needs none, because an `<iframe>` is a
navigation, not a fetch. Worth writing down; it looks like a bug and is not.)

The three states of the Fields section, each seen on the deploy:

| row | renders |
|---|---|
| `54021` HUD-4741, 466 fields | the names, in two columns |
| `70` LDSS-2921, inspected, 0 fields | *"A flat PDF: we opened it and it carries no fillable fields."* |
| `295910` US DOL, never inspected | *"We have this PDF but have never opened it… one of 195,530 files."* |

## §5 — wiring

**Records panel** (`03f2019`): Forms is the ninth entry, `ClipboardList`, after
News Room. **FLAG 7 — nine entries in four columns is three rows** (4 · 4 · 1),
and Brendan asked for two. I kept four columns and flagged it, as §5 said. Both
ways out are his: drop an entry, or add `5: "w-[68rem] md:grid-cols-5"` to the
`GRID` map in `main-nav.tsx` beside the 2/3/4 already there, which restores two
rows at a panel ~1,088 px wide. Shot: `shots/nav-records.png`.

**Rail**: Forms added to the Directory group in `directory-rail.tsx`, under every
scope, like the four federal docs.

**FLAG 8 — global search has no Forms section, and I did not add one.**
`app/search/page.tsx` is lane U's (edit 11 landed as `824b394`). The read is
`/api/policy/forms?state=&q=&limit=8`; rows carry `number`, `title`, `gov`,
`agency`, `fields`, and the item is the canon with `FormSeal` in the avatar slot
— `components/policy/forms-list.tsx` exports `formMeta` and `formLead` so a
Forms section draws identically without copying the logic. For lane U or the lead.

## The searches §6 asked for

| query | scope | count | first row |
|---|---|---|---|
| `LDSS-2921` | NY | **6** | LDSS-2921 · *New York State Certification Form* · NYC HRA |
| `IT-201` | NY | **334** | IT-201 · *Resident Income Tax Return* · NYS DTF (194 fields) |
| `HUD-1` | US | **0** | — |
| `SF-424` | US | 50 | SF-424 · *Application for Federal Assistance* |

**FLAG 4, confirmed rather than assumed.** `HUD-1` is not in the corpus — not in
any of the 392,182 rows, not under `form_number` (`HUD-1`/`HUD1`/`HUD 1`), not
in any filename, and no row anywhere is titled "settlement statement". The
lowest-numbered HUD form we hold is **HUD-307**. The acceptance names a form the
harvest did not bring back; I am reporting the miss rather than making the
search appear to answer it.

## Seals — coverage and the fallback list

**7,388 of 48,684 forms (15.2%) wear their agency's own emblem.**

| agency | emblem | forms |
|---|---|---|
| US HUD · SBA · VA · SSA · GSA · OPM · ED · DOL | their own department seal, already in `public/seals/` | 6,698 |
| NYC HRA · HPD · DHS | **new**: `new-york-city.png`, [Seal of New York City.svg](https://commons.wikimedia.org/wiki/File:Seal_of_New_York_City.svg), public domain | 690 |

**Fallbacks, all of them deliberate:**

- **US IRS, CMS, USCIS, USDA-FNS, Grants.gov (3,259 forms) → the US seal.** Each
  is a *bureau*, and its parent department's seal is sitting in `public/seals/`.
  Putting Treasury's seal on an IRS form would tell the reader something nobody
  checked, so they wear the jurisdiction's, and the row names the agency in words.
- **Every NYS agency — DTF, DOH, DOL, HCR, OCFS, OASAS, OTDA, DMV, HESC, OMH
  (38,037 forms) → the New York State seal.** Commons has no emblem for any of
  them; searched 2026-09-02 and what comes back is scanned annual reports from
  the 1900s. The State seal is what those agencies actually use, so this is a
  fallback that happens to be true, but it is a fallback.

`4d2bffe` fixed a real error on the way: the three **city** agencies were wearing
New York **State**'s seal, because the fallback maps every non-federal gov to NY.

**Trap for the next seal harvest**, recorded in `SOURCES.md`: Commons no longer
serves arbitrary thumbnail widths. The `144px-` URL every other seal in this repo
came from now answers *"Use thumbnail sizes listed on https://w.wiki/GHai"*.
250 px is served; this file was fetched at 250 and resized down.

## FLAG 9 — 1,657 byte-identical rows, left in, and why it is visible

Under `?state=NY` the seventh through eleventh rows are five copies of DOH-4328.
Four are language editions (Yiddish, Korean, Spanish, Bengali, Urdu — distinct
digests, distinct files, correctly shown, and now told apart by the filename in
row 1). The rest of that cluster is genuinely the same bytes fetched from two
URLs. Across the cut: **48,684 rows, 47,027 distinct digests, 1,657 duplicates
(3.4%)**. I left them in and did not dedupe, because collapsing on `sha256`
changes the headline count from 48,684 to 47,027 and that number is on the page
— a product decision, not mine. One `distinct on (sha256)` subquery if the lead
wants it.

## Acceptance, item by item

| §6 asks | result |
|---|---|
| The triage table with the cut | above; cut is 48,684, FLAG 1 |
| `/docs/forms?state=US` and `?state=NY` at 1714 px | `shots/f2-us.png`, `shots/f2-ny.png` |
| `LDSS-2921`, `HUD-1`, `IT-201` each landing the form | 2 of 3 — **HUD-1 is not in the corpus** (FLAG 4) |
| A form page rendering its PDF from S3, with the fields list | `shots/form-pdf-headed.png` |
| Per-agency seal coverage and the fallback list | above — 15.2%, both fallback lists given |
| The IAM statement added | `FormsRead`, read back live |
| Headline count equal to Aurora's for the same scope | US 9,957 = 9,957 · NY 38,727 = 38,727 |
| Rule 4 — say what *we* lack | Ohio: *"No forms harvested for Ohio yet."* Texas likewise. Uninspected rows say so. Unreadable field names are counted, not drawn. |

## Commits

| commit | job | what |
|---|---|---|
| `e56e86e` | 166 | the API, the list, the form page, the rail, five indexes |
| `419a36b` | 169 | evidence ordering, after looking at 166 |
| `83ffa07` | 171 | 3,957 field names recovered from a mis-decoded BOM |
| `03f2019` | 171 | Forms in the Records panel |
| `4d2bffe` | 173 | New York City's seal for the city's agencies |

Open for a ruling: **FLAG 1** (the cut), **2** (195,530 never inspected),
**3** (mojibake fields — partly fixed by `83ffa07`), **4** (HUD-1 absent),
**5** (CMS docket numbers), **6** (`archived` not `rev.`), **7** (three nav rows),
**8** (global search, lane U's file), **9** (byte-identical duplicates).

LANE F STATUS: COMPLETE — /docs/forms and /docs/forms/[id] live and verified on the deploy under US, NY and an unharvested state; API, indexes, presigned S3, IAM, rail and Records menu all landed; 9 flags open for rulings, one of which (HUD-1) is a form the harvest never brought back rather than work left undone.
