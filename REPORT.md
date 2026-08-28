# livingston — build report

livingston is a stripped, rebranded copy of **cshl** (RxivGPT, `cshl.nysgpt.com`),
copied from `~/Code/cshl` on 2026-08-27. Nothing was rebuilt from scratch and
nothing was scraped from the deployed site.

---

## 1. What was copied

Copied verbatim from `~/Code/cshl`, then edited in place:

| Copied | Notes |
| --- | --- |
| `src/` | The whole app tree, minus the pages listed in §2 |
| `api/` | All serverless functions except `community.ts` |
| `public/logos/`, `public/robots.txt` | Model-picker logos are referenced by `src/lib/models.ts` |
| `index.html`, `vite.config.ts`, `vercel.json`, `tsconfig*.json`, `eslint.config.js` | Rewritten where noted below |
| `package.json`, `package-lock.json` | Renamed to `livingston`; five unused deps dropped |
| `.gitignore` | Plus a `!.env.example` negation |
| `.env.local` | Copied with identical values. Gitignored, never committed |

**Not copied:** `.git`, `node_modules`, `dist`, `.vercel`, `data/`, `docs/`,
`scripts/`, `sql/`, `supabase/`, `prompts/`, `.state`. `scripts/` and `sql/` are
the loaders and migrations — deliberately left behind so livingston has no mechanism to
write schema to the shared database (see §5).

`public/data/` (48 MB of NSR-era nuclear JSON) was also skipped: it was read only
by `GraphPage`, `CodePage`, and `lib/structure.ts`'s fetchers, all of which are
gone. `lib/structure.ts` survives only for the static `ELEMENTS` array that
`Search.tsx` imports.

### The framework, for orientation
Vite + React 19 SPA, `react-router-dom` with all routes declared in
`src/App.tsx`. Vercel functions in `api/` use the classic `(req, res)` signature.
Env vars are read via `process.env` in `api/*`; the frontend reads none except
`import.meta.env.DEV`. Sidebar lives in `src/components/Sidebar.tsx`.

---

## 2. What was stripped

**Pages and routes deleted:**

- Entire bioRxiv section — `/biorxiv`, `/biorxiv/{agents,papers,subjects}`
- medRxiv Agents and Subjects — `/medrxiv/{agents,subjects}`, plus the scoped
  agent chat `/medrxiv/agents/:category`
- `Announcing.tsx` (the "Announcing CSHL-CPT" promo), `Community.tsx`,
  `CodePage.tsx`, `GraphPage.tsx`, `Models.tsx`, `Resources.tsx`,
  `archive/AgentsPage.tsx`, `archive/SubjectsPage.tsx`, `templates/CardPage.tsx`
- `/references`, `/nsr`, `/preprints*` (the corpus-wide browser and NSR-era
  redirects — livingston's only browser is `/medrxiv/papers`)
- `api/community.ts`

**Dead code removed** (already unreachable in cshl, verified with a reachability
scan from `src/main.tsx`): `ChatDock.tsx`, `FlowSettings.tsx`,
`ResearchFeed/TrendingStrip.tsx`, `ui/{chart,drawer,sheet,card,input,tabs}.tsx`,
`icons/GitHubMark.tsx`, `types/endf.ts`, `src/assets/`,
`api/_lib/ensdf{,-render}.ts`.

**Sidebar:** bioRxiv group gone; medRxiv shows Papers only; the promo line is
gone; the wordmark is `livingston`.

**Deps dropped:** `@xyflow/react`, `@dagrejs/dagre`, `@radix-ui/react-tabs`,
`vaul`, `csv-parse` — all only used by deleted pages.

**Links repointed** so nothing dangles: `RecordCard`'s send-to-chat now goes to
`/` with the same `?prompt=&context=&url=` params instead of a subject agent;
`ChatResponseFooter`'s subject chip is a label rather than an agent link;
`FeedItem`'s destinations are `/medrxiv/papers`; `ChatInput` and `Features`
point at `/new-search`. `ScopeSwitcher` was deleted — with one archive and one
section there is nothing to switch between, so `References` renders a static
"medRxiv papers" label in its place.

A catch-all `<Route path="*">` redirects everything unrecognised to `/`.

---

## 3. Rebranding

`livingston` everywhere: sidebar wordmark, `<title>`, meta description, chat input
placeholder, both system prompts, the disclaimer, the Features page, and the
outbound fetcher's User-Agent. The CSH avatar was replaced with a neutral
`public/avatar.svg`; the favicon is a neutral `public/favicon.svg`.

`grep -rniE "rxivgpt|cshl|cold spring|nsrgpt|nndc"` over `src api index.html
public` returns **only** database identifiers (`preprint_embeddings_cshl*`),
which are real column/table names in the shared database and must not be
renamed. Zero user-visible hits.

**One judgment call.** cshl's `/features` page was an "NNDC NSR Interface vs.
RxivGPT" comparison inherited from the NSR era, and its claims did not describe
cshl either (it advertised GPT-4o, OpenAI embeddings, and Deno Edge Functions;
cshl runs Bedrock + bge-m3 on Vercel). Since the spec keeps the account-menu
Features entry but drops cshl-specific marketing, I kept the route and the
layout and rewrote the content to describe what livingston actually ships. Every bullet
on it is a capability present in this codebase.

---

## 4. Environment

`.env.example` lists everything with placeholders. What livingston actually needs:

| Var | Required | Used by |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | every `api/*` function |
| `AWS_BEARER_TOKEN_BEDROCK` | **yes** for chat | `api/chat.ts` |
| `SEARCH_ENCODER` | no (defaults to `bge`) | `api/search.ts`, `api/similar.ts` |
| `CF_ACCOUNT_ID`, `CF_AI_TOKEN` | when `SEARCH_ENCODER=bge` | `api/_lib/embed.ts` |
| `NSR_ENCODER_URL`, `NSR_RERANKER_URL`, `NSR_SERVE_KEY` | when `SEARCH_ENCODER=nsr` | `api/_lib/embed.ts` |
| `SEARCH_RERANK` | no | `api/search.ts` |
| `BEDROCK_REGION`, `BEDROCK_API_KEY`, `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION` | no | `api/grounding.ts` |
| `SEMANTIC_SCHOLAR_API_KEY`, `OPENALEX_MAILTO`, `NCBI_API_KEY`, `HF_TOKEN` | no | enrichment / full-text fetch |
| `DATABASE_URL_UNPOOLED` | no — **livingston never loads data** | bulk loaders only (not shipped) |

`.gitignore` covers `.env*` with a `!.env.example` negation. Verified: `git add
.env.local` is refused; `.env.example` is tracked.

---

## 5. What is shared with cshl — and the coupling risks

livingston points at **the same Neon database as cshl** (`ep-orange-water-aut2eymf`,
433,449 preprints — 87,567 medRxiv, 345,882 bioRxiv). That is deliberate, and it
is what makes Papers render real data on first boot. The consequences:

**Read-only, and safe:**
- `preprints` and its relational/embedding tables. livingston only ever SELECTs.
- No migration or DDL path exists in this repo — `sql/` and `scripts/` were not
  copied. **Do not add them.** If the schema needs to change, change it from
  cshl, which owns it.

**Shared writes — these are real coupling, not theoretical:**

1. **`chat_sessions` is global and unauthenticated.** There is no user column and
   no auth (`api/chat-sessions.ts` says so explicitly: *"No auth by ruling"*).
   livingston's sidebar currently lists **cshl's 20 existing conversations**, and any
   chat started in livingston appears in cshl's sidebar too — including rename and
   delete. This is the biggest coupling risk. Splitting it later means either a
   separate database or a `app`/`owner` column plus a filter on both sides.

2. **`research_feed` is shared.** Activity generated by browsing livingston shows up in
   cshl's live feed and vice versa.

**Auth:** there is none, in either app. The account block at the sidebar bottom
is cshl's implementation copied as-is — Upgrade plan, Settings, and Log out are
inert buttons; Features navigates; Theme works. Nothing to port because nothing
exists yet.

---

## 6. Deviations from a literal replica, and why

1. **The right rail and the search page are scoped to medRxiv.**
   `useRecentPapers` and `PapersList`'s search pass `server=medrxiv`, as does
   `Search.tsx`. cshl queried the whole corpus. In an app whose only archive is
   medRxiv, a rail full of bioRxiv preprints reads as a bug. Reverting is a
   one-line change in each of the three call sites.

2. **`/api/chat` retrieval was left corpus-wide.** It can still ground answers
   in bioRxiv preprints. Scoping it would mean threading a server predicate
   through six SQL arms (structured, author, strict FTS, pruned-OR FTS, dense,
   and the widened retry), each with its own parameter offsets — a real risk of
   silently breaking retrieval for a cosmetic gain. The system prompts say
   "bioRxiv and medRxiv" so the model is not made to misdescribe its sources.
   If you want it scoped, the hook is the existing `room` mechanism in
   `api/chat.ts` (~line 240), which already carries a `server`.

3. **The live feed's write path was fixed, not replicated.** `api/feed.ts`'s
   POST called a stored function `insert_feed_event()` that **does not exist in
   this database**. Every write 500s, in cshl production too — which is why
   `research_feed` had 0 rows and the feed never populated. Replicating that
   would have shipped a permanently-empty panel. It now does a plain `INSERT`
   into `research_feed`, whose columns already exist with defaults for `id` and
   `created_at`. **No schema change was made.** Verified end-to-end by running
   livingston's own handler against the real database (POST 200 → GET returns the row);
   the verification rows were deleted afterwards.

4. **Workspace is inert by design.** It renders as a normal sidebar group —
   same icon, label, chevron, hover and expand behaviour — but its item list is
   empty, so it navigates nowhere. See §8.

5. **Dev proxy retargeted.** `vite.config.ts` pointed `/api` at
   `nsr.nysgpt.com` (stale from cshl's own cloning). It now points at
   `cshl.nysgpt.com`, overridable with `SAM_API_ORIGIN`. Note the consequence:
   **until livingston is deployed, local `/api` calls are served by cshl's deployment,
   which still has the old broken feed POST.** The feed fix takes effect once
   livingston runs its own functions.

---

## 7. Known inherited weirdness (not introduced here)

- **`/api/graph` does not exist.** `Chat.tsx` fetches it when a `#cite:type:id`
  link in an answer is clicked, and `lib/drag-entity.ts` calls it too. The panel
  degrades to "Not found in the corpus." Present in cshl exactly the same way.
  Nothing in the system prompt asks the model to emit `#cite:` links, so it is
  effectively unreachable. Kept because the affordance is wired through the
  markdown renderer; `EntityDetail.tsx` was trimmed to its paper/author branches
  and its dead `/ensdf/...` links removed.
- `src/components/ChatInput.tsx:5` has two imports on one line. Copied verbatim
  from cshl; valid TypeScript, left alone.

---

## 8. What Workspace will need when you wire it

`Sidebar.tsx` holds `WORKSPACE_ITEMS`, currently `[]`. To light it up:

1. Add entries: `{ label, path, prefetch: () => import("@/pages/YourPage") }`.
   The `Group` component already renders them, handles the active state, and
   prefetches the chunk on hover — no component changes needed.
2. Add matching `<Route>`s in `src/App.tsx` **above** the catch-all `*` route,
   or they will redirect to `/`.
3. If Workspace should highlight when you are inside it, replace the hardcoded
   `active={false}` on the Workspace `<Group>` with a pathname test — cshl's
   version was `WORKSPACE_ITEMS.some(i => location.pathname.startsWith(i.path))`.
4. There is a `workspace_views` table already in the shared database, unused by
   this code. If you intend to use it, treat §5 as binding: livingston does not own the
   schema.

---

## 9. Verification performed

Dev server boots clean; `npx vite build` succeeds. Driven headless with
Playwright against real data (note: the upstream deployment's bot protection
returns `403 x-vercel-mitigated: deny` to a `HeadlessChrome` UA, so tests set a
normal Chrome UA — this is a harness detail, not an app issue).

- **Sidebar** — `livingston` wordmark, New Chat, New Search, medRxiv → Papers only,
  Workspace visible and navigating nowhere, Your Chats listing 20 sessions,
  Account block. No bioRxiv, no Agents, no Subjects, no promo line.
- **Account menu** — Upgrade plan, Settings, Features, Theme (Light/Dark, and
  dark actually applies), Log out.
- **Papers** — 87,567 medRxiv records over 885 pages; filter row (Authors, Key
  #, Year, Category, Journal); Hybrid/Semantic/Keyword toggle; pagination
  changes results; header search returns hits; cards carry title, abstract,
  authors, subject chips, reference, and the dated DOI link.
- **Search** — `/new-search` returns ~100 results for a real query, with the
  year/cumulative/relevance widgets rendering.
- **Chat** — sent a question, received a streamed grounded answer with
  citations; URL became `/c/:uuid`; conversation survived a reload; the session
  appeared in the sidebar.
- **Right rail** — live feed renders events and carries the "Activity will
  appear here as you explore" empty state; papers rail loads 12 medRxiv cards,
  search returns 100, the X dismisses a card, and dragging a card onto the chat
  input attaches it as context.
- **Routes** — 16 dropped routes (bioRxiv, agents, subjects, community,
  announcing, graph, models, resources, code, references, nsr, preprints) all
  redirect to `/`; 7 kept routes resolve correctly.
- **Branding** — grep is clean of user-visible `RxivGPT` / `CSHL` / `CSHL-CPT`.

---

## 10. Deployment

Vercel project **`nys-gpt/livingston`** (`prj_6qotmODWWiu6jvAO6DSKi4VN00bJ`), connected
to `github.com/nyd-user-1/livingston` — **push to `main` is the deploy**, same as cshl.

Production alias: **https://livingston-nysgpt.vercel.app**

Verified live: Papers renders 99 medRxiv cards; hybrid search returns real hits;
`/api/{records,feed,chat-sessions,dict}` all 200; the sidebar shows `livingston` with
no bioRxiv; `/biorxiv/papers` redirects home; and **the feed fix works on livingston's
own functions** (`POST /api/feed` → `{"ok":true}`, the row reads back) where the
same call still 500s on cshl.

### Env set on the deployment
`DATABASE_URL`, `CF_ACCOUNT_ID`, `CF_AI_TOKEN`, `SEARCH_ENCODER=bge`,
`SEMANTIC_SCHOLAR_API_KEY`, `OPENALEX_MAILTO`, `NCBI_API_KEY` — all three
environments, sourced from `.env.local`.

`SEARCH_ENCODER=bge` means queries are encoded by stock bge-m3 on Cloudflare
Workers AI and matched against `preprint_embeddings`. cshl runs `=nsr` against
`preprint_embeddings_cshl_qp2` via a self-hosted box; to match it, set
`SEARCH_ENCODER=nsr` plus `NSR_ENCODER_URL`, `NSR_RERANKER_URL`, `NSR_SERVE_KEY`.

### Outstanding: chat needs a Bedrock token

`AWS_BEARER_TOKEN_BEDROCK` is **not set**. It is a Vercel *sensitive* variable on
cshl, which is write-only — it cannot be read back by CLI or dashboard, and it
exists in no local file. Chat therefore retrieves correctly but fails at
generation with `Could not load credentials from any providers`. Everything else
works. To finish:

```sh
vercel env add AWS_BEARER_TOKEN_BEDROCK production   # paste the token
vercel deploy --prod
```

Add it to `preview` and `development` too if you want chat working on branch
deploys.

### Remote build is the type-check
This machine blocks whole-project `tsc` (an 8 GB memory guard), and the local
`vite build` is esbuild-only, so it does not type-check. The first deploy failed
on three `TS6133` unused-symbol errors in `ChatResponseFooter.tsx` left by the
agent-link removal — caught exactly where it should be, fixed in `5976555`.
Treat a green Vercel build as the gate, not a green local one.
