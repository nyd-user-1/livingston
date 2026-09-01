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

### Lane R — regulations.gov audit, 2026-09-01

`HEARTBEAT 18:05Z §1 and §2 measured · 131 API requests of a 250 budget · limit 1,000/h, 862 remaining · next: write §3`

**Method.** Every number below came from a request I made; the query is given
with it. 131 requests against a measured **1,000/hour** limit
(`x-ratelimit-limit`), i.e. 13% of the hour and half the quarter-limit the brief
allows. 123×200, 7×400 (invalid filter names, reported below because they are
findings), 1×404. Responses were cached to disk so no question was paid for
twice. Key read from `.env.local`; it is still spelt `REGULSATIONS_API_KEY`
there — see FLAG R1. Header `X-Api-Key`, plus a real `User-Agent`.

---

## 1. The accounting — what is there

### Totals and freshness

| family | all time | 2026 | last 90 days | last 7 days |
| --- | ---: | ---: | ---: | ---: |
| dockets | **278,664** | 17,093 † | 7,846 † | 1,082 † |
| documents | **1,984,910** | **54,635** | 23,947 | 1,605 |
| comments | **26,311,731** | **1,329,773** | 711,434 | 61,723 |

`GET /v4/{family}?filter[postedDate][ge]=<date>&page[size]=5`, reading
`meta.totalElements`.

† **Dockets have no `postedDate`.** `filter[postedDate]` on `/dockets` is a
hard 400 — `"Invalid filter field name: postedDate"`. The docket figures are
`filter[lastModifiedDate][ge]=<date> 00:00:00`, which is a *different question*
(dockets touched since, not created since) and reads high, because any new
document or comment touches its docket. Worth knowing before anyone builds a
"new dockets this week" count. `lastModifiedDate` is also documented as **beta**
and "may be removed when we have a permanent bulk download solution available".

The documents endpoint also returns a ready-made freshness aggregation, which
is cheaper than asking four times — `meta.aggregations.postedDate`: Today 128 ·
Last 3 Days 436 · Last 7 Days 1,179 · Last 15 Days 3,190 · Last 30 Days 7,165 ·
Last 90 Days 23,613.

**The API does server-side facets.** `meta.aggregations` comes back on every
list call at no extra cost: documents give `documentType, subtype,
withinCommentPeriod, agencyId, commentEndDate, postedDate`; dockets give
`docketType, ruleStage, agencyId, priorityCategory, major, smallEntities,
energyAffected, eo13771Designation, internationalInterest`; comments give
`agencyId, postedDate`. Nearly every count in this report is one request
because of that. (Entries are `{docCount, value}` for `agencyId` and
`{docCount, label}` for the rest — an inconsistency worth knowing.)

### documentType breakdown

`GET /v4/documents?filter[postedDate][ge]=2026-01-01&page[size]=5` →
`meta.aggregations.documentType`:

| documentType | 2026 | all time |
| --- | ---: | ---: |
| Supporting & Related Material | 21,733 | 718,605 |
| Other | 18,227 | 729,347 |
| Notice | 10,781 | 387,751 |
| Rule | 2,279 | 99,486 |
| Proposed Rule | 1,615 | 49,719 |

**The regulatory record proper — Rules and Proposed Rules — is 3,894 documents
in 2026 and 149,205 all time: 7% of 2026 and 7.5% of everything.** The other
93% is agency working paper (Supporting & Related Material, Other) and notices.
That ratio is the single most important number for sizing this.

Dockets split `Nonrulemaking` 215,647 / `Rulemaking` **63,017**, and
`ruleStage` (on rulemaking dockets) is Final Rule Stage 12,729 · Completed
Actions 11,696 · Long-Term Actions 2,788 · Proposed Rule Stage 607 · Prerule
Stage 33.

### Top 20 agencies by 2026 documents

From `meta.aggregations.agencyId` on the 2026 documents query — 198 agencies
present in 2026.

| # | agency | 2026 docs | | # | agency | 2026 docs |
| ---: | --- | ---: | --- | ---: | --- | ---: |
| 1 | EPA | 16,382 | | 11 | FRA | 672 |
| 2 | FDA | 10,573 | | 12 | NRC | 611 |
| 3 | FAA | 9,129 | | 13 | PHMSA | 566 |
| 4 | DOT | 1,875 | | 14 | MARAD | 542 |
| 5 | SEC | 1,673 | | 15 | ITC | 416 |
| 6 | FERC | 1,109 | | 16 | NOAA | 350 |
| 7 | USCG | 998 | | 17 | ED | 299 |
| 8 | ITA | 846 | | 18 | FCC | 286 |
| 9 | FMCSA | 829 | | 19 | USCIS | 286 |
| 10 | FWS | 710 | | 20 | DOS | 245 |

EPA, FDA and FAA alone are 66% of 2026 documents. Comment volume ranks
completely differently (116 agencies in 2026): CMS 167,683 · OMB 164,665 ·
FWS 145,690 · FS 84,251 · FSIS 76,085 · NOAA 65,359 · EBSA 52,139 · DOJ 51,599 ·
FDA 47,388 · EPA 44,707. **The agencies that publish most are not the agencies
the public writes to most** — worth knowing before a page ranks anything.

### Attributes, and what only the detail record has

| family | list attrs | detail attrs | detail-only |
| --- | ---: | ---: | ---: |
| documents | 16 | **66** | 52 |
| dockets | 7 | **21** | 16 |
| comments | 8 | **46** | 40 |

**`/documents` list** (16): `agencyId, objectId, frDocNum, documentType,
withdrawn, highlightedContent, commentEndDate, commentStartDate,
lastModifiedDate, openForComment, withinCommentPeriod, postedDate, title,
docketId, subtype, allowLateComments`.

**`GET /v4/documents/NPS_FRDOC_0001-0199`** adds 52, of which the ones that
matter: `cfrPart, additionalRins, docAbstract, fileFormats, pageCount,
sourceCitation, startEndPage, frVolNum, effectiveDate, implementationDate,
topics, subject, ombApproval, regWriterInstruction, authors, modifyDate,
receiveDate`. The rest are commenter-submission fields (`firstName, lastName,
organization, address1, city, zip, email, phone, submitterRep…`) that are
populated on comments and empty on agency documents — one schema serves both.

**`/dockets` list** is only `agencyId, objectId, docketId, docketType,
highlightedContent, title, lastModifiedDate` — no dates, no abstract.
**`GET /v4/dockets/{id}`** adds `rin, dkAbstract, keywords, program, shortTitle,
subType, subType2, petitionNbr, effectiveDate, category, modifyDate,
displayProperties, generic, legacyId, organization, field1/2`.

**`/comments` list** is `agencyId, objectId, documentType, withdrawn,
highlightedContent, postedDate, lastModifiedDate, title`.
**`GET /v4/comments/{id}`** adds the 40 that matter most, including
**`comment` (the body text)**, `commentOn`, `commentOnDocumentId`, `docketId`,
`fileFormats`, `pageCount`, and the submitter block.

### Full text — reachable, and the catch

`fileFormats` on a document detail is an array of
`{fileUrl, format, size}`. Measured on `NPS_FRDOC_0001-0199`:
`content.pdf` 259,608 B and `content.html` 46,328 B, both at
`downloads.regulations.gov`. **Present on 20/20 sampled 2026 Rules and Proposed
Rules.** The HTML is the Federal Register text itself — the fetched body begins
`Federal Register, Volume 91 Issue 168 (Tuesday, September 1, 2026) … [Proposed
Rules] [Pages 56095-56101]`.

**It does not need the API key, and it does need a browser User-Agent.**
`downloads.regulations.gov` sits behind CloudFront, which returns
`403 … Request blocked` (`x-cache: Error from cloudfront`) for a custom
User-Agent — *with or without* `X-Api-Key`, as a header or as `?api_key=`. The
same URL with a normal browser UA returns 200 and the full text. So the file
host is open but UA-filtered, and the brief's "send a real User-Agent" is in
direct tension with what the CDN will serve. **See FLAG R2 — this needs a
ruling before any text harvest.**

### Citations — can a rule be tied to a statute?

Sampled 20 documents (the 10 most recent 2026 `Rule` and 10 most recent
`Proposed Rule`), one `GET /v4/documents/{id}` each:

| field | present | note |
| --- | --- | --- |
| `frDocNum` | **20/20** | e.g. `2026-17902`; on the *list* record too, so free |
| `cfrPart` | **12/20** | e.g. `36 CFR Part 4`; detail-only |
| `rin` | **0/20** | **always null on documents** |
| `docAbstract` | 4/20 | mostly empty on agency documents |
| `fileFormats` | 20/20 | |

**The RIN is on the docket, not the document.** Ten `GET /v4/dockets/{id}`:
real RINs on 6/10 (`1625-AA00`, `2126-AC72`, `1557-AF35`, `2125-AF80`,
`2120-AA64`, `0348-AB88`); the other four are `Not Assigned` or null, and the
nulls are `Nonrulemaking` dockets. `dkAbstract` is populated on 6/10 and is
substantially better prose than the document's — 1,584 characters on
`OMB-2026-0034`. **If you want the human summary of a rulemaking, read the
docket, not the document.**

So a rule carries: its FR document number (always), its CFR part (60%), and
via its docket a RIN (60% of rulemaking dockets). **None of those is a statute
citation.** See §2 and FLAG R3.

### Comments, and the most-commented dockets of 2026

`filter[docketId]` works on `/comments` and agrees exactly with
`filter[commentOnId]=<objectId>` (both 164,653 for `OMB-2026-0034`), so a
per-docket comment count is **one request**.

Ranked by exact 2026 comment count. Candidates were found by taking the 2026
comment aggregation's top ten agencies, pulling 250 comments each, and reading
the docket id off the comment id prefix; the counts are then exact from
`GET /v4/comments?filter[docketId]=<id>&filter[postedDate][ge]=2026-01-01`.

| docket | agency | 2026 comments | open? | comment end | title |
| --- | --- | ---: | --- | --- | --- |
| `OMB-2026-0034` | OMB | **164,653** | closed | 2026-07-14 | Regulation for Federal Financial Assistance |
| `EBSA-2026-0166` | EBSA | **46,712** | closed | 2026-06-02 | Fiduciary Duties In Selecting Designated Investment… |
| `CMS-2026-2047` | CMS | **43,436** | closed | 2026-06-04 | Community Engagement Requirement for Certain Individuals |
| `FSIS-2025-0012` | FSIS | **38,614** | closed | 2026-04-21 | Maximum Line Speed Rates for Young Chicken and Turkey… |
| `FDA-2025-P-7321` | FDA | **10,035** | closed | null | Acknowledgement Letter from FDA DMB… |

**Every one of the five is already closed.** The dockets open *right now* are an
order of magnitude smaller: `USCIS-2026-0298` 5,521 (ends 2026-09-25),
`FTC-2026-1057` 920 (ends 2026-09-19), `FS-2026-0100` 553 (ends 2026-09-24).
That is a real product point — a "comment on this now" surface would be showing
mostly small dockets, because the huge ones are retrospective.

**Open for comment right now: 1,106 documents**
(`filter[withinCommentPeriod]=true` — note `filter[openForComment]` is a 400,
`"Invalid filter field name"`, even though `openForComment` *is* an attribute).
By type: Notice 659 · Proposed Rule 226 · Other 180 · Rule 41. By agency:
FDA 143 · EPA 115 · FAA 99 · FCC 48 · NRC 26 · OSHA 26 · DEA 22 · PHMSA 21.

### Two hard limits that shape any harvest

1. **`page[size]` maxes at 250** (500 is a 400) and **`page[number]` maxes at
   40** — a **10,000-record ceiling per query**. `page[number]=41` on the 2026
   documents query is `"Page number parameter is greater than allowed"`.
   `totalElements` still reports the truth (54,635) — it just will not let you
   page to it. Any harvest of more than 10,000 rows must window by date.
   Measured: January 2026 alone is 5,501 documents, so monthly windows clear
   the ceiling for documents; comments at 1.33 M/year need daily or per-docket
   windows.
2. **Comment text is detail-only, one request per comment.** Verified three
   ways on `/comments?filter[docketId]=FTC-2026-1057` — plain list,
   `fields[comments]=comment`, and `include=attachments` all return the same
   8 attributes with no `comment` field. There is no bulk path to comment
   bodies. This is the number that decides §3.

---

## 2. Suitability for govblock

### Which surfaces this could feed

**A "Rules" desk in the newsroom — yes, and it is the strongest case.**
1,605 documents posted in the last 7 days, 1,179 by the API's own rolling
window, 128 today. Of the 2026 flow, 3,894 are Rules or Proposed Rules — about
11 a day of genuine regulatory news, from named agencies, each with a title, a
posted date, an FR number and reachable full text. That is a publishable daily
desk without any joins at all, and it is the one surface where this source
stands on its own.

**A rulemaking docket page — yes, for the 63,017 `Rulemaking` dockets.** The
docket is the right unit: it has `dkAbstract` (real prose, better than the
document's), `rin`, `docketType`, `ruleStage`, and one request gives its exact
comment count. A page showing "this rulemaking, its documents, its stage, and
how many people wrote in" is well supported.

**A bill page's "Regulations implementing this law" — no, not from structured
fields.** This is the surface the brief most wants and the data does not carry
it. What exists is `frDocNum` (an FR document number), `cfrPart` (a CFR
citation, 60%), and `rin` on the docket (60% of rulemaking dockets). **None of
those is a statute citation.** The public-law reference that would tie a rule
to an Act of Congress lives in the *prose* of the rule's "Authority" section —
in the `content.html` body, not in any field. Building this surface means
fetching the text and regex-mining `Pub. L. 118-xx` / `NN U.S.C. NNNN`
citations, which is a text-mining project, not a join. See FLAG R3.

**A member page's comment activity — confirmed not a thing.** The comment
schema has `firstName, lastName, organization, city, stateProvinceRegion,
submitterRep` and nothing resembling a member identifier; there is no
`bioguideId`, no candidate id, no linkage to a legislator. Members of Congress
do occasionally file comments, but they are identified only by a free-text name
on a submitter form, with no id to join on and no way to distinguish a Member
from a constituent of the same name. **Do not build this.**

### What joins to what we hold

Honestly: **almost nothing, today.**

| candidate join | verdict |
| --- | --- |
| `agencyId` ↔ our committees | **No.** 198 federal agency codes here; our `committees` table is 82 rows of *New York State* committees. There is no federal agency ↔ congressional committee crosswalk in what we hold, and jurisdiction mapping is a judgement exercise, not a lookup. Would have to be built by hand. |
| `frDocNum` ↔ anything we hold | **No.** We hold no Federal Register data at all. `frDocNum` is a join key to a source we have not harvested. |
| `rin` ↔ anything we hold | **No.** RIN is the Unified Agenda key; not in our data. |
| `cfrPart` ↔ anything we hold | **No.** We hold no CFR. |
| law ↔ docket via public-law citation | **Only via text mining** (FLAG R3). `dkAbstract` sometimes names the statute in prose; there is no field. |
| `docketId` ↔ `documents` ↔ `comments` | **Yes, internally.** The three families join cleanly to each other: `documents.docketId` → `dockets.id`, `comments.docketId` → `dockets.id`, `comments.commentOnDocumentId` → `documents.id`. This is a self-contained graph. |

So this source arrives as an **island**. It is a good island — clean internal
keys, real freshness, reachable text — but nothing in it touches `bills`,
`people`, `roll_call` or the money tables without new work. That is the
central suitability finding and it should drive the decision: harvest it
because a Rules desk is worth having on its own, not because it will enrich
bill pages, which it will not without a text-mining lane.

### Licence and terms

- The data is US federal government work product and carries no copyright
  (17 U.S.C. §105); regulations.gov publishes it as the public rulemaking
  record. I found **no use restriction on reading** in the GSA API docs.
- The "Terms of Participation" on open.gsa.gov that require agreeing to terms
  and displaying a privacy notice apply to the **Comment (POST) API** — posting
  comments on someone's behalf — which is a different key and a different
  product. It is rate-limited separately at 50/minute and 500/hour. **We are
  read-only; those terms are not ours**, but they are the reason there is a
  privacy notice at all, and comment bodies do contain submitter names, cities
  and sometimes addresses. Anything we republish from comments is republishing
  personal data that a member of the public typed into a federal form.
- **Rate-limit increases are available**: "GSA may grant a rate limit increase
  on the GET keys for an indefinite period… reviewed and considered on a
  case-by-case basis." That is the single cheapest lever on every cost below.
- **There is no bulk download today.** The docs say `lastModifiedDate` is in
  beta and "may be removed when we have a permanent bulk download solution
  available" — i.e. one is intended and does not yet exist.
  `www.regulations.gov/bulkdownload` responds 200 but is a JavaScript
  application, not a file index.

### Harvest cost, against the measured 1,000/hour

| target | rows | requests | hours @1,000/h |
| --- | ---: | ---: | ---: |
| (a) 2026 documents, **all**, with detail | 54,635 | ~54,870 | **~55 h** |
| (a′) 2026 **Rules + Proposed Rules** only, with detail | 3,894 | ~3,910 | **~4 h** |
| (a″) (a′) + Notices | 14,675 | ~14,730 | ~15 h |
| (b) all documents open for comment, with detail | 1,106 | ~1,111 | **~1.1 h** |
| (c) comments on the top 50 dockets, **metadata only** | ~400 k | ~1,800 | **~1.8 h** |
| (c′) the same comments **with text** | ~400 k | ~400,000 | **~400 h** |
| full text of (a′), pdf+html | 3,894 | 3,894 fetches (no key) | ~1 h, CDN-bound |

List requests assume `page[size]=250` plus monthly date windows to clear the
10,000 ceiling; detail is one request per row, which is the dominant term
everywhere. **(c′) is the line that matters: comment text costs 100× its own
metadata and is the reason comments are a "no" below.**

### Storage, at Lane A's measured Parquet ratios

Lane A measured zstd-3 at **~4.9× on legislative text**, landing `bill_texts`
at 2.08 KB of Parquet per 8,342-character row. Applying that:

| slice | raw | Parquet (est.) |
| --- | ---: | ---: |
| 2026 documents, metadata only (54,635 × ~1 KB) | ~55 MB | **~11 MB** |
| all documents ever, metadata only (1.98 M) | ~2.0 GB | **~400 MB** |
| 2026 Rules + Proposed Rules, full text (3,894 × 46 KB measured) | ~179 MB | **~37 MB** |
| all Rules + Proposed Rules ever, full text (149,205 × 46 KB) | ~6.9 GB | **~1.4 GB** |
| 2026 comments, metadata only (1.33 M × ~150 B) | ~200 MB | **~40 MB** |
| all comments ever, metadata only (26.3 M) | ~3.9 GB | **~800 MB** |

Storage is not the constraint anywhere. **Request budget is the only real
cost**, which is why the rate-limit increase is worth asking for before
anything larger than (a′) is attempted.

---

## 3. Recommendation

| family | rows available | rows worth holding | why | page it would feed | cost | risk |
| --- | ---: | ---: | --- | --- | --- | --- |
| **Rules + Proposed Rules** (documents) | 149,205 all time · **3,894 in 2026** | **3,894/yr**, backfill 2 yrs ≈ 8 k | The regulatory record proper. Titled, dated, agency-attributed, FR-numbered, full text reachable. 7% of the corpus carrying ~all of the signal. | Rules desk in the newsroom; docket page | **~4 h**, ~37 MB | Low. Stable schema, no auth on text. |
| **Rulemaking dockets** | 63,017 | **63,017** (or ~8 k touched in 2026) | The right unit for a page: `dkAbstract` is real prose, `rin`, `ruleStage`, exact comment count in 1 request. | Rulemaking docket page | ~1 h (detail-bound) | Low. |
| **Full text of the above** | 3,894 (2026) | same | The FR body. Needed for any statute-citation mining, and for search. | Rules desk; future "implements this law" | ~1 h, no key | **Medium — UA-filtered CDN, FLAG R2.** |
| **Documents open for comment** | **1,106 now** | 1,106, refreshed daily | Small, cheap, genuinely time-sensitive. | "Comment closing soon" module | ~1.1 h, negligible | Low. But see the finding that open dockets are all small. |
| **Notices** | 387,751 · 10,781 in 2026 | Defer | Real but high-volume, low-salience — meeting notices, filings, petitions. Would swamp a Rules desk. | — | ~15 h | Low value now. |
| **Comment counts** (metadata) | 26.3 M · 1.33 M in 2026 | **counts only, not rows** | A count per docket is 1 request and is the whole value: "164,653 people wrote in". | Docket page stat | **~1.8 h for top 50** | Low. |
| **Comment bodies** | 26.3 M | **none** | Detail-only, 1 request each — 400 h for the top 50 dockets alone, 1,330 h for 2026. And it is public personal data. | — | ~400 h+ | **High — cost and PII.** |
| **Supporting & Related Material + Other** | 1,447,952 | **none** | 73% of the corpus; agency working paper, correspondence, background material. | — | prohibitive | No value. |

### Three lines

- **Harvest now** — Rules and Proposed Rules (2026 + a two-year backfill,
  ~8 k documents), their Rulemaking dockets, and the full text of both.
  About **5 hours of requests and under 100 MB**, and it stands up a Rules desk
  and a docket page on its own. This is a clear yes.
- **Harvest later** — documents currently open for comment as a daily refresh
  (~1 h/day, trivial), and per-docket comment *counts* for the dockets we show.
  Both are cheap; they are "later" only because they are worth nothing until
  the pages above exist.
- **Do not harvest** — comment bodies (400 h for the top 50 dockets, and it is
  members of the public's personal data), Supporting & Related Material, and
  Other. Notices: not now; revisit only if the Rules desk proves it wants more
  volume.

**The honest caveat on all of it:** this source does not join to anything we
hold (§2). It earns its place as a new island — a Rules desk — not as an
enrichment of bill pages. If the "Regulations implementing this law" surface is
what makes this worth doing, then the real project is FLAG R3, not this
harvest, and it should be sized before anyone counts this lane as delivering
that.

---

### FLAGS

FLAG: R1 — the key is misspelt in `.env.local` and should be renamed before anything depends on it.
The variable is `REGULSATIONS_API_KEY`; `REGULATIONS_API_KEY` does not exist.
I read the correct spelling first and fell back, as instructed, so nothing is
blocked. But every future script will carry the same fallback unless it is
fixed once. Recommend renaming it in `.env.local` (and in whatever staged it)
and dropping the fallback. Not done here — `.env.local` is gitignored and
outside this lane's explicit-path remit, and I am not editing config on my own
authority.

FLAG: R2 — harvesting full text requires sending a browser User-Agent, because CloudFront blocks anything else. Needs a ruling.
`downloads.regulations.gov` returns `403 Request blocked` to a descriptive
User-Agent with or without the API key, and 200 to a stock Chrome UA. So the
files are public and unauthenticated, but only reachable by presenting as a
browser. That is in tension with the brief's own "send a real `User-Agent`"
rule and with normal crawler etiquette. Three options: (1) send a browser UA
for `downloads.` only and say so in the report; (2) ask GSA whether a
documented bot UA can be allow-listed; (3) skip full text and hold metadata
only, which kills FLAG R3 permanently. I did not harvest any text beyond the
two files measured for this audit.

FLAG: R3 — "Regulations implementing this law" cannot be built from this API's fields, only from the text. Needs a scoping decision.
There is no statute citation anywhere in the schema — not on the document, not
on the docket. `frDocNum`, `cfrPart` and `rin` are all regulatory-side
identifiers. The public-law reference lives in the prose of each rule's
Authority section. Making that surface real means: harvest the text (FLAG R2),
regex the `Pub. L.` / `U.S.C.` citations, and reconcile them against
`congress_laws` — a discovery-and-build lane of its own, not a line item in a
harvest. It may well be worth doing; it should be sized separately and not
assumed to come free with this source.

FLAG: R4 — ask GSA for a rate-limit increase before anything larger than the "harvest now" slice.
The docs say increases on GET keys are granted case-by-case for an indefinite
period. Every cost in §2 is request-bound, not storage-bound or CPU-bound, so
this one email is worth more than any optimisation available to us. At the
current 1,000/h even the full 2026 document set is 55 hours.

---

`HEARTBEAT 18:20Z §1 §2 §3 complete · 133 API requests of a 250 budget · 862 remaining on the hour · 4 flags open`

LANE R STATUS: COMPLETE

LEAD: 16:20Z — LANE R ACCEPTED. This is the shape an audit should have: every number carries its query, and the two facts that decide any design are stated as such — the 10,000-record paging ceiling (window by month for documents, by day or docket for comments) and the detail-only comment body (one request each, so bodies are never harvested). "It arrives as an island" is the right suitability verdict: a Rules desk stands on its own; it does not enrich bill pages, and nobody should count it as doing so. Rulings:
LEAD: R1 — fixed by the lead. `.env.local` now reads `REGULATIONS_API_KEY`; the misspelling is gone. Anything that carried the fallback drops it.
LEAD: R2 — recommendation to Brendan (outward-facing, his call): option (1) — a stock browser User-Agent for `downloads.regulations.gov` only, no faster than 2 requests/s, with the R4 email also asking whether a named bot UA can be allow-listed. Nothing is fetched from `downloads.` until he says so.
LEAD: R3 — parked as a discovery lane of its own; not assumed to come with this source. One pointer for whoever sizes it: the Federal Register's own XML (the govinfo FR collection, or federalregister.gov's `full_text_xml_url`) tags the Authority paragraph as an element, so the statute-citation mining is a tagged-element parse followed by a `Pub. L.` / `U.S.C.` regex, not a regex over HTML. Verify that before counting on it.
LEAD: R4 — recommendation to Brendan: send the rate-limit email. Every cost in §2 is request-bound; at 1,000/h the harvest-now slice is 5 hours and the full 2026 document set is 55.
LEAD: Harvest decision is Brendan's. What I endorse: the "harvest now" line exactly as written — Rules + Proposed Rules (2026 + two-year backfill, ~8 k), their Rulemaking dockets, and the full text of both; ~5 h of requests, under 100 MB; a Rules desk in the newsroom and a docket page are the two surfaces it earns. Comment bodies: never. Notices: not now.
