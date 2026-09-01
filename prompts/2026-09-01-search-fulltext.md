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
