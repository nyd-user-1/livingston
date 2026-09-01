# Lane R — Regulations.gov: audit for content and suitability

**Brendan, 2026-09-01 ~17:10Z:** *"both of these will need to be audited for
both content and suitability. But I would expect a full accounting in each
instance."* This lane is **discovery only** — no tables, no pipeline, no
pages. Its deliverable is a decision-ready accounting, in the shape of
`prompts/2026-09-01-congress-api.md` §1, that Brendan can approve a harvest
from. If you find yourself building, stop.

**Source:** https://api.regulations.gov/v4 — dockets, documents (proposed
rules, final rules, notices, supporting material), public comments; the
federal rulemaking record for every agency. Docs: https://open.gsa.gov/api/regulationsgov/.
**Key:** in `~/Code/livingston/.env.local` — the variable is currently spelt
`REGULSATIONS_API_KEY`; read `REGULATIONS_API_KEY` first and fall back to that
spelling, never commit either. Send `X-Api-Key` and a real `User-Agent`.
Rate limit: read it from the response headers and report it (api.data.gov
keys default to 1,000/hour; the number in the header is the truth).

## 0. Rules

1. Read-only against everything. Explicit-path commits of this file only.
2. Measure, don't assert: every count in the report comes from a request you
   made, with the query that produced it.
3. Stay under a quarter of the hourly limit; back off on 429.
4. Same reporting protocol as the other lanes: `HEARTBEAT` every 45 min,
   `FLAG:` for rulings, one `LANE R STATUS: COMPLETE | STOPPED — <why>` at the end.

## 1. The accounting — what is there

For each of `dockets`, `documents`, `comments`: total count; count posted in
2026, in the last 90 days, in the last 7 days (freshness); the full attribute
list of one record with detail (`/documents/{id}`, `/dockets/{id}`,
`/comments/{id}`) including which attributes are only on detail; the
`documentType` breakdown for 2026 (Proposed Rule, Rule, Notice, Supporting &
Related Material, Other); the top 20 agencies by 2026 documents; whether full
text is reachable (the `fileFormats` attachments — sizes, types, whether they
need a separate key) and whether Federal Register citations (`frDocNum`,
`cfrPart`, `rin`) are present so a document can be tied to a statute or a
bill; comment counts on the five most-commented open dockets of 2026, with
the comment `openForComment`/`commentEndDate` fields.

## 2. The accounting — suitability for govblock

Answer, with evidence: which of our surfaces this could feed (a rulemaking
docket page; a "Rules" desk in the newsroom; a bill page's "Regulations
implementing this law" section via RIN/CFR/statute citations; a member page's
comment activity is *not* a thing — say so if it isn't); what joins exist to
what we hold (agency ↔ committee jurisdiction? law ↔ docket via `frDocNum`/
public law citations in the docket abstract?); what the data licence and terms
allow (api.data.gov terms; bulk download availability at
https://www.regulations.gov/bulkdownload); harvest cost — requests and hours
for (a) 2026's documents with detail, (b) all open dockets, (c) comments on
the top 50 dockets — against the measured limit; storage estimate in Aurora
at Lane A's Parquet ratios.

## 3. Recommendation

One table: family · rows available · rows worth holding · why · page it would
feed · cost · risk. Then a three-line recommendation: harvest now / harvest
later / do not harvest, per family. Brendan decides from that.

---

## Report — worker appends below this line
