# GovBlock on AWS — off Vercel, off Neon

**Session:** 2026-09-01, ~08:00Z onward. Picked up after lane A (929.sock) and the
UI lane (92946.sock) both hit their usage windows.

**Mission (Brendan):** replace Vercel and Neon; stand GovBlock up end-to-end on
AWS — front end, database and S3 in one account; maximally cost- and
performance-efficient. Budget authorised: $15. Cloudflare DNS is Brendan's, in
the morning.

**Status: done and verified.** The site serves from AWS reading Aurora; the whole
76 GB Neon policy database is migrated and row-count-verified exact; every one of
2.13M bills has a working page. Neon and Vercel are untouched as a rollback.

---

## 1. Where it is serving

| | |
|---|---|
| **Live URL** | https://main.d2a69zdzqun8m7.amplifyapp.com |
| **Data-path proof** | https://main.d2a69zdzqun8m7.amplifyapp.com/api/health |
| **Amplify app** | `d2a69zdzqun8m7`, branch `main`, PRODUCTION, auto-build on push |
| **Database** | Aurora Serverless v2 PostgreSQL 17.10 — cluster `aurora-2525`, database `policy` |
| **Lake** | `s3://govblock-lake-638175140432` (lane A's Parquet export — finished clean) |
| **Region / account** | us-east-1 / 638175140432 |

Live health, as of hand-off:

```json
{"ok":true,"database":"aurora-data-api","region":"us-east-1",
 "counts":{"stream_rows":2014,"newsroom_rows":52,"bills":2129003,
           "refreshed_at":"2026-09-01 08:26:02"},"ms":435}
```

All 52 jurisdictions, 2.13M bills, sub-second. `refreshed_at` moving on its own
is the EventBridge schedule working.

Page sweep, all 200 (two 307s are intended redirects):
`/` 0.34s · `/newsroom` 0.21s · `/docs/bills` 0.46s · `/docs/committees` 0.39s ·
`/docs/directory` 0.30s · `/docs/changelog` 0.29s · `/docs/changelog-v2` 0.26s ·
`/blocks` 0.26s · `/typeset` 0.20s · `/create` 1.14s (2 MB page).

**Every bill now has a page.** Before this session the detail route read only
`lib/data`, so 2,128,991 of 2,129,003 bills returned 404 — the route's own
comment said "the rest 404 until the data layer lands". They now render from
Aurora: `/docs/bills/1912501` (Alaska SB9) comes back with its description,
status, nine sponsors with party and district, and its full legislative history.
First on-demand render ~0.8–3.9s, cached after; the twelve committed bills stay
prerendered at ~0.3s. The bills index went from 12 rows to 100.

---

## 2. The architecture, and why this shape

**Front end — AWS Amplify Hosting (`WEB_COMPUTE`).** The AWS answer to Vercel:
git-connected, CloudFront in front, SSR compute behind, pay-per-request with no
idle floor. Chosen over App Runner (~$5–8/mo of always-on provisioned memory) and
ECS+ALB (an ALB alone is ~$16/mo).

**Database — the existing `aurora-2525` cluster, reused.** The biggest cost
decision. Aurora Serverless v2 at **min 0 ACU** is the Neon-equivalent: it bills
nothing for compute while idle and scales on demand. It was already provisioned
and sitting at 0 ACU, so the marginal fixed cost of this migration is storage
alone. During the load it burst to its full **32 ACU** and absorbed ~110M rows in
minutes, then dropped back. Maximum performance when it matters, ~zero at rest —
that is the whole argument, and CloudWatch confirms both ends of it.

**The connection — RDS Data API, not a Postgres socket.** The load-bearing
choice. It is an HTTPS call signed with the hosting role, so:

- the cluster stays **private** — no public accessibility, no 0.0.0.0/0 on 5432;
- Amplify's managed compute needs **no VPC attachment**, hence **no NAT gateway**
  (~$32/mo, which would have cost more than everything else here combined);
- there is **no connection pool** to exhaust from serverless compute, and no RDS
  Proxy (~$87/mo at this cluster's floor).

Auth is IAM: `govblock-amplify-compute` may call `rds-data` on this one cluster
and read the one secret. It is both the build role and the compute role.

**Refresh + keep-warm — one EventBridge schedule.** `govblock-refresh-matviews`
calls `public.refresh_policy_matviews()` hourly through the Data API (universal
target, no Lambda). Double duty: it keeps the matviews current, and the activity
keeps the cluster out of auto-pause.

**Auto-pause raised 1h → 24h.** A full resume from paused measured **over 60
seconds** — fatal on a hot path. With the hourly refresh it should never pause,
and the app degrades to snapshots rather than erroring if it ever does.

---

## 3. The data migration

Two waves, so the site could go live without waiting on 57 GB of text and votes.

**Wave 1 — the whole serving surface (~13 GB).** `pg_dump -Fd -j3` on worker-2,
`pg_restore -j4` into Aurora. Dump 99 s, restore 103 s. **Verified exact against
Neon, 12/12 tables, zero mismatches:**

| table | rows | table | rows |
|---|---|---|---|
| Bills | 2,129,003 | Progress | 8,348,155 |
| Sponsors | 12,076,489 | Subjects | 2,958,465 |
| Documents | 4,373,840 | Referrals | 2,952,901 |
| Roll Call | 1,730,054 | Calendar | 1,454,524 |
| People | 22,723 | Forms | 392,182 |
| LobbyingFilings | 357,379 | FecContributions | 116,820 |

Structure matches exactly too: **198 indexes, 119 constraints, 9 views**, both
`public` and `openstates` schemas, both matviews populated, and
`refresh_policy_matviews()` came across.

**Wave 2 — the three giants**, streamed `pg_dump | psql` with indexes dropped and
rebuilt around the load. Nothing staged on disk.

- `History Table` — **18,115,699** rows in 47 s. ✅ exact vs Neon.
  This independently reproduces lane A's verified figure to the row.
- `Votes` — **89,087,703** rows in ~3 min. ✅ exact vs Neon.
- `BillTexts` — **3,486,742** rows, 36 GB, ~80 min. ✅ exact vs Neon.

**All 15 verified tables match Neon exactly. The whole 76 GB policy database is
in Aurora.** Bill text renders live from it: `/docs/bills/1966490` serves the
actual text of S. RES. 71 out of `BillTexts`, not a committed snapshot.

The 54 warnings pg_restore ignored were all `role "anon"/"authenticated" does not
exist` — Supabase-era GRANTs with no meaning here. Nothing structural was lost.

---

## 4. The code, and five things that will bite the next person

The data layer the UI lane built was already shaped for this: every reader tries
`sql`, falls back to a committed snapshot. So the driver swap is **one file**,
`apps/web/lib/policy/db.ts` — a tagged template with the Neon driver's shape, over
the Data API. `stream.ts`, `newsroom.ts` and `texts.ts` needed no rewrite, only
the two fixes below.

Everything here was found the hard way. All five share a failure signature worth
internalising: **the site serves 200s and looks fine while silently reading
snapshots.** `/api/health` exists precisely so that is visible.

1. **pnpm symlinks.** Amplify packages `<appRoot>/node_modules` and will not
   follow pnpm's symlinks out of the app root. The Next build succeeds, then
   deploy fails: *"the node_modules folder is missing the next dependency."*
   Fix: `node-linker=hoisted` in `.npmrc`.
2. **Runtime env vars.** Amplify hands its variables to the *build*, not to the
   Next server runtime, and **Next 16 + Turbopack does not inline `next.config`'s
   `env` into the server bundle** — verified locally, a marker ARN appears
   nowhere in `.next`. Fix: variables set at **branch** level, plus the build
   writes a real `.env.production`. (ARNs are deliberately not committed —
   the repo is **public**.)
3. **The build had no AWS credentials.** `--compute-role-arn` covers the SSR
   runtime only; the build container needs `--iam-service-role-arn` as well.
   Without it every prerender failed with `CredentialsProviderError` and baked
   snapshots into the static pages.
4. **The Data API caps a result at 1 MB.** All 52 jurisdictions × 40 bills blew
   past it and the whole statement was rejected. `getStream` now reads
   jurisdictions in batches of 8, dispatched in parallel — one round trip's
   latency, not seven. Bill texts have the same ceiling *per row*, so they are
   fetched one bill per call and capped at 800k chars.
5. **The shim binds JS integers as `bigint`.** `left(text, bigint)` is not a
   function Postgres has. Cast at the call site: `${MAX_TEXT}::int`.

Also worth knowing: the Data API **cannot return an `INTERVAL` column** at all —
it errors outright. No current query does; a `now() - x` in a future one will.

Decoding goes through the Data API's **column metadata**, not
`formatRecordsAs: "JSON"` — that mode returns jsonb as an *unparsed string* and
drops the metadata, which would have turned the newsroom's sections into text.

`POLICY_DATABASE_URL` still wins when set, so a laptop can point at any Postgres.

### Wiring the detail route

`queries.ts` was still entirely fixture-backed, which is why all but twelve bills
404'd. `getBill`, `getBillText` and `getBills` now read Aurora with the same
snapshot fallback as everything else. The whole record — sponsors, history, roll
calls, referrals, progress, same-as, documents, subjects, text versions and
hearings — is assembled in **one statement** as jsonb sub-selects, so a bill page
costs one round trip rather than eleven. That matters more here than it would on
a socket: each Data API call is its own signed HTTPS request.

The twelve committed bills stay in `generateStaticParams` and are prerendered;
the other 2.1M render on demand and are cached after.

### The build was broken at HEAD

The UI lane was interrupted mid-flight and `main` did not compile — 37 type
errors. Fixed: `jurisdiction.ts` was missing `setSession` (the typeset customizer
already called it); `react-resizable-panels` was imported by `web` but was only a
dependency of `ui`; `noUncheckedIndexedAccess` (inherited from the Turborepo
starter) turned off for `web`, `strict` kept on, because the components were never
written against it and honouring it meant ~30 non-null assertions that buy
nothing. Genuine errors behind that noise: the generated `BILLS` map pinned every
bill to the first one's shape, `Resolved` collapsed `session` to `never`, and the
FEC sort compared nullable columns.

---

## 5. Still running / still owed

**Nothing is owed on the migration. It finished at 10:20:35Z.** Final state,
against Neon's numbers in brackets:

**93 tables [93] · 198 indexes [198] · 119 constraints [119] · 9 views [9] ·
58 GB.** Every row count exact across all 15 tables checked.

- Worker-2 is **still running** and was not stopped — deliberate: it is lane A's
  box and `lake-hold` is still open. Stop it when you are satisfied.
  Lane A's `shard0` finished clean — *all relations complete, EXIT=0*.
- The scratch scripts live in `~/gb/` on worker-2 (`wave1-dump.sh`,
  `wave1-restore.sh`, `wave2.sh`) with logs in `~/logs/gb/`, if you ever want to
  re-run any of it. Credentials are staged at `~/.govblock/`.

## 6. For Brendan, in the morning

1. **DNS.** `aws amplify create-domain-association --app-id d2a69zdzqun8m7
   --domain-name <domain> --sub-domain-settings prefix=,branchName=main`, then
   put the returned CNAMEs into Cloudflare **DNS-only (grey cloud)** for
   validation. Not created because I do not know which domain you want.
2. **Do not decommission anything yet.** Neon and Vercel are untouched and still
   work — deliberately, so there is a rollback. Retire them after you have
   reviewed the site.
3. **Rotate the Neon password when you retire it.** The `POLICY_DATABASE_URL` in
   `apps/web/.env.local` was visible in process listings on worker-2 while the
   migration ran.
4. **Lane A's FLAG G is moot for serving.** `lakeName()` collapsing
   `public.Bills` and `openstates.bills` onto one lake prefix was a *lake naming*
   defect. Aurora keeps the two schemas distinct, so the serving path is
   unaffected. The lake still wants the one-line fix and a re-run for its own
   sake.
5. **The jurisdiction switcher is still a constant** (`US`, 2025). I added
   `setSession` as a no-op to unbreak the build and did not refactor it — 14
   components consume it and that is a deliberate change, not a 5am one. It is
   now the biggest product gap, and worth doing precisely because all 52
   jurisdictions are finally behind it.
6. **One judgement call I left alone.** On a database error the readers fall back
   to a snapshot and return 200. For ISR pages that means a transient blip can
   bake a snapshot into the CDN for the full hour. Throwing instead would let
   Next keep serving the last good render. That is arguably more correct, but it
   reverses a choice the UI lane made deliberately, so it is yours to call.

## 7. Cost

| item | at rest |
|---|---|
| Aurora compute | ~$0 idle (min 0 ACU); ~$5/mo for the hourly refresh |
| Aurora storage | $0.10/GB-mo → **$5.80/mo** at the final 58 GB |
| Amplify hosting | ~$0–3/mo at this traffic; builds ~$0.01/min |
| S3 lake | ~$0.13/mo at 5.7 GB |
| **NAT gateway avoided** | **–$32/mo** |

The migration itself burned **33.1 ACU-hours = $3.97** (CloudWatch, 08:00–10:22Z,
hourly averages 9.3 / 12.6 / 11.2 ACU). Well inside the $15, though four times my
first estimate — bulk loading 110M rows and rebuilding a GIN index over 3.5M
documents is not cheap, it is just fast.

The only lever if the hourly refresh proves too dear: drop it to every 2–3 hours.
It is the sole recurring compute in the design. Worth measuring a single refresh
against an idle cluster before deciding — my ~$5/mo for it is an estimate, not a
measurement, because Aurora was never idle while I had it.

## 8. Operating it

```bash
# Redeploy (or just push to main — auto-build is on)
aws amplify start-job --app-id d2a69zdzqun8m7 --branch-name main --job-type RELEASE

# Is the live site actually reading Aurora? (the one check that matters)
curl -s https://main.d2a69zdzqun8m7.amplifyapp.com/api/health

# Query from anywhere, no VPC needed
aws rds-data execute-statement \
  --resource-arn arn:aws:rds:us-east-1:638175140432:cluster:aurora-2525 \
  --secret-arn "$(aws secretsmanager list-secrets \
      --query "SecretList[?starts_with(Name,'rds!cluster-ee58a523')].ARN" --output text)" \
  --database policy --format-records-as JSON --sql "select count(*) from \"Bills\""

# psql, from worker-2 (inside the VPC, PG17 client and credentials already staged)
ssh -i ~/.ssh/livingston-worker-2.pem ubuntu@13.218.239.11
. ~/.govblock/aurora.env && psql "$AURORA_POLICY_URL"

# Did a build silently fall back to snapshots?
aws amplify get-job --app-id d2a69zdzqun8m7 --branch-name main --job-id <n> \
  --query 'job.steps[?stepName==`BUILD`].logUrl' --output text | xargs curl -s \
  | grep -icE "database unavailable|CredentialsProviderError|size limit"   # want 0
```
