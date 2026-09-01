# Lane G — the GSA API catalog: triage, then audit for content and suitability

**Brendan, 2026-09-01:** *"Sadly or excitedly I have many, many more api's to
review: https://open.gsa.gov/api/."* Same standing order as lanes R and B:
*"audited for both content and suitability … a full accounting in each
instance."* This lane is **discovery only** — no tables, no pipeline, no
pages. If you find yourself building, stop.

**Source:** the GSA API Directory, https://open.gsa.gov/api/ — 33 APIs listed
on 2026-09-01. Lane R has already audited Regulations.gov
(`prompts/2026-09-01-regulations-audit.md`) — **read its report first**: it is
the shape, and its "Two hard limits" and "What joins to what we hold" sections
are the two every audit here must have.

**Keys.** `~/Code/livingston/.env.local` holds `REGULATIONS_API_KEY` (an
api.data.gov key) and `CONGRESS_API_KEY`. SAM.gov's own APIs take `api_key=`
minted at SAM.gov → Account Details → Public API Key — a different key we do
not have. Try the api.data.gov key first; if refused, measure what the
endpoint serves without a key, raise one `FLAG:` naming exactly which key
Brendan needs to mint and where, and move to the next API — do not stop the
lane for it. Never commit a key. Read the rate limit from the headers or docs
and report it: SAM.gov limits are **per day** and differ by role (federal /
non-federal / no key), and several SAM.gov APIs offer a daily **extract**
(`download-entities`, `download-exclusions`, the Contract Awards extract) that
is the harvest path when the search limit is small — evaluate the extract, not
just the search.

## 0. Rules

1. Read-only against everything. Explicit-path commits of this file only —
   `git status` first, never `git add -A`.
2. Measure, don't assert: every count in the report comes from a request you
   made, with the query that produced it.
3. Stay under a quarter of any limit; back off on 429. Per-day limits mean a
   budget, not a pace — spend it on the questions in §2, not on paging.
4. `HEARTBEAT` every 45 min, `FLAG:` for rulings (keep going), one
   `LANE G STATUS: COMPLETE | PARTIAL | STOPPED — <why>` at the very end.

## 1. Triage — all 33, one line each

One table: API · what it holds · relevance to govblock (a legislative / policy
/ money product: bills, votes, members, committees, laws, lobbying, FEC,
contracts, grants, across 51 jurisdictions) · audit / skip · why. Start from
the lead's cut below and correct it with evidence.

**Audit, in this order:**

1. **SAM.gov Assistance Listings** (`https://api.sam.gov/assistance-listings/v1/search`)
   — the federal grant and assistance programs (the old CFDA). Records carry an
   `authorizations` block with public-law / U.S.C. citations. That is the
   law→program join lane R found missing on the regulations side: "what this
   law funds" on a bill or law page. Highest value; start here. Count the
   programs whose authorizations carry a parseable `Pub. L.` or `U.S.C.`
   citation, and sample twenty against `congress_laws` on Aurora.
2. **SAM.gov Contract Awards** (`/contract-awards/v1/search`, FPDS-derived) +
   **Entity Management** (`/entity-information/v2/entities`) + **Exclusions**
   (`/entity-information/v4/exclusions`) — audit as one; they join on UEI.
   Contracts by vendor, agency and place of performance (a money surface, and
   a per-state cut for the 50 state jurisdictions); entity records carry NAICS,
   address and executive compensation for large recipients; exclusions are the
   debarred list. Ask specifically: do vendor names or UEIs reach our lobbying
   registrants or FEC committees, and how well — sample fifty.
3. **SAM.gov Federal Hierarchy Public** (`/prod/federalorganizations/v1/`) —
   the agency / sub-tier org tree. A reference table: it is what would make
   regulations.gov's `agencyId` and the contract agency codes joinable and
   nameable. Small; do it fully.
4. **SAM.gov Get Opportunities** and the two **Subaward Reporting** APIs —
   size only (counts, freshness, fields); recommend later / not.

**Skip, unless your triage finds otherwise (say so in the table):** Per Diem,
CALC, TMSS 2.0, Fleet Vehicles, Sustainable Facilities, Site Scanning,
Search.gov Results / Clicks, Touchpoints, IT Collect, Public Location Services,
api.data.gov Admin / Metrics, Acquisition Gateway, Data.gov CKAN (catalog
metadata only), Analytics.usa.gov (web traffic), FPDS API (superseded by
Contract Awards — confirm), Federal Hierarchy FOUO / Opportunity Management /
Subaward Bulk Upload / Subcontracting Plan Outbound (system accounts or
write-side), Product Service Codes (reference codes — note only).

## 2. Per audited API — the accounting

As lane R §1 and §2: totals; freshness (2026 / last 90 days / last 7 days);
one full record with detail-only fields marked; the breakdowns that matter
(assistance type and agency; award type, agency and state); whether documents
or text are reachable and on what terms; the two hard limits (paging ceiling;
detail-only fields); which govblock surface it feeds; what joins to what we
hold — be honest, "island" is an acceptable answer; licence and terms; harvest
cost in requests and hours against the measured limit and against the extract
path; storage at lane A's Parquet ratios.

## 3. Recommendation

Per audited API, one table: family · rows available · rows worth holding · why
· page it would feed · cost · risk; then harvest now / later / do not harvest.
End with one ranked list across everything audited. Brendan decides from that.

---

## Report — worker appends below this line
