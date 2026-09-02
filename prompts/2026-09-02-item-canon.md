# Lane U — the item canon, and eleven small UI edits

**Brendan, 2026-09-02 07:30–08:01 ET, from screenshots.** He started dictating
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

## 3. Acceptance — the output, not the assertion

For each edit: the commit hash, the Amplify job number, and one screenshot of
the deployed page at 1714 px. For edit 3 also a screenshot of the hover state.
For edit 5 the seal manifest and the fallback list. For edit 10 the side by
side with congress.gov.

## 4. Reporting — the lead monitors this file

Append below the marker. `HEARTBEAT <UTC> edit N/10 <commit> job <n> next …`
every 45 minutes; `FLAG: …` for rulings; the last line, once:
`LANE U STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>`.

---

## Report — worker appends below this line
