#!/usr/bin/env node
// scripts/pipeline/build-pipeline-doc.mjs — regenerate docs/PIPELINE.md.
//
//   node scripts/pipeline/build-pipeline-doc.mjs
//
// PIPELINE.md is a status document, not an essay, so it is generated: the
// verdict column comes from openstates.pipeline_reconcile (the latest row per
// jurisdiction) and the source column from docs/PROVENANCE.md, which lane IN
// built by fetching every feed rather than by remembering them. A hand-written
// status table is out of date the first night nobody updates it.

import fs from "node:fs";
import path from "node:path";
import { connect, REPO, log } from "./_lib/db.mjs";
import { prepareSchema } from "./_lib/schema.mjs";

const JUR = {
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado",
  CT: "Connecticut", DC: "District of Columbia", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota",
  MO: "Missouri", MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota",
  NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NV: "Nevada",
  NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", US: "U.S. Congress",
  UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington", WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
};

// Credentials the OPEN route needs, read out of openstates-scrapers'
// docker-compose.yml by lane IN — not guessed. A state that needs a key is a
// state Brendan has to sign up for; that is a real cost of independence.
const CREDS = {
  NY: ["`NYS_LEGISLATION_API_KEY` — free, we already hold it", "https://legislation.nysenate.gov/static/docs/html/index.html"],
  IN: ["`INDIANA_API_KEY` — **Brendan must obtain**", "https://docs.api.iga.in.gov/"],
  DC: ["`DC_API_KEY` — **Brendan must obtain**", "https://lims.dccouncil.gov/"],
  AR: ["`AR_FTP_USER` / `AR_FTP_PASSWORD` — **Brendan must obtain**", "ftp://www.arkleg.state.ar.us/"],
  VA: ["`VIRGINIA_FTP_USER` / `VIRGINIA_FTP_PASSWORD` — **Brendan must obtain**", "https://lis.virginia.gov/SiteInformation/csv.html"],
  CA: ["no key, but a **MariaDB server inside the container** to load the 1.22 GB MySQL dump", "https://downloads.leginfo.legislature.ca.gov/"],
};

function parseProvenance() {
  const file = path.join(REPO, "docs", "PROVENANCE.md");
  if (!fs.existsSync(file)) return {};
  const out = {};
  let inFeeds = false;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("## The jurisdiction's own structured feed")) { inFeeds = true; continue; }
    if (inFeeds && line.startsWith("## ")) break;
    if (!inFeeds || !line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || !/^[A-Z]{2}$/.test(cells[1])) continue;
    out[cells[1]] = { feed: cells[3], format: cells[4], verified: cells[5].replace(/\*/g, ""), evidence: cells[6] };
  }
  return out;
}

const c = await connect({ label: "pipeline-doc" });
await prepareSchema(c, { log });

const { rows: verdicts } = await c.query(`
  SELECT DISTINCT ON (state) state, session, source, verdict, ran_at, bills_pct, actions_pct, sponsors_pct, votes_pct, detail, notes
    FROM openstates.pipeline_reconcile WHERE verdict <> 'promoted'
   -- Native first, then most recent. New York has verdicts from BOTH engines and
   -- the native one is the jurisdiction's actual pipeline; ordering by ran_at
   -- alone showed NY as 5.86% (lane IN's 1,487-bill Open States sample) instead
   -- of the 99.78% the feed reconciles at.
   ORDER BY state, (source = 'openstates') ASC, ran_at DESC`);
const byState = Object.fromEntries(verdicts.map((v) => [v.state, v]));

const { rows: loaded } = await c.query(`
  SELECT state, source, count(*) n, count(DISTINCT session) sessions FROM openstates.bills GROUP BY 1,2`);
const loadedBy = {};
for (const r of loaded) (loadedBy[r.state] ??= []).push(r);

const prov = parseProvenance();
const codes = Object.keys(JUR).sort();

const ICON = { parity: "🟢 **parity**", close: "🟡 **close**", gap: "🟠 **gap**", failed: "🔴 **failed**" };
const tally = { parity: 0, close: 0, gap: 0, failed: 0, "not yet run": 0 };

const rows = codes.map((code) => {
  const p = prov[code] ?? {};
  const v = byState[code];
  const mine = loadedBy[code] ?? [];
  const feedOk = /^YES/.test(p.verified ?? "");
  const native = mine.find((m) => m.source !== "openstates");
  const engine = native ? `native \`${native.source}\`` : mine.length ? "Open States scraper" : feedOk ? "feed (unused)" : "Open States scraper";
  const status = v ? (ICON[v.verdict] ?? v.verdict) : "not yet run";
  tally[v ? v.verdict : "not yet run"] += 1;
  const cred = CREDS[code] ? CREDS[code][0] : "—";
  const cadence = native ? "nightly" : mine.length ? "weekly" : "not scheduled";
  const numbers = v && v.bills_pct != null
    ? `bills ${v.bills_pct}% · actions ${v.actions_pct ?? "–"}% · sponsors ${v.sponsors_pct ?? "–"}%`
    : (v && v.notes ? String(v.notes).replace(/\|/g, "/").slice(0, 150) : "—");
  return `| ${code} | **${JUR[code]}** | ${engine} | ${feedOk ? "✔ verified" : (p.verified === "BLOCKED" ? "blocked" : "—")} | ${cred} | ${cadence} | ${status} | ${numbers} | LegiScan |`;
});

const doc = `# PIPELINE — every jurisdiction, from the source, on our boxes

**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`scripts/pipeline/build-pipeline-doc.mjs\`.
**Lane:** DP (\`prompts/2026-08-28-direct-pipeline.md\`). **Inputs:** \`docs/PROVENANCE.md\` (lane IN) and
\`openstates.pipeline_reconcile\` (live). Re-run the generator; do not hand-edit the table.

## What this is

Brendan, 2026-08-28: *"We use LegiScan now and leverage it as much as possible... **And** we establish
our own pipeline for all 51, direct to the states, so that we never have to rely on either platform."*
And: *"what I thought we were doing was creating 51 loaders, that's all."*

So: for each jurisdiction, a scheduled job on our box that pulls the legislature's own data and loads it
into schema \`openstates\`. **LegiScan still writes every canonical table.** A jurisdiction moves only when
it reaches \`parity\` twice running *and* Brendan names it — \`promote.mjs\` enforces both and two more locks.

## Where it stands

| verdict | jurisdictions |
|---|---:|
| 🟢 parity — ≥99% bills, ≥97% actions and sponsors | ${tally.parity} |
| 🟡 close — ≥95% bills, ≥90% actions and sponsors | ${tally.close} |
| 🟠 gap | ${tally.gap} |
| 🔴 failed — the scrape produced nothing, or one side has no rows | ${tally.failed} |
| not yet run | ${tally["not yet run"]} |

**Read that honestly: ${52 - tally["not yet run"]} of 52 have been through the pipeline, ${tally.parity + tally.close} of them at \`close\` or better.** The pipeline —
loaders, reconcile, crosswalk, schedule — is built and exercised across both engines; most \`gap\` rows
above are a BUDGET, not a disagreement. \`pipeline_reconcile.detail\` splits the two: \`theirs_in_ours\` is
correctness (100% almost everywhere) and \`ours_in_theirs\` is completeness (low wherever a scrape was
cut short at 20 minutes). The remaining rows are a queue, and the per-state cost is the scrape, not the
code — \`scrape.mjs <juris>\` then \`load.mjs <juris>\` then \`reconcile.mjs\` needs no new code for any of them.

## The two engines

**Native feed**, where the legislature publishes one. Take *everything* it offers, not the LegiScan subset.
Both native loaders found the same thing, and it is the single most useful measurement in this lane:
**the bulk endpoint exists and the per-item route is what everyone reaches for first.**

| | per-item route | bulk route | ratio |
|---|---|---|---|
| **NY** \`legislation.nysenate.gov\` | 25,402 requests (one per bill) | **75 requests**, 261 s, whole session | **339×** |
| **US** \`govinfo.gov/bulkdata\` | ~20,000 XML files, ~3 h | **8 zips**, 71 s, whole congress | **2,300×** |

**Open States scrapers**, mirrored (GPL-3.0) and run by us, for everyone else. The spread between states is
about 2,000×: New Jersey publishes its whole session as one ZIP and scrapes in **35 seconds**; New York
would take **~21 hours** at ~15 bills/min. Expect breakage — Open States' own issue tracker shows **~27% of
jurisdictions filed a scraper defect in the last 90 days and ~9% produced nothing at all.**

## The 52

\`engine\` = what pulls it · \`feed\` = did lane IN verify a structured feed by fetching it ·
\`credentials\` = what the open route needs before it can run at all · \`verdict\` = latest
\`pipeline_reconcile\` row · \`writes canonical\` = who owns \`"Bills"\` and friends **today**.

| | jurisdiction | engine | feed | credentials | cadence | verdict | latest numbers | writes canonical |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Credentials Brendan must obtain

Read out of \`openstates-scrapers/docker-compose.yml\`, not guessed. **Five jurisdictions need a credential
and one needs a database server** before "run it ourselves" is even possible:

${Object.entries(CREDS).map(([k, v]) => `- **${JUR[k]}** — ${v[0]} · sign-up: ${v[1]}`).join("\n")}

Plus one decision, not a credential: **Open States' bulk downloads are behind a login** (lane IN, 15:34) —
\`openstates.org/data/session-csv/\` redirects to \`open.pluralpolicy.com\` and says *"Please log in to access
download links."* The catalogue is public and current; the files are not. That is why this lane runs the
scrapers rather than mirroring their exports.

## Known gaps, stated rather than smoothed over

- **New York cannot reach parity on the Senate API alone.** The feed carries **819** Assembly roll calls
  against LegiScan's **7,129** — Assembly floor votes live on \`nyassembly.gov\`, not in the Senate's system.
  Closing it means one request per bill against a second host, which is exactly the cost the bulk endpoint
  avoids, so it wants its own budgeted job rather than being bolted onto the nightly.
- **govinfo carries ~1.5× the action rows LegiScan does**, because it publishes each action once per source
  system that recorded it ("House floor actions" *and* "Library of Congress" for the same vote). A
  count-identity test fails by construction; \`reconcile.mjs\` therefore also reports \`date_set_pct\`, the
  share of bills where the *set of dates something happened* is identical. The verdict still uses the strict
  measure so it stays comparable with lane IN's hand-run numbers.
- **Per-member federal roll calls are not fetched.** BILLSTATUS gives the roll number and the clerk's URL;
  the votes are one request each on \`clerk.house.gov\` and \`senate.gov\`. Those rows are stored with NULL
  tallies and a description saying where the detail is — a roll call with a fabricated zero tally would be
  worse than an absent one.
- **California's scraper needs a MariaDB server** in the container to load the state's 1.22 GB MySQL dump.
  It fails in 8.7 seconds without one. Verified today, not predicted.
- **Blocked politely, not worked around:** AZ, DC, ME, OK, RI, TN by \`robots.txt\`; IN, VA by repeated 429.
  Several of those are paths Open States' own scrapers fetch anyway. We do not.

## What the pipeline cannot reproduce

\`followthemoney_eid\` (**20,922** of our \`"People"\` rows) and \`knowwho_pid\` (18,502). Open States carries
neither, and our \`ftm_total\` / \`ftm_in_state\` / \`ftm_out_of_state\` columns hang off the first. Ballotpedia
(99.6%) and VoteSmart (75.6%) **are** independently reproducible from \`openstates/people\`, which is CC0.
**The money data is the sharpest single dependency on LegiScan we have.**
`;

fs.writeFileSync(path.join(REPO, "docs", "PIPELINE.md"), doc);
console.log(JSON.stringify({ written: "docs/PIPELINE.md", jurisdictions: codes.length, tally, verdicts: verdicts.length }, null, 1));
await c.end();
