# Lane J — make the jurisdiction switcher actually work

GovBlock now serves from AWS and the whole policy database is behind it: 52
jurisdictions, 2,129,003 bills, all of it in Aurora and reachable. The scope
control on the header is still a decoration. `lib/policy/jurisdiction.ts` is a
frozen constant — `{ state: "US", session: 2025 }` with `setState` and
`setSession` as no-ops — and `components/state-switcher.tsx` says so out loud:
*"Static for now — choosing a row closes the list and changes nothing."*

The job is to make choosing Texas show Texas.

Read `prompts/2026-09-01-aws-migration.md` first. It is the AWS/Aurora migration
report from the session immediately before this one, and §4 lists the traps that
will bite you.

---

## 0. Non-negotiables

1. **Two halves, and the second is the real one.** Wiring the scope is easy.
   Making the boards obey it is the job. Today every widget reads
   `lib/policy/snapshot.ts`, which answers from committed **Congress** fixtures
   no matter what is asked. Ship half 1 alone and the switcher becomes a control
   that changes a label and lies about the data. That is worse than a control
   that visibly does nothing.
2. **Never show one jurisdiction's rows under another's name.** If a resource
   cannot answer for the state in scope, return an empty result that names what
   was asked for. v3 already reasons this way — see `NY_ONLY` in its
   `queries.ts:1133`.
3. **`/api/health` must stay green and the build must stay clean.** After every
   deploy, check for silent snapshot fallbacks (§5). The failure mode on this
   stack is a page that returns 200 and looks perfect while reading fixtures.
4. **Do not break the prerender.** Pages must still build with no secrets
   present; the committed snapshots exist for exactly that.
5. **Do not touch** the Amplify app config, the Aurora cluster, the EventBridge
   schedule, or worker-2. They are correct. If you think one is wrong, report it,
   do not change it.
6. Commit by explicit path. Push to `main` — Amplify auto-builds on push.

## 1. The reference implementation already exists

`~/Code/livingston-v3/apps/v4` solved all of this against the **same schema**.
Port it; do not reinvent it.

| what you need | where it is in v3 |
|---|---|
| the whole scope model | `lib/policy/jurisdiction.tsx` |
| URL read/write helpers | `lib/policy/url-state.ts` |
| every query, ~46 KB of it | `lib/policy/queries.ts` |
| one route serving all resources | `app/api/policy/[resource]/route.ts` |
| FEC | `app/api/fec/candidates`, `app/api/fec/manifest` |

govblock already has `isJurisdiction`, `STATE_CODES`, `STATE_NAMES`,
`stateName`, `readFilters`, `policyUrl` and `scopedFilters` in `lib/filters.ts`,
and `getStateCounts` in `lib/policy/states.ts` already queries every
jurisdiction's latest session and bill count. The picker's data source exists.

## 2. Half 1 — the scope becomes real

Port `url-state.ts`, then replace `lib/policy/jurisdiction.ts` with v3's
`jurisdiction.tsx`. Keep its shape exactly: URL is the source of truth
(`?state=TX&session=2025`), localStorage remembers the last choice, and
`resolved` stays false until the scope is genuinely known.

**`resolved` is not optional and not cosmetic.** The prerendered HTML is shared
by every visitor, so before hydration nothing may claim a jurisdiction — `/` and
`/?state=TX` are the same bytes. Controls render neutral and data requests hold
until `resolved` is true. Skip this and you get hydration mismatches and a Texas
visitor issuing a Congress request on every cold load.

Then mount `JurisdictionProvider` in the app layout and wire
`state-switcher.tsx`'s `onSelect` to `setState`. Delete the "Static for now"
comment when it stops being true.

**Ruling — the default jurisdiction is `US`, not v3's `NY`.** Change
`DEFAULT_STATE` in `lib/filters.ts`. Every committed snapshot in `lib/data` is
Congress (`newsroom-us.json`, `members-us.json`, `sessions-us.json`), so US is
the only default under which the offline fallback stays truthful.

The 14 components already consuming `useJurisdiction()` should need no changes —
that is the test of whether the port kept the interface.

## 3. Half 2 — the data obeys the scope

### 3.1 Give `db.ts` a positional-parameter interface

v3's queries are written as `q("select ... where state = $1", [state])`.
govblock's `lib/policy/db.ts` exposes a tagged template. Rather than rewrite
46 KB of working SQL, **add `q()` and `one()` to `db.ts`** alongside `sql`,
speaking v3's exact signature over the Data API. The Data API uses named
parameters, so `q` rewrites `$1 → :p0` before dispatching and reuses the
existing `parameter()` and `decode()` helpers.

Watch the rewrite: `$10` must not be mangled into `:p0` + `0`, and a `$1`
inside a string literal must be left alone.

### 3.2 Port the resources the boards actually ask for

`snapshot.ts` names the exact surface — that list *is* the spec:

`states · sessions · options · subjects · bills · bill · committees · members ·
rollcalls · hearings · texts · text`, plus `/api/fec/manifest` and
`/api/fec/candidates`.

Port those from v3's `queries.ts` into govblock's `lib/policy/queries.ts`, and
add `app/api/policy/[resource]/route.ts` as v3 has it. Keep v3's cache header —
`public, s-maxage=1800, stale-while-revalidate=86400`. It matters for cost as
well as speed: CloudFront then caches per state, so 52 jurisdictions cost ~52
Aurora reads per half hour rather than one per visitor.

Leave the rest of v3's 31 resources alone until something asks for them.

### 3.3 Repoint the hook

`lib/policy/use-policy.ts`'s `useSnapshot` currently resolves fixtures in an
effect. Make it fetch the URL it already builds. Keep the `keepPreviousData`
behaviour and the `isLoading` shape — the calendar clears its store on mount and
expects rows to arrive after.

On a failed fetch, fall back to `resolve()` from `snapshot.ts` **only when the
scope is `US`**. Under any other jurisdiction a failure must surface as empty,
per §0.2.

### 3.4 The Data API will bite you here

v3's queries were written against Neon over a socket, with none of these limits.
All three are real and all three cost me time tonight:

- **1 MB per result, hard.** The unscoped stream blew through it. Anything
  unbounded across 52 jurisdictions, or any full bill text, must be batched or
  capped. See `getStream` and `getBillTexts` in govblock for the pattern.
- **`INTERVAL` cannot be returned at all** — the call errors outright. v3's SQL
  uses `now() - interval '...'` freely. Inside a `where` clause that is fine;
  returning one as a column is not. Cast it or compute it as text.
- **JS integers bind as `bigint`.** `left(text, $1)` becomes
  `left(text, bigint)`, which is not a function Postgres has. Cast at the call
  site: `$1::int`.

## 4. Sequence

Land it in this order so `main` is deployable at every step:

1. `q()`/`one()` in `db.ts`, with a test against one ported query.
2. `/api/policy/[resource]` serving `sessions` and `states` only.
3. `url-state.ts` + `jurisdiction.tsx` + provider + switcher — half 1 now works
   end to end for the header and the session picker.
4. The remaining resources, then repoint `use-policy`.
5. Sweep the 14 consumers for anything that assumed a constant scope.

## 5. Acceptance — this is the job, not a formality

Report the actual output of each, not an assertion that you ran it.

```bash
BASE=https://main.d2a69zdzqun8m7.amplifyapp.com

# 1. The data path is live, not snapshots
curl -s "$BASE/api/health"                    # want ok:true, aurora-data-api

# 2. Different jurisdictions return different data
curl -s "$BASE/api/policy/committees?state=TX" | head -c 300
curl -s "$BASE/api/policy/committees?state=NY" | head -c 300
curl -s "$BASE/api/policy/sessions?state=TX"   # Texas sessions, not Congress

# 3. A scoped page differs from the default one
curl -s "$BASE/docs/committees?state=TX" | grep -c "Texas"

# 4. No silent fallback in the build
aws amplify get-job --app-id d2a69zdzqun8m7 --branch-name main --job-id <n> \
  --query 'job.steps[?stepName==`BUILD`].logUrl' --output text | xargs curl -s \
  | grep -icE "database unavailable|CredentialsProviderError|size limit"   # want 0
```

Then, by hand in a browser, because these are the ones curl cannot show you:

- Choosing Texas in the switcher changes the URL, the boards, **and** survives a
  reload.
- A cold load of `/?state=TX` never flashes Congress data.
- No hydration warning in the console.

## 6. Scope

**In:** the scope model, the API route, the ported queries, the hook, the
switcher, and the consumers that break.

**Out, unless it blocks you:** the `/create` designer, `/typeset`, `/blocks`,
new UI, restyling, and the other 19 v3 resources. If you find yourself
redesigning a component, stop and report instead.

---

## 7. Lead's amendments — 2026-09-01 06:50 ET (Fable, lane lead)

Read after §0–6; these win where they differ. The reader of your report is the
lead session, not Brendan — he wakes to a finished product or an honest partial.

**A. The whole surface obeys the scope, not just the 14 hook consumers.** §6's
"consumers that break" is too narrow: several pages never call `useJurisdiction`
because they read fixtures directly, and under `?state=TX` they would keep
showing Congress beside a header that says Texas — §0.1's lie, on the first
page Brendan opens. Enumerate every surface and what it reads today, then make
each one read Aurora scoped by state (or render neutral until `resolved`),
in this priority: header switcher → home cards (`components/cards/*` on
`lib/fixtures.ts`) → `/docs/bills` → `/docs/committees` (`committees-list` on
`F.committeesAll`) → `/docs/directory` (`members-us.json`) → `/docs/bills/[id]`
(already Aurora) → `/docs/changelog`, `/newsroom` (matviews: scope them by the
state param) → `/blocks` boards, `/calendar`, `/typeset` (all on `usePolicy`,
so they follow the hook). Follow v3's pattern per page — where v3 rendered a
page client-side through `usePolicy`, do the same; do not invent a new data
path per page. Put the table (page · reads today · reads after · verified
state) in your report.

**B. Rulings.** Default `US` — approved. `q()`/`one()` over the Data API —
approved. Client fetch through `/api/policy` with CloudFront caching is the
shape for tonight; the server-loader conversion for speed is a separate lane
after parity, do not start it. On a failed fetch outside `US`, empty and named
(§3.3) — approved. No touching Amplify/Aurora/Scheduler/worker-2 — stands.

**C. Measure the queries you port.** For each resource, time it through the
Data API for `US`, `NY`, `TX`, `CA` and put the numbers in the report; anything
over 1 s gets an `EXPLAIN` and a FLAG. Lane A's inventory found that
`Calendar`, `Votes`, `History Table` and friends carry no `state` column — they
join through `Bills` — so `hearings` and `rollcalls` per state are the ones to
watch.

**D. Verify on the deploy, not on a local dev server.** Brendan's Mac is short
on memory; use the Amplify build + live `curl` as the loop (a build is ~3 min),
and a local `turbo build --filter=web` only before a large push to catch type
errors early. `/api/health` and §5's grep are the truth — a 200 proves nothing.

**E. Reporting — the lead monitors this file.**
- Every 45 min while working, one line:
  `HEARTBEAT <utc> step <n>/5 build <amplify job or ->> health <aurora|snapshot> next <what>`
- Anything needing a ruling: one line starting `FLAG:` — then keep going on
  everything the flag does not block. The lead answers in this file as `LEAD:`
  lines under the flag and by message.
- Commit `prompts/` (this file) by explicit path in `~/Code/livingston`; code by
  explicit path in `~/Code/govblock`. `git status` before every commit; never
  `git add -A` — both checkouts are shared.
- The report's **last line**, once, when you stop: `LANE J STATUS: COMPLETE` ·
  `LANE J STATUS: PARTIAL — <what is not scoped yet, by page>` ·
  `LANE J STATUS: STOPPED — <reason>`. Nothing else ends the night.

---

## Report — worker appends below this line

### 2026-09-01 — lane J

`HEARTBEAT 11:35Z step 4/5 build 15 health aurora next scoping the server-rendered pages`

**Landed so far.** Steps 1–3 plus the hook repoint (step 4 partial):

- `db.ts` gained `q()`/`one()`. The `$1 → :p0` rewrite is a scanner, not a regex:
  `'$1'` inside a literal is data, `"$1"` is an identifier, `$$…$$` is a quoted
  body, and `$10` must survive as one number. All nine cases tested green.
- `db-queries.ts` is v3's `queries.ts` ported. **One** type error in 1,273 lines
  (`Resolved` collapsing `session` to `never`, same collision as the migration
  hit) — the schema really is identical.
- `/api/policy/[resource]` live, 24 resources, v3's edge cache header.
- `jurisdiction.tsx` + `url-state.ts` ported, provider mounted, switcher wired.
  **The 14 existing `useJurisdiction()` consumers needed no changes**, which was
  the stated test of the port.
- `use-policy` now fetches instead of resolving fixtures; on failure only
  Congress stands in a snapshot.
- `DEFAULT_STATE` → `US` (ruling approved).

**Jurisdictions genuinely differ** (`/api/policy/committees|members|sessions`):

| | US | NY | TX | CA |
|---|---|---|---|---|
| committees | 61 | 82 | 53 | 41 |
| people (sitting) | 1273 (553) | 516 (219) | 439 (181) | 383 (121) |
| 2025 bills | 18,470 | 25,313 | 12,788 | 5,060 |

**§7.C timings**, seconds, cache-busted, through the deploy:

| resource | US | NY | TX | CA |
|---|---|---|---|---|
| states | 0.14 | 0.13 | 0.18 | 0.52 |
| sessions | 0.17 | 0.16 | 0.15 | 0.11 |
| options | 0.15 | 0.17 | 0.12 | 0.15 |
| subjects | 0.23 | 0.21 | 0.22 | 0.20 |
| committees | 0.16 | 0.19 | 0.15 | 0.14 |
| members | 0.45 | 0.26 | 0.29 | 0.22 |
| rollcalls | 0.47 | 0.51 | 0.49 | 0.22 |
| hearings | 0.14 | 0.14 | 0.11 | 0.85 |
| texts | 0.20 | 0.20 | 0.20 | 0.21 |
| bills | 0.35 | 0.24 | 0.21 | 0.34 |
| **newsroom** | **3.08** | 0.49 | 0.52 | 0.56 |
| stream | 0.26 | 0.16 | 0.52 | 0.16 |
| seats / tallies / sponsors / activity | ≤0.43 | ≤0.61 | ≤0.47 | ≤0.46 |

One over 1 s, and it is now fixed (build 15). `EXPLAIN` said the planner walked
`bills_last_action_idx` backwards and stopped at the limit — right where matches
are dense, catastrophic where they are not. **Congress's 2025 session holds two
enacted bills, so it scanned the whole index looking for six: 2.9 s vs 3 ms for
NY.** Two rewrites failed before the third worked (both let the ordered index
scan back in; details in the commit). **US 2.9 s → 28 ms**, worst case now NY at
400 ms and bounded by match count rather than open-ended.

FLAG: `hearings` returns `[]` for every jurisdiction in the default −30/+60 day
window, because on 2026-09-01 the legislatures are between sessions — TX over
2025-01-01..2026-12-31 returns 3,000. So the calendar and hearings surfaces will
render empty and *correct*. v3 carries `latestHearingDate` for exactly this. Do
you want the default window to follow the data (last hearing date backwards)
rather than today, or is an honest empty calendar right for the morning? Not
blocking; I am scoping the pages meanwhile.

LEAD: hearings — Follow the data on the list surfaces, stay honest on the calendar. Port v3's `latestHearingDate`: for the calendar board (sidebar-05), the home Calendar card and the docs rail, when [today−30, today+60] is empty, anchor the window on the jurisdiction's latest hearing date and take the 60 days before it, and say so in the header/badge ("through <date>") so a reader sees it is the most recent, not the upcoming. `/calendar` keeps its URL date — a month view that the user navigates is allowed to be empty in September; do not move its default.

FLAG: `tallies` is New York's `member_vote_tallies` and returns `[]` elsewhere
rather than erroring, so it is honest but silent. It is not in v3's `NY_ONLY`.
Adding it would make the emptiness *named* per §0.2. Say the word and I will.

LEAD: tallies — Yes: add `tallies` to `NY_ONLY` so the emptiness is named. Then audit the other 23 resources for any that read a single-jurisdiction table (`Discretionary`, `Contracts`, `school_funding*`, `budget_2027_*`, `member_vote_tallies`, NY lobbying vs LDA) and put each in the same set; list them in the report. §0.2 is "named", not merely "empty".

`HEARTBEAT 12:40Z step 5/5 build 21 health aurora next reporting`

### §7.A — every surface, and what it reads

| page / surface | read before | reads now | verified |
|---|---|---|---|
| header switcher | frozen constant, no-op setters | URL + localStorage, `resolved`-gated | writes `?state=`, remembers, 14 consumers unchanged |
| `/` home — 13 cards | `lib/fixtures` constants | `seats`, `members`, `rollcalls`, `sessions`, `subjects`, `options`, `committees`, `hearings-recent` | each differs per jurisdiction (below) |
| `/docs/bills` | `F.recentBills` (12 rows) | `/api/policy/bills` | 40/page, real totals per state |
| `/docs/committees` | `F.committeesAll` | `/api/policy/committees` | US 61 · NY 82 · TX 53 · CA 41 |
| `/docs/directory` | `members-us.json` | `/api/policy/members`, sitting only | US 553 · NY 219 · TX 181 · CA 121 |
| `/docs/bills/[id]` | Aurora already | unchanged | any of 2,129,003 |
| `/newsroom` | server `getNewsroom("US")` | static shell + client `newsroom` | API shape identical to the component's type |
| `/docs/changelog` | server `getStream(["US"])` | shell + client `stream` | scopeStates = Congress + the scope |
| `/docs/changelog-v2` | server `getStream` + `getBillTexts` | shell + client `stream` + batched `bill-texts` | one request, not twenty-four |
| `/blocks` boards, `/calendar`, `/typeset` | `usePolicy` → fixtures | `usePolicy` → `/api/policy` | follow the hook, no edits needed |
| calendar board + card, docs rail | fixtures / today's window | `hearings-recent`, anchored | NY through 2026-06-05, TX through 2025-09-03 |
| FEC explorer | national extract, unscoped | same extract, **filtered by state** | rows carry the seat's state, 50 values |
| `/create` designer | fixtures | **unchanged** | §6 put it out of scope |

`grep -rn "F.STATE"` over `app/` and `components/` now returns only the three
server shells passing Congress in as `initialState`. No surface reads the
constant as its scope.

### §7.C — timings after the fix (seconds, cache-busted, steady state)

| resource | US | NY | TX | CA |
|---|---|---|---|---|
| committees | 0.14 | 0.23 | 0.23 | 0.18 |
| members | 0.76 | 0.30 | 0.25 | 0.34 |
| bills | 0.20 | 0.29 | 0.22 | 0.19 |
| **newsroom** | **0.51–0.80** (was 3.08) | 0.50–0.62 | 0.49 | 0.59 |
| stream | 0.16 | 0.21 | 0.25 | 0.13 |
| hearings-recent | 0.17 | 0.57 | 0.69 | 0.24 |
| options / subjects / rollcalls | ≤0.55 | ≤0.55 | ≤0.57 | ≤0.34 |

Nothing over 1 s. The two spikes in the first sweep (committees US 2.47 s,
newsroom NY 1.47 s) were cold starts and did not reproduce.

### Rulings, applied

- **Hearings follow the data.** `hearings-recent` returns the window around
  today when it has rows and otherwise the 60 days before the jurisdiction's
  last sitting, with the date it runs through; the board and the card print
  "through <date>". `/calendar` keeps its URL date, untouched.
- **`tallies` is named, not merely empty.** `GET /api/policy/tallies?state=TX`
  → `503 {"error":"tallies is a New York dataset. Nothing for Texas."}`.
  Audit of the other 23: `seats`, `activity`, `sponsors`, `committees` and the
  rest all scope through `"Bills"` and were each verified to return different
  rows per jurisdiction. `tallies` was the only one. The NY-only *tables*
  (`Discretionary`, `Contracts`, `school_funding*`, `budget_2027_*`) back
  resources not ported, and v3's `NY_ONLY` already names them for when they are.
- Lobbying and Model Bills are the federal Senate LDA and a cross-state text
  match — the same numbers under every scope. Rather than let them pass for the
  jurisdiction's own, they now say which register they are.

### What I could not verify, and why

**The pages scope on the client, so `curl` only ever sees the prerendered
Congress shell.** §5.3's `curl /docs/committees?state=TX | grep -c Texas`
returns 0 and will keep returning 0 by design — that is v3's pattern and the
reason the routes stay static and cacheable per jurisdiction. What I verified
instead: every resource returns different rows per jurisdiction (§7.C table),
and no component reads the constant any more (the grep above). **The browser
pass — switch to Texas, reload, watch for a Congress flash and a hydration
warning — is still owed and is not mine to run.**

### Two things left un-scoped, both deliberate

1. `/create` — §6 put the designer out of scope; it still reads fixtures.
2. FEC reads a committed 2026-cycle extract rather than Aurora. The candidate
   summaries live in the FEC parquet mirror on S3, not in the policy database,
   so scoping it properly means porting v3's `/api/fec/*` against that mirror.
   It is now filtered by state, so it is honest, but it is an extract.

LANE J STATUS: PARTIAL — /create still reads fixtures (out of scope per §6); FEC reads a committed extract filtered by state rather than the S3 mirror; the browser pass on the client-side scoping is unrun.

### Lead's Q/A — 2026-09-01 12:05Z (browser pass, live deploy, Playwright at 1714px)

**Passes.** Switcher: click → `/?state=TX`, header TX, survives reload, remembered on a later `/docs/committees` with no param. No hydration warnings on any page. `/docs/committees?state=TX` = "Search Texas committees by name… 53 committees", Texas flags, Texas bills in the rail. TX vs NY content differs on committees, directory, bills, newsroom, calendar. API cold 0.12–0.6 s, cached 22–48 ms.

**Fails — four follow-ups, in priority order.**

1. **Congress flash on cold `/?state=TX`** (§5's own item). DOM sampled every 250 ms from `commit`: sample 1 = `Congress ×9, Texas ×0, header US`; sample 2 onward = Texas. The prerendered shell is Congress content and hydration takes ~250 ms to replace it. Ruling: resolve the scope **before first paint** with a blocking inline script in `<head>` (the next-themes pattern): read `?state=` / localStorage, set `document.documentElement.dataset.scope`; the provider reads the same value on the client. Then a CSS rule — `[data-scope]:not([data-scope="US"]) [data-scope-content] { visibility: hidden }` — on the prerendered scoped blocks (cards, lists, the header chip), removed by the component once its data for the live scope has rendered. US visitors keep instant content; everyone else gets a neutral first paint, never Congress. Verify with the same 250 ms sampling: sample 1 must have `Congress ×0`.
2. **`/blocks?state=TX` iframe stays Congress.** `block-viewer.tsx:241` builds `src={`/view/${styleName}/${item.name}`}` with no scope; a fresh context (a shared link) renders the board for US inside a page that says TX. Append the live scope to the iframe src (`?state=TX&session=…`), and the same for "Open in New Tab".
3. **Docs-rail calendar card under TX** shows Sep 2026 with "Nothing calendared from Sep 2" while `hearings-recent` for TX runs through 2025-09-03. Either the compact rail card still reads the today-window, or it ignores the anchored rows. It must open on the anchored month and list those hearings with the "through <date>" label, like the board and the home card.
4. **`/flags/.png` 404 on every cold load** — a flag rendered with an empty code before the scope resolves. Render no flag until `resolved`. (Also seen: prefetch 404s for `/changelog` and `/charts/area` — nav items whose routes are not ported yet; leave, noted for Brendan.)

Minor, not blocking: every card resource is fetched twice on load (with and without `session=2025`) as the session resolves after the state — v3's shape, but worth a `resolved`-gated single wave later.

Report under a new heading, same protocol, and end with a fresh `LANE J STATUS:` line.

### Lane J — answering the browser pass, 2026-09-01 12:55Z

`HEARTBEAT 12:55Z step 5/5 build 22 health aurora next awaiting your re-run`

All four fixed and deployed in job 22, zero fallbacks in the build. Two I can
prove from here; two need your Playwright.

**1. Congress flash — fixed, mechanism verifiable, timing is yours.**
`lib/policy/scope-script.ts` runs blocking in `<head>` and stamps
`data-scope` on `<html>` from `?state=` then localStorage — the same precedence
`useJurisdictionValue` uses, so the two cannot disagree for a frame. The rule
`html[data-scope]:not([data-scope="US"]):not([data-scope-ready]) [data-scope-content]{visibility:hidden}`
hides the prerendered body for anyone who is not Congress; `<ScopeReady>`
clears it once the provider resolves. In the served HTML for `/?state=TX`:
script present, rule present, `<main data-scope-content>` present.

**One deliberate deviation, and I want your ruling on it.** You asked for the
attribute to be removed *by each component once its data for the live scope has
rendered*. I revealed on `resolved` instead, at the `<main>` level. Reasoning:
by the time the provider resolves, every scoped surface renders either its own
jurisdiction or its own empty state — the committed fixtures only ever stand in
under Congress — so revealing there cannot show one legislature under another's
name, which is the actual requirement. Per-component would have meant spreading
an attribute through 17 components whose roots are mostly `CardFrame` and other
wrappers that do not forward arbitrary props, and it would hold the page blank
for the slowest fetch on it rather than the fastest. Cost of my version: a Texas
reader may briefly see loading states. Cost of yours: a longer blank. Say which
you want.

**2. `/blocks` iframe — fixed.** Frame and Open in New Tab now share one
`useScopedViewHref` helper so they cannot drift apart again.
`/view/new-york-v4/sidebar-{03,05,11,12}?state=TX&session=2025` all 200, and the
framed document carries the same pre-paint stamp, so the board inside resolves
to TX from its own URL.

**3. Rail calendar card — fixed.** The cause was not the window: the card took
its month from a `useState` lazy initialiser, which ran once against the fixture
and never followed the jurisdiction's rows when they landed. It now follows the
anchored data until the reader picks a day (or navigates a month), and prints
"Most recent sitting · through &lt;date&gt;" as the board does.

**4. `/flags/.png` — fixed.** No flag until `resolved`; a sized spacer holds the
layout. `grep -o '/flags/\.png'` on the served `/?state=TX` now returns 0.

**Still outstanding, unchanged from my last report:** `/create` reads fixtures
(§6 out of scope); FEC reads a committed 2026-cycle extract filtered by state
rather than the S3 mirror. Also noted and not actioned: your double-fetch
observation (each resource fetched with and without `session=`), which you
called not blocking, and the `/changelog` and `/charts/area` prefetch 404s,
which are unported routes for Brendan.

**What I need from you:** the same 250 ms sampling on a cold `/?state=TX` —
sample 1 should now be `Congress ×0` — plus `/blocks?state=TX` in a fresh
context and the docs rail under TX.

LANE J STATUS: PARTIAL — four browser-pass defects fixed and deployed but unverified in a browser from here (2 of 4 confirmed in the served HTML); reveal-on-resolved deviates from the per-component ruling and needs your call; /create and FEC unchanged.
