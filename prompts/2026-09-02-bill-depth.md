# Lane D — the bill page at congress.gov depth, and lane C's unfinished items

**Brendan, 2026-09-02 08:31 ET:** *"This is our bill page:
https://policy.nysgpt.com/docs/bills/2157698, and this is theirs:
https://www.congress.gov/bill/119th-congress/house-bill/1 — the difference in
depth of information is staggering, and if I'm not mistaken we have access to
all of it."* He is not mistaken about most of it. This lane measures the gap
section by section, harvests what is missing into Aurora through the pipeline
lane C built, and renders it — and first it closes the three things lane C
left open when its window was cut.

**You inherit lane C.** Read `prompts/2026-09-01-congress-api.md` end to end —
the brief, its two reports, every `LEAD:` ruling, and the 2026-09-02 08:00Z
note at the bottom. Lane C's session is gone; its file has no PAUSED line and
no final report, because the window closed mid-poll. What it actually landed
(the lead verified on Aurora and box 2 this morning):

| Family | State on Aurora |
|---|---|
| §5.2–5.5 house votes (with positions), CRS, the Record, communications | landed, `e598d14` |
| cosponsors (from BILLSTATUS) | 172,684 rows |
| §6.1 real stage dates on text versions | 21,264 dates, `964192b` `22f1a07` |
| §6.2 policyArea on laws | 104 of 104, `d2692b1` |
| §6.3 bill→report and committee→report links; report detail | 901 linked, 921 detailed, `e2d9ee2` |
| §6.4 amendment sponsors (detail pass, tmux on box 2) | 7,035 of 7,035 — finished 16:51Z, a minute after the window closed |

Both checkouts were clean; nothing is half-committed. The nightly `dp-congress`
manifest on box 2 runs `sync.mjs --days 7`, `billstatus.mjs`,
`harvest.mjs --detail-limit 1200`, `house-votes.mjs`, and has run green.

Work in `~/Code/govblock` (the site) and `~/Code/livingston` (the pipeline,
`scripts/pipeline/congress/`). Box 2 is `ubuntu@13.218.239.11`, key
`~/.ssh/livingston-worker-2.pem`, repo at `~/livingston`, runner
`node --env-file=.env.local <step>`; Aurora credentials resolve at run time
from the cluster's MasterUserSecret (they rotate every 7 days — lane C's
report explains). `CONGRESS_API_KEY` is in `.env.local`; 20,000/hour; 403
without a real `User-Agent`; **never commit it.**

## 0. Rules

1. Measure, don't assert: every "congress.gov shows X and we don't" in your
   audit comes from opening the tab and our page for the same bill.
2. Same child-name caution as everything govinfo: **verify the shape, not the
   name** (`items(b.summaries)` was wrong once; `member-detail` held list
   rows for a day). And lane C's closing rule: *a key change without a
   cleanup is a silent doubling.*
3. Aurora is reached over the RDS Data API from the site — 1 MB per result.
   A long bill's actions can exceed it; page or cap every new resource.
4. Shared checkouts: explicit paths, `git status` before every commit, never
   `git add -A`. Amplify gates on type errors; a red push stalls the queue.
5. Page work: one section, one commit, one deploy, one look (headless
   screenshot of the production deploy at 1714 px — lane P's method in
   `prompts/2026-09-01-congress-pages.md`).
6. **Seam with lane U** (`prompts/2026-09-02-item-canon.md`, same checkout,
   same bill page, running now): lane U owns the shared item component, every
   list, search, and the bill page's **Sponsors** section. You own
   `lib/policy/db-queries.ts`, `app/api/policy`, the pipeline, and every
   *new* section on the bill page. Add sections as new components; edit
   `app/docs/bills/[id]/page.tsx` minimally; pull before every commit; do not
   touch the Sponsors block.
7. Surfaces render and say what *we* lack ("actions not harvested yet"),
   never what the subject lacks. No invented data.
8. `HEARTBEAT` every 45 min, `FLAG:` for rulings (keep going), one
   `LANE D STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>` at the end.

## 1. First — lane C's three open items, in this order

1. **The member refresh regresses the address backfill.** `harvest.mjs` line
   ~87 reads `congress_members` from the list endpoint `/member/congress/{c}`
   and stores those rows under the name `member-detail`. The lead backfilled
   all 553 rows from `/v3/member/{bioguideId}` on 2026-09-02 (537 carry
   `addressInformation`). The next nightly run overwrites them with list rows
   and every member page's Contact section goes silently empty again. Fix:
   the member step fetches the detail record per member (553 requests
   against 20,000/h) and stores the detail payload. Prove it: run the step on
   box 2 under the runner's own conditions, then
   `count(*) filter (where payload ? 'addressInformation')` = 537 after.
2. **Yea/nay tallies on `congress_house_votes`**, aggregated from
   `congress_house_vote_positions` (yea, nay, present, not voting), served on
   the `house-votes` envelope, so `/blocks/vote` reads all 647 roll calls from
   Aurora and the six committed fixture cards retire. Lane P asked for this;
   nobody ruled; the lead rules yes.
3. **Close lane C's file.** Append to `prompts/2026-09-01-congress-api.md`
   a round-3 report with the table above, the amendment pass's final line
   from `~/logs/c-amend.log` on box 2, the two fixes above, and one
   `LANE C STATUS: COMPLETE` line — so the record says what happened.

## 2. The gap audit — one table before any build

Open https://www.congress.gov/bill/119th-congress/house-bill/1 and each of its
tabs (Overview, Summary, Text, Actions, Titles, Amendments, Cosponsors,
Committees, Related Bills, Subjects, Notes), and our page for H.R. 1 (find its
govblock id — `/docs/bills/2157698` is HB10171, a different bill). Produce one
table: section · what congress.gov shows (count for H.R. 1) · what we show ·
where the data lives (API endpoint or BILLSTATUS element) · on Aurora today?
· cost to harvest (requests, or "8 zips, no calls").

Our page today (`app/docs/bills/[id]/page.tsx`): Summary, Sponsors, History
(LegiScan's), Votes, Text, plus Amendments, Related bills, Titles, Committee
reports, cosponsor dates and the status callout from lane P. `billstatus.mjs`
parses `policyArea`, `cosponsors`, `laws`, `relatedBills`, `summaries`,
`textVersions`, `titles` — and nothing else from the zips. The lead's
starting cut of what is missing — verify each, correct the list:

- **Actions** — congress.gov's full list with chamber, acted-by (committee or
  floor), action code, source system, links to the Congressional Record page
  and to recorded votes. We show LegiScan's coarser history. Source:
  BILLSTATUS `<actions>` (8 zips per congress, no API calls); also
  `/bill/{c}/{t}/{n}/actions`.
- **Committees** — every committee and subcommittee the bill touched, with
  activities and dates (Referred to, Hearings by, Markup by, Reported by).
  BILLSTATUS `<committees><item><activities>` and `<subcommittees>`.
- **Subjects** — the policy area (held) plus the legislative subjects, up to
  240 per bill. BILLSTATUS `<subjects><legislativeSubjects>`.
- **Tracker** — Introduced → Passed House → Passed Senate → Resolving
  Differences → To President → Became Law. Derived from the actions' codes
  (congress.gov's own stage logic — document the mapping you use).
- **Sponsor with bioguide** — BILLSTATUS `<sponsors>`; today's LegiScan
  sponsor has no bioguide, so the sponsor does not link to the member page.
- **CBO cost estimates** — BILLSTATUS `<cboCostEstimates>` (title, URL, date,
  description). Lane B (`prompts/2026-09-01-cbo-audit.md`) found the metadata
  free and the numbers behind DataDome: link out, print no numbers.
- **Recorded votes on actions** — `<recordedVotes>` carries roll number,
  chamber, date, URL; join to `congress_house_votes` so the Votes section
  shows the Clerk roll call with positions beside the action that took it.
- **Text formats** — we hold the .htm text; congress.gov offers PDF, XML and
  TXT per version. Link govinfo's other formats from `textVersions[].formats`;
  do not fetch them.
- **Notes** and the **constitutional authority statement** (House bills:
  `<constitutionalAuthorityStatementText>`).
- Things congress.gov shows that the API does **not** give: most-viewed,
  "Bill Searches and Lists". Say so in the table; do not fake them.

FLAG the table and keep going — the lead rules on anything contested while
you harvest the uncontested rows.

## 3. Harvest — extend the pipeline lane C built

Extend `billstatus.mjs` (already nightly, already parsing the eight zips) for
every BILLSTATUS-sourced family above; add API detail passes to `harvest.mjs`
only where the zips do not carry the field. New tables, one per family, keyed
so a re-run is idempotent and a stale row is cleaned: `congress_bill_actions`,
`congress_bill_committees` (activity rows), `congress_bill_subjects`,
`congress_cbo_estimates`, sponsor bioguide on the bill (a `congress_bill_sponsors`
table or a column — your call, say why). Serve each under `/api/policy/<name>`
with the scoped envelope the other resources use (`actions`,
`bill-committees`, `subjects`, `cbo-estimates`, `sponsors`); page `actions`.
Prove the nightly under the runner's own conditions: `EXIT=0` in
`~/logs/dp-congress.log` on box 2, and the H.R. 1 counts on Aurora next to
congress.gov's.

## 4. Render — one section per commit, in this order

1. **Tracker** at the top of the page, under the title.
2. **Actions** — on a Congress bill the BILLSTATUS actions are the canon and
   LegiScan's history is not shown twice; state bills keep LegiScan's. Record
   and roll-call links on the rows that have them.
3. **Committees** with activities and dates, each linked to its committee page.
4. **Subjects** — policy area first, then the legislative subjects.
5. **Cost estimate** — CBO title, date, link.
6. **Sponsor → member page** through the bioguide (the line only; the
   cosponsor table is lane U's).
7. **Votes ↔ actions** — the roll call beside the action.
8. **Text formats** — PDF · XML · TXT links per version.
9. **Notes / constitutional authority**, where present.

Every section renders when empty and says what we lack.

## 5. Acceptance — the output, not the assertion

H.R. 1 side by side: each congress.gov tab and our section, screenshots. One
row per family: congress.gov's count · Aurora's count · our page's count.
The nightly's `EXIT=0` line. The member address count after a refresh run.
`/blocks/vote` reading 647 from Aurora, fixtures gone.

## 6. Not in this lane — sized only

Brendan looked at congress.gov's home page ("Current Legislative Activities":
in-session status and next meeting per chamber, today's committee meetings,
Yesterday in Congress, bill texts today, floor calendars, roll calls,
presented to the President, the Daily Digest) and said he is "not even
getting into" what of it belongs on `/newsroom`. Do not build any of it. In
your closing report, one table: each element · which Aurora table already
feeds it · what is missing. That is the brief for the lane that does.

## 7. Reporting — the lead monitors this file

Append below the marker. `HEARTBEAT <UTC> §N <where> <commit> next …`;
`FLAG:` for rulings; the last line, once:
`LANE D STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>`.

---

## Report — worker appends below this line
