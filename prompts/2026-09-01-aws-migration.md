# GovBlock on AWS — off Vercel, off Neon

**Session:** 2026-09-01, ~08:00Z onward. Picked up after lane A (929.sock) and the
UI lane (92946.sock) both hit their usage windows.

**Mission (Brendan, verbatim intent):** replace Vercel and Neon; stand GovBlock up
end-to-end on AWS; serving front end, database, and S3 all in one account;
maximally cost- and performance-efficient. Budget authorised: $15. Cloudflare DNS
is Brendan's, in the morning.

---

## 1. Where it is serving

| | |
|---|---|
| **Live URL** | https://main.d2a69zdzqun8m7.amplifyapp.com |
| **Health / data-path proof** | https://main.d2a69zdzqun8m7.amplifyapp.com/api/health |
| **Amplify app id** | `d2a69zdzqun8m7` (app name `govblock`, branch `main`, PRODUCTION) |
| **Database** | Aurora Serverless v2 PostgreSQL 17.10, cluster `aurora-2525`, database `policy` |
| **Lake** | `s3://govblock-lake-638175140432` (lane A's Parquet export — finished clean) |
| **Region / account** | us-east-1 / 638175140432 |

Everything below is in that one account, alongside Bedrock, the Knowledge Base,
AgentCore and the worker boxes — which was the point.

---

## 2. The architecture, and why this shape

**Front end — AWS Amplify Hosting (`WEB_COMPUTE`).** It is the AWS answer to
Vercel: git-connected, CloudFront in front, SSR compute behind, pay-per-request
with no idle floor. Chosen over App Runner (~$5–8/mo of always-on provisioned
memory) and over ECS+ALB (an ALB alone is ~$16/mo). Builds run on `git push` to
`main`.

**Database — the existing `aurora-2525` cluster, reused.** This is the single
biggest cost decision. Aurora Serverless v2 with **min 0 ACU** is the
Neon-equivalent: it bills nothing for compute while idle and scales on demand.
It was already provisioned and idling at 0 ACU, so the marginal fixed cost of
this migration is storage alone. During the bulk load it burst to its full
**32 ACU** and absorbed ~110M rows in minutes, then dropped back. Max
performance when it matters, ~zero at rest — that is the whole argument.

**The connection — RDS Data API, not a Postgres socket.** This is the load-bearing
choice and the one worth understanding. The Data API is an HTTPS call signed with
the hosting role. Because of it:

- the cluster stays **private** — no public accessibility, no 0.0.0.0/0 on 5432;
- Amplify's managed compute needs **no VPC attachment**, so **no NAT gateway**
  (which would have been ~$32/mo, more than everything else here combined);
- there is **no connection pool** to exhaust from serverless compute, and no
  RDS Proxy (~$87/mo at this cluster's floor).

Auth is IAM: role `govblock-amplify-compute` may call `rds-data` on this one
cluster and read the one secret. Nothing else.

**Refresh + keep-warm — one EventBridge schedule.** `govblock-refresh-matviews`
calls `public.refresh_policy_matviews()` hourly through the Data API (universal
target — no Lambda). It does double duty: it keeps `mv_stream_latest` and
`mv_newsroom_latest` current, and the activity keeps the cluster out of
auto-pause, which is what makes the cold-start problem below a non-issue.

**Auto-pause was raised 1h → 24h.** A full resume from paused state measured
**over 60 seconds** — fatal on a hot path. With the hourly refresh it should
never pause, and the app degrades to committed snapshots rather than erroring if
it ever does.

---

## 3. The data migration

Two waves, so the site could go live without waiting on 57 GB of text and votes.

**Wave 1 — the whole serving surface (~13 GB).** `pg_dump -Fd -j3 --compress=zstd`
on worker-2, then `pg_restore -j4` into Aurora. Dump 99 s, restore 103 s.
**Verified exact against Neon, 12/12 tables, zero mismatches:**

| table | rows | table | rows |
|---|---|---|---|
| Bills | 2,129,003 | Progress | 8,348,155 |
| Sponsors | 12,076,489 | Subjects | 2,958,465 |
| Documents | 4,373,840 | Referrals | 2,952,901 |
| Roll Call | 1,730,054 | Calendar | 1,454,524 |
| People | 22,723 | Forms | 392,182 |
| LobbyingFilings | 357,379 | FecContributions | 116,820 |

Structure also matches exactly: **198 indexes, 119 constraints, 9 views**, both
`public` and `openstates` schemas, both matviews populated, and
`refresh_policy_matviews()` came across.

**Wave 2 — the three giants**, streamed `pg_dump | psql` with indexes dropped and
rebuilt around the load (BillTexts carries a GIN search index that would
otherwise be maintained row-by-row across 3.4M rows). Nothing staged on disk.

- `History Table` — **18,115,699** rows in 47 s. ✅ exact vs Neon.
  This independently reproduces lane A's verified figure to the row.
- `Votes` — **89,087,703** rows in ~3 min. ✅ exact vs Neon.
- `BillTexts` — 40 GB, **still running** when this was written. See §5.

The 54 warnings pg_restore ignored were all `role "anon"/"authenticated" does not
exist` — Supabase-era GRANTs with no meaning here. Nothing structural was lost.

---

## 4. The code change

The data layer the UI lane built was already shaped for this: every reader tries
`sql` and falls back to a committed snapshot. So the swap is **one file**.

`apps/web/lib/policy/db.ts` now exports a tagged template backed by the Data API
with the same shape the Neon driver had — `stream.ts`, `newsroom.ts` and
`texts.ts` are untouched. Two things worth knowing:

- It decodes via the Data API's **column metadata**, not `formatRecordsAs: "JSON"`.
  That mode returns jsonb as an *unparsed string* and drops the metadata, which
  would have turned the newsroom's sections into text.
- Array parameters are rendered as Postgres array literals (`{1,2,3}`), because
  the call sites already carry their own `::bigint[]` / `::text[]` casts.

**Known Data API limits** (documented here so nobody rediscovers them): results
cap at 1 MB, and it **cannot return an `INTERVAL` column** — it errors outright.
No current query does, but a `now() - x` in a future query will fail.

`POLICY_DATABASE_URL` still wins when set, so a laptop can point at any plain
Postgres.

### The build was broken at HEAD

The UI lane was interrupted mid-flight and `main` did not compile — 37 type
errors. Fixed:

- `jurisdiction.ts` was missing `setSession`, which the typeset customizer called.
- `react-resizable-panels` was imported by `web` but was only a dependency of `ui`.
- `noUncheckedIndexedAccess` (inherited from the Turborepo starter) off for `web`;
  `strict` stays on. The components were never written against it and honouring
  it meant ~30 non-null assertions that buy nothing.
- Genuine errors behind that noise: the generated `BILLS` map pinned every bill to
  the first one's shape, `Resolved` collapsed `session` to `never`, and the FEC
  sort compared nullable columns.

Two Amplify-specific fixes, both non-obvious:

- **`node-linker=hoisted`** in `.npmrc`. Amplify packages `<appRoot>/node_modules`
  and does not follow pnpm's symlinks out of the app root — the Next build
  succeeded and then deploy failed with *"the node_modules folder is missing the
  next dependency"*.
- **`env` in `next.config.ts`.** Amplify gives its environment variables to the
  *build*, not to the Next server runtime. Without this the deployed site read
  `undefined` for both ARNs and **silently served snapshots against a fully
  loaded cluster** — `/api/health` said `database: none`. This is the failure
  mode to watch for; it looks like success from the outside.

---

## 5. Still running / still owed

- **BillTexts** was mid-copy at hand-off — ~7.5 MB/s, so ~90 min for the rows
  plus the GIN rebuild. It is in tmux `gb-billtexts` on worker-2
  (13.218.239.11, `~/.ssh/livingston-worker-2.pem`), logging to
  `~/logs/gb/billtexts.log`. It is idempotent per table; re-run with
  `~/gb/wave2.sh '"BillTexts"'` if it died.
  **Until it lands, bill-text pages fall back to the committed texts.**
- **Verify BillTexts** when it finishes: `select count(*) from "BillTexts"`
  should be **3,446,255**-ish (Neon's estimate; take an exact count on Neon).
- **Aurora storage after BillTexts** will be roughly 60–70 GB.
- Worker-2 is **still running** and was not stopped. `lake-hold` (lane A's
  session) is still open; lane A's `shard0` finished clean — *all relations
  complete, EXIT=0*.

## 6. For Brendan, in the morning

1. **DNS.** Point the domain at Amplify with
   `aws amplify create-domain-association --app-id d2a69zdzqun8m7 --domain-name <domain> --sub-domain-settings prefix=,branchName=main`,
   then put the CNAMEs it returns into Cloudflare **DNS-only (grey cloud)** for
   validation. I did not create it because I do not know which domain you want.
2. **Do not decommission anything yet.** Neon and Vercel are both untouched and
   still work — deliberately, so there is a rollback. Retire them only after you
   have reviewed the site.
3. **Rotate the Neon password when you do retire it.** The `POLICY_DATABASE_URL`
   in `apps/web/.env.local` is visible in process listings on worker-2 while the
   migration jobs run.
4. **Lane A's FLAG G is moot for serving.** `lakeName()` collapsing
   `public.Bills` and `openstates.bills` onto one lake prefix was a *lake naming*
   defect. Aurora keeps the two schemas distinct, so the serving path is
   unaffected. The lake still needs the one-line fix and a re-run for its own
   sake.
5. **The jurisdiction switcher is still a constant** (`US`, 2025). I added
   `setSession` as a no-op to unbreak the build; making the scope real across all
   52 jurisdictions is now worth doing, because the data behind it is finally
   there.

## 7. Cost

| item | at rest |
|---|---|
| Aurora compute | ~$0 idle (min 0 ACU); ~$5/mo for the hourly refresh |
| Aurora storage | ~$7/mo now, ~$0.10/GB-mo (≈$7 at 70 GB) |
| Amplify hosting | ~$0–3/mo at this traffic; builds ~$0.01/min |
| S3 lake | ~$0.13/mo at 5.7 GB |
| **NAT gateway avoided** | **–$32/mo** |

The migration itself burned roughly **$1** of Aurora ACU. Well inside the $15.

The one lever if the hourly refresh proves too expensive: drop it to every 2–3
hours. It is the only recurring compute in the design.

## 8. Operating it

```bash
# Redeploy (or just push to main — auto-build is on)
aws amplify start-job --app-id d2a69zdzqun8m7 --branch-name main --job-type RELEASE

# Is the live site actually reading Aurora?
curl -s https://main.d2a69zdzqun8m7.amplifyapp.com/api/health

# Query the database from anywhere (no VPC needed)
aws rds-data execute-statement \
  --resource-arn arn:aws:rds:us-east-1:638175140432:cluster:aurora-2525 \
  --secret-arn "$(aws secretsmanager list-secrets \
      --query "SecretList[?starts_with(Name,'rds!cluster-ee58a523')].ARN" --output text)" \
  --database policy --format-records-as JSON --sql "select count(*) from \"Bills\""

# psql, from worker-2 (it is inside the VPC and has PG17 + credentials staged)
ssh -i ~/.ssh/livingston-worker-2.pem ubuntu@13.218.239.11
. ~/.govblock/aurora.env && psql "$AURORA_POLICY_URL"
```
