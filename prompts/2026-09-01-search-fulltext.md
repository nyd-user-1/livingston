# Lane S — search: full text, and every jurisdiction

**Brendan, 2026-09-01:** *"take the necessary measures to provide an optimized
search experience across jurisdictions, sessions, entities, topics, docs,
text"* — and on review: *"I asked for search across all jurisdictions, bills,
committees, etc, etc."* This lane makes that whole sentence true.

**What exists** (built by the lead, govblock commits `4dfbb25` → the flags
commit; read them first): `/api/policy/search` — `searchAll` in
`apps/web/lib/policy/db-queries.ts` — answers the ⌘K menu and `/search` on
https://policy.nysgpt.com. Members already search across all jurisdictions
(22,260 rows, current scope sorts first, FlagChip per row). Bills and
committees are still scoped to the active `(state, session)` because 2.1 M
`"Bills"` rows have no text index of any kind: **pg_trgm and any tsvector are
both absent** (extensions installed today: plpgsql, pgcrypto, uuid-ossp,
vector). Everything is metadata; nothing searches the bill text itself.

## 0. Rules

1. **Files you own, and nothing else:** `apps/web/lib/policy/db-queries.ts`
   (`searchAll` only), `apps/web/app/api/policy/[resource]/route.ts` (the
   `search` case only), `apps/web/app/search/page.tsx`, and new scripts under
   `scripts/search/` in govblock. `components/command-menu.tsx` is NOT yours —
   the menu stays metadata-fast; the lead owns it. Other lanes have in-flight
   work elsewhere in both repos: explicit-path commits, `git status` before
   every commit, never `git add -A`.
2. The report lives in this file below the marker. `HEARTBEAT` every 45 min,
   `FLAG:` for rulings (keep going), one
   `LANE S STATUS: COMPLETE | PARTIAL | STOPPED — <why>` at the very end.
3. One change per commit; the Amplify build is the type-check (a local hook
   blocks tsc/lint by name). Verify on https://policy.nysgpt.com with
   Playwright at 1714 px — `curl` proves nothing on client-scoped pages, and
   the /blocks previews render in an iframe.
4. Measure before you build: every index gets a size and build-time estimate
   from a measured sample before it goes on the big table.

## 1. Indexes — the enabling work, on Aurora (cluster `aurora-2525`, db `policy`)

- `CREATE EXTENSION pg_trgm`.
- GIN trgm on `"Bills"(title)`, `"Bills"(bill_number)`, `"People"(name)`.
  Build one, measure size and time and the ACU spike, then decide the rest.
- Full text over `"BillTexts"` (read `lib/policy/texts.ts` first — one row per
  bill version, `bill_id`-indexed; NY texts need `cleanBillText`'s marker rule
  before they are worth indexing). Discover the true rowcount and byte size,
  then choose: a generated tsvector column + GIN, or an expression index.
  Report the cost either way before building.
- **TRAP:** the RDS Data API runs statements transactionally —
  `CREATE INDEX CONCURRENTLY` cannot run there. Build from box 2
  (13.218.239.11) over psql; the Aurora master secret rotates every 7 days, so
  run `scripts/box/refresh-aurora-env.sh` first (lane C's fix). A plain
  (non-CONCURRENTLY) build is acceptable if you measure the lock window and
  say so in the report.

## 2. The query

- Extend `searchAll` (and only it): bills and committees across
  jurisdictions — ranked current-scope-first, then everywhere, with a
  per-jurisdiction cap so Congress cannot drown Wyoming. Cross-jurisdiction
  rows come from each jurisdiction's **current session** (`latestSession`),
  not the archive. Keep the envelope's existing field names; changes are
  additive only (`bills[].state`, `committees[].state`, a new `texts[]` group
  with `ts_headline` snippets).
- **Name aliases.** "holmes" must find Eleanor Holmes Norton; our `"People"`
  row says only "Eleanor Norton" (LegiScan's name, role `Rep`). The
  congress.gov `member-detail` records carry the bioguide's full names — add
  an alias source (a small table keyed by `people_id`, or an `aliases` column)
  populated from what we already hold, and search name and aliases together.
  State legislators keep their LegiScan names until a source exists.
- The Data API caps any result at 1 MB — snippets, never bodies.

## 3. The surface

- `/search` gains a **Text** section: snippet with the match highlighted, the
  bill's number and jurisdiction flag, linking to `/docs/bills/[id]#text`.
  Sections stay in the existing order; Text goes after Bills.
- Latency budget, measured and reported: menu query ≤ 300 ms warm;
  `/search` with full text ≤ 1.5 s.

## 4. Report

What was built (indexes, sizes, build times, the ACU bill), what the queries
cost now (timed), what changed in `searchAll`'s envelope, screenshots of
`/search` showing a cross-jurisdiction result set and a Text section, and the
honest list of what still cannot be found (with why). Then the STATUS line.

---

## Report — worker appends below this line

### HEARTBEAT 1 — 16:47 ET · discovery

**The premise is half wrong, in our favour.** The prompt says "pg_trgm and any
tsvector are both absent." pg_trgm was absent. A tsvector was not:

```
 search_tsv | tsvector | generated always as
              (to_tsvector('english'::regconfig, left(coalesce(text,''), 1000000))) stored
Indexes:
    "billtexts_search_idx" gin (search_tsv)   -- 1895 MB, indisvalid = t
```

`"BillTexts"` has carried a stored, generated `search_tsv` and a **valid** GIN
index over it all along (migrated from Neon with the table). Full text over
bill bodies therefore costs **zero index build** — the enabling work §1 asked
for on the 36 GB table is already paid for. Measured, cold:

```
select bill_id from "BillTexts" where search_tsv @@ websearch_to_tsquery('english','climate resiliency') limit 20
  Bitmap Index Scan on billtexts_search_idx — 11,893 matching rows
  Execution Time: 64.6 ms   (planning 38.6 ms)
```

**FLAG (informational, not blocking):** §1's third bullet — "choose a generated
tsvector column + GIN, or an expression index; report the cost either way
before building" — is already answered by the database. I am not rebuilding it.
The one thing I will not get for free is the `left(..., 1000000)` truncation
baked into the generated column: bills longer than 1 M characters are indexed
through their first megabyte only. At `avg(chars) = 12,145` that bites a
handful of bills (`max(chars) = 11,429,601`), and I will name them in §4's
honest list rather than rebuild a 36 GB column to catch them.

**Measured volumes** (Aurora `aurora-2525`, db `policy`, 58 GB):

| table | rows | table | indexes |
|---|---|---|---|
| `"BillTexts"` | 3,486,788 (3,303,757 with text) | 36 GB | 2077 MB |
| `"Bills"` | 2,129,003 | 1519 MB | 244 MB |
| `"People"` | 22,723 | 6120 kB | 696 kB |

`sum(chars)` = 39 GB of bill text; `avg 12,145`, `max 11,429,601`.

**Trap found, worth more than the index:** `default_text_search_config` on this
cluster is `pg_catalog.simple`, but the generated column is built with
`'english'::regconfig`. Any query that writes `to_tsquery(q)` instead of
`to_tsquery('english', q)` gets a *simple*-parsed tsquery that will not match
the stemmed lexemes in the index — no error, just silently zero rows. Every
statement I write names `'english'`.

**pg_trgm: installed (1.6), and measured before it goes near the big table.**
Built on a materialised 5% sample of `"Bills"` (106,458 rows, `bill_id % 20 = 0`):

| index | sample size | sample build | ×20 projection |
|---|---|---|---|
| `gin (title gin_trgm_ops)` | 19 MB | 2.09 s | ~380 MB, ~40–90 s |
| `gin (bill_number gin_trgm_ops)` | 2064 kB | 0.15 s | ~41 MB, ~3 s |
| `gin ("People".name)` | — | — | 22,723 rows, ~5 MB, <1 s |

Sample dropped. `bill_number` carries no spaces in any row sampled, so the
existing space-squeeze on the *term* is all the normalisation a prefix match
needs.

**Aliases: no new source needed.** `"People"` already holds the missing token —
`people_id 9100` is `name='Eleanor Norton', first='Eleanor', middle='Holmes',
last='Norton'`. 9,334 rows carry a middle name and 2,294 a nickname. On top of
that, `congress_members` (553 rows, not `congress_member_detail` — that table
does not exist) carries the bioguide form `"Norton, Eleanor Holmes"` and joins
to `"People".bioguide_id` for 552 of 553. So the alias column is populated from
what we hold, exactly as §2 asks.

**Worst case that will shape the query:** `websearch_to_tsquery('english','health')`
matches ~979,526 rows. Unordered with a LIMIT the planner seq-scans and returns
in 8 ms; add an ORDER BY over that match set and it is a disaster. Every text
query I write is therefore bounded by scope *before* it is ranked.

Next: build the three trgm indexes on the real tables (lock window measured and
reported), then `searchAll`.

LEAD: 21:00Z — Heartbeat 1 read. The premise correction is accepted with thanks — the brief said no tsvector existed; the database knew better, and you measured rather than rebuilt. Rulings:
LEAD: FLAG (1 MB truncation) — accepted as-is. Do not rebuild a 36 GB generated column to index the tail of a handful of mega-bills; name them in §4's honest list with their sizes. If one of them ever matters, it is a one-off reindex of specific rows, not a schema change.
LEAD: The `'english'` vs `simple` config trap goes in the closing notes verbatim — "no error, just silently zero rows" is the kind of sentence that saves the next person a day. Consider a one-line code comment at the query site too, since the code outlives the report.
LEAD: trgm builds on the live tables — approved now. A plain CREATE INDEX takes a SHARE lock (reads continue, writes wait); the Aurora writers are lane C's nightly jobs (01:04 ET) and nothing writes mid-day, so a 40–90 s window this afternoon is free. Measure and report it as planned.
LEAD: Aliases from what we hold — `People.middle_name`/`nickname` plus the `congress_members` bioguide join (552/553) — is exactly right; no new harvest. Proceed to `searchAll`.

### HEARTBEAT 2 — 17:05 ET · indexes built, and the one that was not optional

Lead's rulings received and applied — the `'english'` trap is going in the code
as a comment as well as here, and the mega-bills will be named in §4.

**§1 built, all four `CONCURRENTLY`, so the SHARE lock the lead priced never
had to be taken at all** (measured on box 2, psql 17.11 → Aurora 17.10):

| index | projected | built | actual size | valid |
|---|---|---|---|---|
| `bills_number_trgm` gin(bill_number) | ~41 MB / ~3 s | **83 s** | 37 MB | t |
| `people_name_trgm` gin(name) | ~5 MB / <1 s | **4 s** | 1480 kB | t |
| `people_aliases_trgm` gin(aliases) | — | **0 s** | 5192 kB | t |
| `bills_title_trgm` gin(title) | ~380 MB / ~40–90 s | **64 s** | 305 MB | t |

Total wall 2 m 31 s, zero lock window. Sizes came in **under** the 5% sample's
projection (305 MB against 380 MB projected) — GIN's posting lists compress
better at scale than a twentieth of the table suggests.

**The 83 s on `bills_number_trgm` is a lie worth recording.** 73 of those 83
seconds were `wait_event = Virtualxid`: `CREATE INDEX CONCURRENTLY` waits for
every transaction older than itself to finish, and my own discovery query in
another psql window — a `sum(length(text))` over the 36 GB table — was one of
them. The index itself took ~10 s. **Before any CONCURRENTLY build on this
cluster, check `pg_stat_activity` for a long read and cancel it**, or you will
attribute someone else's scan to your index.

**Aliases populated** (`scripts/search/people-aliases.sql`, new, idempotent,
1.07 s for 21,727 of 22,723 rows):

```
 people_id |        name        | aliases
      9100 | Eleanor Norton     | Eleanor Holmes Norton | Norton | Norton Eleanor Holmes | …
     20052 | Gil Cisneros       | Gil Cisneros | Cisneros | Cisneros Gilbert Ray | Gilbert Ray Cisneros
     23173 | Pat Ryan           | Pat Ryan | Ryan | Ryan Pat | Ryan Patrick | Patrick Ryan
     20059 | Elizabeth Fletcher | Elizabeth Pannill Fletcher | … | Fletcher Lizzie | Lizzie Fletcher
```

No new harvest, as the lead ruled. 13 of the 552 bioguide joins add a token
`"People"` did not already hold (Gilbert, Jefferson, Patrick, Lizzie, Angie,
Thomas, Aumua Coleman…); the other 539 are confirmations. Forms are `' | '`
-delimited so a `%wildcard%` cannot bridge two of them.

**Then the query refused to be fast, and that is the real work of this lane.**

Cross-jurisdiction **bills** landed easily. The obvious shape — a `LATERAL` per
jurisdiction — is a trap: it rebuilds the *same* global trgm bitmap 52 times
(`loops=52` on `bills_title_trgm`, 101,801 rows each pass). One trgm pass plus
`row_number() over (partition by state)` is the same answer 50× cheaper:

| shape | "climate" | "health" |
|---|---|---|
| `LATERAL` per jurisdiction | 969 ms | 1396 ms |
| one pass + window | **18 ms** | **232 ms** |

Cross-jurisdiction **text** would not fall to the same trick:

```
narrow  ("climate resiliency") …………… 138 ms      ✓
common  ("health")             …………… 179,435 ms  ✗   (2 m 59 s)
```

`websearch_to_tsquery('english','health')` matches 979,526 rows. The GIN scan
finds them in 20 ms; fetching (state, session_id, bill_id) for each one off a
**36 GB heap** is the three minutes. No amount of re-shaping the SQL fixes it,
because the columns that would cut the set are not in the index.

**FLAG (proceeding, ruling welcome after the fact): I am building one more
index on the big table, and it is not one §1 listed.** Measured first, on a
5-state slice of the current sessions (142,180 docs) — and the sample says the
cut moves *inside* the index:

```
composite gin (state, session_id, search_tsv):
  Index Cond: state='TX' AND session_id=2025 AND search_tsv @@ 'health'
  bitmap → 5,798 rows, 1,651 heap blocks,  4.3 ms
plain gin (search_tsv) — today's index:
  Index Cond: search_tsv @@ 'health'
  bitmap → 46,302 rows, 40,504 removed by filter, 8,127 heap blocks, 15.2 ms
```

Sized on the NY current-session slice (46,765 docs, 198 MB of tsvector):
composite GIN **35 MB / 4.18 s**, against a plain GIN on the same slice of
35 MB / 4.02 s — *the state and session keys are free*, because they are
low-cardinality and GIN's posting lists swallow them. Extrapolated to all
3,486,788 docs: **~2 GB, ~5 min of index work plus the 36 GB heap scan** (twice,
for CONCURRENTLY). Building it full rather than partial so that a reader who
picks an *archive* session gets a fast text search too, and so there is no
`session_id >= 2025` predicate to rot. `btree_gin` installed (it is what lets a
scalar key sit in a GIN index next to a tsvector). Running now; the existing
`billtexts_search_idx` stays where it is — 1.9 GB on a 58 GB cluster is not
worth the risk of dropping an index other readers may plan against.

**Design decision the menu depends on:** `/api/policy/search` answers both the
⌘K menu (the lead's, must stay metadata-fast) and `/search`. So the new
`texts[]` group is gated behind `?text=1`, which only `/search` sends. The menu
pays nothing for full text.

Next: `searchAll`, then the surface, then timings on the live site.

LEAD: 21:55Z — Heartbeat 2 read. The composite gin(state, session_id, search_tsv) is APPROVED after the fact — that is what "measure before you build" is for: the 979k-row heap fetch was the disease, the 4.3 ms slice proof is the cure, and full-not-partial is right (archive sessions deserve fast text, and a year predicate would rot). Conditions, both cheap: (1) report indisvalid and the ACU spike when the build lands — a failed CONCURRENTLY leaves an INVALID index that silently serves nothing; (2) the old billtexts_search_idx stays for now as you chose, but the closing report names who, if anyone, still plans against it, so dropping 1.9 GB later is a decision with evidence. The Virtualxid lesson ("cancel the long read first, or you will attribute someone else's scan to your index") goes in the closing notes verbatim. The ?text=1 gate is exactly right — the menu stays metadata-fast and mine. Proceed: searchAll, surface, live timings.

### HEARTBEAT 3 — 17:20 ET · the query is written, built and pushed

Three commits on `govblock@main`, explicit paths only (another lane has
`apps/web/package.json`, `pnpm-lock.yaml` and `apps/web/lib/agents/` in flight;
none of them are in these commits):

- `75d8d0f` search: aliases, so "holmes" finds Eleanor Holmes Norton
- `a592f66` search: every jurisdiction, and the bill text itself
- `81c2211` search: /search shows a Text section, and every row wears its own flag

Amplify job 58 is building. The composite GIN is at 28% and will land after it.

**A sixth index, because the committee query asked for one.** Cross-jurisdiction
committees measured **1244 ms** — the planner was rebuilding a bitmap per
jurisdiction with nothing to cut against. `"Bills".committee` is `null_frac`
0.5552, `n_distinct` 1063, `avg_width` 20; a 5% sample took 2072 kB / 0.16 s, so
the ×20 projection was ~41 MB / ~4 s. Built plain (not CONCURRENTLY, because the
big build was already holding the CONCURRENTLY queue): **40 MB in 3 s**, a 3-second
SHARE lock on `"Bills"` at 17:33 ET, inside the window the lead priced. The
projection was accurate to 2.5%.

**`as materialized` is the finding of the afternoon.** With the index in place
the committee query was still 750 ms, because the planner *still* preferred to
join the 52-row session view first and re-derive the trgm bitmap per
jurisdiction (`loops=52`, 9.26 ms each = 481 ms of pure repetition). Forcing the
filter to run once:

```
                         inlined      as materialized
committees, "%health%"    1244 ms  →         38.8 ms
bills,      "%climate%"    969 ms  →           18 ms
```

Both queries now carry `as materialized` and a comment saying why, because the
next person to "simplify" that CTE will make it 30× slower and the plan will not
tell them.

**Measured, warm, against Aurora:**

| query | term | time |
|---|---|---|
| members (name + aliases, all jurisdictions) | `%holmes%` | **1.6 ms** |
| committees, all jurisdictions | `%health%` | **38.8 ms** |
| bills, all jurisdictions | `%climate%` | 18 ms (359 ms cold) |
| texts, all jurisdictions, **old index** | `climate resiliency` | 802 ms |

`%holmes%` returns 14 members and Eleanor Norton is one of them.

**Two bugs worth naming, both mine, both caught before they shipped:**

1. A SQL comment inside a JS template literal contained backticks. The template
   ended early and the file stopped parsing — no type-checker locally (the hook
   blocks `tsc` by name), so this would have been an Amplify failure. SQL
   comments in this file now use double quotes.
2. My *test harness* — not the module — replaced `${BODY}` with
   `String.replace`, and `BODY` ends in `$'`, which `String.replace` reads as
   "everything after the match". The generated SQL came out silently truncated
   and duplicated. The module interpolates rather than replaces and was never
   affected, but it is the exact shape of bug that produces a query that runs
   and answers wrongly. Every generated statement is now `PREPARE`d against
   Aurora before it is committed; all four prepare clean.

**Snippets.** `ts_headline` given no match inside its window returns the opening
of the document rather than nothing — which renders as a result and teaches the
reader nothing (`S9004` came back as `S T A T E O F N E W Y O R K`). 2,707 of the
444,220 current-session documents (0.61%) run past the 200 k-character window;
those rows are now dropped rather than shown unhighlighted. Delimiters are `«` `»`,
not HTML, so the page never renders markup that came out of the database.

Verification harness written: `scripts/search/verify-search.mjs`, Playwright at
1714 px, four cases (cross-jurisdiction text, the alias, the common term from a
small jurisdiction, a bill-number prefix), printing section counts, distinct
flag count and wall time per case.

### HEARTBEAT 4 — 17:22 ET · a correctness bug my own change would have shipped

Amplify job 58 **SUCCEED** — the type-check the brief points at is green on the
first three commits. Job 60 is building the fourth.

**The bug, and why it needed a fourth commit.** `/api/policy/search` answers both
`/search` and the ⌘K menu. I widened the envelope so `bills[]` and `committees[]`
can carry any jurisdiction — and then read `components/command-menu.tsx`, which
is not mine:

```tsx
onSelect={() => go(`/docs/bills/${bill.bill_id}?state=${state}`)}
<FlagChip state={state} width={20} />
```

`state` there is the *page's* scope, not the row's. Members already carry their
own (`member.state`) and render correctly; bills and committees do not. So my
change, shipped as written, would have put a New York flag on an Arizona bill
and linked it into New York — a wrong answer that looks like a right one.

Rule 0.1 says that file is the lead's, so I gated the behaviour rather than
reaching into it. `?all=1` sits alongside `?text=1`; only `/search` sends either.
Off, the cross-jurisdiction CTEs fold to a plan-time `One-Time Filter: false` and
the scan never runs, so the menu is not merely correct but **unchanged in cost**:

```
menu (all=0), warm:   bills "%health%"  76 ms      committees  25 ms
                      members "%holmes%" 1.6 ms    budget: 300 ms
```

**FLAG for the lead — a two-line change turns the menu national.** In
`components/command-menu.tsx`, take `state` from the row rather than the page:

```tsx
- onSelect={() => go(`/docs/bills/${bill.bill_id}?state=${state}`)}
- <FlagChip state={state} width={20} />
+ onSelect={() => go(`/docs/bills/${bill.bill_id}?state=${bill.state}`)}
+ <FlagChip state={bill.state} width={20} />
```

(and the same for `committee.state`; add `state: string` to both types in
`Results`). Then add `all: 1` to the menu's fetch. The envelope already carries
the field — the menu just has to read it. Until then the menu searches the
jurisdiction you are in, which is what its flag claims.

**Evidence the lead asked for: who plans against `billtexts_search_idx`.**
Nobody queries it. The only references in either repo are in
`livingston/api/bill-text.ts` — the ingestion-side schema-ensure that *created*
it (line 110, comment: *"The search lane's raw material"*) and a health check
that counts it by name (line 82). But dropping it is not free, and the trap is
worth more than the 1.9 GB:

```ts
if (have[0] && have[0].tsv === 1 && have[0].idx === 4 && …) return;
```

The ensure block short-circuits only when it finds **4** named indexes. Ingestion
still writes Neon, so today that check never looks at Aurora. The moment the
writers are repointed, an Aurora missing `billtexts_search_idx` fails the `idx
=== 4` test and the whole block re-runs — including a **non-concurrent**
`CREATE INDEX … USING GIN` over 36 GB, from every fleet process that starts. The
file's own comment records 338 sessions once queued behind exactly this kind of
schema no-op. **So: keep the index, or change that `4` to a `3` in the same
commit that drops it.** Not my file; reporting, not touching.

**Aurora's ACU bill for the whole afternoon**, from CloudWatch
(`ServerlessDatabaseCapacity`, 5-min periods):

```
idle, before any of this          0.5 ACU
discovery scans (15:46–16:06)     avg 11–25, max 32 (the cluster ceiling)
four trgm builds (16:52–16:56)    avg 13–17, max 32
composite GIN     (17:06– )       avg  7– 9, max 32
```

Every large read pins the 32-ACU ceiling briefly; the *average* over the 110
minutes from first discovery query to now is ≈10 ACU, so the afternoon's whole
index programme costs on the order of **$2**. Idle returns to 0.5.

**Two more measurements for the honest list.** A two-character query cannot use a
trigram index (trigrams need three characters) and falls back to a parallel
sequential scan of `"Bills"` — **312 ms** measured for `%hb%` across all current
sessions, inside budget, so the two-character floor in the UI stays. And the
gaps: 197,748 of 2,129,003 bills (9.3%) have never had text fetched, and 183,031
`"BillTexts"` rows carry a null `text` from a failed fetch. Neither is findable
by text, and §4 will say so.

Composite GIN at 42%.
