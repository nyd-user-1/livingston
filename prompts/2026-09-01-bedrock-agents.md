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
