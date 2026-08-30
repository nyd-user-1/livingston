# Lane FD — the bill-text breakthrough, written down for every repo

**Kick-off (paste into an Opus window in `~/Code/livingston`):**
`Read prompts/2026-08-30-fleet-lessons-docs.md and do it. Report into that file under ## Report as you go.`

---

## Why this lane exists

Brendan, 2026-08-30 evening:

> Whatever lessons were learned by the last session must be well documented in /forge and /scripts. We spent days trying to get bill text and a breakthrough was only achieved yesterday afternoon into late evening and early morning. […] There were a series of measures that were taken yesterday even into the early morning that represent new tactics, new mechanics. There were 20 instances involved, multiple IPs, real creativity in getting the job done. Please be sure to annotate any and all measures/scripts/tactics/strategies for the benefit of future use for this repo and all others (this is not only relevant to this repo but also germane to the work and content of forge and scripts).

The numbers: bills with text went from **16.7 % (≈356k of 2.13M) on 2026-08-29 afternoon to 90.0 % (1,916,065) by 2026-08-30 17:25 ET**. The earlier days (08-27/28) were the failed approaches. Both halves are lessons.

Two standing orders came with the request and are already in code and doctrine (`~/Code/scripts/FLEET-DOCTRINE.md` §0, `SCRAPER-DOCTRINE.md` §0, `api/_lib/polite-fetch.ts` `POLITE_ROBOTS`): **public right over robots.txt**, and **max speed — bulk, then API in batches, then HTML; no walker states**. Carry them into everything you write.

## What to read (all of it, in this order)

1. `~/Code/scripts/FLEET-DOCTRINE.md` — the canonical write-up as it stands (§0–§5, incl. §2 bullet 8 and the tactics added the morning of 08-30). Your job is to verify and complete it, not replace it.
2. `~/Code/scripts/SCRAPER-DOCTRINE.md`, `ORCHESTRATION-DOCTRINE.md`, `RIG-DOCTRINE.md`, `README.md` — the house style and where things belong.
3. `~/Code/forge/docs/LESSONS.md`, `CATALOG.md` (§4 has the fleet pointers), `EXTRACTION-MAP.md`, `~/Code/forge/CLAUDE.md`.
4. `livingston/prompts/2026-08-29-text-fleet.md` **§Report** — the lead's decision-by-decision log with numbers (07:50, 08:20, 09:10, 11:40, 16:25, 17:25 ET). Then `prompts/2026-08-29-native-text.md`, `prompts/2026-08-28-bill-text.md`, `prompts/2026-08-28-worker-box.md`, `prompts/2026-08-28-direct-pipeline.md`, `prompts/2026-08-30-forms-library.md` — the earlier lanes and what they got wrong or right.
5. `livingston/docs/TEXT-FLEET.md`, `docs/PIPELINE.md`, `docs/PROVENANCE.md`, `docs/HANDOFF-2026-08-28.md`.
6. The code, because the doctrine must cite it exactly: `api/bill-text.ts` (`rewriteLink` + `rewriteIndiana`, PDF deferral, the S3 sink, `runS3Load`, `runPdfBatch`, `runStateLink`, the LegiScan metered fallback in `runDelta`), `api/_lib/polite-fetch.ts` (pacing, adaptive lanes, overrides, `norobots`, the UA, five-strike drop, `POLITE_ROBOTS`), `api/_lib/text-shared.ts` (`TextBuffer`, `fitForIndex`, `sinkToS3`, `readSinkObject`), `scripts/box/text-backfill.mjs` (`drain`, `--shard`, `--all-states`, `--bill-ids`, the stall/zero-text/refused stops), `scripts/box/run-handler.mjs`, `scripts/box/fleet-launch.sh` and the rest of `scripts/box/`, `ops/box/` (janitor, run-job, CA bundle), `scripts/box/fec-bulk-mirror.sh`, `scripts/forms/forms-harvest.mjs`.
7. `git -C ~/Code/livingston log --since=2026-08-28 --format='%h %ad %s' --date=format:'%m-%d %H:%M'` — every commit is a decision; the messages carry the numbers.
8. The transcripts, for the reasoning the commits do not carry. They live under the **other** Claude account's config dir: `~/.claude-account3/projects/-Users-brendanstanton-Code-livingston/9ec33653-5ac3-4594-a0a4-14d05b2ab529.jsonl` (08-29 08:26 → 08-30 12:41 ET, the fleet night — 10 MB, read it with a script that prints assistant text + tool commands in order), and the 08-28/29 sessions `e6361e20-…`, `f0c0bd92-…`, `1ad06b75-…` in the same dir (the days that did not work). The memory notes there (`memory/text-fleet-2026-08-30.md`, `lane-nt-native-text.md`, `fec-bulk-mirror.md`, `forms-library-lane.md`, `policy-neon-legislative-data.md`) are short and dense — read them first.
9. This account's take-over session (08-30 16:12 ET onward) is summarised in `prompts/2026-08-29-text-fleet.md` 16:25 and 17:25 entries and in commits `fccba32`, `1e74f90`, `d66534b` and the Indiana route commit that follows them.

## Deliverables

**A. `~/Code/scripts/FLEET-DOCTRINE.md` — verified, and completed with Annex A: the tactics catalogue.**
Re-read every existing claim against the code and the commits; fix what drifted; keep its voice. Then add **Annex A**, one entry per measure, each with: *what it is* · *the failure it answered* (with the number: rows, hours, dollars) · *mechanism* · *where* (file:function, flag, env var, commit hash) · *when to reuse it* · *pitfalls / anti-lessons*. It must at least cover:
- the sharded fleet: 19–20 × `t4g.medium`, one public IP each, `--shard i/N`, stock-Ubuntu bootstrap from an S3 tarball, self-terminating boxes, janitors ("box stops when the last job ends"), fleet 2 = the retry pass through rewritten hosts, fleet 3 = the paced hosts;
- per-IP request-count WAFs → **more IPs, not more lanes** (FL/MI at 12 lanes; NH/CO/IA/TN at `1000:2`); adaptive lanes `POLITE_AUTO_LANES=4:16`; `POLITE_HOST_OVERRIDES` and `norobots`; the standing order that now makes robots advisory;
- hosts that **block the AWS range** (PA, GA, VT, MO `house.mo.gov`, IN `iga.in.gov`) → run from the home IP (the Mac), and how a Mac run is launched;
- the identified `Mozilla/5.0 (compatible; …)` UA (tnsosfiles 403s bare product UAs) and `parseRobots` reading our name from the `compatible;` token;
- **host moves and rewrites**: the full table in the 07:50 report (WV, LA, MD, NH, AK, RI, KY, MO, CO, AL/ALISON GraphQL, IA, OR/OLIS, OK, VT, MI, HI, IL) plus Indiana (`/pdf-documents/<GA>/<year>/…`, GA arithmetic, three link shapes); how each was found (probe scripts `probe-hosts.sh`, `rw-test.mjs`); the rule "verified end-to-end from the bundle before it ships";
- the **JS-shell verdict**, the **five-strike drop**, `host-dropped` as a verdict, and **DELETE the verdicts that were ours** (blocked range, dead host since rerouted, shell from a page link since rewritten) so the absence puts documents back on the fetch path;
- **PDF deferral** (`PDF_DEFER_BUCKET`, park to S3, `--source pdf-batch` with pdftotext at concurrency 8–24, `antiword` for Word-97 `.doc`, `billtexts_deferred_idx`), and OCR as the still-open piece;
- the **S3 text sink** (`TEXT_SINK_BUCKET`, gzipped JSONL per batch, stub rows, `--source s3-load` serial loader, unique keys per writer after the Arizona same-millisecond collision, orphan-stub cleanup);
- the **database ceiling** lessons (§2 today) and the two write-path lessons: NUL stripping; the tsvector limit is on the vector, `fitForIndex`; and the anti-lesson: the head-bytes guard that never fired;
- the driver's stops: refused batch, two zero-text rounds (parked PDFs now count as progress), three no-change rounds, `MAX_ERRORS`, the nightly budget;
- TLS: `NODE_EXTRA_CA_CERTS` / `ops/box/state-ca-bundle.pem` (Vermont's missing intermediate looks like a dead host from Node);
- `run-job`/tmux drops a prefixed env — `env VAR=… node …` inside the command; never a kill pattern and a relaunch in one ssh; kill the boot wrapper before a driver; monitors + 15-minute heartbeats; the census queries (and "no census while the fleet runs");
- the **Wayback CDX as a catalogue** (forms lane) and as the route for dead hosts (planned for IN 2009–13, GA www1, OH-129, MT, SD, DE);
- the **FEC mirror**: streaming copy from the unsigned GovCloud bucket, `--expected-size`, and the key-with-spaces bug;
- LegiScan: datasets (all 993 sessions held), the 30k/month meter, `LEGISCAN_MONTHLY_STOP`, legiscan.com is Cloudflare-challenged (API only, never crawl);
- cost: what the night cost in EC2 and what a box-hour buys.

**B. `~/Code/scripts/SCRAPER-DOCTRINE.md`** — confirm §0 standing orders read correctly in context; add a **Host-behaviour catalogue** section: the taxonomy of what a host does to a crawler (rate by count per IP · blocks a cloud range · UA whitelist · JS shell · Cloudflare challenge · moved host · missing TLS intermediate · 200-with-HTML-error) and the answer to each, with the state that taught it.

**C. `~/Code/forge/docs/LESSONS.md`** — a dated entry (2026-08-29/30): the breakthrough in one page — the failed days and why (walker mindset, one IP, robots deference, database as the ceiling unrecognised), the turn (Brendan's calls: max speed, per-IP edge, 20 instances, "we're doing it my way"), the machinery, the transferable rules. **`~/Code/forge/docs/CATALOG.md` §4** — pointers to every script/flag above, current.

**D. `livingston/docs/TEXT-FLEET.md`** — grow it into the repo-local runbook: how to launch a fleet, a Mac run, the sink loader, pdf-batch, the census, the monitors; where the logs are; what to delete before a retry pass. Short sections, exact commands.

**E. Report** — under `## Report` below: what you wrote where (paths, section names), which existing claims you corrected, claims you could not verify (say so — do not paper over), and anything you found in the transcripts that is not yet in code or doctrine.

## Rules

- **No code changes** in this lane. Documentation only. If you find a bug, write it in the report.
- **Verify before you assert.** Cite the file, the function, the flag, the commit. A number in the doctrine must trace to a report entry, a log, or a query.
- **Do not duplicate; link.** One canonical home per fact: the doctrine holds the rule, forge holds the lesson and the pointer, the repo runbook holds the commands.
- Keep the voice of the existing doctrine: plain, specific, each rule paid for by a named incident.
- `~/Code/scripts` and `~/Code/forge` are not git repos (check; if one is, commit there with a clear message). Livingston is — commit `docs/TEXT-FLEET.md` and this prompt file when you report.

## Report

*(lane writes here)*
