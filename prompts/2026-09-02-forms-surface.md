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
