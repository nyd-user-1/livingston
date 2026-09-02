# Lane U — the item canon, and twelve small UI edits

**Brendan, 2026-09-02 07:30–08:31 ET, from screenshots.** He started dictating
"a couple of small UI edits" and ended with a list; the lead wrote it up. Every
edit below is his, in his order, with his screenshots described where the
words alone are ambiguous. Where he said two things, the lead ruled and says
so — Brendan overrules on the deploy.

Work in `~/Code/govblock` (Amplify, https://policy.nysgpt.com). Read
`prompts/2026-09-01-congress-pages.md` first: lane P built the pages you are
editing, its report names the components, and its verification method
(headless screenshot of the production deploy at 1714 px, look at the pixels)
is the one you use.

## 0. Rules

1. **One numbered edit, one commit, one deploy, one look.** Push, wait for the
   Amplify job (≈3 min), screenshot the page, then start the next. Amplify
   gates on type errors and a red push stalls the shared queue — if the build
   goes red, fix it before anything else. Edits 7, 8 and 9 are copy-only and
   may ride as one commit.
2. Shared checkout: explicit paths, `git status` before every commit, never
   `git add -A`. No dev server on the Mac — commit, push, review on the deploy.
3. Never rename a surface, a route or a query param; change labels and
   content only (`?item=article` stays `article`; only its label changes).
4. Surfaces render and say what *we* lack, never what the subject lacks. No
   invented facts, icons, copy or seals: if a seal for an organization is not
   on Wikimedia Commons, fall back to the chamber seal and say so in the report.
5. `HEARTBEAT` every 45 min, `FLAG:` for rulings (keep going on the rest),
   one `LANE U STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>` at the end.
6. **Seam with lane D** (`prompts/2026-09-02-bill-depth.md`, same checkout,
   same bill page): you own the item component, every list, the search
   results and the bill page's **Sponsors** section (edit 12). Lane D adds
   *new* sections to the bill page and owns `lib/policy/db-queries.ts`,
   `app/api/policy` and the pipeline. Pull before every commit; touch
   `app/docs/bills/[id]/page.tsx` only inside the Sponsors block.

## 1. The item canon

The standard for a bill item — and, to the extent the convention fits, every
record item — is the **Record list on the member page**
(https://policy.nysgpt.com/docs/directory/16271?state=US, built in
`apps/web/components/policy/member-page.tsx`, the `ArrowUpRight` hover at
line ~100), with these revisions:

- Row 1: chamber seal in a circle at left (`public/chambers/us-house.png` /
  `us-senate.png`); bold bill number, then the latest action in muted text,
  one line, truncated.
- Row 2, the meta line: `Aug 27, 2026 · In House Committee · Energy And
  Commerce Committee` — **`text-xs`** (it is `text-sm` today), muted.
  Order is date · status · committee. On a list that is not the member's own
  page, append ` · <sponsor>`; on a committee's own page omit the committee.
- Row 3, the description (the bill title): body text, **8 px top margin**
  (`mt-2`). Brendan wrote 8 px once and 12 px once; the lead takes 8 — the
  specific instruction, and on the Tailwind scale. FLAG if it reads tight.
- **1 px bottom border on every item**, as `/docs/bills` has today. That
  border is the *only* thing taken from the `/docs/bills` version.
- Hover: the grey rounded background and the `↗` at top right, exactly as the
  member page does it now. The whole item is the link to the record.
- No "Text" button. The `/docs/bills` version carries one today; the canon
  does not, and the bill page it links to has the text timeline. FLAG so
  Brendan can restore it if he wants it back.

**Do it once.** Lift the member-page item into one shared component (e.g.
`apps/web/components/policy/record-item.tsx`) and make every list below use
it, so the canon is one file. The member page is edit 2 — it gets the
revisions too.

## 2. The edits, in order

1. **Member page stat pills** (`components/policy/member-tabs.tsx` /
   `app/docs/directory/[id]/page.tsx`): emoji in front of the three labels,
   as mocked — `😀 Sponsored 367 · ✅ AYE 249 · ❌ NAY 226`. Emoji, not icons.
2. **Member page Record list**: apply the canon's revisions (text-xs meta,
   mt-2 description, 1 px bottom border) to the list that defines it.
3. **`/docs/bills`** (`app/docs/bills/page.tsx` and the list it renders):
   replace today's item (number + truncated title on row 1, `In House
   Committee · Aug 27, 2026 · Joseph Morelle` on row 2, a Text button at
   right) with the canon: number + latest action; date · status · committee ·
   sponsor; the title as the description; border; hover; ↗.
4. **Committee pages** (`app/docs/committees/[id]/page.tsx`, the Bills table
   at line ~123 with Bill · Latest action · Status columns): replace the table
   with the canon list. Omit the committee from the meta line, keep the
   sponsor.
5. **`/docs/nominations`, `/docs/laws`, `/docs/reports`**
   (`components/policy/federal-lists.tsx`: `NominationsList`, `LawsList`,
   `ReportsList`) — the canon to the extent it fits each family:
   - **Nominations**: the avatar is the **nominating department's seal**.
     List the distinct organizations in `congress_nominations` first, then
     fetch each seal from Wikimedia Commons (U.S. government works, public
     domain; prefer the SVG or the largest PNG), commit them under
     `public/seals/<slug>.<ext>` with a `public/seals/SOURCES.md` naming the
     Commons file URL for each. No seal on Commons → Senate seal fallback,
     listed in the report.
   - **Reports**: CRS reports carry the **CRS logo** — it will not fit a
     circle; use a rectangular avatar variant for it. Brendan meant to paste
     the Commons link and it did not come through; find "Congressional
     Research Service" on Commons and record the URL in `SOURCES.md`.
     Committee reports keep the chamber seal.
   - **Laws**: chamber seal of the originating chamber; public-law number in
     the bold slot, the title as the description.
   - `/docs/record` is not on the list; leave it.
6. **Records dropdown** (`components/main-nav.tsx`): add **Newsroom** to the
   panel (its one-line sentence is the newsroom page's own subtitle — reuse,
   do not write a new one), lay the panel out as **four columns, two rows**
   (eight items), and give every item a lucide icon at the left of its title
   with the description aligned under the title, as in shadcn's feature
   grids. Suggested map, lucide only: Bills `FileText` · Committees `Users` ·
   Directory `BookUser` · Laws `Scale` · Nominations `UserCheck` · Reports
   `BookOpen` · The Record `ScrollText` · Newsroom `Newspaper`. Two rows is
   the requirement; the column count follows from it (Brendan, 08:10 ET).
7. **Home, Notifications card** (`components/cards/notifications.tsx`):
   "Select all" stays; the four rows become
   - ☑ **Bill alerts** — Get amendment, status, and votes updates.
   - ☑ **Committee alerts** — Get agenda, hearing, and vote updates.
   - ☑ **Member alerts** — Get Member-specific updates.
   - ☐ **Vote alerts** — Get itemized vote results.
   Checked states as mocked. Brendan's mock spelled "ammendment"; ship
   "amendment".
8. **Home, Stock Performance card** (`components/cards/stock-performance.tsx`):
   title **Committee Votes**, subtitle **6-month history.**, remove the Ticker
   label, the select and its divider. The chart stays as it is (it is still
   the demo series — say so in the report, do not invent data).
9. **Typeset pill tooltip** (`app/(typeset)/lib/fixtures/index.ts`, the item
   whose label is "Article"): the tooltip reads **Text**. The `article` key
   and the URL do not change.
10. **Typeset Text block — IMPORTANT** (https://policy.nysgpt.com/typeset?item=article).
    Brendan: "remove the text from the text block and format it as Congress
    does here — https://www.congress.gov/bill/119th-congress/house-bill/10150/text/ih?format=txt —
    the only difference being that you can center it." The lead reads this as
    one deliverable with three parts:
    - The block shows the GPO text **verbatim** in a `<pre>`: monospace,
      whitespace and line breaks exactly as the `.txt` has them, no
      re-wrapping, no re-styling, no card typography — what congress.gov's
      `format=txt` renders, including its two bold lines above the text
      (`Shown Here:` / `Introduced in House (08/27/2026)`).
    - The "View Code" strip under it — which today shows the bill text again
      as numbered code lines — goes. Bill text is not code.
    - The one permitted difference: the block is **centered** in the container.
    Screenshot it beside the congress.gov page in the report. If Brendan's
    meaning differs he will say so on the deploy; that is why it is one commit.
11. **Search results** (`app/search/page.tsx`: the Bills, Text, Members,
    Committees, Topics and Pages sections) — every result row becomes the
    canon item, to the extent the convention fits each family. Today a row is
    a flag, an underlined number, an underlined title or snippet, and
    `In House Committee · 2025-09-16` right-aligned. It becomes: the
    jurisdiction **flag** in the avatar slot (results span jurisdictions —
    keep the flag, not the chamber seal); bold number + the title in muted
    text on row 1; the meta line (`Sep 16, 2025 · In House Committee`, dates
    written the canon's way) in `text-xs`; for **Text** results the
    highlighted snippet is the description, highlights kept; no underlines —
    the whole item is the link; hover + ↗; 1 px bottom border. Members carry
    the portrait, committees the chamber seal, topics and pages whatever
    they have today.
12. **Sponsors on the bill page — one listing, not two**
    (`app/docs/bills/[id]/page.tsx` ~108–121, `BillCosponsorDates` in
    `components/policy/bill-congress.tsx`). Brendan asked "were we
    duplicating sponsorship listing?" — yes. On a Congress bill the section
    renders LegiScan's sponsor list (bullets, "…and 64 more co-sponsors")
    and then congress.gov's cosponsor table (Cosponsor · Joined · Withdrawn):
    the same people twice from two sources. Make it one:
    - the **prime sponsor** first, on its own line, linked to the member page;
    - then **one table** — Name (first-name-first from `People`, party–state,
      linked to the member page through `bioguide_id`; where no People row
      matches, congress.gov's own name as-is) · Joined · Original · Withdrawn;
    - **more than 10 rows → a fixed-height box** showing 10, the rows
      scrolling inside it, and a **"Show all N"** control that expands the box
      to full height and collapses it again;
    - the LegiScan bullet list goes on Congress bills. State bills keep the
      LegiScan list (there is no congress.gov table for them) under the same
      10-row box rule.
13. **`/blocks/intelligence` — the inbox alone, filling the screen (Brendan,
    10:50 ET; DO THIS NEXT, before the remaining numbered edits).** Today the
    page is `app/blocks/layout.tsx` (Announcement, "Building Blocks for the
    Web", description, Browse Blocks / View Components, the tab strip and
    "Browse all blocks") wrapping `app/blocks/[...categories]/page.tsx` →
    `BlockDisplay` → `BlockViewer` (the Preview/Code toolbar, description,
    device buttons, `npx shadcn add sidebar-09`, Open in v0) → an iframe of
    `/view/new-york-v4/sidebar-09` at 930 px. Brendan wants, on this route
    only: the site nav, then the inbox frame, nothing else — and the frame
    sized to the viewport. Do it inside one route tree, not a route group
    (the catch-all's `generateStaticParams` already emits `intelligence`):
    - move the hero and the tab strip out of `app/blocks/layout.tsx` into a
      `components/blocks-hero.tsx`, rendered by `app/blocks/page.tsx` and by
      the catch-all page for every tab **except** `intelligence`; the layout
      keeps only its wrapper, and drops `md:py-12` when the child asks for
      full-bleed (a prop or a data attribute — your call, say which);
    - on `intelligence` the catch-all renders the block's iframe directly, no
      `BlockViewer` toolbar, full container width, height
      `calc(100svh - var(--header-height))` so the frame fits the screen and
      the inbox list scrolls inside it; the other six tabs and every category
      page are byte-identical to today (screenshot `/blocks/vote` to prove it).
    Never rename the route; `/blocks/intelligence` stays.

## 3. Acceptance — the output, not the assertion

For each edit: the commit hash, the Amplify job number, and one screenshot of
the deployed page at 1714 px. For edit 3 also a screenshot of the hover state.
For edit 5 the seal manifest and the fallback list. For edit 10 the side by
side with congress.gov. For edit 12 a bill with 80+ cosponsors (S. 1 of the
119th has 84) collapsed and expanded.

## 4. Reporting — the lead monitors this file

Append below the marker. `HEARTBEAT <UTC> edit N/13 <commit> job <n> next …`
every 45 minutes; `FLAG: …` for rulings; the last line, once:
`LANE U STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>`.

---

## Report — worker appends below this line
### 2026-09-02 — lane U

`HEARTBEAT 12:45Z edit 3/10 9d096b3 job 152 next the committee page's Bills table`

**Method.** Playwright from `~/Code/livingston/node_modules`, 1714 px, against
`https://policy.nysgpt.com` after the Amplify job goes green — lane P's method,
unchanged. Shots in
`/private/tmp/claude-501/-Users-brendanstanton-Code-livingston/dc01e9aa-359c-4e5c-b445-acdd94c5a5ab/scratchpad/shots/`.

**The canon lives in `apps/web/components/policy/record-item.tsx`** — `RecordList`,
`RecordItem`, `RecordSeal`. No `"use client"` on it, deliberately: the member and
committee pages are server components and the bills / federal lists are client
components, and both graphs render the same file. What varies list to list is
arguments — `avatar`, the bold `title`, `lead` (row 1's muted tail), `meta[]`
(joined with ` · `, falsy entries dropped) and `description` — never shape.

| # | edit | commit | job | shot |
|---|---|---|---|---|
| 1 | member page stat pills | `272e48c` | 149 | `e01-pills.png` |
| 2 | member Record list = the canon | `6a3e24c` | 151 | `e02-canon-top.png` |
| 3 | `/docs/bills` on the canon | `9d096b3` | 152 | `e03-bills.png`, `e03-bills-hover.png` |

**Edit 2, the 8 px question, answered by looking.** The description's `mt-2`
does not read tight — but only because the column's `gap-1` came off with it.
Left in place, the gap and the margin stack and the row would have sat at 12 px,
which is the number Brendan wrote once and did not mean twice. The two rows now
carry explicit `mt-1` (meta) and `mt-2` (description), so 8 px is 8 px. No FLAG.

**FLAG (edit 3, non-blocking) — the Text button is gone.** The canon does not
carry one, so `/docs/bills` no longer does. The item still links to the bill,
and the bill page has carried the full text timeline since lane P — Introduced
through Enrolled, each version with its date — so the button led to a subset of
where the row already goes. One line to restore if Brendan wants the shortcut.

`HEARTBEAT 14:02Z edit 10/12 95ab2f7 job 164 next search results (11), then the sponsors listing (12)`

Edits 1–10 are committed, deployed and looked at. Two arrived after I started —
11 and 12 — and are next, in order.

| # | edit | commit | job | shot |
|---|---|---|---|---|
| 4 | committee page Bills table → canon | `9e0674b` | 153 | `e04-committee.png` |
| 5 | nominations · reports · laws | `951079e` `1d19b83` | 154, 156 | `e05-nominations-fixed.png` `e05-reports.png` `e05-laws.png` |
| 6 | Records panel, 4 × 2, icons | `29e0c11` | 157 | `e06-records-panel.png` |
| 7–9 | the two home cards, the pill | `c8c0840` | 159 | `e07-notifications.png` `e08-committee-votes.png` `e09-pill-tooltip.png` |
| 10 | the Text block | `95ab2f7` | 164 | `e10-after.png`, vs `e10-congressgov.png` |

**Job 164, not a job of its own.** Amplify builds the branch head when a build
*starts*, not every commit, and lane D's nine bill-page commits were landing
through the same queue — so `95ab2f7` never got its own job number and was built
inside 164 (`47fb94e`). Verified by ancestry (`git merge-base --is-ancestor`)
and then by the pixels, which is the check that counts.

#### Edit 5 — the seal manifest

**81 organizations resolved**, committed under `apps/web/public/seals` at 144 px
(an avatar is 36 CSS px; Veterans Affairs' original is a 2 MB SVG). Every file,
its Commons file page and its licence are in `apps/web/public/seals/SOURCES.md`;
`apps/web/lib/seals.ts` is the map. All public domain, except the NEH seal,
which is CC0 — recorded as CC0, not laundered into "public domain".

**Six fall back to the Senate seal**, which is the chamber the nomination is
before: African Development Bank · European Bank for Reconstruction and
Development · Federal Agricultural Mortgage Corporation · Foreign Service ·
United States International Development Finance Corporation · United States
Postal Service. Plus the 17 rows whose `organization` is `None`.

Two near-misses were rejected on purpose and are named in `SOURCES.md`: the
Postal **Inspection** Service seal, and the Post Office Department seal
(1837–1970), which USPS replaced in 1971. Neither is the Postal Service.

**Worth carrying to other lanes: ranking Commons search hits is not good
enough.** A scored search pass over the same 86 names gave the Army the
**National Guard's** seal, the Department of Transportation **Alabama's**, the
Judiciary **Mississippi's**, the Navy the **Junior ROTC's**, the Postal Service
the **Inspection Service's**, Peace Corps and TVA their **Inspector General's**,
NASA a flag, NSF a flag, and the Foreign Service the **Republic of China's**
foreign ministry, 1931. Every hit was public domain and every hit scored well.
The fix was to name the exact file for each organization by hand and verify it
exists and is PD — 76 of 87 hit on the first candidate.

#### Edit 10 — beside congress.gov

`e10-congressgov.png` is the reference and `e10-after.png` is ours. Same two
bold lines, same verbatim `<pre>`, same monospace, no View Code strip; ours is
centred, which is the one difference Brendan allowed.

**congress.gov cannot be screenshotted headless** — Cloudflare serves
"Performing security verification" to headless Chromium. The reference shot is a
headed run with `--disable-blink-features=AutomationControlled`; noting it so
nobody else spends the twenty minutes.

**One honest difference, and it is in the data, not the rendering.** GPO's own
file has six blank lines between `<DOC>` and `119th CONGRESS`; the row we hold
has one. Confirmed against Aurora (`select replace(left(text,160), chr(10), …)`)
— the collapse is LegiScan's copy, not our `<pre>`. We render what we hold
verbatim rather than padding it back out to match a file we are not serving.

**The date is the document's, not ours.** `BillTexts.fetched_at` is the night we
pulled the file — the same trap lane P hit on `text-versions.date` — so
`getBillText` now also selects `Documents.date`, which is 2026-08-27 for
HB10171 and is what "(08/27/2026)" prints. No document row, no date: the line
prints the version alone.

**FLAG (edit 10) — `bill-text.tsx` is shared, and the change lands on lane D's
page.** `/docs/bills/[id]` §Text and the version timeline in `bill-congress.tsx`
render through it, so both lose the View Code strip and the drawn title page.
That reads right to me — "bill text is not code" is not a claim about one page —
but it moved without lane D touching it, and the lead should rule. Neither call
site passes `version`, so neither grows the "Shown Here:" header.

**FLAG (edit 8) — the chart tooltip still says "Price".** The brief said the
chart stays as it is, and `chartConfig` is part of the chart, so it does. On
hover the Committee Votes card reads "Price 118". It is a label on a demo series
either way, which is why it is Brendan's call and not mine.

**FLAG (edit 6) — the panel entry reads "News Room", not "Newsroom".** The
top-level nav has said "News Room" since it shipped and rule 3 says a surface
does not get renamed; two spellings of one page in one menu is worse than
either spelling. Trivial to flip.

`HEARTBEAT 14:49Z edit 12/12 858354b job 174 next nothing`

### Acceptance — twelve edits, twelve looks

Shots at 1714 px in
`/private/tmp/claude-501/-Users-brendanstanton-Code-livingston/dc01e9aa-359c-4e5c-b445-acdd94c5a5ab/scratchpad/shots/`.

| # | edit | commit(s) | job | shot |
|---|---|---|---|---|
| 1 | member stat pills | `272e48c` | 149 | `e01-pills` |
| 2 | member Record list = the canon | `6a3e24c` | 151 | `e02-canon-top` |
| 3 | `/docs/bills` | `9d096b3` | 152 | `e03-bills`, `e03-bills-hover` |
| 4 | committee Bills table → list | `9e0674b` | 153 | `e04-committee` |
| 5 | nominations · reports · laws | `951079e`, `1d19b83` | 154, 156 | `e05-nominations-fixed`, `e05-reports`, `e05-laws`, `seal-sheet` |
| 6 | Records panel 4 × 2, icons | `29e0c11` | 157 | `e06-records-panel` |
| 7–9 | two home cards, the pill | `c8c0840` | 159 | `e07-notifications`, `e08-committee-votes`, `e09-pill-tooltip` |
| 10 | the Text block | `95ab2f7` | 164 | `e10-after` vs `e10-congressgov` |
| 11 | search results | `824b394` | 167 | `e11-search-bills`, `-text`, `-members`, `-committees` |
| 12 | one sponsors listing | `65d65d1`, `65e2bf9`, `858354b` | 171, 173, 174 | `e12-sponsors-collapsed`, `-expanded`, `-state` |

**Edit 9, for the record:** the "pill tooltip" is the `01 02 03 04 05` strip
under the preview, and hovering `03` now reads **Text**. `?item=article` is
untouched.

**Edit 12, on the numbers.** HB2102 (338 cosponsors): prime sponsor on his own
line, one table, ten rows then a scroll, `Show all 338`. **185 original / 153
not**, and **0 of 338** unresolved names.

#### Three defects the deploy showed and the code did not

Each was found by looking at the pixels or the DOM after the build went green,
which is the whole argument for the method.

1. **`PN730-2` broke across two lines** — the bold slot had no `shrink-0`, and a
   nomination number split in half reads as two nominations (`1d19b83`).
2. **338 cosponsors all read "Yes" under Original**, including one who joined
   five months after introduction. `/api/policy/cosponsors` answers
   `isOriginalCosponsor` as the text `"True"` / `"False"` where the committed
   record has a real boolean — and `"False"` is truthy. Read through a `truth()`
   that takes either shape (`65e2bf9`). **Worth carrying: any lane reading that
   route's booleans has the same bug.**
3. **The ten-row box cut its tenth row in half on a state bill.** It measured
   the eleventh row's top inside a plain `<div>` and then applied that height to
   a scroll container — and a scroll container does not collapse its child's top
   margin while a plain div does, so the list dropped by its own `<ul>` margin
   after the measurement. The wrapper carries `overflow-y-auto` from the first
   render now, so the box measured and the box constrained are the same box
   (`858354b`). The congress.gov table never showed it; a table's margin does
   not collapse either way.

#### Open FLAGs, all non-blocking, none of them mine to rule on

- **Edit 3 — the Text button is gone.** The canon has none. The item still links
  to the bill, and the bill page has carried the full text timeline since lane
  P, so the button led to a subset of where the row already goes.
- **Edit 6 — the panel entry reads "News Room", not "Newsroom".** Rule 3: the
  top-level nav has said "News Room" since it shipped, and two spellings of one
  page in one menu is worse than either.
- **Edit 8 — the Committee Votes chart tooltip still reads "Price".** The brief
  said the chart stays as it is and `chartConfig` is part of the chart. It is a
  label on a demo series either way.
- **Edit 10 — `bill-text.tsx` is shared.** `/docs/bills/[id]` §Text and the
  version timeline in `bill-congress.tsx` also lost the View Code strip and the
  drawn title page. Right, I think — but it landed on lane D's surface without
  lane D touching it.
- **Edit 12 — NY K-resolutions list many "prime sponsors".** Carl Heastie gets
  the prime line and ten more rows below him also say "prime sponsor", because
  LegiScan gives `sponsor_type_id = 1` to every one of them. Faithful, and it
  reads as a contradiction. Pre-existing; a rule that picks one would be
  inventing one.

#### Two asks for other lanes

- **Lane D / `app/api/policy`:** the `search` payload's member rows carry no
  `photo_url` or `bioguide_id`, so search results draw `MemberPortrait`'s
  chamber-seal fallback rather than a face. One column and they look like the
  directory.
- **Anyone reading `/api/policy/cosponsors`:** see defect 2 above.

#### Seam with lane D

`app/docs/bills/[id]/page.tsx` was touched only inside the Sponsors block, plus
the four declarations that block was the sole user of (`SPONSOR_TYPE`,
`MAX_SPONSORS`, `district`, and the two `shownSponsors`/`moreSponsors` lines),
which would otherwise be dead. `lib/policy/db-queries.ts`, `app/api/policy` and
`scripts/` were never opened. `lib/policy/queries.ts` gained two columns —
`Documents.date` (edit 10) and `People.bioguide_id` on the sponsor rows (edit
12); it is not named in rule 6, and it was clean on every pull.

**Note on job numbers:** Amplify builds the branch head when a build *starts*,
not one job per commit, and lane D's bill-page commits were landing through the
same queue all afternoon. Two of my commits therefore have no job of their own
and were built inside a later one — ancestry checked with
`git merge-base --is-ancestor`, then confirmed by the pixels.

LANE U STATUS: COMPLETE
