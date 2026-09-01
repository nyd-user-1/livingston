# Lane X — Bedrock chat, four specialist agents, and connections (Slack first)

**Brendan, 2026-09-01:** *"another lane that wires in AWS Bedrock for chat
purposes and builds out 3 or 4 agents. I'd like them to be specialist agents so
I can feature them on a surface dedicated for explaining each agent and its
speciality. At least one agent must be 'agentic' in nature… able to 'do
something', complete a multi-step task."* And: in his Vercel apps he wired
Slack, Google Drive, Gmail and Discord via the platform's "Connections" —
*"Please prepare the same in AWS… If AWS has a solution lean in the direction
of the standardized approach provided by AWS (versus a handrolled solution).
Here, maybe start with Slack."* (He supplied the Slack CLI doc:
https://docs.slack.dev/tools/slack-cli — Bolt + CLI is Slack's own standard.)

**Where this runs:** govblock (`~/Code/govblock`), live at
https://policy.nysgpt.com on Amplify app `d2a69zdzqun8m7` (WEB_COMPUTE,
us-east-1, account 638175140432). Data: Aurora over the RDS Data API via
`/api/policy/[resource]` — the agents' tools are these routes, already scoped
and cached. Read `prompts/2026-09-01-aws-migration.md` §4 (Data API traps) and
the govblock CLAUDE/README first.

## 0. Rules

1. **Files you own, and nothing else:** `apps/web/app/agents/**`,
   `apps/web/app/api/agents/**`, `apps/web/lib/agents/**`,
   `scripts/agents/**`, plus one line in `apps/web/lib/config.ts` navItems
   ("Agents") and IAM/infra for this lane. NOT yours: the search files (lane
   S is live in them right now: `db-queries.ts`, the policy route's search
   case, `app/search/`), `components/command-menu.tsx`, the docs pages, the
   pipelines. Explicit-path commits; `git status` first; never `git add -A`.
2. Report below the marker in this file. `HEARTBEAT` every 45 min, `FLAG:`
   for rulings (keep going), one `LANE X STATUS: COMPLETE | PARTIAL |
   STOPPED — <why>` at the end.
3. One change per commit; the Amplify build is the type-check (a local hook
   blocks tsc/lint by name); verify every surface on https://policy.nysgpt.com
   with Playwright at 1714 px. Design: port the site's own vocabulary — the
   typeset chat panel is the chat surface to reuse; no invented metaphors; the
   lead reviews each slice on the deploy before the next.
4. Secrets: never in the repo. Slack tokens → Secrets Manager (or AgentCore
   Identity if chosen); model access is IAM, not keys. Bedrock tokens bill the
   AWS account — say the measured cost per exchange in the report.

## 1. Bedrock wiring (ship this slice first)

- Probe model access: `bedrock:ListFoundationModels` in us-east-1; test-invoke
  the newest Anthropic Claude models the account can reach (expect Sonnet- and
  Haiku-class; use cross-region inference profiles if that is what is
  enabled). If model access needs a console enablement, FLAG with the exact
  page and keep building against whichever model answers.
- Grant the Amplify SSR compute role `bedrock:InvokeModel` +
  `InvokeModelWithResponseStream`, scoped to the chosen model ARNs. Name the
  role and the policy in the report.
- Chat route: `app/api/agents/chat` on the **Converse / ConverseStream** API
  (tool use comes free later). Verify streaming actually reaches the browser
  through Amplify WEB_COMPUTE — measure it; if buffering breaks it, FLAG with
  evidence and fall back to chunked delivery, stating the trade.
- Default the strongest available Claude for the specialists, cheapest
  adequate (Haiku-class) for tool-routing loops; record exact model IDs.

## 2. Four specialists, one surface

`/agents` — a dedicated surface in the docs shell: each agent a card with its
name, speciality, what it reads, what it can do, and an open-chat action into
the typeset-style panel. Propose the four (names plain, no metaphors — the
lead rules on names before they ship). The required mix:

1. **Bill explainer** — grounded chat: given a bill (or found via the search
   route), reads `text`, `summaries`, `text-versions`, `sponsors`, history
   from `/api/policy` and produces a sourced brief. Never answers from the
   model's memory when the record disagrees; cites the rows it read.
2. **Jurisdiction navigator** — "who represents…", "which committee has…",
   "where is this bill" across all 52 jurisdictions, on the same tools.
3. **Money follower** — sponsors ↔ committees ↔ the money tables we hold;
   "follow the money on HB X" with honest gaps named.
4. **The agentic one — the Tracker (required):** a multi-step task runner.
   Canonical task: "watch <topic> bills in <jurisdiction>" → plans → calls
   the search route → fetches each bill's detail → composes a digest →
   **posts it to Slack** (§3) → reports back with links. Tool loop over
   Converse toolConfig (TS, in-repo — keep the codebase small) unless §3's
   evaluation lands on AgentCore Runtime, in which case say why and deploy
   there. Multi-step must be real: observable intermediate tool calls, not
   one prompt.

## 3. Connections — the AWS-standard evaluation, then Slack

Brendan's ruling to honor: **lean standardized-AWS over handrolled.** Evaluate,
with 30 minutes of evidence each, and recommend before building:

- **Bedrock AgentCore** — Identity (OAuth2 credential providers: the token
  vault that is the closest analog to Vercel's Connections), Gateway (external
  APIs exposed as MCP tools), Runtime. Is it GA in us-east-1 for this account,
  what does wiring Slack through Identity+Gateway actually take, what does it
  cost idle?
- **Handrolled-standard:** a Slack app from their own CLI/Bolt path (the doc
  Brendan supplied), bot token in Secrets Manager, called from the Tracker's
  tool. Smallest possible; no OAuth dance for a single workspace bot.
- Note for the report only (not to build): Amazon Q Business connectors are
  enterprise-search connectors, not app connections — name them so the option
  is visibly considered and rejected or adopted knowingly.

Then build **Slack first** whichever way the ruling lands. The Slack app
itself (create + install to the workspace) is Brendan's interactive step —
FLAG with the exact commands/manifest when you reach it, and keep building
behind a stub until the token exists. Design the connection layer so Drive,
Gmail and Discord are additions, not rewrites: one `lib/agents/connections/`
contract (name · auth · tools it contributes), Slack as the first instance.

## 4. Report

Model IDs and measured cost per exchange; the IAM changes; streaming verdict
with numbers; the four agents (name, speciality, tools) and the Tracker's
full observable run (screenshots: the surface, a chat, the Slack message);
the connections recommendation with its evidence; what is stubbed awaiting
Brendan's Slack install. Then the STATUS line.

---

## Report — worker appends below this line

LEAD: 22:15Z (Brendan, relayed) — Bedrock is ALREADY SET UP on this account; do not re-wire what exists. Use the AWS CLI, and read `~/Code/leuk/`, `~/Code/44b/` or `~/Code/nsr/` to see which ~27 models we hold entitlements and allocation for — those repos already call Bedrock in production. WARNING, his words: AWS labeling misleads — ListFoundationModels will say we have models we do not (the Claude 5 family shows; we do not have it; our Claude entitlements top out around 4.6). A model is "available" only when a real test invoke answers — probe by invoking, never by listing. Pick your defaults from what actually answers, and record the proven IDs in the report.

LEAD: 22:30Z — Probe results accepted; you confirmed the warning by invoke before it landed, which is the right reflex. Note for the record: even `get-foundation-model-availability` reports opus-5 AUTHORIZED while Converse denies it — the invoke is the only truth on this account. Rulings:
LEAD: Defaults — Opus 4.6 for specialists and Haiku 4.5 for the Tracker loop approved as the opening position. The report's measured cost-per-exchange decides the shipped default: if Sonnet 4.6 is indistinguishable on the bill-explainer's output at its price, it takes the specialist seat and Opus 4.6 is reserved for the money-follower's hard joins. Let the measurement rule, not the label.
LEAD: Tightening BedrockInvoke from Resource:"*" — approved, with the trap named: a us.* inference profile authorizes against BOTH the profile ARN and the underlying foundation-model ARNs in every region the profile fans out to (us-east-1/us-east-2/us-west-2). Scope to profile + all underlying model ARNs for the two chosen tiers, or the tightening itself breaks invocation. Verify by invoking through the DEPLOYED site after the change, not just locally, before the commit that claims it.
LEAD: 44b's live AgentCore Gateway — read it, do not touch it. It is evidence for the §3 ruling, not shared infrastructure: if AgentCore wins, govblock gets its own Gateway/Identity resources; the two apps must be separable with one deletion each.

---

### HEARTBEAT 1 — 21:22Z

**Slices 1 and 2 pushed.** `5527eb0` (Bedrock wiring) → `e911359` (a type fix
Amplify caught) → `1306e5f` (four specialists, the tool loop, the connection
contract). Build on the last one is running; verification on the deploy comes
next, before slice 3.

**§1 · what actually answers.** Probed by invoking every `us.anthropic.*`
inference profile in us-east-1, not by listing — the lead's warning held exactly.

| answers | denied |
|---|---|
| `us.anthropic.claude-opus-4-6-v1` · 1140 ms | `claude-opus-5`, `claude-sonnet-5` |
| `us.anthropic.claude-sonnet-4-6` · 874 ms | `claude-fable-5`, `claude-fable-5-1` |
| `us.anthropic.claude-opus-4-5-20251101-v1:0` · 1389 ms | `claude-opus-4-8`, `claude-opus-4-7` |
| `us.anthropic.claude-sonnet-4-5-20250929-v1:0` · 1300 ms | `claude-sonnet-4-20250514` |
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` · 507 ms | |

Both AWS catalogues lie about this account. `ListFoundationModels` advertises
the whole Claude 5 family, and `GetFoundationModelAvailability` reports
`anthropic.claude-opus-5` as `authorizationStatus: AUTHORIZED`,
`entitlementAvailability: AVAILABLE` — while Converse returns *"is not available
for this account"*. Same denial on the `global.*` profiles and in us-west-2, so
it is an account entitlement, not a region or a profile shape. The probe is
committed as `scripts/agents/probe-models.sh` so nobody has to trust this table.

Shipped: **Opus 4.6** for the specialists, **Haiku 4.5** for the Tracker's
tool-routing loop — the same two tiers leuk/44b/nsr already run in production.
Every entitled model here is `INFERENCE_PROFILE`-only, so every id is the `us.`
cross-region profile and never the bare `anthropic.` foundation model.

**§1 · IAM.** Bedrock was already wired, as the lead said: role
`govblock-amplify-compute` (it is both the build and the compute role) already
carried a `BedrockInvoke` statement inside its **`govblock-data-access`** inline
policy, at `Resource: "*"`. Nothing new was created. That one statement now
names the three inference-profile ARNs **and** the underlying foundation-model
ARNs in us-east-1, us-east-2 and us-west-2 — twelve ARNs, because a `us.*`
profile authorises against everything it fans out to. The document is committed
at `scripts/agents/iam/govblock-data-access.json`. Verification through the
deployed site is the next thing I do, per the lead's ruling, and slice 3 does
not start until it passes.

**§2 · the four, for the naming ruling.** Plain, no metaphors:

1. **Bill Reader** — one bill's whole record, cited. `search_bills`, `get_bill`,
   `get_bill_text`, `list_jurisdictions`.
2. **Jurisdiction Guide** — who represents, which committee, where a bill sits,
   across all 52. Rosters, committees, search.
3. **Money Follower** — bill → sponsors → committees → filings, gaps named.
   Adds `get_member_record` (FEC totals and largest contributions) and
   `top_sponsors`.
4. **Tracker** — the agentic one. `search_bills` → `get_bill` on each of the top
   three to five → digest → `post_to_slack` → reports what it read and whether
   the post landed.

**FLAG A (names):** those four. Say the word and they change; nothing outside
`registry.ts` and the URL depends on them.

**§2 · what the surface is.** `/agents` wears the docs shell by re-exporting
`app/docs/layout` — the same one-line move `/search` made, so the three cannot
drift. A card per agent carries name, speciality, what it reads, what it can do,
its tools and its model. The chat panel is `components/policy/assist-chat.tsx`'s
bubbles, textarea and Clear/Send row moved rather than redesigned; what is new is
the middle, where each tool call is rendered as it happens with its arguments,
what came back and how long it took, then the answer, then the exchange's exact
token count and cost. One line added to `config.ts` navItems.

Incidentally: `assist-chat.tsx` posts to `/api/chat`, and **no such route
exists** — that panel has never been able to answer. Not my file, so I have not
touched it, but pointing it at `/api/agents/chat` would light it up.

**§3 · the connections evaluation, most of it already answered by our own
account.** Standing evidence, not a doc read: 44b built a **live AgentCore
Gateway in this same account** on 2026-08-09 — `44b-gateway-dvq95nm6dw`, one REST
target, READY, plus two credential providers (`44b-api-key`,
`44b-gateway-oauth`), two AgentCore Runtime agents on Haiku 4.5, and zero idle
cost since. So AgentCore Identity, Gateway and Runtime are all GA and working
here; the question is not availability but fit.

Two findings that decide it, both measured today:

- **AgentCore Identity has a first-class `SlackOauth2` credential provider** —
  and `GoogleOauth2` and `MicrosoftOauth2` beside it, which is precisely
  Brendan's Drive/Gmail list. It is the real AWS analog of Vercel Connections.
  But it wants `clientId` + `clientSecret` for a three-legged flow, and reading a
  token back out (`bedrock-agentcore get-resource-api-key` /
  `get-resource-oauth2-token`) requires a **workload-identity token**, which our
  Next.js SSR route does not have and would have to be given machinery to mint.
- **Gateway-over-Slack is not the shape it looks like.** Slack publishes
  `swagger: 2.0` (1.0 MB, 170 operations); Gateway requires OpenAPI 3.0+ — 44b
  already had 3.1.0 *rejected* and down-converted. So the "standard" path means
  hand-authoring an OpenAPI 3.0 spec, an S3 object, a Cognito user pool for
  inbound auth, a gateway, a credential provider and an execution role — to make
  one `chat.postMessage`.

**Recommendation, and it does honour the lean:** ship Slack now as a bot token in
Secrets Manager (`govblock/slack`, created empty, read by the same compute role
that reads the database secret) — the smallest correct thing for one workspace
bot with no OAuth dance. Adopt **AgentCore Identity** the moment a *second*
workspace or a per-user token appears, which is the case its OAuth vendors are
built for and where hand-rolling would genuinely be wrong. Amazon Q Business
connectors are considered and rejected: they are enterprise-search connectors
that index a source for retrieval, not a way for an agent to act on an app. The
connection layer is written so this ruling is reversible — `lib/agents/connections/`
is a contract (id · name · auth · tools · live status), Slack is one file
implementing it, and the vault behind `postToSlack` can change without the
agents, the loop or the surface noticing.

**FLAG B (ruling wanted):** Secrets Manager now, AgentCore Identity at the second
credential. Overrulable — if you want AgentCore Identity today I will build it,
but it is a Cognito pool and a workload identity for one HTTPS POST.

**FLAG C (one line, not mine to write):** the database holds `LobbyingBills` /
`LobbyingFilings` and `getLobbying(billId)` exists in `db-queries.ts`, but no
`lobbying` case is exposed on `/api/policy/[resource]` — so the Money Follower
cannot see who filed on a bill. It says so out loud instead of guessing. Two
lines in the route (`case "lobbying"` and `case "fec"`) would close it; that file
is lane S's.

**Next:** verify the deploy (streaming numbers, the Opus-4.6-vs-Sonnet-4.6
comparison you asked for, Playwright at 1714 px), then slice 3 — the Tracker's
observable run and the Slack manifest for Brendan.

LEAD: 23:45Z — Heartbeat 1 read. The probe table with both AWS catalogues caught lying, committed as scripts/agents/probe-models.sh so "nobody has to trust this table", is exactly right. Rulings:
LEAD: FLAG A — the four names are APPROVED: Bill Reader, Jurisdiction Guide, Money Follower, Tracker. Plain, honest, no metaphors. Brendan may rename on sight; nothing outside registry.ts depends, so that costs nothing later.
LEAD: FLAG B — APPROVED as recommended: Secrets Manager (govblock/slack) now; AgentCore Identity at the second credential — a second workspace or the first per-user token is the adoption trigger, and that trigger gets written as a comment in lib/agents/connections/ AND in §4, so the reversal point lives where the next person will read it. You honoured the lean by evaluating the standard path on evidence and rejecting it for one workspace bot with reasons (OpenAPI 3.0 hand-authoring, a Cognito pool and a workload identity for one chat.postMessage). Q Business considered-and-rejected is noted.
LEAD: FLAG C — routed to lane S, whose file it is: case "lobbying" (getLobbying exists) lands in its next commit to the policy route; "fec" only if a query function already exists — no new SQL in its scope. Until then the Money Follower keeps saying out loud what it cannot see, which is the correct behaviour, not a gap.
LEAD: The /api/chat orphan (assist-chat.tsx has posted to a route that never existed) — good catch, and right not to touch it. The repoint to /api/agents/chat is MINE to do after your route verifies on the deploy: include the route's exact request/response contract in your report so the one-line change is made against the truth. Proceed: deploy verification, the Opus-vs-Sonnet comparison, then slice 3.

---

### HEARTBEAT 2 — 21:47Z

**The streaming verdict, and it is a no.** §1 asked for it measured; here is the
measurement, from the live deploy at https://policy.nysgpt.com:

| framing | events | first byte | last line | spread |
|---|---|---|---|---|
| `application/x-ndjson` | 418 | 23.27 s | 23.27 s | **0.00 s** |
| `application/x-ndjson` (identity encoding) | 315 | 17.45 s | 17.45 s | **0.00 s** |
| `text/event-stream` | 342 | 14.88 s | 14.88 s | **0.00 s** |

Same on `main.d2a69zdzqun8m7.amplifyapp.com` as on the custom domain, so it is
neither CloudFront compression nor the domain. The decisive detail: the route
enqueues its `open` event **before Bedrock is called at all**, and that event
still arrives 23 seconds late. Nothing about the model explains it. **Amplify
WEB_COMPUTE holds the whole response body until the handler returns.** SSE — the
framing proxies usually special-case — changed nothing, so that branch is
removed rather than kept as decoration; it existed to answer the question and it
did.

**The fallback, and its trade.** The loop moved out of the request. One POST is
now **one round**: the model answers or asks for tools, the tools run, and the
conversation comes back to the browser as `state`, which posts it again until
the model stops asking. The Tracker's search therefore lands on screen while it
is still reading bills — which is the thing the surface exists to show.

- **Lost:** token-by-token typing. A round's prose arrives whole.
- **Kept:** the multi-step run is watched, not asserted — every tool call, its
  arguments, what came back and how long it took, as each round returns.
- **Costs nothing in tokens.** Converse is stateless and the history was already
  resent every round; the price is one HTTP round trip per step.
- Because the conversation now travels through the client it is bounded on the
  way in — 60 messages, 600 kB.

**FLAG D (security, and I have taken the cheap half already).** `/api/agents/chat`
is public, and the Tracker holds an actuator. I removed `post_to_slack`'s
`channel` parameter, so the model can choose the words but never the
destination — the channel is the secret's. What remains is that anyone who can
reach the site can cause a post to that one channel once a token exists. Cheapest
real gates, your call: a shared-secret header the surface sends, Amplify access
control on `/agents`, or leaving it — it is one channel, rate-limited by Bedrock
latency and costing a fraction of a cent per post.

**§1 · the model ruling, measured.** You asked whether Sonnet 4.6 is
indistinguishable on the explainer's output at its price. It is. Same prompt,
same whole bill record (NY A07380, 1,365 input tokens), both models:

| | tokens | latency | cost |
|---|---|---|---|
| Opus 4.6 | 1365 in / 460 out | 10.7 s | **1.83¢** |
| Sonnet 4.6 | 1365 in / 364 out | 7.9 s | **0.96¢** |

Same status, same three sponsors with party and district, same three history
moves, same same-as companion, and both correctly refused to characterise text
they had not fetched. So per your ruling: **Bill Reader and Jurisdiction Guide →
Sonnet 4.6**, **Money Follower → Opus 4.6** (the one agent holding several
records at once), **Tracker's loop → Haiku 4.5**. Halving the price of the two
agents people will actually use was worth a third tier name.

**Measured cost per exchange, so far.** A grounded one-round answer with no tool
call: **1.0¢** (Opus 4.6, 1,592 in / 81 out, 4.7 s). The Bill Reader's full brief
over a real record: **0.96¢** on Sonnet. A Tracker run is several rounds and its
number goes in the report once it has run end to end on the deploy.

**§3 · lane S's routes are in and wired.** `get_lobbying` and `get_fec` are now
the Money Follower's, with the Congress-only behaviour encoded as you asked: it
surfaces the route's own sentence rather than reporting an empty result as an
answer.

**The `/api/chat` repoint contract you asked for**, exactly:

```
POST /api/agents/chat            → application/x-ndjson, one event per line
  first call   { agent: "<slug>", jurisdiction?: "NY",
                 turns: [{ role: "user" | "assistant", text }] }
  each after   { agent: "<slug>", jurisdiction?: "NY",
                 state: { messages } }        // `messages` from the state event

events  { t:"open",  model, label }
        { t:"text",  v }
        { t:"tool",  id, name, input }
        { t:"tool_result", id, name, ok, summary, ms }
        { t:"state", messages, done }   // post `messages` back while !done
        { t:"done",  stopReason, usage:{inputTokens,outputTokens}, usd, ms }
        { t:"error", message }
```

Slugs: `bill-reader`, `jurisdiction-guide`, `money-follower`, `tracker`. Note it
is **not** the AI SDK's `useChat` protocol, so `assist-chat.tsx` needs its reader
swapped, not just its URL — the panel at `app/agents/agent-chat.tsx` is the
working reader to copy.

**Next:** the Tracker's observable run end to end on the deploy, Playwright at
1714 px on all three surfaces, and the Slack manifest + one-command connect
script for Brendan (both written, not yet committed).

LEAD: 01:45Z — Heartbeat 2 rulings:
LEAD: Streaming — verdict ACCEPTED as measured; the pre-Bedrock open event arriving 23 s late is the whole proof, and removing the SSE branch once it had answered its question is right. The round-per-POST design is genuinely better for this surface: watched tool calls are the product, token-typing is decoration. For §4's options list only, one line: if typing ever matters, a Lambda Function URL with response streaming beside Amplify is the known escape hatch — priced there, not built.
LEAD: Models — APPROVED as measured: Bill Reader and Jurisdiction Guide on Sonnet 4.6, Money Follower on Opus 4.6, Tracker loop on Haiku 4.5. "Both correctly refused to characterise text they had not fetched" is the sentence that mattered; halving the price of the agents people will actually use was worth the third tier.
LEAD: FLAG D — ruling: (a) the half you took is the real control and it stays — the destination is configuration, never the model's choice; (b) a shared-secret header on a public site is theatre (it ships in the bundle) and Amplify access control would gate a surface Brendan wants public — both rejected; (c) what does work on a public actuator and costs an evening nothing: a server-side ROUND CAP per conversation (refuse past ~12 rounds — the client drives rounds, and a runaway client is a Bedrock bill), plus a best-effort in-route rate cap per IP on the chat route, weak on WEB_COMPUTE but not nothing; (d) the standing decision — whether one public channel receiving public posts is acceptable — is explicitly deferred to the moment Brendan creates the token, when he can choose the channel with that in mind. Nothing can post until then; note it in the manifest FLAG.
LEAD: The /api/chat repoint (reader swap, agent-chat.tsx as the copy source) stays mine and waits for your STATUS line so I never touch the panel mid-lane. The contract is recorded. Proceed: Tracker end to end, three surfaces at 1714 px, manifest + connect script for Brendan.

LEAD: 02:15Z — The bill-number fallthrough is confirmed and FIXED by the lead (the route's non-search cases are unowned, and the file was clean): a supplied number that matches nothing now throws `No bill numbered "…" in <state> <session>.` instead of answering with the newest bill, and numbers normalise (bare, upper) before the lookup, so "HR 1" and "hr1" reach the same row. Your get_bill guard STAYS as defence in depth — a route fixed today can regress tomorrow, and the tool that checks what it was handed is the tool that catches it. Credited to this lane's account: found live, guarded your side first, reported with the exact cause and the one-line fix. The two measured numbers are noted for §4 — prompt caching taking the Money Follower's HR-1 run from 25.64¢/42,692 input tokens to 8.07¢ is the second-best ratio of the night, and the Tracker's 4-round end-to-end at 3.01¢ with an honest Slack refusal is the observable run the brief demanded.

---

### HEARTBEAT 3 — 22:10Z

*(the two timestamps above were my estimates and were ~40 min fast; corrected
against the build log. Nothing else in them changed.)*

**All four agents run on the deploy, and the Tracker's run is the one the brief
asked for.** Screenshot evidence at 1714 px, headless Chromium, against
https://policy.nysgpt.com — the surface, a grounded chat, and the Tracker
mid-run and finished.

**The Tracker, end to end, watched:**

```
search_bills   q: housing, jurisdiction: NY, limit: 8  → 8 bills, 5 committees · 574 ms
get_bill       bill_id: 2014457      → 3 sponsors, 6 history, 1 referrals, 3 progress · 241 ms
get_bill       bill_id: 1975863      → 4 sponsors, 6 history, 1 referrals, 3 progress · 418 ms
get_bill       bill_id: 1902711      → 12 sponsors, 3 history, 1 referrals, 3 progress · 587 ms
get_bill       bill_id: 2152290      → 1 sponsors, 14 history, 4 rollCalls, 3 referrals · 344 ms
get_bill       bill_id: 2025009561   → 1 sponsors, 2 history, 1 texts · 330 ms
post_to_slack  text: *New York Housing Bills Digest* …
               → not posted — Slack is not connected yet — the secret
                 govblock/slack holds no bot_token. · 61 ms
Claude Haiku 4.5 · 4 rounds · 4,378 in / 1,155 out · 9,478 cached · $0.024 · 12.9 s
```

Four rounds, five bills opened in parallel in one round, and the last step
refusing honestly and printing the whole digest in the reply instead — which is
the behaviour the prompt asks for and not a stub. Three of those tool calls are
visible on screen while the run is still going.

**Caching landed and it is the difference between a toy and a bill.** The Money
Follower's "who lobbied on HR 1 and what are its sponsor's FEC totals" went
**25.64¢ → 8.07¢**. The 42,692 input tokens were never 42,692 tokens of record;
they were a few thousand, resent seven times, because Converse is stateless.
Four cache points — tool definitions, system prompt, and a rolling pair over the
history — and the panel now prints the cache reads beside the tokens so the
saving is visible rather than claimed.

**Two real defects found by driving it, both fixed:**

1. **The wrong-bill trap** (reported to you; you have since fixed the route).
   `/api/policy/bill?state=US&number=HR%201` returned **HB10171** — a
   food-and-nutrition grant bill — with HTTP 200, because an unmatched number
   fell through to `getBills(f, 1)`. My `get_bill` now compares the number asked
   for against the number returned, punctuation stripped, and calls a mismatch a
   miss. Keeping it as you ruled: defence in depth.
2. **The Bill Reader elaborating a title.** Asked about NY A07380, whose
   description is a verbatim copy of its title, it wrote that the bill covers
   "what information must be included or disclosed when such units are marketed
   to prospective tenants" — reasonable, and nowhere in the record. The prompt
   now names that case: say the description is only the title, offer to read the
   text, do not fill the gap.

Also fixed from the screenshots: rounds' prose ran together with no paragraph
break; `**bold**` printed its asterisks (fifteen lines, bold and `code` only, no
markdown dependency); and "3 in / 75 out" was the cache telling a lie — Bedrock
reports uncached input, cache reads and cache writes as three disjoint numbers
and the panel was printing only the first.

**Your rulings are in.** Round cap enforced server-side at 12, counted from the
assistant turns in the conversation where a client cannot edit it; per-IP cap at
20/minute, and the comment says plainly that it is a Map in one warm instance —
a brake, not an access control.

**Still to do:** the §4 report — the Lambda Function URL escape-hatch pricing you
asked for, the AgentCore evidence written up properly, the connections
recommendation, and the STATUS line. The Slack manifest and connect script are
committed (`scripts/agents/slack-app-manifest.json`,
`scripts/agents/connect-slack.sh`).

LEAD: 03:40Z — Heartbeat 3 read. The Tracker's watched run is exactly what the brief demanded — four rounds, five bills opened in parallel, and an honest refusal that prints the digest rather than pretending; $0.024 and 12.9 s for the whole thing is a shippable number. Three items called out with credit: the cache reads printed beside the tokens ("visible rather than claimed") is the reporting standard; the Bill Reader title-elaboration fix — "say the description is only the title, offer to read the text, do not fill the gap" — is the grounding sentence every agent prompt here should carry; and the round cap counted from assistant turns where a client cannot edit it is the right implementation of the ruling. The per-IP comment admitting it is "a brake, not an access control" is the honesty the file needs. Remaining: §4 (Lambda URL pricing line, AgentCore evidence, connections recommendation) and STATUS. The manifest and connect script are noted — Brendan's install step is being surfaced to him now.

LEAD: (Brendan, relayed) — *"I prefer Discord honestly; let's come back to Slack shortly."* He is creating a PolicyBot inbound WEBHOOK now. Pivot, and it is smaller than what you built for Slack: a Discord webhook is a bare POST to https://discord.com/api/webhooks/{id}/{token} — no bot token, no OAuth, and the destination is baked into the URL itself, which answers FLAG D's public-actuator question by construction. Do now, ahead of §4: (1) a second connection file beside Slack's implementing the same contract — this is exactly the "additions, not rewrites" test the layer was designed to pass; (2) the Tracker's post tool goes connection-agnostic (post_digest routed to whichever connection is live) or gains post_to_discord beside post_to_slack — your call, say which in the report; (3) scripts/agents/connect-discord.sh in the shape of connect-slack.sh: takes the webhook URL as an argument, proves it with a POST of a one-line test message using ?wait=true (the returned message object is the proof), writes {webhook_url} to Secrets Manager govblock/discord, never echoes it — the URL is the whole credential and the repo is public. Discord facts that matter: content caps at 2,000 chars — a digest goes as embeds (4,096-char descriptions, 10 per message) or split; rate limit ~5/s per webhook; send a User-Agent. Slack's manifest and script stay committed and parked — "come back to Slack shortly." The webhook URL arrives via the lead; standby to connect and run the Tracker end to end with a real post.

LEAD: 05:00Z (Brendan, relayed + lead's interpretation) — §5, the Agentic Inbox. His words: use the /blocks/intelligence inbox block as an early agentic surface — *"Giving the user the option for live chat or an 'email/slack/discord'-like experience for longer running multi-turn, multi-step and tool based tasking. Example: a deep research report over the entire site + the canonical sources and the report being in the inbox like a delivered e-mail."* Named: **"Agentic Inbox."** He is open to interpretation; this is the lead's, build to it and flag where it fights the code:

1. **The mapping.** The intelligence block's mail UI becomes the task surface: the thread list is the task list (each row an agent run: who, tasking, status — running / delivered / needs input, with time); the reading pane is the delivered report (the run's observable tool calls collapsed beneath it, same renderer as /agents); compose is "New task" — pick an agent, write the tasking, send. Live chat stays what /agents already is; the inbox is the long-form sibling. Keep the block's own markup and classNames — repurpose by content, never redesign.
2. **A fifth agent: the Researcher** (name plain, rule stands) — the flagship inbox task. Multi-step deep research: plans sections → searches the site's own routes (search, bills, text, members, lobbying, fec) across jurisdictions → reads the records → composes a long sourced report with links to every page and canonical source it read (congress.gov URLs where the record carries them). Opus 4.6. Cap its rounds higher (~24) and report a measured cost per report.
3. **v1 delivery, buildable now, no new infra:** tasks execute in-tab on the existing round loop (visible progress in the inbox row); finished reports persist in localStorage (this is a public site with no accounts — a server-side shared inbox would show every visitor everyone's tasks; say this plainly on the surface) AND deliver to Discord via the live PolicyBot webhook — the report arriving in his channel IS the "delivered e-mail" experience, today.
4. **v2, PRICE ONLY, do not build:** true close-the-tab delivery — task queued server-side, executed off-request (AgentCore Runtime, which 44b already runs in this account, vs a Lambda worker), report into an Aurora table + Discord. Needs an identity story for a public site; name the options (a per-browser token is the cheapest honest one) and the cost. Brendan buys it or not from §4.
5. `/agent` → `/agents` redirect (he typed the singular and got a blank shell); one line.
6. The inbox demo rows (William Smith, "Meeting Tomorrow") go — seeded instead with one real delivered example: a Researcher report the lane actually ran.
Ownership: /blocks/intelligence's page and the block behind it join your files for this section; the same fences hold everywhere else. Verify at 1714 px; the acceptance test is a Researcher task submitted from compose, watched in the row, delivered in the pane and landing in Discord.

LEAD: 05:30Z — Brendan drove the Tracker live ("Watch artificial intelligence bills in California" — 4 rounds, 5 bills, $0.042, and the agent handled the refusal correctly by delivering the digest in the reply). One defect from his run: the post failed with Discord 220001 — the PolicyBot channel is a FORUM channel, and webhook posts there must carry thread_name. Fix in the connection, not the agent: attempt plain; on code 220001 retry once with thread_name set to the digest's title (each digest then becomes its own forum post, which reads well); keep the error text verbatim in the tool result either way. Do not ask Brendan to move the webhook — adapt to the channel he chose. Also: he is thinking §5 (the Agentic Inbox) over — LEAVE IT IN PLACE as written, keep building; his ruling may refine it.

LEAD: 05:50Z — The first real PolicyBot post has landed ("New York Housing Bills", 357 ms). The adaptive discovery is better than the ruled retry — learned once per instance, works unchanged if the webhook moves — and the transcript carrying the message id instead of "posted" is this surface's own creed applied to itself: proof, not assertion. Split digests staying in one thread via ?thread_id= is the detail a reader would have missed until it bit. Second real run approved (real digests are content, not noise). Proceed to §5.

LEAD: 07:20Z — The 30-second finding is accepted as measured and it is the §4 headline: Amplify WEB_COMPUTE buffers the whole response AND cuts it at 30 s regardless of maxDuration, with a silent 500 (no CloudWatch group for the compute). "This only shows up as a stopwatch" goes in the closing notes verbatim. Rulings: (1) the mitigation is approved and is good agent design independent of the limit — bounded tool results, compaction with the last two rounds verbatim, and the Researcher writing notes as it gathers ("what it did not write down, it will have to read again" is the sentence; keep it in the prompt). (2) The Lambda Function URL escape hatch is re-scoped in §4 from if-typing-matters to THE RECOMMENDED NEXT STEP — it dissolves both platform limits at once; price it fully (function, URL, IAM, the streaming reader) but do NOT build it in this lane; Brendan buys it from the report. (3) Permitted fallback without a new ruling: if a compacted Opus 4.6 round still trips 30 s, the Researcher's synthesis rounds may drop to Sonnet 4.6 — the H2 comparison already showed it holds the quality on grounded work; say so in the report if used. (4) The type-gate account is settled — the onSelect prop-name collision class is noted. Finish: Researcher end to end, inbox acceptance at 1714 px, §4, STATUS.

LEAD: 07:50Z (Brendan, relayed — §6, the high-fidelity mail experience) — His screenshots are the spec: Gmail, faithfully replicated to the degree possible. His words: a To: field for the agents with a mock address and a one-line description; Subject; I send it, I see it in Sent, and I get a mail back; search over sent and inbox; drafts kept; deleted; favorite; read and unread. Plus the immediate defect he named: while the Researcher runs there is "no spinner/loader or even shimmer to indicate thinking." Build order inside §6 — the indicator first, it ships alone:
1. **Running indicator, now:** the running thread row and the open reading pane both show life — a spinner or shimmer beside the current tool line, updating as rounds land. A reader must never wonder if it died. (His run: 24 calls, 33.7 s, visibly ambiguous.)
2. **The model:** a task is a THREAD. Your message (To, Subject, body) files under **Sent** the moment it goes; the agent's report arrives as a **reply in the Inbox** on the same thread — bold/unread until opened, read after. Subject is the thread title and becomes the Discord thread_name.
3. **To: with autocomplete, Gmail-shaped:** type into To and the dropdown offers the agents — monogram avatar, name, mock address (researcher@govblock, tracker@govblock, bill-reader@govblock, money-follower@govblock, jurisdiction-guide@govblock), and the one-line specialty. ALL FIVE are addressable — the chat specialists simply reply with their answer as one message; Tracker and Researcher run long with the transcript underneath.
4. **Folders and states:** Inbox (replies), Sent (your taskings), Drafts (compose persists unsent, per-browser), Trash (soft delete, restorable), star on any thread, unread dots, and search that covers inbox AND sent (client-side over the local store is fine and honest).
5. Explicitly deferred, priced in §4 only: attachments and rich formatting (no file store yet); anything needing accounts.
Everything else already ruled stays: per-browser honesty, Discord as the durable copy, the run collapsed under the reply. Sequence: the indicator ships first and alone; then §6; then §4 and STATUS. The acceptance test: compose To: researcher@govblock with a Subject, watch it run with a visible pulse, find it in Sent, read the reply arrive unread in the Inbox, star it, search it, trash it, restore it.

LEAD: 08:30Z — The Researcher's completion is accepted with all three findings, and they are §4 material of the first order: (1) deliver_report is the standout — "the report cannot drift from what the reader sees — same string" is both a cost fix and a correctness guarantee, and the pattern (never make the model retype what the loop already holds) generalises; (2) recognising max_tokens as "out of room, not finished" and continuing from the exact cut is the right mechanism, and "instruction was the wrong instrument — the output ceiling made it" goes in the notes verbatim; (3) maxTokens as measured throughput × 17 named seconds in models.ts is engineering where a magic number would have rotted. The Sonnet 4.6 Researcher ruling is ratified on the numbers ($0.47 vs $1.11, 37.9 s vs 46.9 s, same grounded quality) — record it in §4 as the shipped default with Opus reserved for the Money Follower. The record?id=1326 1 MB defect is MINE (unowned route case); fixing separately. Proceed §6.

---

## §4 — Report

Written 2026-09-02, ~00:20Z. Everything below is measured on the live deploy at
https://policy.nysgpt.com unless it says otherwise. 35 commits, 31 files,
+3,870/−233, all inside this lane's fences plus the one `config.ts` navItems
line and — from §5 onward, by the lead's grant — `/blocks/intelligence` and the
block behind it.

### 1 · Model IDs, and why they are these

Both AWS catalogues lie about this account. `ListFoundationModels` advertises the
whole Anthropic line including the Claude 5 family, and
`GetFoundationModelAvailability` reports `anthropic.claude-opus-5` as
`authorizationStatus: AUTHORIZED, entitlementAvailability: AVAILABLE`. Converse
answers *"is not available for this account"* — on the `global.*` profiles and in
us-west-2 too, so it is an account entitlement, not a region or a profile shape.
**Only an invoke tells the truth**, which is why `scripts/agents/probe-models.sh`
invokes every `us.anthropic.*` profile the region lists rather than trusting a
table. Probed:

| answers | denied |
|---|---|
| `us.anthropic.claude-opus-4-6-v1` · 1140 ms | `claude-opus-5` · `claude-sonnet-5` |
| `us.anthropic.claude-sonnet-4-6` · 874 ms | `claude-fable-5` · `claude-fable-5-1` |
| `us.anthropic.claude-opus-4-5-20251101-v1:0` · 1389 ms | `claude-opus-4-8` · `claude-opus-4-7` |
| `us.anthropic.claude-sonnet-4-5-20250929-v1:0` · 1300 ms | `claude-sonnet-4-20250514` |
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` · 507 ms | |

Every entitled model is `INFERENCE_PROFILE`-only, so every id is the `us.`
cross-region profile, never the bare `anthropic.` foundation model.

**Shipped, and each choice measured rather than assumed:**

| tier | model | who uses it | why |
|---|---|---|---|
| `grounded` | `us.anthropic.claude-sonnet-4-6` | Bill Reader, Jurisdiction Guide, **Researcher** | Indistinguishable from Opus on grounded work at half the price |
| `reasoning` | `us.anthropic.claude-opus-4-6-v1` | Money Follower | The one agent holding several records at once |
| `routing` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Tracker | Cheapest that does tool use competently, and the fastest writer |

The Sonnet-vs-Opus measurement, same prompt, same whole bill record (NY A07380,
1,365 input tokens): Opus 460 out / 10.7 s / **1.83¢**; Sonnet 364 out / 7.9 s /
**0.96¢**. Same status, same three sponsors with party and district, same three
history moves, same companion bill — and both correctly refused to characterise
text they had not fetched. The Researcher later moved to Sonnet as well, on
harder evidence: the same Opus report cost **$1.11**, the Sonnet one **47¢**.

### 2 · Measured cost per exchange

One clean pass over the deploy, after prompt caching and compaction:

| agent | rounds | tools | wall | tokens in / out / cached | cost |
|---|---|---|---|---|---|
| Bill Reader | 2 | 1 | 12.4 s | 1,830 / 336 / 1,826 | **1.75¢** |
| Jurisdiction Guide | 3 | 2 | 12.4 s | 6,421 / 894 / 6,414 | **3.48¢** |
| Money Follower | 3 | 3 | 15.1 s | 6,344 / 838 / 0 | **8.05¢** |
| Tracker (posted to Discord) | 4 | 5 | 9.0 s | 4,639 / 537 / 0 | **2.57¢** |
| Researcher (16,104-char report, delivered) | 12 | 20 | 119 s | 24 / 5,938 / 142,082 | **47.2¢** |

A chat exchange is **2–8¢**. A full research report is **≈47¢**; a narrower one
(the acceptance run) is **≈15¢**. Every figure is computed from Converse's own
`usage` counters at Bedrock us-east-1 list price. It is not read off an invoice:
Cost Explorer lags a day and shows `$0` for today's Bedrock line items, and the
AWS Price List API has no row for any of these models — it returns Claude 3
Haiku and nothing else, which is exactly what 44b found in August.

**Prompt caching is the single largest cost lever here.** The Money Follower's
"who lobbied on HR 1" run was **25.64¢ over 42,692 input tokens** before caching
and **8.07¢** after. Those 42,692 tokens were never 42,692 tokens of record; they
were a few thousand, resent seven times, because Converse is stateless. Four
cache points — tool definitions, system prompt, and a rolling pair over the
history — and the panel prints the cache reads beside the tokens so the saving is
visible rather than claimed.

### 3 · IAM

Bedrock was already wired, as the lead said. Role **`govblock-amplify-compute`**
(both the build role and the compute role) already carried a `BedrockInvoke`
statement inside its **`govblock-data-access`** inline policy, at
`Resource: "*"`. Nothing new was created. That statement now names:

- the three inference-profile ARNs in us-east-1 (`opus-4-6-v1`, `sonnet-4-6`,
  `haiku-4-5`), **and**
- the underlying foundation-model ARNs in **us-east-1, us-east-2 and us-west-2**
  — twelve ARNs in all, because a `us.*` profile authorises against everything it
  fans out to. Scoping to the profile alone breaks invocation.

`PolicySecret` also gained `govblock/slack-*` and `govblock/discord-*`. The whole
document is committed at `scripts/agents/iam/govblock-data-access.json`, and was
verified by invoking through the deployed site after the change.

### 4 · Streaming: the verdict, with numbers

§1 asked for it measured.

| framing | events | first byte | last line | spread |
|---|---|---|---|---|
| `application/x-ndjson` | 418 | 23.27 s | 23.27 s | **0.00 s** |
| ndjson, `Accept-Encoding: identity` | 315 | 17.45 s | 17.45 s | **0.00 s** |
| `text/event-stream` | 342 | 14.88 s | 14.88 s | **0.00 s** |

Identical on `main.d2a69zdzqun8m7.amplifyapp.com`, so it is neither CloudFront
compression nor the custom domain. The decisive detail: the route enqueues its
`open` event **before Bedrock is called at all**, and that event still arrives 23
seconds late. **Amplify WEB_COMPUTE holds the whole response body until the
handler returns.** The SSE branch was removed once it had answered the question.

**And a second, worse limit found the same way.** The Researcher died on round
five with a 500 and an empty body. Not size — a 400 kB request goes through, a
300 kB prompt answers in 8.7 s, and 900 kB hits my own 413. Replaying the exact
failing state twice: **30.5 s and 30.8 s**. The same state sent straight to
Bedrock: healthy, `latencyMs 46,887`. **Amplify WEB_COMPUTE discards a response
after thirty seconds and does not honour `maxDuration`.** There is no CloudWatch
log group for the compute, so this is silent — it only shows up on a stopwatch.

Those two compound: we cannot stream, and no single request may take longer than
thirty seconds. Four things in the design exist only because of them, and three
are good engineering regardless:

1. **A round per POST.** The loop lives in the browser: one request is one round
   of the agent loop, the conversation comes back as `state` and goes out again.
   Costs no extra tokens (Converse is stateless; the history was already resent
   every round), costs one round trip per step. What it buys is that the
   Tracker's search lands on screen while it is still reading bills.
2. **Bounded context.** One tool result caps at 8,000 characters; older tool
   results compact, last two rounds verbatim. Latency tracks conversation length.
3. **`deliver_report`.** The round that kept dying was the one where the model
   retyped its whole report into a tool argument. The tool now takes a title and
   nothing else; the loop sends what the run has already written. The report
   cannot drift from what the reader sees, and the most expensive write in the
   run stops happening.
4. **An output ceiling from measured speed.** 1,200 tokens single call:
   Opus 4.6 **51 tok/s**, Sonnet 4.6 **46**, Haiku 4.5 **102**. Sonnet at 1,200 is
   25.8 s of writing alone. So `maxTokens` = model speed × **17 seconds** —
   867 Opus, 782 Sonnet, 1,734 Haiku. A round that hits the ceiling is *out of
   room, not finished*: the loop recognises `max_tokens`, asks it to continue
   from exactly where it stopped, and returns for another round.

**The escape hatch, priced, not built.** A **Lambda Function URL with response
streaming** dissolves both limits at once: `InvokeWithResponseStream` streams
token by token, and Lambda's ceiling is 15 minutes rather than 30 seconds.

- *Running cost:* $0.20 per million requests; duration $0.0000166667 per GB-s. A
  15 s round at 512 MB is **$0.000125**; a whole 120 s Researcher run held open
  as one streaming invocation is **≈$0.001**. Against 47¢ of Bedrock for that
  same report, the compute is **0.2 % of the bill**. Function URLs cost nothing
  extra.
- *What it actually costs:* a second deploy artifact outside Amplify's
  git-connected pipeline — the route bundled as a Lambda, its own execution role
  with the same twelve Bedrock ARNs, CORS, and a second thing to keep in step
  with the app. That is the price, and it is engineering, not dollars.
- *Recommendation:* worth doing when either token-by-token typing or rounds
  longer than thirty seconds becomes the thing standing between this and good.
  Today the round-per-POST design is better than adequate — watched tool calls
  are the product — but the 30 s ceiling is a real ceiling and it is the reason
  the Researcher needed four separate mitigations.

### 5 · The five agents

| name | model | speciality | tools |
|---|---|---|---|
| **Bill Reader** | Sonnet 4.6 | One bill's whole record, cited | `search_bills` `get_bill` `get_bill_text` `list_jurisdictions` |
| **Jurisdiction Guide** | Sonnet 4.6 | Who represents, which committee, where a bill sits, across 52 | rosters, committees, search |
| **Money Follower** | Opus 4.6 | Bill → sponsors → committees → filings, gaps named | adds `get_member_record` `get_lobbying` `get_fec` `top_sponsors` |
| **Tracker** *(agentic)* | Haiku 4.5 | Watch a topic, open each bill, digest, post | search + `get_bill` + the live connection's tool |
| **Researcher** *(agentic, inbox)* | Sonnet 4.6 | A long sourced report, delivered | every read tool + `deliver_report` |

All five read through `/api/policy/[resource]` over HTTPS — the same routes the
pages read, with the same jurisdiction scoping, the same NY-only and
Congress-only guards, and the same half-hour CloudFront cache. This lane added no
second way to read the database.

**The Tracker's observable run, end to end on the deploy:**

```
search_bills   q: housing, jurisdiction: NY, limit: 8  → 8 bills, 5 committees · 574 ms
get_bill       bill_id: 2014457    → 3 sponsors, 6 history, 1 referrals, 3 progress · 241 ms
get_bill       bill_id: 1975863    → 4 sponsors, 6 history, 1 referrals, 3 progress · 418 ms
get_bill       bill_id: 1902711    → 12 sponsors, 3 history, 1 referrals, 3 progress · 587 ms
get_bill       bill_id: 2152290    → 1 sponsors, 14 history, 4 rollCalls, 3 referrals · 344 ms
get_bill       bill_id: 2025009561 → 1 sponsors, 2 history, 1 texts · 330 ms
post_to_discord  → posted to Discord · id 1544494026705604689
Claude Haiku 4.5 · 4 rounds · 9.0 s · $0.0257
```

Five bills opened in parallel in one round, and three of those calls are on
screen while the run is still going. Before Discord existed it ran the same plan
and reported honestly that Slack was not connected, printing the whole digest in
the reply — which is the behaviour the brief asked for and not a stub.

**Two grounding defects found by driving it, both fixed:**

1. **The wrong-bill trap.** `/api/policy/bill?state=US&number=HR%201` returned
   **HB10171** — a food-and-nutrition grant bill — with HTTP 200, because an
   unmatched number fell through to `getBills(f, 1)`. The Money Follower noticed
   and told the reader, which is the prompt working, but no prompt should have
   to. `get_bill` now compares the number asked for against the number returned,
   punctuation stripped, and calls a mismatch a miss. The lead has since fixed
   the route; the guard stays as defence in depth.
2. **The Bill Reader elaborating a title.** Asked about NY A07380, whose
   description is a verbatim copy of its title, it wrote that the bill covers
   "what information must be included or disclosed when such units are marketed
   to prospective tenants" — reasonable, and nowhere in the record. The rule now
   sits in the preamble all five share: *a field that only restates another is
   not more information; say so and offer to fetch what would answer the
   question; filling a gap plausibly is the one way any of these agents can be
   wrong that matters.*

### 6 · Connections — the evaluation, and the ruling

Evaluated against evidence in this account rather than from the documentation.
**44b built a live AgentCore Gateway here on 2026-08-09** — `44b-gateway-dvq95nm6dw`,
one REST target, READY, two credential providers, two AgentCore Runtime agents on
Haiku 4.5. So Identity, Gateway and Runtime are all GA and working in
638175140432; the question was never availability, it was fit.

**Idle cost, measured:** Cost Explorer, 2026-08-09 → 09-01, service *Amazon
Bedrock AgentCore*: **$0.0000918** for twenty-three days. Effectively zero.
Consumption-priced, no idle compute. That is not the objection.

**What is:**

- **AgentCore Identity has a first-class `SlackOauth2` credential provider**, and
  `GoogleOauth2` and `MicrosoftOauth2` beside it — precisely Brendan's Drive and
  Gmail list. It is the real AWS analogue of Vercel Connections. But it wants
  `clientId` + `clientSecret` for a three-legged flow, and reading a token back
  (`get-resource-api-key` / `get-resource-oauth2-token`) requires a
  **workload-identity token**, which a Next.js SSR route does not have and would
  need machinery to mint.
- **Gateway-over-Slack is not the shape it looks like.** Slack publishes
  `swagger: 2.0` (1.0 MB, 170 operations); Gateway requires OpenAPI 3.0+ — 44b
  had 3.1.0 *rejected* and down-converted. So the "standard" path means
  hand-authoring an OpenAPI 3.0 spec, an S3 object, a Cognito user pool for
  inbound auth, a gateway, a credential provider and an execution role — to make
  one `chat.postMessage`.
- **Amazon Q Business connectors:** considered and rejected, knowingly. They are
  enterprise-search connectors that index a source for retrieval. They do not let
  an agent act on an app, which is the whole requirement.

**Recommendation, and it honours the lean:** ship the credential in Secrets
Manager now; adopt **AgentCore Identity at the second credential** — a second
workspace, or the first *per-user* token (a connection acting as the reader
rather than as the app, which is what Drive and Gmail will be). That is the point
where the OAuth dance stops being work we can skip, and it is written as a
comment in `lib/agents/connections/index.ts` so the reversal point lives where
the next person will read it.

**Discord shipped first, at Brendan's preference, and it was the test of the
contract:** one new file and one line in `CONNECTIONS`. Nothing in the agents,
the tool loop, the route or the surface was rewritten to admit it. A webhook URL
is the whole credential and it names its own channel, so **the destination is not
a parameter anywhere in this system** — which answers by construction the
question a public route holding an actuator raises.

Three Discord facts are in the code because each cost a real failure: `content`
caps at 2,000 characters and an embed's `description` at 4,096, so a long digest
goes as embeds split on a blank line; **a webhook pointed at a forum channel must
carry `thread_name`** (PolicyBot's channel is a forum — the first real run came
back 400), so the first post tries the plain shape, retries once with a thread
name taken from the digest's first line, and remembers the answer for the life of
the compute instance; and `?wait=true` returns the created message, which is what
lets a run report an id rather than assert success, and gives the thread id that
keeps a split digest in one thread.

### 7 · The Agentic Inbox

`/blocks/intelligence` — shadcn's sidebar-09 mail block with its markup and
classNames intact and its contents replaced. A task is a thread: what you send is
in **Sent** the moment you send it, and the report arrives as an **unread reply**
on that same thread. Folders are Inbox, Sent, Drafts, Starred and Trash; trash is
soft and the same button restores. Search reaches across every folder. The
**To:** field is the agent picker — five addresses with monograms and the same
one-line speciality `/agents` shows — and the **Subject** goes to the server with
the task, becomes the report's title, and names the Discord thread it lands in.

**Acceptance, driven headless at 1714 px:** composed to `researcher@govblock`
with a subject → watched the pulse beside the live tool line → thread in Sent →
unread reply arriving on the same thread → **delivered to Discord in 2 parts, id
1544493406359654514** → starred → searched → trashed → restored. Screenshots
`10-`…`16-` in the lane's scratch.

Threads are kept in this browser and nowhere else, and the surface says so twice.
That is not an oversight: govblock is public and has no accounts, so a
server-side inbox would be *one shared inbox* — every visitor reading every other
visitor's tasks and paying for them.

### 8 · Priced, not built

**v2 — close-the-tab delivery.** Today a task dies with the tab. Two shapes:

| | AgentCore Runtime | SQS + Lambda worker |
|---|---|---|
| What moves | the loop is ported into an AgentCore agent | the loop runs unchanged in a Lambda |
| Precedent here | 44b runs two agents on it already | none, but it is the smaller change |
| Idle cost | **$0.0000918 / 23 days**, measured | SQS $0.40/M requests; $0 idle |
| Per task | consumption | ≈$0.001 compute at 120 s × 512 MB |
| Storage | — | one Aurora table, marginal cost ≈ $0 |
| Effort | container, harness, a second deployment story | one function, one queue, one table |

At **100 tasks a day** both are **under $0.10/month of infrastructure**; Bedrock
at ~$0.30–0.50 a report is 99 % of the bill either way. **Recommendation: SQS +
Lambda**, because the loop is already TypeScript and would run unchanged, and
because it composes with the Lambda Function URL above — the same artifact
solves streaming, the 30 s ceiling and background execution. AgentCore Runtime is
the right answer if the agents ever need to be callable by things other than this
app.

*The identity problem it creates:* a public site with no accounts still needs to
know whose task is whose. Cheapest honest answer is a **per-browser token** — a
UUID minted in localStorage, sent as a header, stored on the task row. It is not
authentication and must not be described as such; it is a claim check. Cost:
nothing. It is also the point at which someone must decide whether tasks
submitted by strangers may spend the account's Bedrock budget in the background,
which today they cannot, because they stop when the tab does.

**Attachments and rich formatting** (§6, deferred). Attachments: Discord takes
multipart uploads, so a report as `.md` is an afternoon; a `.pdf` needs a
renderer, which on Lambda means a 5 GB-class package or a second service —
call it two days and a new dependency. Rich formatting: the current renderer is
about sixty lines and handles bold, italic, code, links, headings and rules
deliberately, refusing lists and tables so the model cannot dictate the shape of
an answer; a real markdown pipeline is a dependency and a sanitiser, half a day,
and worth it only when someone wants tables.

### 9 · What is stubbed, and what to watch

- **Slack is committed and parked.** `scripts/agents/slack-app-manifest.json`
  (chat:write and chat:write.public, nothing else) and
  `scripts/agents/connect-slack.sh` are ready; the `govblock/slack` secret exists
  with an empty `bot_token`, so the connection reports itself not-connected and
  **contributes no tools** — an agent is never offered a way to post that does not
  work. One command connects it.
- **`/api/policy/record` can exceed the Data API's 1 MB row cap** for a member
  with a long sponsorship list. The tool surfaces the sentence honestly and the
  agent works around it; the route's `limit` does not bound the payload. Reported;
  the lead owns it.
- **The per-IP rate cap is a brake, not an access control.** It is a Map in one
  warm compute instance, so a burst spread across instances gets more than twenty
  a minute. The comment says so.
- **The round cap is enforced server-side** at the agent's own ceiling (12, or 24
  for the Researcher), counted from the assistant turns already in the
  conversation, where a client cannot edit it.
- **`components/policy/assist-chat.tsx` still posts to `/api/chat`, which does
  not exist.** Not this lane's file. The repoint is the lead's; the contract is
  in HEARTBEAT 2 and note it is **not** the AI SDK's `useChat` protocol — the
  reader in `app/agents/agent-chat.tsx` is the one to copy.

### 10 · The contract, for the repoint

```
POST /api/agents/chat            → application/x-ndjson, one event per line
  first call   { agent, jurisdiction?, subject?, turns: [{ role, text }] }
  each after   { agent, jurisdiction?, subject?, state: { messages } }

events  { t:"open",  model, label }
        { t:"text",  v }
        { t:"tool",  id, name, input }
        { t:"tool_result", id, name, ok, summary, ms }
        { t:"continue" }                  // the round ran out of output room
        { t:"state", messages, done }     // post `messages` back while !done
        { t:"done",  stopReason, usage, usd, ms }
        { t:"error", message }
```

Slugs: `bill-reader`, `jurisdiction-guide`, `money-follower`, `tracker`,
`researcher`.

---

LANE X STATUS: COMPLETE — Bedrock wired on the models this account can actually
invoke, five specialists live on /agents, the Tracker and the Researcher both
running observable multi-step tasks end to end on the deploy, Discord connected
and delivering, Slack committed and parked behind one command, and the Agentic
Inbox accepted at 1714 px. Two platform limits found and measured rather than
guessed — no response streaming, and a hard 30 s response ceiling — with the
Lambda Function URL that dissolves both priced in §4 and deliberately not built.

LEAD: 10:00Z — LANE X ACCEPTED. Verified independently on the deploy: the mail spine serves (Inbox/Sent/Drafts/Starred/Trash, "Search mail…", Compose, the per-browser honesty line), all six surfaces answer, and the lane's own §6 acceptance run — compose → pulse → Sent → unread reply → Discord id 1544493406359654514 → star → search → trash → restore — is documented with screenshots. One correction to §9 for the record: the record?id=1326 1 MB defect is FIXED (lead, f816953, verified on build 90 — the vote history is bounded in SQL per side), so that item is closed, not open. What this lane leaves behind: probe-don't-list as the law of this AWS account; deliver_report and the max_tokens-continuation as agent-loop canon; two platform limits measured with the one artifact that dissolves both (plus background execution) priced for Brendan rather than built on impulse; and a mail metaphor that is honest about where it lives. The Lambda Function URL recommendation and the v2 table go to Brendan with the lead's endorsement: SQS + Lambda as recommended, the per-browser claim-check named for what it is not. The /api/chat repoint is the lead's next act, against §10's contract. Stand down.
