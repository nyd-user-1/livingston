# PIPELINE — every jurisdiction, from the source, on our boxes

**Generated:** 2026-08-28 21:06 UTC by `scripts/pipeline/build-pipeline-doc.mjs`.
**Lane:** DP (`prompts/2026-08-28-direct-pipeline.md`). **Inputs:** `docs/PROVENANCE.md` (lane IN) and
`openstates.pipeline_reconcile` (live). Re-run the generator; do not hand-edit the table.

## What this is

Brendan, 2026-08-28: *"We use LegiScan now and leverage it as much as possible... **And** we establish
our own pipeline for all 51, direct to the states, so that we never have to rely on either platform."*
And: *"what I thought we were doing was creating 51 loaders, that's all."*

So: for each jurisdiction, a scheduled job on our box that pulls the legislature's own data and loads it
into schema `openstates`. **LegiScan still writes every canonical table.** A jurisdiction moves only when
it reaches `parity` twice running *and* Brendan names it — `promote.mjs` enforces both and two more locks.

## Where it stands

| verdict | jurisdictions |
|---|---:|
| 🟢 parity — ≥99% bills, ≥97% actions and sponsors | 0 |
| 🟡 close — ≥95% bills, ≥90% actions and sponsors | 1 |
| 🟠 gap | 9 |
| 🔴 failed — the scrape produced nothing, or one side has no rows | 3 |
| not yet run | 39 |

**Read that honestly: 13 of 52 have been through the pipeline, 1 of them at `close` or better.** The pipeline —
loaders, reconcile, crosswalk, schedule — is built and exercised across both engines; most `gap` rows
above are a BUDGET, not a disagreement. `pipeline_reconcile.detail` splits the two: `theirs_in_ours` is
correctness (100% almost everywhere) and `ours_in_theirs` is completeness (low wherever a scrape was
cut short at 20 minutes). The remaining rows are a queue, and the per-state cost is the scrape, not the
code — `scrape.mjs <juris>` then `load.mjs <juris>` then `reconcile.mjs` needs no new code for any of them.

## The two engines

**Native feed**, where the legislature publishes one. Take *everything* it offers, not the LegiScan subset.
Both native loaders found the same thing, and it is the single most useful measurement in this lane:
**the bulk endpoint exists and the per-item route is what everyone reaches for first.**

| | per-item route | bulk route | ratio |
|---|---|---|---|
| **NY** `legislation.nysenate.gov` | 25,402 requests (one per bill) | **75 requests**, 261 s, whole session | **339×** |
| **US** `govinfo.gov/bulkdata` | ~20,000 XML files, ~3 h | **8 zips**, 71 s, whole congress | **2,300×** |

**Open States scrapers**, mirrored (GPL-3.0) and run by us, for everyone else. The spread between states is
about 2,000×: New Jersey publishes its whole session as one ZIP and scrapes in **35 seconds**; New York
would take **~21 hours** at ~15 bills/min. Expect breakage — Open States' own issue tracker shows **~27% of
jurisdictions filed a scraper defect in the last 90 days and ~9% produced nothing at all.**

## The 52

`engine` = what pulls it · `feed` = did lane IN verify a structured feed by fetching it ·
`credentials` = what the open route needs before it can run at all · `verdict` = latest
`pipeline_reconcile` row · `writes canonical` = who owns `"Bills"` and friends **today**.

| | jurisdiction | engine | feed | credentials | cadence | verdict | latest numbers | writes canonical |
|---|---|---|---|---|---|---|---|---|
| AK | **Alaska** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| AL | **Alabama** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| AR | **Arkansas** | Open States scraper | — | `AR_FTP_USER` / `AR_FTP_PASSWORD` — **Brendan must obtain** | not scheduled | not yet run | — | LegiScan |
| AZ | **Arizona** | Open States scraper | blocked | — | not scheduled | not yet run | — | LegiScan |
| CA | **California** | feed (unused) | ✔ verified | no key, but a **MariaDB server inside the container** to load the 1.22 GB MySQL dump | not scheduled | 🔴 **failed** | scrape failed after 8.7s: the openstates california scraper needs a MariaDB server inside the container to load the state 1.22 GB MySQL dump (Dockerfi | LegiScan |
| CO | **Colorado** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| CT | **Connecticut** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| DC | **District of Columbia** | Open States scraper | blocked | `DC_API_KEY` — **Brendan must obtain** | not scheduled | not yet run | — | LegiScan |
| DE | **Delaware** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| FL | **Florida** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| GA | **Georgia** | feed (unused) | ✔ verified | — | not scheduled | 🔴 **failed** | scrape failed after 148.8s: HTTPSConnectionPool(host=www.legis.ga.gov, port=443): Max retries exceeded — [Errno 110] Connection timed out. Not robots, | LegiScan |
| HI | **Hawaii** | Open States scraper | — | — | weekly | 🟠 **gap** | bills 19.78% · actions 99.92% · sponsors 91.51% | LegiScan |
| IA | **Iowa** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| ID | **Idaho** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| IL | **Illinois** | Open States scraper | ✔ verified | — | weekly | 🟠 **gap** | bills 4.94% · actions 100% · sponsors 95.97% | LegiScan |
| IN | **Indiana** | Open States scraper | blocked | `INDIANA_API_KEY` — **Brendan must obtain** | not scheduled | not yet run | — | LegiScan |
| KS | **Kansas** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| KY | **Kentucky** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| LA | **Louisiana** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| MA | **Massachusetts** | Open States scraper | ✔ verified | — | weekly | 🟠 **gap** | bills 7.08% · actions 77.5% · sponsors 47.94% | LegiScan |
| MD | **Maryland** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| ME | **Maine** | Open States scraper | blocked | — | not scheduled | not yet run | — | LegiScan |
| MI | **Michigan** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| MN | **Minnesota** | Open States scraper | ✔ verified | — | weekly | 🟠 **gap** | bills 8.78% · actions 99.35% · sponsors 97.2% | LegiScan |
| MO | **Missouri** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| MS | **Mississippi** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| MT | **Montana** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| NC | **North Carolina** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| ND | **North Dakota** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| NE | **Nebraska** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| NH | **New Hampshire** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| NJ | **New Jersey** | Open States scraper | — | — | weekly | 🟡 **close** | bills 99.85% · actions 99.93% · sponsors 96.9% | LegiScan |
| NM | **New Mexico** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| NV | **Nevada** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| NY | **New York** | native `nysenate` | ✔ verified | `NYS_LEGISLATION_API_KEY` — free, we already hold it | nightly | 🟠 **gap** | bills 99.78% · actions 93.32% · sponsors 86.53% | LegiScan |
| OH | **Ohio** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| OK | **Oklahoma** | Open States scraper | blocked | — | weekly | 🟠 **gap** | bills 18.44% · actions 99.64% · sponsors 70.58% | LegiScan |
| OR | **Oregon** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| PA | **Pennsylvania** | Open States scraper | — | — | not scheduled | 🔴 **failed** | scrape failed after 143.5s: HTTPSConnectionPool(host=www.palegis.us, port=443): Max retries exceeded — [Errno 110] Connection timed out. Same shape as | LegiScan |
| RI | **Rhode Island** | Open States scraper | blocked | — | not scheduled | not yet run | — | LegiScan |
| SC | **South Carolina** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| SD | **South Dakota** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| TN | **Tennessee** | Open States scraper | blocked | — | weekly | 🟠 **gap** | bills 13.43% · actions 99.67% · sponsors 60.24% | LegiScan |
| TX | **Texas** | Open States scraper | — | — | weekly | 🟠 **gap** | bills 95.32% · actions 58.38% · sponsors 22.83% | LegiScan |
| US | **U.S. Congress** | native `govinfo` | ✔ verified | — | nightly | 🟠 **gap** | bills 99.77% · actions 2.6% · sponsors 87.95% | LegiScan |
| UT | **Utah** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| VA | **Virginia** | Open States scraper | blocked | `VIRGINIA_FTP_USER` / `VIRGINIA_FTP_PASSWORD` — **Brendan must obtain** | not scheduled | not yet run | — | LegiScan |
| VT | **Vermont** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| WA | **Washington** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |
| WI | **Wisconsin** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| WV | **West Virginia** | Open States scraper | — | — | not scheduled | not yet run | — | LegiScan |
| WY | **Wyoming** | feed (unused) | ✔ verified | — | not scheduled | not yet run | — | LegiScan |

## Credentials Brendan must obtain

Read out of `openstates-scrapers/docker-compose.yml`, not guessed. **Five jurisdictions need a credential
and one needs a database server** before "run it ourselves" is even possible:

- **New York** — `NYS_LEGISLATION_API_KEY` — free, we already hold it · sign-up: https://legislation.nysenate.gov/static/docs/html/index.html
- **Indiana** — `INDIANA_API_KEY` — **Brendan must obtain** · sign-up: https://docs.api.iga.in.gov/
- **District of Columbia** — `DC_API_KEY` — **Brendan must obtain** · sign-up: https://lims.dccouncil.gov/
- **Arkansas** — `AR_FTP_USER` / `AR_FTP_PASSWORD` — **Brendan must obtain** · sign-up: ftp://www.arkleg.state.ar.us/
- **Virginia** — `VIRGINIA_FTP_USER` / `VIRGINIA_FTP_PASSWORD` — **Brendan must obtain** · sign-up: https://lis.virginia.gov/SiteInformation/csv.html
- **California** — no key, but a **MariaDB server inside the container** to load the 1.22 GB MySQL dump · sign-up: https://downloads.leginfo.legislature.ca.gov/

Plus one decision, not a credential: **Open States' bulk downloads are behind a login** (lane IN, 15:34) —
`openstates.org/data/session-csv/` redirects to `open.pluralpolicy.com` and says *"Please log in to access
download links."* The catalogue is public and current; the files are not. That is why this lane runs the
scrapers rather than mirroring their exports.

## Known gaps, stated rather than smoothed over

- **New York cannot reach parity on the Senate API alone.** The feed carries **819** Assembly roll calls
  against LegiScan's **7,129** — Assembly floor votes live on `nyassembly.gov`, not in the Senate's system.
  Closing it means one request per bill against a second host, which is exactly the cost the bulk endpoint
  avoids, so it wants its own budgeted job rather than being bolted onto the nightly.
- **govinfo carries ~1.5× the action rows LegiScan does**, because it publishes each action once per source
  system that recorded it ("House floor actions" *and* "Library of Congress" for the same vote). A
  count-identity test fails by construction; `reconcile.mjs` therefore also reports `date_set_pct`, the
  share of bills where the *set of dates something happened* is identical. The verdict still uses the strict
  measure so it stays comparable with lane IN's hand-run numbers.
- **Per-member federal roll calls are not fetched.** BILLSTATUS gives the roll number and the clerk's URL;
  the votes are one request each on `clerk.house.gov` and `senate.gov`. Those rows are stored with NULL
  tallies and a description saying where the detail is — a roll call with a fabricated zero tally would be
  worse than an absent one.
- **California's scraper needs a MariaDB server** in the container to load the state's 1.22 GB MySQL dump.
  It fails in 8.7 seconds without one. Verified today, not predicted.
- **Blocked politely, not worked around:** AZ, DC, ME, OK, RI, TN by `robots.txt`; IN, VA by repeated 429.
  Several of those are paths Open States' own scrapers fetch anyway. We do not.

## What the pipeline cannot reproduce

`followthemoney_eid` (**20,922** of our `"People"` rows) and `knowwho_pid` (18,502). Open States carries
neither, and our `ftm_total` / `ftm_in_state` / `ftm_out_of_state` columns hang off the first. Ballotpedia
(99.6%) and VoteSmart (75.6%) **are** independently reproducible from `openstates/people`, which is CC0.
**The money data is the sharpest single dependency on LegiScan we have.**
