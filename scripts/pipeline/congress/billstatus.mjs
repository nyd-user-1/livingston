#!/usr/bin/env node
// scripts/pipeline/congress/billstatus.mjs — the bill record, its actions,
// committees, subjects, CBO estimates, summaries, titles, related bills, and the
// bill each amendment and committee report belongs to, from the govinfo
// BILLSTATUS zips, into Aurora.
//
//   node scripts/pipeline/congress/billstatus.mjs            # 119th
//   node scripts/pipeline/congress/billstatus.mjs --congress 118
//
// Zero API calls. govinfo publishes the whole legislative record of a congress as
// eight zips — one per bill type — and the 119th is 18,469 bills in eight
// requests and about a minute. The same families through api.congress.gov are one
// request per bill per family: ~18,500 for summaries alone, against a 20,000/hour
// ceiling. This is the reason `dp-us-native` is fixed rather than retired.
//
// It also supplies the linkage the API list endpoints do not carry: an amendment
// record from /amendment/119 names no bill, and a committee report names no bill,
// so `amendments?bill=` could not be honoured until this ran.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(path.join(REPO, "noop.js"));
const args = process.argv.slice(2);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CONGRESS = Number(val("--congress", "119"));
const ONLY_TYPE = val("--type");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim(); if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("="); if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

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
  return { user, password: pw, host, database, port: Number(port || 5432), ssl: /sslmode=(require|verify)/.test(query ?? "") ? { rejectUnauthorized: false } : undefined, application_name: "congress-billstatus" };
}

const BULK = "https://www.govinfo.gov/bulkdata/BILLSTATUS";
const TYPES = ["hr", "s", "hres", "sres", "hjres", "sjres", "hconres", "sconres"];
// govinfo's type -> our bill_number prefix. LegiScan renames the federal types
// into its state vocabulary and the renaming collides with govinfo's, which is
// why this table is written out rather than derived.
const PREFIX = { hr: "HB", s: "SB", hres: "HR", sres: "SR", hjres: "HJR", sjres: "SJR", hconres: "HCR", sconres: "SCR" };
// congress.gov's own type, for keying into congress_amendments.
const API_TYPE = { hr: "HR", s: "S", hres: "HRES", sres: "SRES", hjres: "HJRES", sjres: "SJRES", hconres: "HCONRES", sconres: "SCONRES" };
const yearOfCongress = (c) => (c - 1) * 2 + 1789;

// The same slot table api/bill-text.ts numbers synthetic document ids with, so a
// date found here lands on the row govinfo already wrote.
const VERSION_CODES = ["as", "ash", "ath", "ats", "cdh", "cds", "cph", "cps", "eah", "eas", "ech", "eh", "enr", "eph", "es", "fah", "fph", "fps", "hdh", "hds", "ih", "iph", "ips", "is", "lth", "lts", "oph", "ops", "pap", "pcs", "pp", "pwah", "rah", "ras", "rch", "rcs", "rdh", "rds", "reah", "renr", "res", "rfh", "rfs", "rh", "rih", "ris", "rs", "rth", "rts", "sas", "sc"];
const versionCodeOf = (url) => (/BILLS-\d+[a-z]+\d+([a-z]+)\.(htm|xml|pdf)$/i.exec(url || "")?.[1] ?? "").toLowerCase();

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
// BILLSTATUS does not use one child name. <titles> and <relatedBills> hold
// <item>, <summaries> holds <summary>, <amendments> holds <amendment>,
// <committeeReports> holds <committeeReport>. Reading them all as `.item` is why
// scripts/pipeline/native/us.mjs's `description` has always been null: it takes
// items(b.summaries)[0], which is an empty list for every bill ever published.
const kids = (x, name) => arr(x?.[name]);
const items = (x) => arr(x?.item);
const txt = (x) => (x == null ? null : typeof x === "object" ? (x["#text"] ?? null) : String(x));
const plain = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function xmlParser() {
  const { XMLParser } = require_("fast-xml-parser");
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, trimValues: true });
}

const { Client } = require_("pg");
const db = new Client(pgConfig(DB));
await db.connect();
const parser = xmlParser();
const year = yearOfCongress(CONGRESS);

for (const [table, cols] of [
  ["congress_summaries", `bill_id bigint, bill_number text, action_date text, action_desc text, version_code text, text text`],
  ["congress_titles", `bill_id bigint, bill_number text, title_type text, title text, chamber text`],
  ["congress_related_bills", `bill_id bigint, bill_number text, related_bill_id bigint, related_bill_number text, relationship text`],
  // Cosponsors: 8 requests a congress from the zips, against 18,500 for
  // /bill/{congress}/{type}/{number}/cosponsors — the same arithmetic that
  // refused the titles top-up.
  ["congress_cosponsors", `bill_id bigint, bill_number text, bioguide_id text, people_id bigint, full_name text, party text, state text, sponsorship_date text, is_original_cosponsor text, sponsorship_withdrawn_date text`],

  // One row per bill, for the facts a bill has exactly one of. The sponsor
  // lives here as columns rather than in a table of its own: `<sponsors>` is a
  // list element, and the whole list is kept in `payload`, but every bill in the
  // 119th has exactly one and a table would buy a join for a one-row lookup the
  // page makes on every render. The prime sponsor is the column; a second, if
  // one ever appears, is in the payload and is not silently dropped.
  //
  // `constitutional_authority` is HTML — a <pre> block quoting the Congressional
  // Record — and is stored as published rather than flattened, because the
  // citation inside it is a link.
  ["congress_bills", `bill_id bigint, bill_number text, bill_type text, number text,
      display_title text, popular_title text, origin_chamber text, introduced_date text,
      policy_area text, constitutional_authority text, latest_action_date text, latest_action text,
      sponsor_bioguide text, sponsor_people_id bigint, sponsor_name text, sponsor_party text,
      sponsor_state text, sponsor_district text, sponsor_by_request text`],

  // The bill's own actions. Not a replacement for "History Table" — measured on
  // H.R. 1, LegiScan holds 141 rows and congress.gov's Actions tab shows 140,
  // while BILLSTATUS holds 59, of which 53 are already in LegiScan's verbatim.
  // What is here and nowhere else is the *structure*: the stage (`type`), the
  // action code, the system that reported it, the committee that acted, and the
  // roll call it produced with the Clerk's own URL.
  //
  // actionDate/actionTime are Eastern as published (14:31:38 is congress.gov's
  // "2:31pm"); the recorded vote's own date is UTC. Both are stored as they came.
  ["congress_bill_actions", `bill_id bigint, bill_number text, action_date text, action_time text,
      text text, action_type text, action_code text, source_system text, source_code text,
      committee_codes text, committee_names text, roll_number text, roll_chamber text,
      roll_url text, roll_session text, roll_date text, sequence int`],

  // One row per committee (or subcommittee) activity: Referred to, Markup by,
  // Reported by. `<committees><item>` may carry `<subcommittees><item>`, each
  // with its own `<activities><item>` — three levels, all named `item`, checked
  // rather than assumed.
  ["congress_bill_committees", `bill_id bigint, bill_number text, system_code text, name text,
      chamber text, committee_type text, subcommittee_code text, subcommittee_name text,
      activity text, activity_date timestamptz`],

  // Up to 240 per bill. The policy area is one row among them, flagged, so the
  // page can print it first without a second read.
  ["congress_bill_subjects", `bill_id bigint, bill_number text, name text, is_policy_area boolean`],

  // Metadata only. Lane B found the numbers behind DataDome; the title, the date
  // and the URL are free, and are all a link needs.
  ["congress_cbo_estimates", `bill_id bigint, bill_number text, pub_date text, title text, url text, description text`],

  // The other renderings of each text version. congress.gov offers PDF, XML and
  // the formatted text per version; BILLSTATUS lists only the XML url.
  //
  // They are DERIVED from the govinfo package id rather than fetched, because
  // govinfo's package layout is uniform — /pdf/{pkg}.pdf, /html/{pkg}.htm — and
  // checked before it was trusted: 28 of 28 packages across five bill types and
  // both BILLS and PLAW answer 200. What is not derivable is which XML flavour a
  // package has (BILLS carries /xml, a public law carries /uslm and no /xml), so
  // that one is taken from BILLSTATUS as published and never guessed.
  //
  // `document_id` is the same synthetic id "BillTexts" and "Documents" use, so a
  // version we hold and a version we only list are the same row of the same
  // table. A version with no slot in the code table gets none, which is how the
  // Public Law rendering of an enacted bill can be listed with its links while
  // we hold no body for it.
  ["congress_text_formats", `bill_id bigint, bill_number text, document_id bigint, version_type text,
      version_date text, package_id text, html_url text, pdf_url text, xml_url text`],
]) {
  await db.query(`create table if not exists ${table} (
    key text primary key, congress int, payload jsonb, updated_at timestamptz not null default now(), ${cols})`);
  await db.query(`create index if not exists ${table}_bill_idx on ${table} (bill_id)`);
}

// bioguide -> our people_id, so a cosponsor lands on the member the app links to.
const byBioguide = new Map();
for (const r of (await db.query(`select people_id, bioguide_id from "People" where bioguide_id is not null and bioguide_id <> ''`)).rows) {
  byBioguide.set(String(r.bioguide_id).toUpperCase(), Number(r.people_id));
}

const known = new Map();
for (const r of (await db.query(`select bill_id, bill_number from "Bills" where state='US' and session_id=$1`, [year])).rows) {
  known.set(String(r.bill_number).toUpperCase(), Number(r.bill_id));
}
log(`${known.size.toLocaleString()} bills on file for ${year}`);

const tally = { bills: 0, summaries: 0, titles: 0, related: 0, amendments: 0, reports: 0, zips: 0, bytes: 0 };

/** Batched multi-row upsert — one statement per few hundred rows, not per row. */
async function flush(table, cols, rows) {
  if (!rows.length) return;
  // Postgres refuses ON CONFLICT DO UPDATE when one statement touches the same
  // key twice, and a bill can list the same cosponsor twice — withdrawn, then
  // added back. Last write wins, which is the later record.
  const byKey = new Map();
  for (const r of rows) byKey.set(r.key, r);
  rows = [...byKey.values()];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const params = [];
    const tuples = chunk.map((r) => `(${cols.map((c) => `$${params.push(r[c])}`).join(",")})`).join(",");
    await db.query(
      `insert into ${table} (${cols.join(",")}) values ${tuples}
       on conflict (key) do update set ${cols.filter((c) => c !== "key").map((c) => `${c} = excluded.${c}`).join(", ")}, updated_at = now()`,
      params,
    );
  }
  rows.length = 0;
}

for (const type of ONLY_TYPE ? [ONLY_TYPE] : TYPES) {
  const url = `${BULK}/${CONGRESS}/${type}/BILLSTATUS-${CONGRESS}-${type}.zip`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": process.env.CONGRESS_USER_AGENT || "govblock/1.0 (+https://govblock.app)" } });
  if (!res.ok) { log(`${type}: ${res.status} — skipped`); continue; }
  const buf = new Uint8Array(await res.arrayBuffer());
  tally.zips += 1; tally.bytes += buf.length;
  const files = unzipSync(buf);
  const names = Object.keys(files).filter((n) => n.endsWith(".xml"));

  const sums = [], titles = [], related = [], cosponsors = [];
  const bills = [], actions = [], billCommittees = [], subjects = [], cbo = [], textFormats = [];
  const docDates = [];
  const lawAreas = [];
  const amendLinks = [], reportLinks = [];

  // The five new families are drained as the type is walked rather than at the
  // end of it: `hr` alone is ten thousand bills, and subjects run to 240 apiece.
  const NEW_FAMILIES = [
    ["congress_bills", bills, ["key", "congress", "payload", "bill_id", "bill_number", "bill_type", "number", "display_title", "popular_title", "origin_chamber", "introduced_date", "policy_area", "constitutional_authority", "latest_action_date", "latest_action", "sponsor_bioguide", "sponsor_people_id", "sponsor_name", "sponsor_party", "sponsor_state", "sponsor_district", "sponsor_by_request"]],
    ["congress_bill_actions", actions, ["key", "congress", "payload", "bill_id", "bill_number", "action_date", "action_time", "text", "action_type", "action_code", "source_system", "source_code", "committee_codes", "committee_names", "roll_number", "roll_chamber", "roll_url", "roll_session", "roll_date", "sequence"]],
    ["congress_bill_committees", billCommittees, ["key", "congress", "payload", "bill_id", "bill_number", "system_code", "name", "chamber", "committee_type", "subcommittee_code", "subcommittee_name", "activity", "activity_date"]],
    ["congress_bill_subjects", subjects, ["key", "congress", "payload", "bill_id", "bill_number", "name", "is_policy_area"]],
    ["congress_cbo_estimates", cbo, ["key", "congress", "payload", "bill_id", "bill_number", "pub_date", "title", "url", "description"]],
    ["congress_text_formats", textFormats, ["key", "congress", "payload", "bill_id", "bill_number", "document_id", "version_type", "version_date", "package_id", "html_url", "pdf_url", "xml_url"]],
  ];
  const drain = async (force = false) => {
    for (const [table, rows, cols] of NEW_FAMILIES) {
      if (force ? rows.length : rows.length >= 4000) await flush(table, cols, rows.splice(0));
    }
  };

  for (const name of names) {
    let b;
    try { b = parser.parse(new TextDecoder().decode(files[name]))?.billStatus?.bill; } catch { continue; }
    if (!b) continue;
    const number = txt(b.number) ?? txt(b.billNumber);
    if (!number) continue;
    const bn = `${PREFIX[type]}${number}`;
    const billId = known.get(bn) ?? null;
    tally.bills += 1;

    // Every CRS summary the bill has carried, not just the newest — the point is
    // the sequence: as introduced, as reported, as passed.
    kids(b.summaries, "summary").forEach((s, i) => {
      const actionDate = txt(s.actionDate) ?? "";
      sums.push({ key: `${CONGRESS}-${bn}-${actionDate || i}-${txt(s.versionCode) ?? i}`, congress: CONGRESS,
        payload: JSON.stringify(s), bill_id: billId, bill_number: bn, action_date: actionDate || null,
        action_desc: txt(s.actionDesc), version_code: txt(s.versionCode), text: plain(txt(s.text)) });
    });
    items(b.titles).forEach((t, i) => {
      titles.push({ key: `${CONGRESS}-${bn}-${i}`, congress: CONGRESS, payload: JSON.stringify(t), bill_id: billId,
        bill_number: bn, title_type: txt(t.titleType), title: txt(t.title), chamber: txt(t.chamberName) });
    });
    for (const rb of items(b.relatedBills)) {
      const rbn = `${PREFIX[String(txt(rb.type) ?? "").toLowerCase()] ?? String(txt(rb.type) ?? "")}${txt(rb.number) ?? ""}`;
      related.push({ key: `${CONGRESS}-${bn}-${rbn}`, congress: CONGRESS, payload: JSON.stringify(rb), bill_id: billId,
        bill_number: bn, related_bill_id: known.get(rbn.toUpperCase()) ?? null, related_bill_number: rbn,
        relationship: (items(rb.relationshipDetails)[0] ? txt(items(rb.relationshipDetails)[0].type) : null) ?? "related" });
    }
    // The stage's own date for every text version, including the ones govinfo
    // wrote. Those rows had no date at all, and the API fell back to the night of
    // the backfill — so every stage of H.R. 1 read the same day. A wrong date is
    // worse than a missing one.
    if (billId) {
      for (const tv of items(b.textVersions)) {
        const date = String(txt(tv.date) ?? "").slice(0, 10);
        const formats = items(tv.formats).map((f) => txt(f.url)).filter(Boolean);
        if (!formats.length) continue;
        const slot = VERSION_CODES.indexOf(versionCodeOf(formats[0]));
        if (slot < 0) continue;
        // Prefer the readable rendering for the link a reader follows.
        const url = formats.find((u) => /\.htm$/i.test(u)) ?? formats[0];
        docDates.push([-(billId * 100 + slot + 1), billId, date || null, url, txt(tv.type) ?? null]);
      }
    }

    /* ---- the bill record, and the families congress.gov shows and we did not ---- */
    const apiKey = `${CONGRESS}-${API_TYPE[type]}-${number}`;
    const area0 = txt(b.policyArea?.name);
    const sponsor = items(b.sponsors)[0] ?? null;
    const sponsorBio = String(txt(sponsor?.bioguideId) ?? "").toUpperCase() || null;
    // <titles> holds <item>; the display title is also the bill's own <title>,
    // and the popular title is the row CRS assigns. Both are free here and both
    // are better than the short title LegiScan picks off one portion of a bill —
    // H.R. 1 is "FEHB Protection Act of 2025" on our lists today.
    const titleRows = items(b.titles);
    const titleOf = (want) => titleRows.find((t) => String(txt(t.titleType) ?? "").toLowerCase().includes(want));
    // The payload is the bill's own scalars and its sponsors — NOT the whole
    // <bill> element. H.R. 1's is a two-megabyte document (493 amendments, 239
    // subjects, 5 summaries), and ten thousand of those held in memory before a
    // flush is several gigabytes against a 2 GB heap. Everything trimmed out of
    // here has a table of its own three lines below.
    const record = {
      congress: CONGRESS, type: API_TYPE[type], number: String(number),
      title: txt(b.title), originChamber: txt(b.originChamber), introducedDate: txt(b.introducedDate),
      updateDate: txt(b.updateDate), updateDateIncludingText: txt(b.updateDateIncludingText),
      legislationUrl: txt(b.legislationUrl),
      policyArea: area0 ? { name: area0 } : null,
      latestAction: { actionDate: txt(b.latestAction?.actionDate), text: plain(txt(b.latestAction?.text)) },
      sponsors: items(b.sponsors).map((sp) => ({
        bioguideId: txt(sp.bioguideId), fullName: txt(sp.fullName), firstName: txt(sp.firstName),
        lastName: txt(sp.lastName), middleName: txt(sp.middleName), party: txt(sp.party),
        state: txt(sp.state), district: txt(sp.district), isByRequest: txt(sp.isByRequest),
      })),
      constitutionalAuthorityStatementText: txt(b.constitutionalAuthorityStatementText),
      laws: items(b.laws).map((l) => ({ type: txt(l.type), number: txt(l.number) })),
    };
    bills.push({
      key: apiKey, congress: CONGRESS, payload: JSON.stringify(record), bill_id: billId, bill_number: bn,
      bill_type: API_TYPE[type], number: String(number),
      display_title: txt(b.title), popular_title: txt(titleOf("popular")?.title),
      origin_chamber: txt(b.originChamber), introduced_date: txt(b.introducedDate),
      policy_area: txt(b.policyArea?.name),
      // Published as HTML and stored as published: the <pre> block quotes the
      // Congressional Record and the citation inside it is a link.
      constitutional_authority: txt(b.constitutionalAuthorityStatementText),
      latest_action_date: txt(b.latestAction?.actionDate), latest_action: plain(txt(b.latestAction?.text)),
      sponsor_bioguide: sponsorBio, sponsor_people_id: sponsorBio ? (byBioguide.get(sponsorBio) ?? null) : null,
      sponsor_name: txt(sponsor?.fullName), sponsor_party: txt(sponsor?.party),
      sponsor_state: txt(sponsor?.state), sponsor_district: txt(sponsor?.district),
      sponsor_by_request: txt(sponsor?.isByRequest),
    });

    // Actions. Keyed on the action's own identity rather than its position:
    // BILLSTATUS lists newest first, so an ordinal key rewrites every row of
    // every bill the moment one action lands.
    items(b.actions).forEach((a, i) => {
      const date = txt(a.actionDate) ?? "";
      const body = plain(txt(a.text));
      const code = txt(a.actionCode) ?? "";
      const kind = txt(a.type) ?? "";
      const cms = items(a.committees);
      const rv = kids(a.recordedVotes, "recordedVote")[0] ?? null;
      actions.push({
        key: `${apiKey}-${date}-${createHash("sha1").update(`${kind}|${code}|${body}`).digest("hex").slice(0, 10)}`,
        congress: CONGRESS, payload: JSON.stringify(a), bill_id: billId, bill_number: bn,
        action_date: date || null, action_time: txt(a.actionTime), text: body,
        action_type: kind || null, action_code: code || null,
        source_system: txt(a.sourceSystem?.name), source_code: txt(a.sourceSystem?.code),
        committee_codes: cms.length ? cms.map((c) => txt(c.systemCode)).filter(Boolean).join(",") : null,
        committee_names: cms.length ? cms.map((c) => txt(c.name)).filter(Boolean).join("; ") : null,
        roll_number: txt(rv?.rollNumber), roll_chamber: txt(rv?.chamber), roll_url: txt(rv?.url),
        roll_session: txt(rv?.sessionNumber), roll_date: txt(rv?.date), sequence: i,
      });
    });

    // Committees and their activities, and the subcommittees' own. Three levels
    // of <item>, checked on H.R. 3617 (Energy and Commerce → Energy
    // Subcommittee → Reported by / Markup by / Referred to) rather than assumed.
    for (const cm of items(b.committees)) {
      const base = { bill_id: billId, bill_number: bn, system_code: txt(cm.systemCode), name: txt(cm.name),
                     chamber: txt(cm.chamber), committee_type: txt(cm.type) };
      const push = (subCode, subName, act) => {
        const when = txt(act.date) ?? "";
        billCommittees.push({ key: `${apiKey}-${subCode ?? base.system_code}-${txt(act.name)}-${when}`,
          congress: CONGRESS, payload: JSON.stringify(act), ...base,
          subcommittee_code: subCode, subcommittee_name: subName,
          activity: txt(act.name), activity_date: when || null });
      };
      for (const act of items(cm.activities)) push(null, null, act);
      for (const sub of items(cm.subcommittees)) {
        for (const act of items(sub.activities)) push(txt(sub.systemCode), txt(sub.name), act);
      }
    }

    // Subjects. The policy area is one row among them, flagged, so a page can
    // print it first without a second read.
    if (area0) subjects.push({ key: `${apiKey}-policyArea`, congress: CONGRESS, payload: JSON.stringify(b.policyArea),
      bill_id: billId, bill_number: bn, name: area0, is_policy_area: true });
    for (const sj of items(b.subjects?.legislativeSubjects)) {
      const nm = txt(sj.name);
      if (nm) subjects.push({ key: `${apiKey}-${nm}`, congress: CONGRESS, payload: JSON.stringify(sj),
        bill_id: billId, bill_number: bn, name: nm, is_policy_area: false });
    }

    for (const est of items(b.cboCostEstimates)) {
      const url = txt(est.url);
      if (!url) continue;
      cbo.push({ key: `${apiKey}-${url}`, congress: CONGRESS, payload: JSON.stringify(est),
        bill_id: billId, bill_number: bn, pub_date: txt(est.pubDate), title: txt(est.title),
        url, description: plain(txt(est.description)) });
    }

    // Every version's other renderings, held or not. This runs outside the
    // `slot >= 0` gate above on purpose: a Public Law rendering has no version
    // code, so it has no slot and no row in "Documents" — and it is exactly the
    // sixth version congress.gov shows on H.R. 1 and we did not.
    if (billId) {
      for (const tv of items(b.textVersions)) {
        const urls = items(tv.formats).map((f) => txt(f.url)).filter(Boolean);
        const xml = urls.find((u) => /\.xml$/i.test(u)) ?? urls[0];
        const pkg = /\/pkg\/([^/]+)\//.exec(xml ?? "")?.[1];
        if (!pkg) continue;
        const slot = VERSION_CODES.indexOf(versionCodeOf(urls[0]));
        const vtype = txt(tv.type) ?? null;
        textFormats.push({
          key: `${apiKey}-${vtype ?? pkg}`, congress: CONGRESS, payload: JSON.stringify(tv),
          bill_id: billId, bill_number: bn,
          document_id: slot >= 0 ? -(billId * 100 + slot + 1) : null,
          version_type: vtype, version_date: String(txt(tv.date) ?? "").slice(0, 10) || null,
          package_id: pkg,
          html_url: `https://www.govinfo.gov/content/pkg/${pkg}/html/${pkg}.htm`,
          pdf_url: `https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}.pdf`,
          xml_url: xml ?? null,
        });
      }
    }

    // A law is a bill, and policyArea is on the bill record — not on the /law
    // list the family is cut from.
    const area = txt(b.policyArea?.name);
    if (area && items(b.laws).length) lawAreas.push([`${CONGRESS}-${API_TYPE[type]}-${number}`, area]);

    // <cosponsors> holds <item>, unlike <summaries>. Checked, not assumed.
    for (const cs of items(b.cosponsors)) {
      const bio = String(txt(cs.bioguideId) ?? "").toUpperCase();
      if (!bio) continue;
      cosponsors.push({ key: `${CONGRESS}-${bn}-${bio}`, congress: CONGRESS, payload: JSON.stringify(cs),
        bill_id: billId, bill_number: bn, bioguide_id: bio, people_id: byBioguide.get(bio) ?? null,
        full_name: txt(cs.fullName), party: txt(cs.party), state: txt(cs.state),
        sponsorship_date: txt(cs.sponsorshipDate), is_original_cosponsor: txt(cs.isOriginalCosponsor),
        sponsorship_withdrawn_date: txt(cs.sponsorshipWithdrawnDate) });
    }

    // The linkage the API list endpoints do not carry.
    for (const a of kids(b.amendments, "amendment")) {
      const at = String(txt(a.type) ?? "").toUpperCase();
      const an = txt(a.number);
      if (at && an && billId) amendLinks.push([`${CONGRESS}-${at}-${an}`, billId, bn]);
    }
    await drain();

    for (const cr of kids(b.committeeReports, "committeeReport")) {
      // The API carries the ",Book N" suffix too — I had assumed only BILLSTATUS
      // did and stripped it, which broke the match for exactly the reports that
      // have one (H. Rept. 119-106,Book 1 and Book 2, H.R. 1's own). Match what
      // was published, and fall back to the stripped form for the rest.
      const cit = String(txt(cr.citation) ?? "").trim();
      if (cit && billId) {
        reportLinks.push([cit, billId]);
        const bare = cit.split(",")[0].trim();
        if (bare !== cit) reportLinks.push([bare, billId]);
      }
    }
  }

  await drain(true);
  await flush("congress_summaries", ["key", "congress", "payload", "bill_id", "bill_number", "action_date", "action_desc", "version_code", "text"], sums.splice(0));
  await flush("congress_titles", ["key", "congress", "payload", "bill_id", "bill_number", "title_type", "title", "chamber"], titles.splice(0));
  await flush("congress_related_bills", ["key", "congress", "payload", "bill_id", "bill_number", "related_bill_id", "related_bill_number", "relationship"], related.splice(0));
  await flush("congress_cosponsors", ["key", "congress", "payload", "bill_id", "bill_number", "bioguide_id", "people_id", "full_name", "party", "state", "sponsorship_date", "is_original_cosponsor", "sponsorship_withdrawn_date"], cosponsors.splice(0));

  for (let i = 0; i < docDates.length; i += 400) {
    const chunk = docDates.slice(i, i + 400);
    // Insert, not update: govinfo wrote 222,121 rows into "BillTexts" and none
    // into "Documents", so there was nothing to update — which is why every
    // stage of a bill read the night of the backfill and carried no link.
    const seen = new Map();
    for (const c of chunk) seen.set(c[0], c);
    const rows = [...seen.values()];
    const params = [];
    const tuples = rows.map((c) => `($${params.push(c[0])},$${params.push(c[1])},'text',$${params.push(c[2])},$${params.push(c[3])},$${params.push(c[4])})`).join(",");
    await db.query(
      `insert into "Documents" (document_id, bill_id, document_type, date, url, document_desc)
       values ${tuples}
       on conflict (document_type, document_id) do update set
         date = coalesce(excluded.date, "Documents".date),
         url = coalesce("Documents".url, excluded.url),
         document_desc = coalesce("Documents".document_desc, excluded.document_desc)`,
      params,
    );
  }

  if (lawAreas.length) {
    await db.query(`alter table congress_laws add column if not exists policy_area text`);
    for (let i = 0; i < lawAreas.length; i += 500) {
      const chunk = lawAreas.slice(i, i + 500);
      await db.query(
        `update congress_laws l set policy_area = v.area,
           payload = jsonb_set(l.payload, '{policyArea}', jsonb_build_object('name', v.area), true)
           from (select * from unnest($1::text[], $2::text[]) as t(key, area)) v
          where l.key = v.key`,
        [chunk.map((c) => c[0]), chunk.map((c) => c[1])],
      );
    }
  }

  for (let i = 0; i < amendLinks.length; i += 500) {
    const chunk = amendLinks.slice(i, i + 500);
    await db.query(
      `update congress_amendments a set amended_bill_id = v.bill_id::bigint, amended_bill_number = v.bn
         from (select * from unnest($1::text[], $2::bigint[], $3::text[]) as t(key, bill_id, bn)) v
        where a.key = v.key`,
      [chunk.map((c) => c[0]), chunk.map((c) => c[1]), chunk.map((c) => c[2])],
    );
  }
  for (let i = 0; i < reportLinks.length; i += 500) {
    const chunk = reportLinks.slice(i, i + 500);
    // A citation names every part of the report, so this links all of them.
    await db.query(
      `update congress_committee_reports r set bill_id = v.bill_id::bigint
         from (select * from unnest($1::text[], $2::bigint[]) as t(citation, bill_id)) v
        where r.citation = v.citation`,
      [chunk.map((c) => c[0]), chunk.map((c) => c[1])],
    );
  }
  tally.amendments += amendLinks.length; tally.reports += reportLinks.length; tally.docDates = (tally.docDates ?? 0) + docDates.length;
  log(`${type}: ${names.length} bills · ${(buf.length / 1e6).toFixed(1)} MB · ${amendLinks.length} amendment links · ${reportLinks.length} report links · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await sleep(1500); // govinfo asks nothing of us; this is manners.
}

const counts = await db.query(`select
  (select count(*) from congress_bills) b, (select count(*) from congress_bill_actions) ba,
  (select count(*) from congress_bill_committees) bc, (select count(*) from congress_bill_subjects) bs,
  (select count(*) from congress_cbo_estimates) cbo,
  (select count(*) from congress_text_formats) tf,
  (select count(*) from congress_bills where sponsor_bioguide is not null) sp,
  (select count(*) from congress_summaries) s, (select count(*) from congress_titles) t,
  (select count(*) from congress_related_bills) r, (select count(*) from congress_cosponsors) cs,
  (select count(*) from "Documents" where document_type='text' and date is not null) dd,
  (select count(*) from congress_amendments where amended_bill_id is not null) a,
  (select count(*) from congress_committee_reports where bill_id is not null) cr`);
const c = counts.rows[0];
log(`billstatus done: ${tally.bills} bills · ${tally.zips} zips · ${(tally.bytes / 1e6).toFixed(0)} MB · 0 API requests`);
log(`  congress_bills ${c.b} (${c.sp} with a sponsor bioguide) · congress_bill_actions ${c.ba} · congress_bill_committees ${c.bc} · congress_bill_subjects ${c.bs} · congress_cbo_estimates ${c.cbo} · congress_text_formats ${c.tf}`);
log(`  congress_summaries ${c.s} · congress_titles ${c.t} · congress_related_bills ${c.r} · congress_cosponsors ${c.cs} · text dates ${c.dd} · amendments linked ${c.a} · reports linked ${c.cr}`);

await db.end();
process.exit(0);
