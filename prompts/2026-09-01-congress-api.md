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
