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
