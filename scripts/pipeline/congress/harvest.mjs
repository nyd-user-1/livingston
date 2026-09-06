#!/usr/bin/env node
// scripts/pipeline/congress/harvest.mjs — the congress.gov families we never held,
// into Aurora, one table each.
//
//   node scripts/pipeline/congress/harvest.mjs                 # every family, 119th
//   node scripts/pipeline/congress/harvest.mjs --family members
//   node scripts/pipeline/congress/harvest.mjs --since 2026-08-25T00:00:00Z
//
// Shape, per §2b: `congress_` prefix, the API's own key as the primary key, typed
// columns for what a page will read, and `payload jsonb` carrying the record
// verbatim so a page can reach a field nobody has typed yet. Nothing here
// overwrites LegiScan or govinfo — these are tables we did not have.
//
// Only the list endpoints are walked. Every family below carries enough in its
// list record to be worth serving; the ones that do not (committee-meeting and
// hearing are an eventId and a URL) need one detail request each and are marked
// `detail: true` so the cost is a decision rather than a surprise.
//
// Since 2026-09-05 (Brendan: "we should get everything"), a family can also
// carry `children`: lists that hang off one record — a committee's nominations
// and communications, a nomination's actions, an issue's articles. Each child
// is its own table keyed on the parent, walked once per parent row, and gated
// on the count the detail record reports where it reports one, so a nomination
// with no hearings costs no request. `--since` rides along as fromDateTime.
//   node scripts/pipeline/congress/harvest.mjs --family committees
//   node scripts/pipeline/congress/harvest.mjs --family hearings --detail-limit 2000
//   node scripts/pipeline/congress/harvest.mjs --no-children

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(path.join(REPO, "noop.js"));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const CONGRESS = Number(val("--congress", "119"));
const ONLY = val("--family");
const PAGE = 250;
const PACE_MS = Number(val("--pace", "120"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim(); if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("="); if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

const KEY = process.env.CONGRESS_API_KEY;
const UA = process.env.CONGRESS_USER_AGENT || "govblock/1.0 (+https://govblock.app)";
if (!KEY) { console.error("congress/harvest: CONGRESS_API_KEY is required"); process.exit(2); }

/* ---- credentials, resolved the same way sync.mjs does -------------------- */
function auroraUrlFromSecret() {
  const region = process.env.AWS_REGION || "us-east-1";
  const cluster = process.env.AURORA_CLUSTER_ID || "aurora-2525";
  const aws = (a) => execFileSync("aws", [...a, "--region", region], { encoding: "utf8" }).trim();
  const arn = aws(["rds", "describe-db-clusters", "--db-cluster-identifier", cluster, "--query", "DBClusters[0].MasterUserSecret.SecretArn", "--output", "text"]);
  const host = aws(["rds", "describe-db-clusters", "--db-cluster-identifier", cluster, "--query", "DBClusters[0].Endpoint", "--output", "text"]);
  const secret = JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", arn, "--query", "SecretString", "--output", "text"]));
  return `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${process.env.POLICY_DATABASE || "policy"}?sslmode=require`;
}
let DB = process.env.AURORA_POLICY_URL;
if (!DB || !/^postgres(?:ql)?:\/\/[^:@/]+:[^@]+@[^@/:]+/.test(DB)) DB = auroraUrlFromSecret();
function pgConfig(url) {
  const m = /^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/.exec(url);
  if (!m) throw new Error("cannot parse the Aurora URL");
  const [, user, password, host, port, database, query] = m;
  let pw = password; try { pw = decodeURIComponent(password); } catch { pw = password; }
  return { user, password: pw, host, database, port: Number(port || 5432), ssl: /sslmode=(require|verify)/.test(query ?? "") ? { rejectUnauthorized: false } : undefined, application_name: "congress-harvest" };
}

/* ---- the API ------------------------------------------------------------- */
const API = "https://api.congress.gov/v3";
let requests = 0, lastCall = 0;
async function api(q) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wait = PACE_MS - (Date.now() - lastCall); if (wait > 0) await sleep(wait);
    lastCall = Date.now(); requests += 1;
    const res = await fetch(`${API}${q}${q.includes("?") ? "&" : "?"}format=json`, { headers: { "X-Api-Key": KEY, "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) { await sleep(Math.min(60_000, 2000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }
  throw new Error("gave up after 5 attempts");
}

/* ---- helpers ------------------------------------------------------------- */
// The API names each record's own address in `url`; the path after /v3 is the
// detail path, and the children hang off it. Reading it beats rebuilding it:
// a nomination is /nomination/119/1201-7, and the part is in the URL, not a
// field one could guess the separator for.
const ownPath = (r) => (r?.url ? String(r.url).replace(/^https?:\/\/api\.congress\.gov\/v3/, "").replace(/\?.*$/, "") : null);
const json = (v) => (v == null ? null : JSON.stringify(v));
const yearOfCongress = (c) => (c - 1) * 2 + 1789;
const chamberPath = (r) => String(r?.chamber ?? "").toLowerCase().replace("house of representatives", "house");

/* ---- the families -------------------------------------------------------- */
// `key` must be the API's own identity for the record, so a re-run upserts.
const n = (v) => (v == null || v === "" ? null : Number(v));
const FAMILIES = [
  { table: "congress_members", path: (c) => `/member/congress/${c}`, listKey: "members",
    key: (r) => String(r.bioguideId),
    cols: { bioguide_id: (r) => r.bioguideId, name: (r) => r.name, party: (r) => r.partyName,
            state: (r) => r.state, district: (r) => n(r.district),
            // The official portrait — the one thing LegiScan's People rows do not carry.
            portrait_url: (r) => r.depiction?.imageUrl ?? null },
    // The roster page and the member record are two different documents wearing
    // one name. `/member/congress/119` returns nine keys — bioguideId, name,
    // party, state, district, a two-field `terms`, a portrait and a URL. The
    // office address, the official website and the birth year exist only on
    // `/member/{bioguideId}`, and storing the roster rows under the name
    // `member-detail` is why every member page's Contact section was empty from
    // the day it shipped. 553 requests against 20,000/hour: verify the shape,
    // not the name.
    //
    // `floor` is why this family cannot be truncated by --detail-limit: 553
    // members half-detailed is 553 members whose Contact section is a coin flip.
    detail: { since: 3650, floor: 600, path: (r) => `/member/${r.bioguideId}`, unwrap: (d) => d.member,
              cols: { address_information: (r) => (r.addressInformation ? JSON.stringify(r.addressInformation) : null),
                      official_website_url: (r) => r.officialWebsiteUrl ?? null,
                      birth_year: (r) => r.birthYear ?? null,
                      party_history: (r) => (r.partyHistory ? JSON.stringify(r.partyHistory) : null),
                      current_member: (r) => (r.currentMember == null ? null : String(r.currentMember)),
                      sponsored_count: (r) => r.sponsoredLegislation?.count ?? null,
                      cosponsored_count: (r) => r.cosponsoredLegislation?.count ?? null } },
    // What each member put their name to, across every congress the API
    // holds — the current one we already derive from the bill side; this is
    // the history (Brendan, 2026-09-06: "derive or get? long term?"). Walked
    // when the member's record is re-read, so a nightly costs nothing for a
    // member who has not changed.
    children: [
      { table: "congress_member_sponsored", listKey: "sponsoredLegislation", when: (row) => Number(row.sponsored_count ?? 1) > 0,
        path: (row) => `/member/${row.bioguide_id}/sponsored-legislation`,
        key: (r, row) => `${row.key}|${r.congress}-${r.type}-${r.number ?? r.amendmentNumber ?? ""}`,
        cols: { bioguide_id: (r, row) => row.bioguide_id, bill_type: (r) => r.type ?? null, number: (r) => String(r.number ?? r.amendmentNumber ?? ""),
                title: (r) => r.title ?? null, introduced_date: (r) => r.introducedDate ?? null, policy_area: (r) => r.policyArea?.name ?? null,
                latest_action: (r) => r.latestAction?.text ?? null, latest_action_date: (r) => r.latestAction?.actionDate ?? null } },
      { table: "congress_member_cosponsored", listKey: "cosponsoredLegislation", when: (row) => Number(row.cosponsored_count ?? 1) > 0,
        path: (row) => `/member/${row.bioguide_id}/cosponsored-legislation`,
        key: (r, row) => `${row.key}|${r.congress}-${r.type}-${r.number ?? r.amendmentNumber ?? ""}`,
        cols: { bioguide_id: (r, row) => row.bioguide_id, bill_type: (r) => r.type ?? null, number: (r) => String(r.number ?? r.amendmentNumber ?? ""),
                title: (r) => r.title ?? null, introduced_date: (r) => r.introducedDate ?? null, policy_area: (r) => r.policyArea?.name ?? null,
                latest_action: (r) => r.latestAction?.text ?? null, latest_action_date: (r) => r.latestAction?.actionDate ?? null } },
    ] },
  { table: "congress_amendments", path: (c) => `/amendment/${c}`, listKey: "amendments",
    key: (r) => `${r.congress}-${r.type}-${r.number}`,
    cols: { amendment_type: (r) => r.type, number: (r) => String(r.number), description: (r) => r.description ?? null,
            latest_action: (r) => r.latestAction?.text ?? null, latest_action_date: (r) => r.latestAction?.actionDate ?? null },
    // The list record carries no sponsor, so a Sponsor column reads as 493 em
    // dashes on H.R. 1. The detail has it. `since` is wide because the pass is
    // gated on detail_fetched_at: the first run pays for all 7,035, a later one
    // only for amendments that have moved.
    detail: { since: 3650, floor: 8000, refreshWhenNull: "actions_count", path: (r) => `/amendment/${r.congress}/${String(r.type).toLowerCase()}/${r.number}`,
              unwrap: (d) => d.amendment,
              cols: { sponsors: (r) => (r.sponsors ? JSON.stringify(r.sponsors) : null),
                      sponsor_name: (r) => (r.sponsors?.[0]?.fullName ?? null),
                      sponsor_bioguide: (r) => (r.sponsors?.[0]?.bioguideId ?? null),
                      purpose: (r) => r.purpose ?? null,
                      actions_count: (r) => r.actions?.count ?? null, cosponsors_count: (r) => r.cosponsors?.count ?? null,
                      text_versions_count: (r) => r.textVersions?.count ?? null,
                      amended_bill: (r) => json(r.amendedBill), chamber: (r) => r.chamber ?? null } },
    // An amendment's own actions, cosponsors and text, only where the record
    // says it has any: most have one action and no cosponsors.
    children: [
      { table: "congress_amendment_actions", listKey: "actions", when: (row) => Number(row.actions_count ?? 1) > 0,
        path: (row) => `/amendment/${row.congress}/${String(row.amendment_type).toLowerCase()}/${row.number}/actions`,
        key: (r, row) => `${row.key}|${r.actionDate}|${r.actionTime ?? ""}|${String(r.text ?? "").slice(0, 80)}`,
        cols: { action_date: (r) => r.actionDate ?? null, action_time: (r) => r.actionTime ?? null, text: (r) => r.text ?? null,
                action_type: (r) => r.type ?? null, recorded_votes: (r) => json(r.recordedVotes), source_system: (r) => r.sourceSystem?.name ?? null } },
      { table: "congress_amendment_cosponsors", listKey: "cosponsors", when: (row) => Number(row.cosponsors_count ?? 0) > 0,
        path: (row) => `/amendment/${row.congress}/${String(row.amendment_type).toLowerCase()}/${row.number}/cosponsors`,
        key: (r, row) => `${row.key}|${r.bioguideId}`,
        cols: { bioguide_id: (r) => r.bioguideId ?? null, name: (r) => r.fullName ?? null, party: (r) => r.party ?? null,
                state: (r) => r.state ?? null, sponsorship_date: (r) => r.sponsorshipDate ?? null,
                is_original: (r) => (r.isOriginalCosponsor == null ? null : String(r.isOriginalCosponsor)) } },
      { table: "congress_amendment_texts", listKey: "textVersions", when: (row) => Number(row.text_versions_count ?? 0) > 0,
        path: (row) => `/amendment/${row.congress}/${String(row.amendment_type).toLowerCase()}/${row.number}/text`,
        key: (r, row) => `${row.key}|${r.date ?? ""}|${r.type ?? ""}`,
        cols: { version_type: (r) => r.type ?? null, version_date: (r) => r.date ?? null, formats: (r) => json(r.formats),
                text_url: (r) => r.formats?.find((f) => /text/i.test(f.type))?.url ?? null,
                pdf_url: (r) => r.formats?.find((f) => /pdf/i.test(f.type))?.url ?? null } },
    ] },
  { table: "congress_nominations", path: (c) => `/nomination/${c}`, listKey: "nominations",
    key: (r) => `${r.congress}-${r.number}-${r.partNumber ?? 0}`,
    cols: { number: (r) => String(r.number), part_number: (r) => String(r.partNumber ?? ""), citation: (r) => r.citation ?? null,
            description: (r) => r.description ?? null, organization: (r) => r.organization ?? null,
            received_date: (r) => r.receivedDate ?? null, latest_action: (r) => r.latestAction?.text ?? null },
    // The record: the nominees with their positions, whether it is privileged,
    // and the counts that decide which children are worth a request.
    detail: { since: 3650, floor: 3000, refreshWhenNull: "actions_count", path: (r) => ownPath(r), unwrap: (d) => d.nomination,
              cols: { nominees: (r) => json(r.nominees), is_privileged: (r) => (r.isPrivileged == null ? null : String(r.isPrivileged)),
                      authority_date: (r) => r.authorityDate ?? null, latest_action_date: (r) => r.latestAction?.actionDate ?? null,
                      actions_count: (r) => r.actions?.count ?? null, committees_count: (r) => r.committees?.count ?? null,
                      hearings_count: (r) => r.hearings?.count ?? null } },
    children: [
      { table: "congress_nomination_actions", listKey: "actions", when: (row) => Number(row.actions_count ?? 1) > 0,
        path: (row) => `${ownPath(row.payload)}/actions`, key: (r, row) => `${row.key}|${r.actionDate}|${String(r.text ?? "").slice(0, 80)}`,
        cols: { action_date: (r) => r.actionDate ?? null, text: (r) => r.text ?? null, action_type: (r) => r.type ?? null,
                committees: (r) => json(r.committees) } },
      { table: "congress_nomination_committees", listKey: "committees", when: (row) => Number(row.committees_count ?? 1) > 0,
        path: (row) => `${ownPath(row.payload)}/committees`, key: (r, row) => `${row.key}|${r.systemCode}`,
        cols: { system_code: (r) => r.systemCode ?? null, name: (r) => r.name ?? null, chamber: (r) => r.chamber ?? null,
                activities: (r) => json(r.activities) } },
      { table: "congress_nomination_hearings", listKey: "hearings", when: (row) => Number(row.hearings_count ?? 0) > 0,
        path: (row) => `${ownPath(row.payload)}/hearings`, key: (r, row) => `${row.key}|${r.jacketNumber ?? r.number ?? r.date}`,
        cols: { jacket_number: (r) => String(r.jacketNumber ?? ""), hearing_date: (r) => r.date ?? null, citation: (r) => r.citation ?? null,
                number: (r) => String(r.number ?? ""), part_number: (r) => String(r.partNumber ?? "") } },
    ] },
  { table: "congress_committee_reports", path: (c) => `/committee-report/${c}`, listKey: "reports",
    // The citation alone is NOT the identity: H. Rept. 119-608 exists as part 1
    // and part 2, two different documents, and keying on the citation dropped
    // the second. The part belongs in the key.
    key: (r) => `${r.citation ?? `${r.congress}-${r.chamber}-${r.type}-${r.number}`}-p${r.part ?? 1}`,
    cols: { citation: (r) => r.citation ?? null, chamber: (r) => r.chamber ?? null, report_type: (r) => r.type ?? null,
            number: (r) => String(r.number ?? ""), part: (r) => n(r.part) },
    // The committee that filed it, and the bill it is about, are on the report
    // record — neither is in the list. 921 requests, once.
    // The endpoint is keyed on the report NUMBER and answers with every part of
    // it: /committee-report/119/HRPT/106 returns Book 2 and Book 1, in that
    // order. Taking [0] gave both of H.R. 1's rows Book 2's record, so the page
    // printed "H. Rept. 119-106,Book 2" twice where congress.gov prints Book 1
    // and Book 2. The part is already in the key; it has to be in the unwrap.
    detail: { since: 3650, floor: 1200, refreshWhenNull: "text_count", path: (r) => `/committee-report/${r.congress}/${r.type}/${r.number}`,
              unwrap: (d, row) => {
                const all = Array.isArray(d.committeeReports) ? d.committeeReports : [d.committeeReports].filter(Boolean);
                const want = String(row?.part ?? 1);
                return all.find((r) => String(r?.part ?? 1) === want) ?? all[0] ?? null;
              },
              cols: { committees: (r) => (r.committees ? JSON.stringify(r.committees) : null),
                      committee_code: (r) => (r.committees?.[0]?.systemCode ?? null),
                      committee_name: (r) => (r.committees?.[0]?.name ?? null),
                      title: (r) => r.title ?? null,
                      issue_date: (r) => r.issueDate ?? null,
                      text_count: (r) => r.text?.count ?? null, associated_bill: (r) => json(r.associatedBill) } },
    children: [
      { table: "congress_report_texts", listKey: "text", when: (row) => Number(row.text_count ?? 1) > 0,
        path: (row) => `/committee-report/${row.congress}/${row.report_type}/${row.number}/text`,
        key: (r, row) => `${row.key}|${r.formats?.[0]?.url ?? ""}`,
        cols: { formats: (r) => json(r.formats), text_url: (r) => r.formats?.find((f) => /text/i.test(f.type))?.url ?? null,
                pdf_url: (r) => r.formats?.find((f) => /pdf/i.test(f.type))?.url ?? null, part: (r) => r.part ?? null } },
    ] },
  { table: "congress_laws", path: (c) => `/law/${c}`, listKey: "bills",
    key: (r) => `${r.congress}-${r.type}-${r.number}`,
    cols: { bill_type: (r) => r.type, number: (r) => String(r.number), title: (r) => r.title ?? null,
            law_number: (r) => (r.laws?.[0]?.number ?? null), law_type: (r) => (r.laws?.[0]?.type ?? null),
            latest_action: (r) => r.latestAction?.text ?? null } },
  { table: "congress_committees", path: (c) => `/committee/${c}`, listKey: "committees",
    key: (r) => String(r.systemCode),
    cols: { system_code: (r) => r.systemCode, name: (r) => r.name ?? null, chamber: (r) => r.chamber ?? null,
            committee_type: (r) => r.committeeTypeCode ?? null, parent: (r) => r.parent?.systemCode ?? null },
    // The record: whether it still sits, its names through history with the
    // establishing authority, its subcommittees, its website, and how much of
    // each family it has referred to it. 236 requests, once; then the ones
    // whose updateDate moves.
    detail: { since: 3650, floor: 400, refreshWhenNull: "is_current", path: (r) => `/committee/${chamberPath(r)}/${r.systemCode}`, unwrap: (d) => d.committee,
              cols: { is_current: (r) => (r.isCurrent == null ? null : String(r.isCurrent)),
                      website_url: (r) => r.committeeWebsiteUrl ?? null,
                      history: (r) => json(r.history), subcommittees: (r) => json(r.subcommittees),
                      bills_count: (r) => r.bills?.count ?? null, reports_count: (r) => r.reports?.count ?? null,
                      nominations_count: (r) => r.nominations?.count ?? null, communications_count: (r) => r.communications?.count ?? null } },
    // What was referred to the committee. Bills come from govinfo from the bill
    // side and reports name their committee in their own detail; nominations
    // and communications name it nowhere else, so they are taken here. The
    // lists reach back to the 114th and each row carries its congress.
    children: [
      { table: "congress_committee_nominations", listKey: "nominations", mode: "since",
        when: (row) => row.chamber === "Senate" && Number(row.nominations_count ?? 1) > 0,
        path: (row) => `/committee/senate/${row.system_code}/nominations`,
        key: (r) => `${r.congress}-${r.number}-${r.partNumber ?? 0}`,
        cols: { citation: (r) => r.citation ?? null, description: (r) => r.description ?? null,
                received_date: (r) => r.receivedDate ?? null, latest_action: (r) => r.latestAction?.text ?? null,
                latest_action_date: (r) => r.latestAction?.actionDate ?? null } },
      { table: "congress_committee_communications", label: "committee house-communications", listKey: "houseCommunications", mode: "since",
        when: (row) => row.chamber !== "Senate" && Number(row.communications_count ?? 1) > 0,
        path: (row) => `/committee/${chamberPath(row)}/${row.system_code}/house-communication`,
        key: (r) => `${r.congress}-H-${r.communicationType?.code ?? "?"}-${r.number}`,
        cols: { chamber: (r) => r.chamber ?? "House", communication_type: (r) => r.communicationType?.name ?? null,
                type_code: (r) => r.communicationType?.code ?? null, number: (r) => String(r.number ?? ""),
                referral_date: (r) => r.referralDate ?? null } },
      { table: "congress_committee_communications", label: "committee senate-communications", listKey: "senateCommunications", mode: "since",
        when: (row) => row.chamber !== "House" && Number(row.communications_count ?? 1) > 0,
        path: (row) => `/committee/${chamberPath(row)}/${row.system_code}/senate-communication`,
        key: (r) => `${r.congress}-S-${r.communicationType?.code ?? "?"}-${r.number}`,
        cols: { chamber: (r) => r.chamber ?? "Senate", communication_type: (r) => r.communicationType?.name ?? null,
                type_code: (r) => r.communicationType?.code ?? null, number: (r) => String(r.number ?? ""),
                referral_date: (r) => r.referralDate ?? null } },
    ] },
  { table: "congress_committee_prints", path: (c) => `/committee-print/${c}`, listKey: "committeePrints",
    key: (r) => String(r.jacketNumber ?? `${r.congress}-${r.chamber}-${r.number}`),
    cols: { jacket_number: (r) => String(r.jacketNumber ?? ""), chamber: (r) => r.chamber ?? null, number: (r) => String(r.number ?? "") },
    detail: { since: 3650, floor: 1000, refreshWhenNull: "title", path: (r) => `/committee-print/${r.congress}/${chamberPath(r)}/${r.jacketNumber}`,
              unwrap: (d) => (Array.isArray(d.committeePrint) ? d.committeePrint[0] : d.committeePrint),
              cols: { title: (r) => r.title ?? null, citation: (r) => r.citation ?? null, committees: (r) => json(r.committees),
                      committee_code: (r) => r.committees?.[0]?.systemCode ?? null, associated_bills: (r) => json(r.associatedBills),
                      text_count: (r) => r.text?.count ?? null } },
    children: [
      { table: "congress_print_texts", listKey: "text", when: (row) => Number(row.text_count ?? 1) > 0,
        path: (row) => `/committee-print/${row.congress}/${chamberPath(row)}/${row.jacket_number}/text`,
        key: (r, row) => `${row.key}|${r.url ?? r.formats?.[0]?.url ?? ""}`,
        cols: { format_type: (r) => r.type ?? null, url: (r) => r.url ?? null, formats: (r) => json(r.formats) } },
    ] },
  { table: "congress_treaties", path: (c) => `/treaty/${c}`, listKey: "treaties",
    key: (r) => `${r.congress}-${r.number}-${r.suffix ?? ""}`,
    cols: { number: (r) => String(r.number ?? ""), suffix: (r) => r.suffix ?? null, topic: (r) => r.topic ?? null,
            transmitted_date: (r) => r.transmittedDate ?? null },
    detail: { since: 3650, floor: 200, refreshWhenNull: "actions_count", path: (r) => ownPath(r), unwrap: (d) => d.treaty,
              cols: { title: (r) => r.titles?.[0]?.title ?? null, titles: (r) => json(r.titles), parts: (r) => json(r.parts),
                      countries_parties: (r) => json(r.countriesParties), index_terms: (r) => json(r.indexTerms),
                      resolution_text: (r) => r.resolutionText ?? null, in_force_date: (r) => r.inForceDate ?? null,
                      actions_count: (r) => r.actions?.count ?? null, old_number: (r) => r.oldNumber ?? null } },
    children: [
      { table: "congress_treaty_actions", listKey: "actions", when: (row) => Number(row.actions_count ?? 1) > 0,
        path: (row) => `${ownPath(row.payload)}/actions`, key: (r, row) => `${row.key}|${r.actionDate}|${String(r.text ?? "").slice(0, 80)}`,
        cols: { action_date: (r) => r.actionDate ?? null, text: (r) => r.text ?? null, action_type: (r) => r.type ?? null,
                committees: (r) => json(r.committees) } },
      { table: "congress_treaty_committees", listKey: "treatyCommittees", when: () => true,
        path: (row) => `${ownPath(row.payload)}/committees`, key: (r, row) => `${row.key}|${r.systemCode}`,
        cols: { system_code: (r) => r.systemCode ?? null, name: (r) => r.name ?? null, chamber: (r) => r.chamber ?? null,
                activities: (r) => json(r.activities) } },
    ] },
  { table: "congress_committee_meetings", path: (c) => `/committee-meeting/${c}`, listKey: "committeeMeetings",
    key: (r) => String(r.eventId),
    cols: { event_id: (r) => String(r.eventId), chamber: (r) => r.chamber ?? null },
    // The list is an eventId and a URL. The date — which is what a calendar
    // needs — lives only in the detail, so the [today-7, today+60] window cannot
    // be applied before fetching. updateDate is the way in: a meeting being
    // scheduled or amended is a meeting being updated. 76 in the last 30 days
    // against 2,680 for the archive.
    detail: { since: 30, path: (r) => `/committee-meeting/119/${String(r.chamber).toLowerCase()}/${r.eventId}`, unwrap: (d) => d.committeeMeeting,
              cols: { meeting_date: (r) => r.date ?? null, title: (r) => r.title ?? null,
                      location: (r) => (r.location ? JSON.stringify(r.location) : null),
                      meeting_status: (r) => r.meetingStatus ?? null } } },
  { table: "congress_hearings", path: (c) => `/hearing/${c}`, listKey: "hearings",
    key: (r) => String(r.jacketNumber ?? `${r.congress}-${r.chamber}-${r.number}`),
    cols: { jacket_number: (r) => String(r.jacketNumber ?? ""), chamber: (r) => r.chamber ?? null, number: (r) => String(r.number ?? "") },
    // The hearing: its title, its date, the committee that held it, and where
    // the transcript is, as formatted text and as PDF. 934 requests, once.
    // The transcript text itself is fetched by hearing-texts.mjs from the
    // formatted-text URL, the way the text walk fetches a bill.
    detail: { since: 3650, floor: 2000, refreshWhenNull: "title", path: (r) => `/hearing/${r.congress}/${chamberPath(r)}/${r.jacketNumber}`, unwrap: (d) => d.hearing,
              cols: { title: (r) => r.title ?? null, citation: (r) => r.citation ?? null,
                      hearing_date: (r) => r.dates?.[0]?.date ?? null, dates: (r) => json(r.dates),
                      committee_code: (r) => r.committees?.[0]?.systemCode ?? null, committee_name: (r) => r.committees?.[0]?.name ?? null,
                      committees: (r) => json(r.committees), formats: (r) => json(r.formats),
                      text_url: (r) => r.formats?.find((f) => /text/i.test(f.type))?.url ?? null,
                      pdf_url: (r) => r.formats?.find((f) => /pdf/i.test(f.type))?.url ?? null,
                      loc_id: (r) => r.libraryOfCongressIdentifier ?? null } } },
  { table: "congress_house_votes", path: (c) => `/house-vote/${c}`, listKey: "houseRollCallVotes",
    key: (r) => String(r.identifier),
    cols: { identifier: (r) => String(r.identifier), session_number: (r) => String(r.sessionNumber ?? ""),
            roll_call_number: (r) => String(r.rollCallNumber ?? ""), legislation_type: (r) => r.legislationType ?? null,
            legislation_number: (r) => r.legislationNumber ?? null, result: (r) => r.result ?? null,
            vote_type: (r) => r.voteType ?? null, start_date: (r) => r.startDate ?? null },
    // The vote's own record: the question, the party totals, the amendment
    // where it was one. Positions stay with house-votes.mjs.
    detail: { since: 3650, floor: 1000, refreshWhenNull: "vote_question", path: (r) => `/house-vote/${r.congress}/${r.sessionNumber}/${r.rollCallNumber}`, unwrap: (d) => d.houseRollCallVote,
              cols: { vote_question: (r) => r.voteQuestion ?? null, vote_party_total: (r) => json(r.votePartyTotal),
                      amendment_author: (r) => r.amendmentAuthor ?? null, amendment_type: (r) => r.amendmentType ?? null,
                      amendment_number: (r) => r.amendmentNumber ?? null, legislation_url: (r) => r.legislationUrl ?? null } } },
  // Not congress-scoped: /crsreport is the whole library, 14,076 of them.
  { table: "congress_crs_reports", path: () => `/crsreport`, listKey: "CRSReports",
    key: (r) => String(r.id),
    cols: { report_id: (r) => r.id, title: (r) => r.title ?? null, publish_date: (r) => r.publishDate ?? null,
            status: (r) => r.status ?? null, version: (r) => String(r.version ?? ""), content_type: (r) => r.contentType ?? null },
    detail: { since: 90, path: (r) => `/crsreport/${r.id}`, unwrap: (d) => d.CRSReport,
              cols: { summary: (r) => (r.summary ? String(r.summary).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null),
                      topics: (r) => (r.topics ? JSON.stringify(r.topics) : null),
                      authors: (r) => (r.authors ? JSON.stringify(r.authors) : null) } } },
  { table: "congress_record_daily", path: () => `/daily-congressional-record`, listKey: "dailyCongressionalRecord",
    key: (r) => `${r.volumeNumber}-${r.issueNumber}`,
    cols: { volume_number: (r) => String(r.volumeNumber ?? ""), issue_number: (r) => String(r.issueNumber ?? ""),
            issue_date: (r) => r.issueDate ?? null, session_number: (r) => String(r.sessionNumber ?? "") },
    detail: { since: 30, path: (r) => `/daily-congressional-record/${r.volumeNumber}/${r.issueNumber}`,
              unwrap: (d) => (Array.isArray(d.issue) ? d.issue[0] : d.issue),
              cols: { articles_count: (r) => String(r.fullIssue?.articles?.count ?? ""),
                      entire_issue: (r) => (r.fullIssue?.entireIssue ? JSON.stringify(r.fullIssue.entireIssue) : null) } },
    // The Record's contents: every article of every issue, by section, with
    // its text and PDF. One request per issue.
    children: [
      // The issue list reaches back to 1995 (5,862 issues); tonight's walk is
      // the current congress, and the archive is a --record-since run.
      { table: "congress_record_articles", listKey: "articles",
        when: (row) => Number(row.articles_count || 1) > 0 && String(row.issue_date ?? "") >= (val("--record-since", `${yearOfCongress(CONGRESS)}-01-03`)),
        path: (row) => `/daily-congressional-record/${row.volume_number}/${row.issue_number}/articles`,
        // The list is sections, each with its articles; flatten so a row is an article.
        flatten: (list) => list.flatMap((section) => (section.sectionArticles ?? []).map((a) => ({ ...a, section: section.name }))),
        key: (r, row) => `${row.key}|${r.section}|${String(r.title ?? "").slice(0, 120)}|${r.startPage ?? ""}`,
        cols: { section: (r) => r.section ?? null, title: (r) => r.title ?? null, start_page: (r) => r.startPage ?? null,
                end_page: (r) => r.endPage ?? null, text: (r) => json(r.text) } },
    ] },
  // The list is a number and a type. The abstract, the committee it was referred
  // to, and the Record date live in the detail: 9,205 requests, once, then the
  // ones that move. Both chambers share one table and one detail shape.
  { table: "congress_communications", label: "house-communications", path: (c) => `/house-communication/${c}`, listKey: "houseCommunications",
    key: (r) => `${r.congress}-H-${r.communicationType?.code ?? "?"}-${r.number}`,
    cols: { chamber: (r) => r.chamber ?? "House", communication_type: (r) => r.communicationType?.name ?? null,
            type_code: (r) => r.communicationType?.code ?? null, number: (r) => String(r.number ?? "") },
    detail: { since: 3650, floor: 12000, path: (r) => ownPath(r), unwrap: (d) => d.houseCommunication ?? d["house-communication"] ?? d.communication,
              cols: { abstract: (r) => r.abstract ?? null, referred_to: (r) => json(r.committees), committee_code: (r) => r.committees?.[0]?.systemCode ?? null,
                      committee_name: (r) => r.committees?.[0]?.name ?? null, record_date: (r) => r.congressionalRecordDate ?? null,
                      report_nature: (r) => r.reportNature ?? null, submitting_agency: (r) => r.submittingAgency ?? null,
                      submitting_official: (r) => r.submittingOfficial ?? null, legal_authority: (r) => r.legalAuthority ?? null,
                      matching_requirements: (r) => json(r.matchingRequirements), is_rulemaking: (r) => r.isRulemaking ?? null } } },
  { table: "congress_communications", label: "senate-communications", path: (c) => `/senate-communication/${c}`, listKey: "senateCommunications",
    key: (r) => `${r.congress}-S-${r.communicationType?.code ?? "?"}-${r.number}`,
    cols: { chamber: (r) => r.chamber ?? "Senate", communication_type: (r) => r.communicationType?.name ?? null,
            type_code: (r) => r.communicationType?.code ?? null, number: (r) => String(r.number ?? "") },
    detail: { since: 3650, floor: 12000, path: (r) => ownPath(r), unwrap: (d) => d.senateCommunication ?? d["senate-communication"] ?? d.communication,
              cols: { abstract: (r) => r.abstract ?? null, referred_to: (r) => json(r.committees), committee_code: (r) => r.committees?.[0]?.systemCode ?? null,
                      committee_name: (r) => r.committees?.[0]?.name ?? null, record_date: (r) => r.congressionalRecordDate ?? null,
                      report_nature: (r) => r.reportNature ?? null, submitting_agency: (r) => r.submittingAgency ?? null,
                      submitting_official: (r) => r.submittingOfficial ?? null, legal_authority: (r) => r.legalAuthority ?? null,
                      matching_requirements: (r) => json(r.matchingRequirements), is_rulemaking: (r) => r.isRulemaking ?? null } } },
  // The congresses themselves: the sessions with their start and end dates,
  // which is the only place the record says whether a chamber is sitting.
  { table: "congress_congresses", path: () => `/congress`, listKey: "congresses",
    key: (r) => String(r.number ?? String(r.name ?? "").replace(/\D/g, "")),
    cols: { number: (r) => String(r.number ?? String(r.name ?? "").replace(/\D/g, "")), name: (r) => r.name ?? null,
            start_year: (r) => r.startYear ?? null, end_year: (r) => r.endYear ?? null, sessions: (r) => json(r.sessions) },
    detail: { since: 36500, floor: 200, path: (r) => `/congress/${r.number ?? String(r.name ?? "").replace(/\D/g, "")}`, unwrap: (d) => d.congress,
              cols: { sessions: (r) => json(r.sessions), start_year: (r) => r.startYear ?? null, end_year: (r) => r.endYear ?? null } } },
  // House reporting requirements and the communications that satisfy them.
  { table: "congress_house_requirements", path: () => `/house-requirement`, listKey: "houseRequirements",
    key: (r) => String(r.number),
    cols: { number: (r) => String(r.number), update_date_text: (r) => r.updateDate ?? null },
    detail: { since: 3650, floor: 3000, path: (r) => `/house-requirement/${r.number}`, unwrap: (d) => d.houseRequirement,
              cols: { parent_agency: (r) => r.parentAgency ?? null, submitting_agency: (r) => r.submittingAgency ?? null,
                      submitting_official: (r) => r.submittingOfficial ?? null, nature: (r) => r.nature ?? null,
                      frequency: (r) => r.frequency ?? null, legal_authority: (r) => r.legalAuthority ?? null,
                      active: (r) => r.activeRecord ?? null, matching_count: (r) => r.matchingCommunications?.count ?? null } },
    children: [
      { table: "congress_requirement_communications", listKey: "matchingCommunications", when: (row) => Number(row.matching_count ?? 1) > 0,
        path: (row) => `/house-requirement/${row.number}/matching-communications`,
        key: (r, row) => `${row.key}|${r.congress}-${r.communicationType?.code ?? "?"}-${r.number}`,
        cols: { chamber: (r) => r.chamber ?? null, communication_type: (r) => r.communicationType?.name ?? null,
                type_code: (r) => r.communicationType?.code ?? null, number: (r) => String(r.number ?? "") } },
    ] },
];

/* ---- main ---------------------------------------------------------------- */
const { Client } = require_("pg");
const db = new Client(pgConfig(DB));
await db.connect();

const since = val("--since");
const results = [];

for (const fam of FAMILIES) {
  const label = fam.label ?? fam.table;
  if (ONLY && fam.table !== `congress_${ONLY}` && fam.table !== ONLY && label !== ONLY) continue;
  const t0 = Date.now();
  const before = requests;

  const cols = Object.keys(fam.cols);
  await db.query(`create table if not exists ${fam.table} (
    key text primary key,
    congress int,
    update_date timestamptz,
    payload jsonb not null,
    updated_at timestamptz not null default now())`);
  const detailCols = Object.keys(fam.detail?.cols ?? {});
  for (const c of [...cols, ...detailCols]) {
    // Typed columns are added rather than assumed, so a family can grow one
    // without a migration and without dropping what is already there.
    await db.query(`alter table ${fam.table} add column if not exists ${c} text`);
  }
  if (fam.detail) {
    await db.query(`alter table ${fam.table} add column if not exists detail_fetched_at timestamptz`);
    // The list record is kept in its own column rather than in `payload`,
    // because for a family with a detail endpoint the two are different
    // documents and `payload` belongs to the fuller one. A member's `terms` is
    // `{item:[…]}` in the roster and a bare array in the record; merging them
    // by name would have written the roster's shape over the record's every
    // night. The detail pass reads `list_payload` for its path and merges the
    // fresh roster fields under the fresh record.
    await db.query(`alter table ${fam.table} add column if not exists list_payload jsonb`);
  }

  let rows = 0, written = 0;
  try {
    for (let offset = 0; ; offset += PAGE) {
      const q = `${fam.path(CONGRESS)}?limit=${PAGE}&offset=${offset}${since ? `&fromDateTime=${encodeURIComponent(since)}` : ""}`;
      const page = await api(q);
      const list = page[fam.listKey] ?? (Object.values(page).find((v) => Array.isArray(v)) ?? []);
      for (const r of list) {
        rows += 1;
        const values = [fam.key(r), r.congress ?? CONGRESS, r.updateDate ?? null, JSON.stringify(r), ...cols.map((c) => {
          const v = fam.cols[c](r);
          return v == null ? null : String(v);
        })];
        const placeholders = cols.map((_, i) => `$${i + 5}`).join(", ");
        const setters = cols.map((c) => `${c} = excluded.${c}`).join(", ");
        // For a detail family the list pass refreshes the typed columns and the
        // list record, and leaves `payload` alone once the detail pass has
        // written it — otherwise every nightly run silently regressed the
        // richer record to the thinner one, which is exactly what happened to
        // all 553 members. The detail pass rewrites `payload` whenever the
        // API's own updateDate moves past the last fetch.
        const payloadSetter = fam.detail
          ? `list_payload = excluded.payload,
             payload = case when ${fam.table}.detail_fetched_at is null then excluded.payload else ${fam.table}.payload end`
          : `payload = excluded.payload`;
        await db.query(
          `insert into ${fam.table} (key, congress, update_date, payload${fam.detail ? ", list_payload" : ""}${cols.length ? ", " + cols.join(", ") : ""})
           values ($1,$2,$3,$4${fam.detail ? ", $4" : ""}${cols.length ? ", " + placeholders : ""})
           on conflict (key) do update set congress = excluded.congress, update_date = excluded.update_date,
             ${payloadSetter}, updated_at = now()${cols.length ? ", " + setters : ""}`,
          values,
        );
        written += 1;
      }
      if (list.length < PAGE) break;
    }
    // The detail pass, bounded. Only the recently-updated records: a meeting
    // being scheduled or amended is a meeting being updated, and the archive can
    // wait. Without this the family costs one request per record, forever.
    let detailed = 0;
    if (fam.detail && !has("--no-detail")) {
      const cutoff = new Date(Date.now() - fam.detail.since * 86400e3).toISOString();
      const detailLimit = Math.max(Number(val("--detail-limit", "400")), fam.detail.floor ?? 0);
      // A family that grew a detail column after its rows were first detailed
      // names it in `refreshWhenNull`, so the rows are read again once to fill
      // it — otherwise a count the children are gated on stays null forever
      // and the child pass walks nothing (amendments, 2026-09-06).
      const stale = fam.detail.refreshWhenNull ? ` or ${fam.detail.refreshWhenNull} is null` : "";
      const targets = await db.query(
        `select key, coalesce(list_payload, payload) as list_payload from ${fam.table}
          where update_date >= $1 and (detail_fetched_at is null or detail_fetched_at < update_date${stale})
          order by update_date desc limit $2`,
        [cutoff, detailLimit],
      );
      for (const t of targets.rows) {
        try {
          const raw = await api(fam.detail.path(t.list_payload));
          // The list row goes in too: an endpoint keyed less precisely than the
          // table can answer with several records, and only the row knows which
          // of them is its own.
          const rec = fam.detail.unwrap ? fam.detail.unwrap(raw, t.list_payload) : raw;
          if (!rec) continue;
          const dcols = Object.keys(fam.detail.cols);
          const setters = dcols.map((c, i) => `${c} = $${i + 3}`).join(", ");
          await db.query(
            `update ${fam.table} set payload = $2, detail_fetched_at = now()${dcols.length ? ", " + setters : ""} where key = $1`,
            // The record wins on every key it has; the roster's extras — a
            // member's name and party, which the record spells differently and
            // the pages read — ride underneath it.
            [t.key, JSON.stringify({ ...t.list_payload, ...rec }), ...dcols.map((c) => { const v = fam.detail.cols[c](rec); return v == null ? null : String(v); })],
          );
          detailed += 1;
        } catch (e) { log(`  ${label} detail ${t.key}: ${String(e.message).slice(0, 80)}`); }
      }
    }

    // The children pass: the lists that hang off each record. A child in
    // `since` mode is walked for every parent on every run, with --since as
    // fromDateTime, because the list grows on its own (a committee's
    // nominations). The default mode walks a parent's children only when its
    // own record has been re-fetched since the children were last taken, so a
    // nomination that has not moved costs nothing tonight.
    let childRows = 0;
    if (fam.children && !has("--no-children")) {
      const childLimit = Number(val("--child-limit", "5000"));
      for (const child of fam.children) {
        const clabel = child.label ?? child.table;
        const ccols = Object.keys(child.cols);
        // The stamp is per child, not per parent: with one stamp the first
        // child marked every parent covered and the second found none
        // (nomination committees and hearings wrote nothing, 2026-09-06).
        const stamp = `child_${child.table.replace(/^congress_/, "")}_at`;
        await db.query(`alter table ${fam.table} add column if not exists ${stamp} timestamptz`);
        await db.query(`create table if not exists ${child.table} (
          key text primary key,
          parent_key text not null,
          congress int,
          update_date timestamptz,
          payload jsonb not null,
          updated_at timestamptz not null default now())`);
        for (const c of ccols) await db.query(`alter table ${child.table} add column if not exists ${c} text`);
        await db.query(`create index if not exists ${child.table}_parent_idx on ${child.table} (parent_key)`);
        const parents = await db.query(
          child.mode === "since"
            ? `select * from ${fam.table} order by key limit $1`
            : `select * from ${fam.table} where ${stamp} is null or (detail_fetched_at is not null and detail_fetched_at > ${stamp}) order by update_date desc nulls last limit $1`,
          [childLimit],
        );
        let took = 0, wrote = 0;
        for (const row of parents.rows) {
          if (child.when && !child.when(row)) continue;
          took += 1;
          try {
            for (let offset = 0; ; offset += PAGE) {
              const q = `${child.path(row)}?limit=${PAGE}&offset=${offset}${since && child.mode === "since" ? `&fromDateTime=${encodeURIComponent(since)}` : ""}`;
              const page = await api(q);
              let list = page[child.listKey] ?? (Object.values(page).find((v) => Array.isArray(v)) ?? []);
              if (!Array.isArray(list)) list = [list];
              const items = child.flatten ? child.flatten(list) : list;
              for (const r of items) {
                const values = [child.key(r, row), row.key, r.congress ?? row.congress ?? CONGRESS, r.updateDate ?? null, JSON.stringify(r),
                  ...ccols.map((c) => { const v = child.cols[c](r, row); return v == null ? null : String(v); })];
                const placeholders = ccols.map((_, i) => `$${i + 6}`).join(", ");
                const setters = ccols.map((c) => `${c} = excluded.${c}`).join(", ");
                await db.query(
                  `insert into ${child.table} (key, parent_key, congress, update_date, payload${ccols.length ? ", " + ccols.join(", ") : ""})
                   values ($1,$2,$3,$4,$5${ccols.length ? ", " + placeholders : ""})
                   on conflict (key) do update set parent_key = excluded.parent_key, congress = excluded.congress,
                     update_date = excluded.update_date, payload = excluded.payload, updated_at = now()${ccols.length ? ", " + setters : ""}`,
                  values,
                );
                wrote += 1;
              }
              if (list.length < PAGE) break;
            }
          } catch (e) { log(`  ${clabel} ${row.key}: ${String(e.message).slice(0, 80)}`); }
        }
        // Stamp the parents this pass covered, so the default mode can skip them next time.
        if (child.mode !== "since" && parents.rows.length) {
          await db.query(`update ${fam.table} set ${stamp} = now() where key = any($1)`, [parents.rows.map((r) => r.key)]);
        }
        childRows += wrote;
        log(`  ${clabel}: ${took} parents · ${wrote} rows`);
      }
    }

    const mins = (Date.now() - t0) / 60000;
    results.push({ table: label, rows, written, detailed, childRows, requests: requests - before, mins: mins.toFixed(1), thin: fam.thin ?? null });
    log(`${label}: ${rows} rows${detailed ? ` · ${detailed} detailed` : ""}${childRows ? ` · ${childRows} child rows` : ""} · ${requests - before} requests · ${mins.toFixed(1)} min${fam.thin ? ` · thin (${fam.thin})` : ""}`);
  } catch (e) {
    results.push({ table: label, rows, written, requests: requests - before, mins: ((Date.now() - t0) / 60000).toFixed(1), error: String(e.message).slice(0, 120) });
    log(`${label}: FAILED after ${rows} rows — ${String(e.message).slice(0, 140)}`);
  }
}

log(`harvest done: ${results.length} families · ${requests} requests total`);
for (const r of results) log(`  ${r.table.padEnd(30)} ${String(r.rows).padStart(6)} rows ${String(r.detailed ?? 0).padStart(4)} detailed ${String(r.requests).padStart(4)} req  ${r.mins} min${r.error ? `  ERROR ${r.error}` : ""}`);

await db.end();
process.exit(results.some((r) => r.error) ? 1 : 0);
