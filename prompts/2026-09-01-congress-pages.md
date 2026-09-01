# Lane P — the Congress pages: enrich, add, and wire to the harvest

**Brendan, 2026-09-01 15:30Z, approving all five:** *"make the changes with
placeholder text now while we await full hydration … it will just be a matter
of connecting the design layer to the data layer once the harvest is
complete."* Lane C (`prompts/2026-09-01-congress-api.md`) is harvesting the
Congress.gov API into Aurora and will serve it under `/api/policy/<resource>`.
This lane builds the pages against **real API records committed as fixtures**,
under the same resource names, so the pages render today and connect
themselves when the routes land.

Read first: `prompts/2026-09-01-jurisdiction-switcher.md` §7 + report (how the
site reads: `usePolicy` → `/api/policy/<resource>`, snapshot fallback under
`US` only), `prompts/2026-09-01-congress-api.md` §1 (what the API holds, with
counts) and the `LEAD: 15:40Z` contract at its end.

---

## 0. Non-negotiables

1. **The code exists — find it before writing.** `~/Code/livingston-v3/apps/v4`
   is the reference (a shadcn-ui/ui fork). The member page is there:
   `app/(app)/docs/members/[id]/page.tsx`, `components/policy/member-page.tsx`,
   `member-record.tsx`, `member-tabs.tsx`. The bill page's sections are the
   ones govblock already has (`app/docs/bills/[id]`). Port file-for-file, keep
   every className, swap the data hook. Where nothing exists in v3 (amendments,
   a text-version timeline, nominations, CRS reports, the Record, laws, vote
   positions), compose from the primitives the site already uses — the docs
   page shell, `typeset` sections, `Item` lists, `Card`s, the rail — in the
   same voice. **No new metaphors, no renamed surfaces, no native form
   controls, red charts, Congress default, 1px hover borders, truncation inside
   the pill.** If you find yourself designing, stop and FLAG with a screenshot.
2. **Placeholder means real.** Pull the fixtures from `https://api.congress.gov/v3`
   with the key in `~/Code/livingston/.env.local` (`CONGRESS_API_KEY`;
   `X-Api-Key` header; send a real `User-Agent` or it 403s; never commit the
   key) for a handful of real bills, members and committees — HR 1 (119th) is
   the rich one (6 text versions, 5 summaries, 493 amendments, 38 related
   bills), plus the twelve bills already on file in `lib/data/bills`. Commit
   them under `apps/web/lib/data/congress/<resource>.json` **in the API's own
   JSON shape, field names unchanged**, and register each in
   `lib/policy/snapshot.ts` under the contract names. Anything a fixture does
   not cover renders its honest empty state ("No amendments on file yet"),
   never invented rows.
3. **The contract with lane C** (verbatim from its file): resources
   `text-versions`, `summaries`, `amendments`, `related-bills`, `titles`,
   `committee-reports`, `laws`, `member-detail`, `member-votes`,
   `committee-detail`, `committee-meetings`, `hearings`, `nominations`,
   `crs-reports`, `record-issues`, `house-votes` — each the API's shape. You
   read them through `usePolicy(name, { state }, { bill | member | committee… })`.
   You do **not** build API routes or touch `lib/policy/db-queries.ts`,
   `app/api/policy`, or `scripts/`. Lane C does not touch `app/` pages or
   `components/`.
4. **One page per commit, deployed and reviewed.** Amplify auto-builds `main`
   (~3 min). Brendan reviews each page on the deploy by screenshot; a batch of
   pages in one push is how 2026-08-31 ended in a rollback. Verify each on the
   deploy with a headless render (Playwright lives in
   `~/Code/livingston/node_modules`; 1714 px wide is his viewport), never with
   `curl` alone — a 200 proves nothing. Brendan's Mac is short on memory: run a
   dev server only while actively iterating a page and stop it after; never
   leave one running.
5. Commit by explicit path in `~/Code/govblock`; `git status` before every
   commit; never `git add -A` — the checkout is shared with lane C. If a file
   you need shows as modified by someone else, do not touch it; FLAG.

## 1. The pages, in this order

1. **`/docs/bills/[id]`** — enrich the existing page:
   - **Text** becomes a version timeline: Introduced → Reported → Engrossed →
     Enrolled → Public Law, each with its date and its text (`text-versions`;
     the current single text stays as the first entry).
   - **Summary** shows the CRS summary per stage (`summaries`), newest first.
   - **Amendments** (new section): number, sponsor, purpose, latest action,
     linked to its text (`amendments`).
   - **Related bills** (`related-bills`) and **Titles** (`titles`: official,
     short, popular) as compact lists.
   - **Committee reports** (`committee-reports`) beside History.
   - **Sponsors** gains cosponsor dates and withdrawn flags.
   - **Status** gains policy area and, when enacted, the public-law citation
     (`laws`).
   The page's TOC in the rail lists every section that has rows.
2. **`/docs/directory/[id]`** — the member page, ported from v3's
   `docs/members/[id]` (route name is govblock's; the Record dialog's link
   already points here): official portrait from `member-detail.depiction.imageUrl`
   (this also retires the clerk.house.gov portrait problem), terms and party
   history, sponsored / cosponsored counts and lists, committee assignments,
   contact and website, and a **Votes** section of positions (`member-votes`).
3. **`/docs/committees/[id]`** — one committee: chamber, subcommittees and
   members (`committee-detail`), **upcoming and recent meetings** with
   witnesses and documents (`committee-meetings`) — the same rows the calendar
   card reads — and its reports, prints and transcripts (`committee-reports`,
   `hearings`). The cards on `/docs/committees` link here.
4. **Four new docs pages, in the docs rail's Directory group** (same shell as
   `/docs/bills`; add the rail entries; no new top-level nav):
   `/docs/nominations` (the Senate docket: nominee, organisation, latest
   action, committee), `/docs/reports` (CRS reports: title, date, topic,
   link), `/docs/record` (daily Congressional Record issues with the Daily
   Digest), `/docs/laws` (public laws of the session).
5. **Votes:** the Vote board (`/blocks/vote`) and the member page's Votes
   section read `house-votes` — real tallies with per-member positions where
   the fixture has them.

## 2. Acceptance — per page, in the report

For each page: commit · Amplify job · a 1714 px screenshot path · which
sections are on fixture rows and which are honest-empty · the resource names it
reads · `Congress` count at first paint under `?state=TX` (must be 0 — the
pages are Congress-only content and must say so, not show Congress under a
Texas header; use the same `US_ONLY`-style named empty state lane C uses).

## 3. Reporting — the lead monitors this file

`HEARTBEAT <utc> page <n>/5 commit <sha> job <n> next <what>` every 45 min;
`FLAG:` with a screenshot path for anything that needs a design ruling (keep
going on the rest); one `LANE P STATUS: COMPLETE | PARTIAL — <pages left> |
STOPPED — <why>` at the end. Brendan reviews as each page lands; do not wait
for the whole lane to ask for a look.

---

## Report — worker appends below this line

### 2026-09-01 — lane P

`HEARTBEAT 16:55Z page 1/5 commit 0206e9f job pending next verifying the bill page on the deploy`

**Read first, and what changed under me.** Lane C landed while I was reading:
eleven families were already live on `/api/policy` when I started building, and
`summaries` / `titles` / `related-bills` plus `bill=` scoping landed while page 1
was compiling. So this lane is not building against fixtures with a hope — most
of it reads Aurora today, and the fixtures are the fallback for the families
that still have no table (`cosponsors`, `member-votes`, `crs-reports`,
`record-issues`, `house-votes`).

**FLAG (answered, ruling applied).** `amendments` and `laws` accepted `?bill=`
and ignored it, so a per-bill section could be handed all 7,035 amendments with
a 200 and no way to tell. Lane C has since shipped `b43cece` (scoped, and the
envelope echoes what it was scoped to). The guard stays permanently, per the
lead: `scopedRows` in `lib/policy/congress.ts` takes rows only from an answer
provably about this bill — a bare array (the route could not answer without the
id), an envelope echoing the scope, or the rows that name the bill in their own
record. Anything else is an honest empty section.

**FLAG (housekeeping, resolved).** The machine hit 100% disk at 250 MB free
mid-build — `govblock/.turbo/cache` had grown to 7.9 GB. Cleared it; 8.2 GB
free now. Lane C's builds were on the same edge.

#### Page 1 — `/docs/bills/[id]` · commit `0206e9f`

| | |
|---|---|
| Sections added | Amendments, Related bills, Titles, Committee reports |
| Sections enriched | Text (stage timeline), Summary (CRS per stage), Sponsors (cosponsor dates + withdrawn), Status (policy area, public-law citation) |
| Resources read | `text-versions`, `summaries`, `amendments`, `related-bills`, `titles`, `committee-reports`, `laws`, `cosponsors`, `text` |
| On Aurora today | `text-versions`, `summaries`, `amendments`, `related-bills`, `titles`, `committee-reports`, `laws` |
| On fixture today | `cosponsors` (no table yet — the one name in this page's set the contract has no home for) |
| Contents in the rail | names only the sections the bill has rows for |

Screenshot and the `?state=TX` count follow once the Amplify job lands.

**One contract addition to rule on:** `cosponsors`. "Sponsors gains cosponsor
dates and withdrawn flags" needs `sponsorshipDate` /
`sponsorshipWithdrawnDate` / `isOriginalCosponsor`, which live on
`/bill/{congress}/{type}/{number}/cosponsors` and on none of the sixteen
contract names. It is committed as a fixture under the name `cosponsors` in the
same envelope as its neighbours (`{bill, count, cosponsors[]}`), so it is safe:
lane C serves nothing there today, the fetch 404s, the fixture answers, and the
day a `congress_cosponsors` table exists the page changes not at all.

`HEARTBEAT 18:25Z page 5/5 commit 611d813 job pending next verifying pages 3–5 on the deploy`

#### Pages 2–5 — commits

| page | commit | reads |
|---|---|---|
| 2 · `/docs/directory/[id]` | `c5686af` (+ `7cea8d8`) | `member`, `record` (Aurora), `member-detail`, `member-votes` |
| 3 · `/docs/committees/[id]` | `e4439c3` (+ `2306791`) | `committee` (Aurora), `committee-detail`, `committee-meetings`, `committee-reports`, `hearings-congress` |
| 4 · `/docs/nominations` `/docs/reports` `/docs/record` `/docs/laws` | `992a0df` | `nominations`, `crs-reports`, `record-issues`, `laws` |
| 5 · `/blocks/vote` | `611d813` | `rollcalls` (Aurora) + `house-votes` |

Also landed: `82888bf`, the rule below, which is the one thing in this lane
worth carrying to other lanes.

**The ordering rule, after the lead's ruling.** A per-entity section trusts a
route's answer only when it is provably about that entity. The first cut then
showed *nothing* when it was not — which turned out to be wrong in the other
direction: `committee-reports?bill=2032901` answers `{"bill":2032901,"count":0}`
(scoped, honest, empty, because the bill→report link is not harvested) while
the record committed for that same bill from the same API names both books of
H. Rept. 119-106. `useCongress` now orders the three possible answers: the
route when it answered about this entity, else the committed record *for this
entity*, else an honest empty. What is still never allowed is one bill's rows
under another bill's heading — which is the whole reason the order exists.

**Four asks for lane C**, none blocking, each one visible on the deploy today:

1. `amendments` payload has no `sponsors` — the Sponsor column on H.R. 1 is 493
   em dashes. The `/amendment/{congress}/{type}/{number}` detail carries it; the
   list record you stored does not.
2. `laws` rows carry no `policyArea`, so the status callout can print the
   public-law citation but not the policy area. It is on the bill record the
   family is cut from.
3. `committee-reports?bill=` and `?committee=` answer the whole family or an
   empty scoped set; the bill→report and committee→report links are not in the
   tables yet. Same for `committee-meetings?committee=` and
   `hearings-congress?committee=`, and their payloads are the list stub rather
   than the record — no witnesses, no documents, no committees, which is what a
   committee page shows.
4. `text-versions.date` on a govinfo-sourced row is the night of the backfill,
   not the day the bill moved. Every stage of H.R. 1 read "Aug 28, 2026" until
   the page started refusing to print a date that is its own fetch day.
   congress.gov's `textVersions[].date` has the real one.

**One contract addition, already in use:** `cosponsors`
(`{bill, count, cosponsors[]}`) — nothing else in the sixteen names carries
`sponsorshipDate` / `sponsorshipWithdrawnDate` / `isOriginalCosponsor`, which is
what "Sponsors gains cosponsor dates and withdrawn flags" needs. Safe by
construction: lane C serves nothing there, so the fixture answers, and the day
a table exists the page does not change.
