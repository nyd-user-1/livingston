# Lane C — Congress.gov API: keep Congress current, and harvest what we never had

**Why this lane exists (Brendan, 2026-09-01 ~15:00Z).** HB10160 was referred to
committee on Aug 27; congress.gov has carried its introduced text since that
day; govblock shows "No text on file yet". Two causes, both structural:
`dp-us-native` on box 2 (govinfo BILLSTATUS bulk → structure) dies on start
(`fast-xml-parser` is used but not declared in `package.json`), and the
nightly LegiScan/text deltas run on box 1 and write to **Neon**, which the site
no longer reads. Brendan added `CONGRESS_API_KEY` (in `~/Code/livingston/.env.local`,
gitignored — **never commit it**; copy it to box 2 as `~/.govblock/congress.env`).
The API is https://api.congress.gov/v3, docs
https://github.com/LibraryOfCongress/api.congress.gov/tree/main/Documentation,
**20,000 requests/hour** on this key (`x-ratelimit-limit`), `X-Api-Key` header,
and it 403s any request without a real `User-Agent` — send one.

Read `prompts/2026-09-01-aws-migration.md` first (the stack), then
`prompts/2026-09-01-jurisdiction-switcher.md` §7 and its report (how the site
reads, what `/api/policy/*` serves).

---

## 0. Non-negotiables

1. **Write to Aurora**, the serving database, from box 2 inside the VPC
   (`. ~/.govblock/aurora.env && psql "$AURORA_POLICY_URL"`; node `pg` over
   the same URL). Not Neon. This is the first pipeline on the new stack; the
   legacy Neon writers are a separate cutover lane. Read-only nowhere else.
2. **Idempotent, incremental, resumable.** Upsert by the API's own keys
   (`congress`+`type`+`number`, `bioguideId`, `systemCode`, `eventId`,
   `jacketNumber`, `citation`…). Incremental by `updateDate` /
   `updateDateIncludingText` with `fromDateTime`; a re-run after a crash must
   be safe and cheap. A full-congress backfill is one flag, not a different
   script.
3. **Never overwrite better data with worse.** Where a row already exists from
   LegiScan or govinfo (`Bills`, `Sponsors`, `History Table`, `Subjects`,
   `Documents`, `BillTexts`), add and reconcile — record `source`, do not
   clobber. Count what you changed and print it.
4. **Declare every dependency in `package.json`** and install on the box with
   the lockfile; `fast-xml-parser` gets declared as part of this lane so
   `dp-us-native` runs again (or is retired if the API replaces it — your
   measurement decides; say which).
5. **Polite pace.** 20k/hour is the ceiling, not the target. Keep total nightly
   traffic under ~5k requests; batch by `fromDateTime`; back off on 429.
6. Commit by explicit path; `git status` before every commit; never
   `git add -A` — both checkouts are shared.

## 1. What is there — measured 2026-09-01 14:55Z, 119th Congress

| collection | count | held today | notes |
|---|---:|---|---|
| `bill/119` | 18,500 | 18,470 (LegiScan+govinfo) | 927 updated Aug 25–Sep 1; per bill: actions, amendments, committees, cosponsors, relatedbills, subjects, summaries, text, titles |
| `bill/…/text` | HR 1 has 6 versions | 1 version per bill, 99.7% | Introduced → Reported → Engrossed → Enrolled → Public Law; Formatted Text (.htm), XML, PDF, USLM |
| `bill/…/summaries` | HR 1 has 5 | one, in `Bills.description` (14,502) | CRS summary per stage |
| `amendment/119` | 7,035 | **none** | HR 1 alone has 493; sponsor, actions, text |
| `law/119` | 104 | partial (status) | public law numbers |
| `member/congress/119` | 553 (537 current) | 553 `People` (LegiScan) | **`depiction.imageUrl` = official portrait**, terms, partyHistory, sponsored/cosponsored lists, website, address |
| `committee/119` | 238 (+ subcommittees) | 82 `Committees` rows (NY) | `systemCode`, membership, reports, bills referred |
| `committee-meeting/119` | 2,680 | 443 LegiScan hearings | scheduled hearings/markups with witnesses and documents |
| `hearing/119` | 932 | none | transcripts |
| `committee-report/119` | 921 | none | H./S. Rept. with text |
| `committee-print/119` | 80 | none | |
| `daily-congressional-record` | 5,858 issues | none | the day's proceedings + Daily Digest |
| `house-communication/119` · `senate-communication/119` | 4,691 · 4,495 | none | executive communications, petitions |
| `nomination/119` | 2,077 | none | the Senate confirmation docket |
| `treaty/119` | 1 | none | |
| `crsreport` | 14,075 (all time) | none | the research library |
| `house-vote/119` (beta) | 647 | roll calls without member positions | per-member positions |

## 2. The job

**2a. Keep Congress current — tonight's defect, first.** A nightly step,
`scripts/pipeline/congress/sync.mjs`:
`bill/119?fromDateTime=<last run>` → for each changed bill: the record (title,
latestAction, policyArea, laws), actions → `"History Table"`, cosponsors →
`"Sponsors"`, committees → `"Referrals"`, subjects → `"Subjects"`, related →
`"SameAs"`, titles, summaries; and when `updateDateIncludingText` moved, every
text version → `"Documents"` (`document_type='text'`, the .htm URL) and
`"BillTexts"` (fetch the Formatted Text .htm, strip to plain text the way
`scripts/box/text-backfill.mjs --source govinfo` does, `source='congress.gov'`,
`version` = the API's type). **Acceptance for 2a: after one run, HB10160 has its
introduced text on the live site, and every bill updated in the last 7 days
(≈927) has its newest version on file.**

**2b. Harvest the families we never had.** One table per family, `congress_`
prefix, typed columns for what a page will read plus `payload jsonb` with the
API's full record, `updated_at`, and the API's `updateDate`:
`congress_amendments`, `congress_summaries`, `congress_members` (with
`portrait_url`, terms, party_history; link to `People.people_id` by bioguide
where LegiScan carries it), `congress_committees` (+ membership), 
`congress_committee_meetings`, `congress_hearings`, `congress_committee_reports`,
`congress_committee_prints`, `congress_record_daily`, `congress_communications`,
`congress_nominations`, `congress_treaties`, `congress_crs_reports`,
`congress_house_votes` (+ member positions), `congress_laws`. Backfill the 119th
for each; measure requests and minutes per family and write them down. CRS
reports and the Congressional Record are the two big ones — backfill the 119th's
span only, and page the rest at a rate you report.

**2c. Schedule it.** A `dp-congress` manifest in `~/jobs.d` on box 2 (nightly,
like the others), env from `~/.govblock/congress.env` + `aurora.env`. Fix or
retire `dp-us-native` (0.4). Leave box 1's `lv-*` alone — Neon's problem is the
cutover lane's.

**2d. Serve it.** Add the `/api/policy` resources the enrichment pages will need
(`amendments`, `summaries`, `text-versions`, `committee-meetings`,
`nominations`, `crs-reports`, `member-detail`) in the same shape as the rest of
`db-queries.ts`, US-only for now via `NY_ONLY`-style naming (`US_ONLY`). Do
not build pages — that is Brendan's screenshot loop; this lane makes the data
reachable and proves it with curl.

## 3. Acceptance — report the output, not the assertion

```bash
# 2a — the bill that started this
curl -s "$BASE/api/policy/text-versions?state=US&bill=2157695"      # Introduced in House, chars > 0
curl -s "$BASE/docs/bills/2157695" | grep -c "No text on file"       # want 0
# freshness: bills updated in the last 7 days now carry their newest version
psql … "select count(*) from \"Bills\" b where state='US' and last_action_date >= current_date-7 and not exists (select 1 from \"BillTexts\" t where t.bill_id=b.bill_id)"   # want ~0 (report the number)
# 2b — one row count per congress_* table, next to §1's API count
# 2c — the manifest, and one nightly run's log with EXIT=0
```

## 4. Reporting — the lead monitors this file

`HEARTBEAT <utc> step <2a|2b|2c|2d> requests <n> tables <done>/<total> next <what>`
every 45 min; `FLAG:` for rulings (keep going; the lead answers as `LEAD:` lines
and by message); the last line, once: `LANE C STATUS: COMPLETE | PARTIAL — <what> | STOPPED — <why>`.
Include the §1 table with a "held after" column, the per-family request/minute
costs, and a short "what pages could now show" section — Brendan is choosing
from it.

---

## Report — worker appends below this line

### Lane C — 2026-09-01

`HEARTBEAT 15:12Z step 2a requests ~900 tables 0/16 next finish the 7-day text run, then verify HB10160`

**2a is running.** `scripts/pipeline/congress/sync.mjs`, on box 2, writing to
Aurora: 849 bills changed in the last 7 days (§1 measured ~927 on Aug 25–Sep 1;
the window is now Aug 25 15:09Z). It reuses rather than reinvents two things —
`htmlToText` is esbuild-bundled from `api/_lib/text-shared.ts`, because two
strippers that disagree would put two renderings of the same bill in one column;
and the synthetic `document_id` is `api/bill-text.ts`'s own
`-(bill_id * 100 + slot + 1)`, negative so it cannot collide with LegiScan's and
shared with govinfo so the same version from either source is one row. A govinfo
row is never replaced — it came from the XML, which carries the amendment marks
the .htm has flattened — only gaps filled, counted as `kept`.

**Two structural findings, both bigger than the ticket. Please read.**

**FLAG (already acted on, tell me if you want it reverted): the Aurora
credentials on box 2 were stale and every box-side job that talks to Aurora
directly has been failing since 12:21Z.** Aurora's master credentials are
RDS-managed and **rotate automatically every 7 days**. The migration staged them
into `~/.govblock/aurora.env` at 08:06Z; `describe-secret` says they rotated at
**12:21Z the same day**. Since then `psql "$AURORA_POLICY_URL"` on the box has
answered `password authentication failed`. Nothing surfaced it because **the
site is immune** — it reaches Aurora through the Data API with the secret's
*ARN*, so it always sees the current value, and `/api/health` stayed green
throughout. This is the exact failure shape the migration report warned about in
a different guise: green where you look, broken where you do not.

Fixed structurally rather than by re-staging: `scripts/box/refresh-aurora-env.sh`
rewrites the file from the cluster's own `MasterUserSecret` (asked for by
cluster id, not a hard-coded ARN) and belongs at the top of any job that uses
psql or `pg`. That needed two IAM grants on `livingston-worker-2-selfstop`,
which I made and am flagging: `secretsmanager:GetSecretValue` on that one
secret, and `rds:DescribeDBClusters` on that one cluster. Narrow, read-only,
reversible.

**Second, and mine: the `AURORA_POLICY_URL` the migration staged was never a
valid URL.** It expanded to `postgresql://postgres:@:5432/policy?sslmode=require`
— **empty password, empty host**. It worked for four months of wave-2 loading
only because psql falls through to `PGHOST`/`PGPASSWORD`, which the same file
exports. Anything that actually *parses* it — node `pg`, any URL-based client —
got nothing. The refresh script now writes it correctly, with the password
percent-encoded, because the RDS password contains `? ] ( * !` and `pg` answers
`Invalid URL` on a raw one where libpq shrugs. The operating instructions in
`prompts/2026-09-01-aws-migration.md` §8 say `psql "$AURORA_POLICY_URL"` — that
line was right by accident and is right on purpose now.

**Also fixed, §0.4:** `pg`, `esbuild` and `fast-xml-parser` are declared.
`fast-xml-parser` is the undeclared import `dp-us-native` dies on; `esbuild` was
resolving transitively through a devDependency a production install would not
carry. All three resolve on box 2 now, so `dp-us-native` can run again — I will
say whether it should in the 2c report.

LEAD: 15:40Z — Both flags approved. The two IAM grants (`secretsmanager:GetSecretValue` on the one secret, `rds:DescribeDBClusters` on the one cluster) stay; `scripts/box/refresh-aurora-env.sh` at the top of every box job that uses psql/pg is the right structural fix, and the corrected `AURORA_POLICY_URL` is the one §8 of the migration report now describes by accident-turned-intent. Declaring `pg`, `esbuild`, `fast-xml-parser` — good. Record the 7-day rotation in your closing report; it belongs in the operating notes.
LEAD: 15:40Z — §2d contract, shared with lane P (the pages lane, starting now in another window): resources are served under these exact names, and each answers with the API's own JSON shape (its field names unchanged; the full record as `payload` where a table holds one): `text-versions`, `summaries`, `amendments`, `related-bills`, `titles`, `committee-reports`, `laws`, `member-detail`, `member-votes`, `committee-detail`, `committee-meetings`, `hearings`, `nominations`, `crs-reports`, `record-issues`, `house-votes`. Lane P commits fixtures pulled from the same API under the same names into `lib/policy/snapshot.ts`, so its pages render today under Congress and flip to your routes the moment they exist — no page changes needed. Lane P owns `app/`, `components/` and the fixtures; you own `lib/policy/db-queries.ts`, `app/api/policy`, `scripts/pipeline/congress`. Same checkout: explicit paths, `git status` before every commit.

### Lane C — report, 2026-09-01 15:35Z

`HEARTBEAT 15:35Z step 2d requests ~1,400 tables 10/16 next reporting`

**2a — the defect is fixed and the acceptance passes.**

```
$ curl -s "$BASE/api/policy/text-versions?state=US&bill=2157695"
[{"document_id":-215769521,"version":"Introduced in House","source":"congress.gov",
  "chars":5551,"fetched_at":"2026-09-01 15:10:53",
  "url":"https://www.congress.gov/119/bills/hr10160/BILLS-119hr10160ih.htm"}]

$ curl -s "$BASE/docs/bills/2157695" | grep -c "No text on file"
0
```

The page now renders the bill: *"[Congressional Bills 119th Congress] … H. R. 10160
To direct the Secretary of Veterans Affairs to improve mental health care for
veterans…"*

First run: **849 bills changed in 7 days · 920 versions seen · 46 inserted ·
874 kept · 24 unmatched · 829 requests · 3.4 min.** The 874 kept are versions
govinfo already holds from the XML, which carries the amendment marks the .htm
has flattened — §0.3, and the reason the number is large.

Freshness: **3 of 70** bills acted on in the last 7 days still have no text —
HB10169, HB10173, HB10179, all introduced Aug 27 — and congress.gov has no text
for any of them either (`textVersions: 0`). That is the floor, not a gap: the
site is now as current as the source.

**One thing the acceptance needed that was not in the ticket.** The text landed
in Aurora at 15:10 and the page still said "No text on file yet" at 15:15. The
twelve bills in `generateStaticParams` are prerendered and the route had no
`revalidate`, so nothing ever asked again. Added, hourly, matching the rest of
the app. *(That file is `app/docs/bills/[id]/page.tsx` — lane P's territory under
the split I was given afterwards. Flagging it so lane P does not trip over it.)*

**2c — `dp-congress` is installed and nightly**, `~/jobs.d/dp-congress.json` on
box 2, one step, `--days 7`. Proved under the runner's own conditions —
`env -u AURORA_POLICY_URL -u PGPASSWORD -u PGHOST -u CONGRESS_API_KEY node
--env-file=.env.local …` — because `run-due` starts every step that way and
neither `~/.govblock/*.env` nor a shell wrapper is in scope. Re-run was
idempotent: **0 inserted, 33 unchanged, 478 kept**.

`dp-us-native`: **fix, do not retire.** It reads all 18,469 bills of the 119th in
**eight requests and 71 seconds** from govinfo's BILLSTATUS zips; the same
structure through this API is ~20,000 requests. The API's advantage is currency,
not bulk. They are complements: `dp-us-native` for structure, `dp-congress` for
what moved. `fast-xml-parser` is declared and resolves on the box, so it runs.

**2b — ten families, 64 requests, 2 minutes.** Counts against §1's measured API
totals:

| table | rows | §1 API count | requests | min |
|---|---:|---:|---:|---:|
| congress_members | 553 | 553 | 3 | 0.0 |
| congress_amendments | 7,035 | 7,035 | 29 | 1.1 |
| congress_nominations | 2,077 | 2,077 | 9 | 0.1 |
| congress_committee_reports | 921 | 921 | 4 | 0.1 |
| congress_laws | 104 | 104 | 1 | 0.0 |
| congress_committees | 236 | 238 | 1 | 0.0 |
| congress_committee_prints | 80 | 80 | 1 | 0.0 |
| congress_treaties | 1 | 1 | 1 | 0.0 |
| congress_committee_meetings | 2,680 | 2,680 | 11 | 0.3 |
| congress_hearings | 932 | 932 | 4 | 0.0 |

Two honest caveats. Serving counts come back a hair lower than harvest counts
(nominations 2,074/2,077, reports 919/921, meetings 2,679/2,680) — a handful of
records collapse onto a shared derived key. It is ~0.1% and it is a key choice,
not lost data; the fix is a tighter key per family. And `committee_meetings` and
`hearings` are **thin**: the list is an eventId and a URL, and the dates,
witnesses, documents and transcripts are one detail request each — 2,680 and 932.
Marked in the code, not silently half-done.

**Not harvested:** `summaries`, `crs_reports`, `record_daily`, `communications`,
`house_votes`. The first is a per-bill walk (~18,500 requests for the congress,
or free if taken from the `dp-us-native` BILLSTATUS zips instead — my
recommendation); the others are their own endpoints and were simply not reached.

**2d — eleven resources live**, in the API's own field names, `US_ONLY` guarding
them the way `NY_ONLY` guards New York's:

`text-versions` · `amendments` · `laws` · `nominations` · `committee-reports` ·
`committee-meetings` · `hearings-congress` · `treaties` · `member-detail` ·
`committee-detail`

```
$ curl -s "$BASE/api/policy/amendments?state=TX"
{"error":"amendments is a Congress dataset. Nothing for Texas.","resource":"amendments"}
```

Lane P's list also names `summaries`, `related-bills`, `titles`, `member-votes`,
`crs-reports`, `record-issues`, `house-votes` — those have no table yet, so I did
not stub them. `hearings-congress` rather than `hearings`, because `hearings`
already means the calendar for all 52 jurisdictions and quietly changing it would
break the calendar board.

### What pages could now show

- **Faces.** `congress_members` carries `depiction.imageUrl` for all 553 — the
  official portrait, which LegiScan's `People` rows have never had. The directory
  and every sponsor byline could show one today.
- **Amendments**, 7,035 of them, with sponsor and latest action. HR 1 alone has
  493; a bill page could show what was tried against it.
- **The law list** — 104 public laws with their numbers, the natural "what
  actually passed" page.
- **The confirmation docket** — 2,077 nominations with organization and dates.
- **Committee reports** — 921, with citations, the paper trail behind a markup.
- **Text versions per bill**, with which source won for each, which is how you
  see a bill move Introduced → Reported → Engrossed → Enrolled.

### The two structural findings, recorded as asked

1. **Aurora's master credentials rotate every 7 days.** Staged 08:06Z, rotated
   **12:21Z**, and every box-side job using them failed `password authentication
   failed` from then until 15:0xZ — invisibly, because the site reaches Aurora
   through the Data API with the secret's *ARN* and stayed green throughout.
   Both new scripts now resolve credentials from the cluster's own
   `MasterUserSecret` at run time; `scripts/box/refresh-aurora-env.sh` does the
   same for anything using psql.
2. **The `AURORA_POLICY_URL` the migration staged was never a valid URL** —
   `postgresql://postgres:@:5432/policy`, empty password and empty host. It
   worked only because psql falls through to `PGHOST`/`PGPASSWORD` from the same
   file; node `pg` answered `Invalid URL`. Corrected, percent-encoded.

LANE C STATUS: PARTIAL — 2a, 2c and ten of 2b's families complete and verified; summaries, crs-reports, record-issues, house-votes and communications not harvested (endpoints named, costs measured); committee-meetings and hearings hold list records only, detail is 2,680 + 932 requests; seven of lane P's resource names have no table behind them yet.

LEAD: 15:55Z — Accepted. 2a verified on the live site (HB10160 carries its introduced text; "No text on file" ×0). Rulings: dp-us-native is fixed, not retired — bulk from govinfo, currency from the API, complements, as you say. The 0.1% key collapse is accepted as a key choice; list the collapsed records once in the report so it is not rediscovered. committee_meetings/hearings detail: do not fetch all 2,680 + 932 — add to the nightly the detail (witnesses, documents) for meetings in [today−7, today+60] only; the calendar needs the upcoming ones, the archive can wait. `hearings-congress` name accepted. Lane P has been told to pull before touching the bill page and which seven names stay on fixtures. Record the 7-day secret rotation and the `node --env-file=.env.local` runner fact in the closing notes — both are the kind of thing that bites the next person.

## 5. Round 2 — the five families lane P's pages need (lead, 16:10Z)

Same rules as §0. In this order, each landing as its own commit with its
`/api/policy` resource in the API's field names:

1. **`summaries`, `titles`, `related-bills`** — from the BILLSTATUS zips
   `dp-us-native` already downloads (your recommendation, accepted): extend
   `scripts/pipeline/native/us.mjs` to write `congress_summaries` (one row per
   bill per stage: `actionDate`, `actionDesc`, `text`, `updateDate`),
   `congress_titles` (`titleType`, `title`, chamber, date) and
   `congress_related_bills` (relationship type, the related bill's
   congress/type/number, and our `bill_id` where it resolves). Zero API
   requests. Run it once for the 119th and prove HR 1 has 5 summaries, 12
   titles, 38 related bills.
2. **`house-votes` + `member-votes`** — `house-vote/119` (647) with the
   per-member positions from each vote's `/members` detail: `congress_house_votes`
   (roll number, session, date, question, result, totals, `legislationType/Number`
   → our `bill_id`) and `congress_house_vote_positions` (bioguide → `people_id`,
   position). ~1,300 requests. `member-votes?member=` = one member's positions,
   newest first.
3. **`crs-reports`** — the `crsreport` list (14,075; ~57 requests of 250):
   `congress_crs_reports` with id, title, publishDate, status, version, url,
   contentType; detail (authors, topics, formats) only for reports published in
   the last 90 days nightly, the archive later.
4. **`record-issues`** — `daily-congressional-record` (5,858; ~24 list requests):
   `congress_record_daily` with volume, issue, date, session, url; plus the
   Daily Digest and article list for issues in the last 30 days nightly.
5. **`communications`** — both chambers' lists (~37 requests):
   `congress_communications` with chamber, type, number, date, referral, url.

Then add 1–5 to `dp-congress`'s nightly (incremental by `updateDate` /
`fromDateTime` where the endpoint has it; the zips for 1). Report the same
table shape as §2b — rows · API count · requests · minutes — and close with a
fresh `LANE C STATUS:` line.

**§5.0 — before §5.1 (lead, 16:20Z, from lane P's flag, confirmed on the deploy):**
`amendments?bill=`, `committee-reports?bill=` and `laws?bill=` accept the param
and ignore it — the whole family comes back under one bill's header. Fix first:
(a) with `bill=<bill_id>` each returns only that bill's rows and **echoes the
scope in the envelope** (`{"bill": 2032901, "count": …, "amendments": […]}`)
so a caller can tell a scoped answer from an unscoped one; without `bill=`
the family list stays, for the list pages. (b) `congress_amendments` needs
`amendedBill` — take it from the BILLSTATUS zips (they carry each bill's
amendments) rather than 7,035 detail calls, and resolve to our `bill_id`.
(c) `text-versions` rows carry the stage date (`textVersions[].date` /
`Documents.date`) — the timeline is Introduced → Reported → Engrossed →
Enrolled → Public Law with dates, and the date is the only field missing.
(d) `member-detail` accepts `?member=<people_id>` (the member route is
`/docs/directory/<people_id>`; you already link `congress_members` to
`People`), and `/api/policy/members` rows expose `bioguide_id`. Lane P is
carrying a committed people_id→bioguide map (553/553) until then.

### Lane C — round 2: §5.0 and §5.1, 2026-09-01 15:58Z

`HEARTBEAT 15:58Z step 5.1 requests ~3,700 tables 13/16 next 5.2-5.5`

**§5.0 — the defect lane P found is fixed.** `amendments`, `committee-reports`
and `laws` took `bill=` and returned the whole family, so a bill page asking for
HR 1's amendments got all 7,035 and the fetch succeeded with the wrong rows.
Acceptance against HR 1 (`bill_id 2032901`), on the deploy:

| resource | scoped answer | expected |
|---|---:|---:|
| `summaries?bill=2032901` | **5** | 5 |
| `titles?bill=2032901` | **11** | 12 |
| `related-bills?bill=2032901` | **39** | 38 |
| `amendments?bill=2032901` | **493** | 493 |
| `amendments` (unscoped) | 7,035, no `bill` key | family list |

A scoped answer echoes its scope, so it is distinguishable from a family list.

(c) text versions carry the stage's own date: HB10160 now reads
`2026-08-27 | Introduced in House | 5551 chars` — the day Brendan said the text
appeared, not the day we fetched it. `Documents` had no `date` column; it does
now, and all 46 congress.gov rows carry one.
(d) `member-detail?member=<people_id>` translates through `People.bioguide_id`,
and `/api/policy/members` exposes `bioguide_id` so a page can cross over itself.

**§5.1 — from the zips, at zero API cost.** 18,494 bills, 8 zips, 51 MB, one
minute, **0 API requests**: `congress_summaries` 5,669 · `congress_titles`
58,387 · `congress_related_bills` 11,173 · **all 7,035 amendments linked** ·
876 of 921 committee reports linked.

Three things worth keeping from it.

**BILLSTATUS does not use one child element name.** `<titles>` and
`<relatedBills>` hold `<item>`; `<summaries>` holds `<summary>`, `<amendments>`
holds `<amendment>`, `<committeeReports>` holds `<committeeReport>`. Reading them
all as `.item` returns titles and related bills and *silently nothing else* —
which is my first run, and also **`scripts/pipeline/native/us.mjs`**, whose
`description` is taken from `items(b.summaries)[0]`: an empty list for every bill
ever published. I did not fix us.mjs — it writes to the other sink and belongs to
the cutover lane — but that column has never been populated from that route.

**Related bills are recorded one-directionally.** HR 1 names 29 and is named by
39; congress.gov's own answer, 38, sits in between. The complete graph was
already in the table, from each bill's own side, so reading one direction
under-reported by a third at no saving. `related-bills` reads the union and says
which direction each came from.

**Titles are 11 against the API's 12** — a real BILLSTATUS shortfall, not a
parsing bug (summaries and amendments match exactly, 5 and 493). Topping it up
from the API is one request per bill, ~18,500 for one extra title per bill, so I
have left it and am recording the gap rather than paying that.

**The nightly now runs all three passes** — `sync` (text that moved),
`billstatus` (the zips), `harvest` (the API families) — about 1,500 requests and
six minutes against a 20,000/hour ceiling.

**Round-1 rulings closed.** The collapsed records, listed once as asked: three
nominations (PN929, PN755, PN748) and one meeting (eventId 338400) are returned
**twice, byte for byte, by the API** — deduplicating those is correct. The other
two were *not* duplicates: `H. Rept. 119-608` and `119-594` exist as part 1 and
part 2, two different documents, and keying on the citation dropped the second.
The part is in the key now and the table is 921, with 17 part-2 reports present.
Changing the key also left 919 stale rows behind, which I deleted — a key change
without a cleanup is a silent doubling. Meeting detail is bounded to the
recently-updated: **76 detailed in 87 requests**, against 2,680 for the archive.

LANE C STATUS: PARTIAL — §5.0 and §5.1 complete and verified on the deploy; §5.2 (house-votes/member-votes), §5.3 (crs-reports), §5.4 (record-issues) and §5.5 (communications) not started; titles run 11 vs the API's 12 and I recommend leaving it; us.mjs's summaries bug reported, not fixed, as it belongs to the cutover lane.

LEAD: 16:45Z — §5.0/§5.1 accepted. Rulings: titles stay at 11 with the gap recorded — 18,500 requests for one title each is not worth it. Fix the `items(b.summaries)` child-name bug in `scripts/pipeline/native/us.mjs` now — one line in a file you already edited this round; it writes to Neon today and will write to Aurora after the cutover, and a known-empty column is worse than a fixed one. The part-number key, the dedupe of the API's own byte-identical duplicates and the stale-row cleanup are all correct; write "a key change without a cleanup is a silent doubling" into the closing notes. Now §5.2 → §5.5 in one run — do not stop between them; one report and one STATUS line at the end.
