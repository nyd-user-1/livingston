# Lane FT — the bill-text fleet: one box per IP, every remaining state at once

**Written:** 2026-08-29 20:45 ET, by the lead (Fable). **Window:** `/rename text-fleet`, `/color magenta`. **Model:** Opus. **Repo:** `~/Code/livingston` (pull `main` first — `98386d3` or later).
**Read first:** `prompts/2026-08-29-native-text.md` §Report (today's history: which states are done, which hosts refuse, why), then `scripts/box/fleet-launch.sh`, `scripts/box/text-backfill.mjs` (the `--shard` and `--all-states` branches) and `api/_lib/polite-fetch.ts` (the `POLITE_AUTO_LANES` and `POLITE_HOST_OVERRIDES` doc comments). Everything below is already built and pushed; your job is to **launch it, watch it, prove it, and report** — not to redesign it.

## Why

Today's lesson, learned state by state: every rate limit we hit is **per IP**. One box at 32 lanes gets `429`'d by Florida and Michigan; the same box at 4 lanes is fine. So the design Brendan asked for: *k* boxes from one AMI, each its own public IP, each taking `document_id % k = i` of the outstanding documents, each host on each box starting at 4 concurrent requests and stepping up 4 at a time after 300 clean answers (to 16), halving on a `429`. No box talks to another — the database is the coordinator — and a box that dies loses nothing. Brendan: "we have like 40 more states to go … we need a solution that fits all states."

## What exists

- **AMI** `ami-0d10c2f783603af51` — a no-reboot snapshot of box 1 (repo at `~/livingston` with `.env.local`, node 22, poppler, the state CA bundle, `~/bin/run-job`). Check it is `available` (`aws ec2 describe-images --region us-east-1 --image-ids ami-0d10c2f783603af51 --query 'Images[0].State'`); it was `pending` at 20:40 ET.
- **`scripts/box/fleet-launch.sh <ami> <count> [--type t4g.medium] [--skip-states …] [--start 4] [--max 16] [--dry-run]`** — launches *count* instances with user-data that: claims the box against its boot janitor (`~/.keep-up`, `~/.no-auto-jobs`), **disables `run-due.timer`/`.service` (the AMI carries box 1's scheduler — eight copies of the nightly LegiScan delta would be a disaster)**, pulls `main`, runs `text-backfill.mjs --source state_link --all-states --skip-states … --shard i/count --parallel 16 --batch 400 --since-session 2009` under `POLITE_AUTO_LANES=start:max`, ships its log to `s3://livingston-fec-bulk-638175140432/_fleet/shard-i-of-count.log` every 5 minutes and at exit, and **terminates itself** when its shard is drained (`--instance-initiated-shutdown-behavior terminate`). Launches are 3 s apart. Instances are tagged `fleet=text`, `shard=i/k`, `Name=lv-text-fleet-i`.
- **Quota:** 64 on-demand vCPUs in us-east-1; box 1 and box 2 use 4. `t4g.medium` is 2 vCPU / 4 GB at $0.0336/h — **12 instances ≈ $0.40/hour, ≈ $4 for the night.**
- **Where things stand (20:40 ET):** done — NY, CA, IL, VA, MA, NJ, TN (all that `capitol.tn.gov` serves). Running elsewhere — **MI on box 1** (`lv-text-mi`, 4 lanes; leave it, skip MI), **FEC haul on box 2** (`lv-fec-bulk`; not yours). Box 1's unsharded walker and box 2's `lv-text-walk2` were **stopped** at 20:35 so nothing overlaps the fleet. TX is at 65% and **is in scope** (its FTP job was stopped on Brendan's order; the fleet takes `capitol.texas.gov` like any other host). FL is at 3% and in scope — clear its refusal rows first (step 2).
- Refused hosts you will see close themselves on contact, correctly: OK, HI, CO, DC, AK (robots), PA, GA (AWS-range blocks), `publications.tnsosfiles.com`. They are on Brendan's email list; do not work around them.

## Do, in order

1. **Recon (5 min).** `git pull`; AMI state; `aws ec2 describe-instances --filters Name=tag:fleet,Values=text` (nothing should exist yet); the census below, saved as the "before" table.
2. **Clear the refusal rows that were our fault, not the host's** — rows written while a box was being rate-limited (`host-dropped:`) for the states the fleet will take; they block re-selection:
   `DELETE FROM "BillTexts" WHERE source='state_link' AND error LIKE 'host-dropped%' AND state NOT IN ('HI','TN','OK','PA','GA','CO','DC','AK');` — report the count. (Rows with `robots:` are verdicts; leave them.)
3. **Dry run:** `bash scripts/box/fleet-launch.sh ami-0d10c2f783603af51 12 --dry-run` — read one instance's user-data end to end and say it is what §"What exists" describes.
4. **Launch 12:** the same command without `--dry-run`. Record the 12 instance ids and IPs. Within 5 minutes, **read shard 0's log from S3** (`aws s3 cp s3://livingston-fec-bulk-638175140432/_fleet/shard-0-of-12.log -`) — it must show `state_link --all-states: N states … shard 0/12` and rounds landing. If any shard shows `EXIT=` inside 5 minutes, or no log appears in 10, **terminate the fleet by tag** (`aws ec2 terminate-instances --instance-ids $(aws ec2 describe-instances --filters Name=tag:fleet,Values=text Name=instance-state-name,Values=running --query 'Reservations[].Instances[].InstanceId' --output text)`), find the cause in the log, fix, relaunch. Do not launch a second fleet beside the first — *k* is fixed per run.
5. **Watch, every 15–20 minutes, and write a heartbeat each time:** (a) documents with text, by state, from the census query; (b) rows/hour by state over the last 10 minutes; (c) per-shard: the last log line and the host stats in the last `HTTP 200 {…"hosts":[…]}` line — `lanes` (has the host ramped past 4?), `strikes`, `dropped`; (d) `aws ec2 describe-instances … fleet=text` — how many still running. A host that every shard reports `dropped` is a host that refuses the whole fleet; say so and move on — the driver already does.
6. **When shards finish** (instances terminate themselves), run the census; for states with `left_to_fetch > 0` that are not on the refused list, run one `--retry-errors` sweep for that state from box 1 (`node scripts/box/text-backfill.mjs --source state_link --state XX --since-session 2009 --retry-errors --batch 500`, with `POLITE_AUTO_LANES=4:16`) and report what it recovered.
7. **Final report** (below). Then confirm no `fleet=text` instance is still running, and say what the night cost.

## The census query (before, during, after)

```sql
WITH d AS (
  SELECT b.state, t.document_id IS NOT NULL AND t.error IS NULL AS got, t.error
    FROM "Documents" d JOIN "Bills" b USING (bill_id)
    LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
   WHERE d.document_type = 'text' AND coalesce(d.state_link,'') <> '' AND b.session_id >= 2009
     AND d.state_link NOT LIKE '%legiscan.com%')
SELECT state, count(*) AS docs, count(*) FILTER (WHERE got) AS got,
       count(*) FILTER (WHERE error IS NOT NULL) AS err,
       count(*) - count(*) FILTER (WHERE got) - count(*) FILTER (WHERE error IS NOT NULL) AS left_to_fetch,
       round(100.0 * count(*) FILTER (WHERE got) / count(*), 1) AS pct
  FROM d GROUP BY 1 ORDER BY left_to_fetch DESC;
```
`POLICY_DATABASE_URL` is in `.env.local`; use the `-pooler` host for anything you run at volume. NY and US read as "left_to_fetch" because their text sits under synthetic ids — ignore them.

## Hard rules

Never a second unsharded walker while the fleet runs · never two fleets with different *k* at once · `POLITE_AUTO_LANES` and the fleet's lane logic are the tuning surface; **do not add `norobots` for any host** — the one exception (Tennessee) was Brendan's explicit call and is already done · no `DELETE` beyond step 2's statement · no `src/` changes · no LegiScan API queries · **no push** — commit anything you change by pathspec and say so; the lead pushes after Q/A · if a host answers `403/429` to every shard at 4 lanes, it is refusing the fleet, not a bug — record and report · instances cost money while they run: a shard that is idle for 30 minutes with no log movement gets terminated and reported, not watched.

## Reporting — into this file, under **Report**

Heartbeat before each step with the expected duration; a heartbeat every 15–20 minutes while the fleet runs (the four things in step 5); a line when each shard terminates. **Final report:** before/after census tables · per-state rows/hour peak · which hosts ramped to 16, which held at 4, which refused · shard wall clocks and the total cost · the `--retry-errors` recoveries · deviations · what was deliberately not done · **one paragraph: what a second fleet run (for the refused states, once Brendan's emails land) should do differently.**

---

## Report

*(lane writes here)*

### Heartbeats
