# Lane J — make the jurisdiction switcher actually work

GovBlock now serves from AWS and the whole policy database is behind it: 52
jurisdictions, 2,129,003 bills, all of it in Aurora and reachable. The scope
control on the header is still a decoration. `lib/policy/jurisdiction.ts` is a
frozen constant — `{ state: "US", session: 2025 }` with `setState` and
`setSession` as no-ops — and `components/state-switcher.tsx` says so out loud:
*"Static for now — choosing a row closes the list and changes nothing."*

The job is to make choosing Texas show Texas.

Read `prompts/2026-09-01-aws-migration.md` first. It is the AWS/Aurora migration
report from the session immediately before this one, and §4 lists the traps that
will bite you.

---

## 0. Non-negotiables

1. **Two halves, and the second is the real one.** Wiring the scope is easy.
   Making the boards obey it is the job. Today every widget reads
   `lib/policy/snapshot.ts`, which answers from committed **Congress** fixtures
   no matter what is asked. Ship half 1 alone and the switcher becomes a control
   that changes a label and lies about the data. That is worse than a control
   that visibly does nothing.
2. **Never show one jurisdiction's rows under another's name.** If a resource
   cannot answer for the state in scope, return an empty result that names what
   was asked for. v3 already reasons this way — see `NY_ONLY` in its
   `queries.ts:1133`.
3. **`/api/health` must stay green and the build must stay clean.** After every
   deploy, check for silent snapshot fallbacks (§5). The failure mode on this
   stack is a page that returns 200 and looks perfect while reading fixtures.
4. **Do not break the prerender.** Pages must still build with no secrets
   present; the committed snapshots exist for exactly that.
5. **Do not touch** the Amplify app config, the Aurora cluster, the EventBridge
   schedule, or worker-2. They are correct. If you think one is wrong, report it,
   do not change it.
6. Commit by explicit path. Push to `main` — Amplify auto-builds on push.

## 1. The reference implementation already exists

`~/Code/livingston-v3/apps/v4` solved all of this against the **same schema**.
Port it; do not reinvent it.

| what you need | where it is in v3 |
|---|---|
| the whole scope model | `lib/policy/jurisdiction.tsx` |
| URL read/write helpers | `lib/policy/url-state.ts` |
| every query, ~46 KB of it | `lib/policy/queries.ts` |
| one route serving all resources | `app/api/policy/[resource]/route.ts` |
| FEC | `app/api/fec/candidates`, `app/api/fec/manifest` |

govblock already has `isJurisdiction`, `STATE_CODES`, `STATE_NAMES`,
`stateName`, `readFilters`, `policyUrl` and `scopedFilters` in `lib/filters.ts`,
and `getStateCounts` in `lib/policy/states.ts` already queries every
jurisdiction's latest session and bill count. The picker's data source exists.

## 2. Half 1 — the scope becomes real

Port `url-state.ts`, then replace `lib/policy/jurisdiction.ts` with v3's
`jurisdiction.tsx`. Keep its shape exactly: URL is the source of truth
(`?state=TX&session=2025`), localStorage remembers the last choice, and
`resolved` stays false until the scope is genuinely known.

**`resolved` is not optional and not cosmetic.** The prerendered HTML is shared
by every visitor, so before hydration nothing may claim a jurisdiction — `/` and
`/?state=TX` are the same bytes. Controls render neutral and data requests hold
until `resolved` is true. Skip this and you get hydration mismatches and a Texas
visitor issuing a Congress request on every cold load.

Then mount `JurisdictionProvider` in the app layout and wire
`state-switcher.tsx`'s `onSelect` to `setState`. Delete the "Static for now"
comment when it stops being true.

**Ruling — the default jurisdiction is `US`, not v3's `NY`.** Change
`DEFAULT_STATE` in `lib/filters.ts`. Every committed snapshot in `lib/data` is
Congress (`newsroom-us.json`, `members-us.json`, `sessions-us.json`), so US is
the only default under which the offline fallback stays truthful.

The 14 components already consuming `useJurisdiction()` should need no changes —
that is the test of whether the port kept the interface.

## 3. Half 2 — the data obeys the scope

### 3.1 Give `db.ts` a positional-parameter interface

v3's queries are written as `q("select ... where state = $1", [state])`.
govblock's `lib/policy/db.ts` exposes a tagged template. Rather than rewrite
46 KB of working SQL, **add `q()` and `one()` to `db.ts`** alongside `sql`,
speaking v3's exact signature over the Data API. The Data API uses named
parameters, so `q` rewrites `$1 → :p0` before dispatching and reuses the
existing `parameter()` and `decode()` helpers.

Watch the rewrite: `$10` must not be mangled into `:p0` + `0`, and a `$1`
inside a string literal must be left alone.

### 3.2 Port the resources the boards actually ask for

`snapshot.ts` names the exact surface — that list *is* the spec:

`states · sessions · options · subjects · bills · bill · committees · members ·
rollcalls · hearings · texts · text`, plus `/api/fec/manifest` and
`/api/fec/candidates`.

Port those from v3's `queries.ts` into govblock's `lib/policy/queries.ts`, and
add `app/api/policy/[resource]/route.ts` as v3 has it. Keep v3's cache header —
`public, s-maxage=1800, stale-while-revalidate=86400`. It matters for cost as
well as speed: CloudFront then caches per state, so 52 jurisdictions cost ~52
Aurora reads per half hour rather than one per visitor.

Leave the rest of v3's 31 resources alone until something asks for them.

### 3.3 Repoint the hook

`lib/policy/use-policy.ts`'s `useSnapshot` currently resolves fixtures in an
effect. Make it fetch the URL it already builds. Keep the `keepPreviousData`
behaviour and the `isLoading` shape — the calendar clears its store on mount and
expects rows to arrive after.

On a failed fetch, fall back to `resolve()` from `snapshot.ts` **only when the
scope is `US`**. Under any other jurisdiction a failure must surface as empty,
per §0.2.

### 3.4 The Data API will bite you here

v3's queries were written against Neon over a socket, with none of these limits.
All three are real and all three cost me time tonight:

- **1 MB per result, hard.** The unscoped stream blew through it. Anything
  unbounded across 52 jurisdictions, or any full bill text, must be batched or
  capped. See `getStream` and `getBillTexts` in govblock for the pattern.
- **`INTERVAL` cannot be returned at all** — the call errors outright. v3's SQL
  uses `now() - interval '...'` freely. Inside a `where` clause that is fine;
  returning one as a column is not. Cast it or compute it as text.
- **JS integers bind as `bigint`.** `left(text, $1)` becomes
  `left(text, bigint)`, which is not a function Postgres has. Cast at the call
  site: `$1::int`.

## 4. Sequence

Land it in this order so `main` is deployable at every step:

1. `q()`/`one()` in `db.ts`, with a test against one ported query.
2. `/api/policy/[resource]` serving `sessions` and `states` only.
3. `url-state.ts` + `jurisdiction.tsx` + provider + switcher — half 1 now works
   end to end for the header and the session picker.
4. The remaining resources, then repoint `use-policy`.
5. Sweep the 14 consumers for anything that assumed a constant scope.

## 5. Acceptance — this is the job, not a formality

Report the actual output of each, not an assertion that you ran it.

```bash
BASE=https://main.d2a69zdzqun8m7.amplifyapp.com

# 1. The data path is live, not snapshots
curl -s "$BASE/api/health"                    # want ok:true, aurora-data-api

# 2. Different jurisdictions return different data
curl -s "$BASE/api/policy/committees?state=TX" | head -c 300
curl -s "$BASE/api/policy/committees?state=NY" | head -c 300
curl -s "$BASE/api/policy/sessions?state=TX"   # Texas sessions, not Congress

# 3. A scoped page differs from the default one
curl -s "$BASE/docs/committees?state=TX" | grep -c "Texas"

# 4. No silent fallback in the build
aws amplify get-job --app-id d2a69zdzqun8m7 --branch-name main --job-id <n> \
  --query 'job.steps[?stepName==`BUILD`].logUrl' --output text | xargs curl -s \
  | grep -icE "database unavailable|CredentialsProviderError|size limit"   # want 0
```

Then, by hand in a browser, because these are the ones curl cannot show you:

- Choosing Texas in the switcher changes the URL, the boards, **and** survives a
  reload.
- A cold load of `/?state=TX` never flashes Congress data.
- No hydration warning in the console.

## 6. Scope

**In:** the scope model, the API route, the ported queries, the hook, the
switcher, and the consumers that break.

**Out, unless it blocks you:** the `/create` designer, `/typeset`, `/blocks`,
new UI, restyling, and the other 19 v3 resources. If you find yourself
redesigning a component, stop and report instead.

---

## Report — worker appends below this line
