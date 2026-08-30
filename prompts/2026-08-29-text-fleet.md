# ⚠ 22:35 ET — THE FLEET IS ALREADY RUNNING. DO NOT LAUNCH ANOTHER.

Brendan handed the launch back to the lead at 22:20 ("no more stopping to wait"). The lead launched **20 shards** at 22:28 ET: shard 0 on box 1 (`lv-text-shard0`), shards 1–19 as `t4g.medium` instances from stock Ubuntu via `fleet-launch.sh --bootstrap` (the AMIs were still `pending` after an hour). If you are the Opus window that received this brief: **do not run step 4.** Your job is now steps 5–7 only — watch, census, retry sweeps, report — against the fleet that exists (`aws ec2 describe-instances --filters Name=tag:fleet,Values=text`). Shard logs: `s3://livingston-fec-bulk-638175140432/_fleet/shard-<i>-of-20.log`; box 1's is `~/logs/lv-text-shard0.log`.

# Lane FT — the bill-text fleet: one box per IP, every remaining state at once

**Written:** 2026-08-29 20:45 ET, by the lead (Fable). **Window:** `/rename text-fleet`, `/color magenta`. **Model:** Opus. **Repo:** `~/Code/livingston` (pull `main` first — `98386d3` or later).
**Read first:** `prompts/2026-08-29-native-text.md` §Report (today's history: which states are done, which hosts refuse, why), then `scripts/box/fleet-launch.sh`, `scripts/box/text-backfill.mjs` (the `--shard` and `--all-states` branches) and `api/_lib/polite-fetch.ts` (the `POLITE_AUTO_LANES` and `POLITE_HOST_OVERRIDES` doc comments). Everything below is already built and pushed; your job is to **launch it, watch it, prove it, and report** — not to redesign it.

## Why

Today's lesson, learned state by state: every rate limit we hit is **per IP**. One box at 32 lanes gets `429`'d by Florida and Michigan; the same box at 4 lanes is fine. So the design Brendan asked for: *k* boxes from one AMI, each its own public IP, each taking `document_id % k = i` of the outstanding documents, each host on each box starting at 4 concurrent requests and stepping up 4 at a time after 300 clean answers (to 16), halving on a `429`. No box talks to another — the database is the coordinator — and a box that dies loses nothing. Brendan: "we have like 40 more states to go … we need a solution that fits all states."

## Amendment 22:20 ET (lead) — pull before you launch

Two things landed after this brief was written; `git pull` first, and if you had already launched, terminate by tag and relaunch:
- **PDF deferral.** The fleet no longer converts PDFs in line. With `PDF_DEFER_BUCKET` set (the launcher sets it), a PDF is parked at `s3://livingston-bill-pdfs-638175140432/pdf/<state>/<document_id>.pdf` and its row says `pdf-deferred: s3://…`. Fetching runs at the host's pace, not pdftotext's. **The conversion is a separate, later pass** — `text-backfill.mjs --source pdf-batch --batch 500 --concurrency 24` on a many-core box — which the lead runs; you report how many PDFs were parked (the census query counts them under `err`, so also run `SELECT state, count(*) FROM "BillTexts" WHERE error LIKE 'pdf-deferred%' GROUP BY 1`).
- **The robots-refused states are in scope** (OK, HI, CO, DC, AK), with fixed 4-lane `norobots` overrides per host in the launcher. Their earlier `robots:` and `host-dropped:` rows must be cleared so they are re-selected — step 2's DELETE now reads: `DELETE FROM "BillTexts" WHERE source='state_link' AND (error LIKE 'host-dropped%' OR error LIKE 'robots:%') AND state NOT IN ('PA','GA','TN');` (TN's remaining refusals are `publications.tnsosfiles.com`, a real block; PA/GA are AWS-range blocks). Report the count.
- FL and **MI** are in scope. **Before launching, stop box 1's Michigan job** — `ssh -i ~/.ssh/44b-worker.pem ubuntu@<box1 ip> 'tmux kill-session -t lv-text-mi; tmux kill-session -t w-lv-text-mi'` (the ip is in `aws ec2 describe-instances --instance-ids i-030d9cac100e6e124`) — one IP at 4 lanes was giving Michigan 1.5 docs/s; twelve IPs at 4 lanes is the fleet's whole point. Then clear MI's `host-dropped` rows with the rest (step 2 covers it).

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

Never a second unsharded walker while the fleet runs · never two fleets with different *k* at once · `POLITE_AUTO_LANES` and the fleet's lane logic are the tuning surface · **the `norobots` overrides baked into `fleet-launch.sh` (OK, HI, CO, DC, AK) are Brendan's decision of 22:05 ET — "all 50 minus the 3-4 where you are blocked, max speed" — do not add hosts to that list yourself; PA and GA are AWS-range blocks and stay out** · no `DELETE` beyond step 2's statement · no `src/` changes · no LegiScan API queries · **no push** — commit anything you change by pathspec and say so; the lead pushes after Q/A · if a host answers `403/429` to every shard at 4 lanes, it is refusing the fleet, not a bug — record and report · instances cost money while they run: a shard that is idle for 30 minutes with no log movement gets terminated and reported, not watched.

## Reporting — into this file, under **Report**

Heartbeat before each step with the expected duration; a heartbeat every 15–20 minutes while the fleet runs (the four things in step 5); a line when each shard terminates. **Final report:** before/after census tables · per-state rows/hour peak · which hosts ramped to 16, which held at 4, which refused · shard wall clocks and the total cost · the `--retry-errors` recoveries · deviations · what was deliberately not done · **one paragraph: what a second fleet run (for the refused states, once Brendan's emails land) should do differently.**

---

## Report

*(lane writes here)*

### Heartbeats
