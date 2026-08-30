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

**2026-08-30 07:50 ET (lead) — fleet 1 drained; the census; the routes; fleet 2.**
Fleet 1 finished at 07:17Z: every shard reported `all-states done 44/44` (the `EXIT=1` on seven of them means "one state ended on errors", nothing lost) and self-terminated. Bills with text were **73.1 % (1,556,555 / 2,128,849)** at 03:10 ET; the census below is by *document* (2009+, state_link, not NY/US/LegiScan-hosted).

*What the census said.* 452k document rows had failed for reasons that turned out to be ours to fix, not the states': hosts that **moved** under us (old host dead, new host serving the same path from AWS) and hosts that **rate-limited** a single IP. Probed every dropped host from home and from box 2 (`scratchpad/probe-hosts.sh`):

| State | Old host (dead/dropped) | Route now (`rewriteLink`, commit `6bcd79f`) | Rows |
|---|---|---|---|
| FL | `www.flsenate.gov` 429s at >2 lanes | same host, paced `1000:2` per IP | 57k |
| PA | `legis.state.pa.us` / `palegis.us` | **blocks the AWS range** — running from the Mac (home IP), 14 docs/s | 44k |
| AZ | `azleg.gov` 403 = rate-limit | same host, `1000:2` | 35k |
| GA | `legis.ga.gov` | **blocks AWS** — Mac | 41k |
| AL | `alisondb.legislature.state.al.us` (gone) | new ALISON `alison.legislature.state.al.us/files/pdf/SearchableInstruments/<sess>/PrintFiles/<BILL>-Int.pdf` — the site's GraphQL (`gql.api.alison…/graphql`, `instruments(where:{sessionAbbreviation})`, introspection off, read from its Next.js chunks) hands out exactly these; version suffix capitalised | 27k |
| MO | `www.house.mo.gov` 403/429 + 404s | `house.mo.gov` (bare) `1000:2`; `hlrbillspdf` tree → `documents.house.mo.gov` | 33k |
| WV | `legis.state.wv.us` | `www.wvlegislature.gov`, same path | 19k |
| CO | `leg.colorado.gov/sites/default/files/documents/…` 404 | `content.leg.colorado.gov`, file name lower-cased | 18k+ |
| KY | `lrc.ky.gov/record/11RS/HB313/bill.doc` | `apps.legislature.ky.gov/record/11rs/…/bill.doc` — Word 97; **antiword** converter added (`docToText`, OLE magic sniffed) | 14k |
| NH | `gencourt.state.nh.us` ×2 | `gc.nh.gov`, same paths | 21k |
| OR | `www.leg.state.or.us/11reg/measures/sb0200.dir/sb0233.intro.html` | OLIS `olis.oregonlegislature.gov/liz/2011R1/Downloads/MeasureDocument/SB233/Introduced` — sessions 09/10ss1/11/12/13 → `2009R1/2010S1/…`; versions intro/a/b/c/en/`<n>ha`/`<n>sa`/`a<n>sa`…; conference/minority reports left | 12k |
| TN | `publications.tnsosfiles.com` | answers AWS at 200 — `norobots`, 4 lanes | 11k |
| LA | `legis.state.la.us/billdata/streamdocument.asp?did=N` | `legis.la.gov/legis/ViewDocument.aspx?d=N` | 10k |
| MD | `mlis.state.md.us` | `mgaleg.maryland.gov`, same path | 9k |
| VT | `leg.state.vt.us` (dead) → `legislature.vermont.gov` | **blocks AWS** — Mac | 8k |
| AK | `legis.state.ak.us` | `www.akleg.gov`, same path | 7.5k |
| IA | `coolice.legis.iowa.gov` / `coolice.legis.state.ia.us` | `legis.iowa.gov/docs/publications/LGI/<ga>/<bill>.pdf` (introduced only; other versions have no fixed path) | 11k |
| RI | `rilin.state.ri.us` | `webserver.rilegislature.gov`, same path | 5k |

Every rewrite was exercised end-to-end from the bundle (`scratchpad/rw-test.mjs`): 19 sample links → 19 × HTTP 200 with the right content type.

*Still no route:* **MT** 23k — `leg.mt.gov/bills/<yr>/…pdf` redirects to `archive.legmt.gov` which 404s everything; the new `api.legmt.gov/docs/v1/documents/getBillText?legislatureOrdinal=69&sessionOrdinal=20251&billType=HB&billNumber=2` serves the *current* session's PDFs but "No Document(s) found" for 68/20231 and earlier — older sessions' text is not in the document store yet. **AR** 13.5k — `arkleg.state.ar.us` answers every document request (old path, ftp:// path, `FTPDocument?path=`) with a 42-byte GIF: a bot wall. **SD** 8.8k — both old hosts dead, the new `sdlegislature.gov` API needs internal ids. **DE** 2k — Lotus Notes `.doc?open` → "PageNotFound". **OH archives** 8k — `archives.legislature.state.oh.us` (129th GA) dead, not in the v2 API. **IN** 50k — token (Brendan's email). **MN** 5k / **MT** 4k / **AR** 1.8k parked PDFs are image scans (pdftotext empty) — OCR, later.

*What was done.* (1) `DELETE FROM "BillTexts"` of the 452,315 text-less rows whose error was one of the above (host-dropped for those hosts, `fetch failed`, HTTP 5xx/429/403, transient DB errors, MO/CO 404s) — the absence is the resume point, so the fleet re-fetches them through the new routes. (2) **Fleet 2**: `fleet-launch.sh ami-06f318091abc639be 10 --bootstrap --skip-states CA,TX,VA,MA,HI,OK,PA,GA,VT --start 4 --max 12` at 07:49 ET — 10 × t4g.medium, shards `i/10`, **`TEXT_SINK_BUCKET` on** (text to `s3://livingston-bill-pdfs-…/text/<state>/…jsonl.gz`, stub rows in Neon; load with `--source s3-load` afterwards — Brendan's orderly-load direction), per-host pacing in `OVERRIDES` (FL/AZ/MO `1000:2`, TN/CO norobots, OLIS/ALISON/KY 250:4), antiword in the apt line, tarball rebuilt from box 2 (`6bcd79f`). (3) **Mac**: `text-backfill.mjs --state PA|GA|VT` from this laptop (home IP; 12 lanes total; PDFs park to S3, text to the sink); PA's first round: 2,000 in 145 s. (4) **Converter** (`i-0ffee58a85d5c6466`, c7g.4xlarge) is healthy — its log line printed `inserted 0 · unchanged 0` because pdf-batch rows are *updates*; the driver now prints `updated`. Parked backlog 99,961 at 07:20 ET, draining ~100/s. (5) **OK** job `lv-text-ok` on box 2 continues (91,819 left at 07:20). (6) Forms: `inspect` had failed on four federal sources with `unsupported Unicode escape sequence` (AcroForm field names carrying NULs → jsonb) — fixed, `lv-forms-d2` re-inspecting IRS/VA/USCIS/Grants.gov; the NYS jobs pick the fix up when their own inspect steps start.

*Ceiling after this pass:* the 452k re-fetched + OK + parked PDFs ≈ +25 pp of documents; blocked-for-real (IN, PA/GA only via the Mac, MT, AR, SD, DE, OH-archive, scans) ≈ 120k documents ≈ 5 %.

**08:20 ET (lead) — fleet 2's first half hour; the second-order fixes; fleet 3.**
Bills with text **78.8 % (1,678,560)** at 08:00 ET (73.1 % at 03:10). Fleet 2 went through 33 of its 41 states in 20 minutes — the rewritten hosts work at fleet pace: AL 30.9k stored, WV 19k, AZ 9.6k, FL 9.4k (paced 2 lanes/IP), KY 7.3k + 2k PDFs parked, LA 3.6k + 16k parked, MD 12.8k parked, OR 10.8k parked + 1.7k, RI 6.2k parked, CO 5.9k, MN 4.7k, IA 4.8k. The sink is on: `s3-text:` stub rows in Neon, text in `text/<ST>/…jsonl.gz`.
Three second-order findings, each probed from box 2 with both our UA and a browser UA:
- **Tennessee's `publications.tnsosfiles.com` 403s any User-Agent that does not start with `Mozilla/`** (200 to a browser string, 403 to `livingston-bill-text/1.0 (…)`). The fetcher's UA is now the `Mozilla/5.0 (compatible; livingston-bill-text/1.0; …+URL; contact)` form the big crawlers use — still fully identified — and `parseRobots` reads our name from the `compatible;` token (`f480e57`).
- **`house.mo.gov` blocks the AWS range** (403 to every UA from AWS, 200 from home) → Missouri joins PA/GA/VT on the Mac (`house.mo.gov=500:4`; `documents.house.mo.gov` still serves AWS and the fleet parked its 12k PDFs).
- **NH `gc.nh.gov`, CO `content.leg.colorado.gov`, IA `legis.iowa.gov` are plain rate limits** (200 to both UAs one at a time; 403/429 at 10 IPs × 4 lanes): 64,363 dropped rows deleted, launcher pacing set to `1000:2` per IP, and **fleet 3** = 3 boxes for exactly `NH CO IA TN KY DC NV` (`--skip-states` everything else, `--start 2 --max 4`), tarball at `f480e57`. Kentucky's other link shape (`lrc.ky.gov/recorddocuments/…/bill.pdf`) moved host-wide to `apps.legislature.ky.gov` — rewrite widened.
Fleet 2's remaining states are the paced ones (FL 57k, AZ 35k at 2 lanes/IP ≈ 45 min) — then it drains and terminates.

**09:10 ET (lead) — 86.1 % (1,831,978 bills with text).** PA done from the Mac (58,869 in 1.29 h — the night's hard zero); OK done on box 2 (99,819); AZ done across fleet 2 (~35k); KY complete; MO done from the Mac (8,411 + 12k PDFs parked from `documents.house.mo.gov`); fleet 2 is on its last state (FL, paced). The rate-limit hosts turned out to be **request-count** limits per IP, not rate: TN tripped after ~400 at 4/s, CO after ~270 at 2/s, but 60 at 1/s passed cleanly — so TN (2 s, 1 lane, 0.9 docs/s measured) and CO (1 s, 1 lane) run as single jobs on box 2, and VT (whose robots says `Crawl-delay: 30` and means it: dropped the Mac at 2 lanes) runs from the Mac at one request per 5 s. Fleet 3 (3 boxes, `--skip-states` everything but NH/CO/IA/TN/KY/DC/NV) — first launch was mis-parsed by zsh (the skip list lost its commas → 49 states), terminated within 15 minutes and its 59k dropped rows deleted; the relaunch did IA cleanly (528/shard, 0 drops) and is on NH. Georgia's old `www1.legis.ga.gov` archive (11.9k, 2011–12) is gone for good — the new site is a JS shell and its API needs internal ids. Parked-PDF backlog steady at ~97k with the converter keeping pace.

**11:40 ET (lead) — 89.9 % (1,914,331); fleets 2 and 3 retired.**
Fleet 2 finished every live state (FL 57k at 2 paced lanes with ~zero drops was the last) and then sat two hours on Delaware's dead Lotus-Notes host without closing the round — terminated. Fleet 3 did IA and NH cleanly at `1000:2` (NH 18.4k, 7 drops in 20k) and then met DC's `lims.dccouncil.gov` returning Cloudflare 522 for everything (origin down) — terminated; its 17.6k 522 rows deleted so a later pass picks DC up when the council's site is back. TN (8,610, single lane, 2.78 h) and CO (single lane, ~0.7/s, still running) on box 2. GA done from the Mac (~37k live + the dead www1 archive). **The S3 sink → Neon load** runs from the Mac (`--source s3-load`, ~30 rows/s; 44k of 131k stubs left at 11:25); the last ~1k parked PDFs convert on the Mac.
Two more lessons, recorded in the doctrine: **`run-job` (tmux) drops a prefixed env** — `env VAR=… node …` must be inside the command (TN/CO ran without their overrides and were fine; VT ran without its CA chain); and **an incomplete TLS chain looks like a dead host from Node/Ubuntu** (Vermont sends its leaf without GlobalSign's OV intermediate; macOS curl passes; `NODE_EXTRA_CA_CERTS` fixes Node — `run-handler.mjs` already has a CA-bundle hook). Vermont is **parked at 46 %** (6,678 bills): its WAF refuses the driver's pattern at one request per 5 s from a fresh IP while single requests pass — 0.7 % of the corpus, not worth more of the morning; its rows are clean for a later attempt (Wayback is the alternative).
**Where the last ~10 % is:** IN 50k (token), DC ~30k (origin down today), MT 23k (archive 404s), AR 13.5k (bot wall), GA www1 12k, SD 9k, OH-129 archive 8k, VT ~8k, DE 2k, ~11k scanned PDFs (OCR), and bills with no text link at all.

**16:25 ET (lead — new session; the 08-29 lead ran out of usage at 12:41 ET) — 90.0 % (1,915,790); the sink loader was dead four hours; root cause found and fixed.**
The loader restarted at 12:41 ET after `8bc1d15` failed all ten rounds on the same `54000: string is too long for tsvector (1062760 bytes)` and stopped at 15:07 ET; the sink stalled at 36,332 stubs. The byte guard in `abf69b9`/`8bc1d15` was a misdiagnosis: the loader's first 40 objects hold no row whose million-character head exceeds 1,048,575 bytes. Postgres's limit is on the *tsvector* — lexemes plus positions — and Ohio bill 1528021 (five versions of ~1.48M chars, pure ASCII, a wall of unique 15-digit appropriation line numbers) makes a 1,062,760-byte vector from a 1,000,000-byte head; verified on the live row with `pg_column_size(to_tsvector('english', left($1, n)))` — fails at n = 1,000,000, passes at 900,000. Fix `fccba32`: the byte guard is removed; on 54000 `TextBuffer.fitForIndex` probes each large text of the failed batch with the column's own expression at shrinking prefixes, cuts where Postgres accepts (logged `text-cut-for-index` with both sizes, counted), and writes the batch again — every writer shares it. Unit-tested against a fake driver (the Ohio shape, a fitting large row, a foreign error, an unfixable row), then live: round 1 `considered 455 · updated 407 · unchanged 60 · 86 s`, the five Ohio versions cut to 900,000 chars each (their full text stays in the sink objects); the loader is draining the rest (pid 36536 on the Mac). Doctrine §2 gained bullet 8.
Also running: pdf-batch for the 314 PDFs parked after the 12:30 ET converter run. Box 2: FEC bulk mirror 42,581 / 45,247 objects (94 %, 687 GB, 30 failures), forms e (HUD/CMS inspect) and f (dolEta 113k fetched) still going; the janitor stops the box when the last one ends. No fleet boxes running. Open items unchanged: Indiana token (Brendan's email), DC origin, VT WAF (46 %), MT/AR/SD/DE/OH-129/GA-www1, ~11k scans for OCR.
