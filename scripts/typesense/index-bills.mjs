#!/usr/bin/env node
// scripts/typesense/index-bills.mjs — load the NY corpus into Typesense.
//
//   node scripts/typesense/index-bills.mjs [--state NY | --all-states] [--since 2009] [--recreate] [--batch 2000] [--text-chars 4000]
//
// One document per bill: number, session, chamber, title, description, status, committee,
// primary sponsor (+ party, district), last action, the sponsor memo (NY), and the first
// TEXT_CHARS characters of the latest bill text. Facets: session, chamber, status,
// committee, sponsor, party. Idempotent: import?action=upsert keyed on bill_id.
//
//   Env: POLICY_DATABASE_URL, TYPESENSE_URL, TYPESENSE_API_KEY (admin key, indexing only)

import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

for (const l of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const STATE = val("--state", "NY");
const SINCE = Number(val("--since", "2009"));
const BATCH = Number(val("--batch", "2000"));
const RECREATE = argv.includes("--recreate");
const ALL_STATES = argv.includes("--all-states");
const TEXT_CHARS = Number(val("--text-chars", "4000")) || 4000;

const { POLICY_DATABASE_URL, TYPESENSE_URL, TYPESENSE_API_KEY } = process.env;
if (!POLICY_DATABASE_URL || !TYPESENSE_URL || !TYPESENSE_API_KEY) throw new Error("POLICY_DATABASE_URL, TYPESENSE_URL, TYPESENSE_API_KEY required");
const sql = neon(POLICY_DATABASE_URL);
const ts = (path, init = {}) => fetch(`${TYPESENSE_URL}${path}`, { ...init, headers: { "X-TYPESENSE-API-KEY": TYPESENSE_API_KEY, ...(init.headers ?? {}) } });

const schema = {
  name: "bills",
  fields: [
    { name: "bill_number", type: "string" },
    { name: "number_alt", type: "string", optional: true },   // S01234 → S1234, so a typed number matches either spelling
    { name: "state", type: "string", facet: true },
    { name: "session", type: "int32", facet: true },
    { name: "chamber", type: "string", facet: true },
    { name: "title", type: "string" },
    { name: "description", type: "string", optional: true },
    { name: "status", type: "string", facet: true, optional: true },
    { name: "committee", type: "string", facet: true, optional: true },
    { name: "sponsor", type: "string", facet: true, optional: true },
    { name: "party", type: "string", facet: true, optional: true },
    { name: "district", type: "string", optional: true },
    { name: "cosponsors", type: "int32" },
    { name: "last_action", type: "string", optional: true },
    { name: "last_action_date", type: "string", optional: true },
    { name: "last_action_ts", type: "int64" },
    { name: "memo", type: "string", optional: true },
    { name: "crs", type: "string", optional: true },      // CRS summary (Congress)
    { name: "text", type: "string", optional: true },
    { name: "text_chars", type: "int32" },
    { name: "url", type: "string", optional: true, index: false },
  ],
  default_sorting_field: "last_action_ts",
  token_separators: ["-", "."],
};

const exists = (await ts("/collections/bills")).status === 200;
if (exists && RECREATE) { await ts("/collections/bills", { method: "DELETE" }); console.log("dropped bills"); }
if (!exists || RECREATE) {
  const r = await ts("/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(schema) });
  if (!r.ok) throw new Error(`create collection: ${r.status} ${await r.text()}`);
  console.log("created bills");
}

const chamber = (b) => (b ?? "").startsWith("S") ? "Senate" : (b ?? "").startsWith("A") ? "Assembly" : (b ?? "").startsWith("H") ? "House" : b || "";
const day = (d) => (d ? String(d).slice(0, 10) : "");
const ts_of = (d) => { const t = Date.parse(day(d)); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };

async function indexState(STATE) {
  const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM "Bills" WHERE state = $1 AND session_id >= $2`, [STATE, SINCE]);
  console.log(`${STATE} since ${SINCE}: ${n.toLocaleString()} bills, batch ${BATCH}`);
  let last = 0, done = 0, t0 = Date.now();
for (;;) {
  const rows = await sql.query(
    `SELECT b.bill_id, b.bill_number, b.session_id, b.body, b.title, b.description, b.status_desc, b.committee, b.last_action, b.last_action_date, b.url, b.state_link,
            b.text_chars,
            p.name AS sponsor, p.party AS party, p.district AS district,
            (SELECT count(*)::int - 1 FROM "Sponsors" s2 WHERE s2.bill_id = b.bill_id) AS cosponsors,
            (SELECT t.text FROM "BillTexts" t WHERE t.bill_id = b.bill_id AND t.version ILIKE '%memo%' AND t.text IS NOT NULL ORDER BY t.fetched_at DESC LIMIT 1) AS memo,
            (SELECT left(t.text, ${TEXT_CHARS}) FROM "BillTexts" t WHERE t.bill_id = b.bill_id AND t.version NOT ILIKE '%memo%' AND t.version NOT ILIKE 'crs%' AND t.text IS NOT NULL ORDER BY t.fetched_at DESC LIMIT 1) AS text,
            (SELECT t.text FROM "BillTexts" t WHERE t.bill_id = b.bill_id AND t.version ILIKE 'crs%' AND t.text IS NOT NULL ORDER BY t.fetched_at DESC LIMIT 1) AS crs
       FROM "Bills" b
       LEFT JOIN LATERAL (SELECT people_id FROM "Sponsors" s WHERE s.bill_id = b.bill_id ORDER BY (s.sponsor_type_id = 1) DESC, s.position ASC LIMIT 1) sp ON TRUE
       LEFT JOIN "People" p ON p.people_id = sp.people_id
      WHERE b.state = $1 AND b.session_id >= $2 AND b.bill_id > $3
      ORDER BY b.bill_id LIMIT $4`,
    [STATE, SINCE, last, BATCH],
  );
  if (!rows.length) break;
  const docs = rows.map((b) => ({
    id: String(b.bill_id), bill_number: b.bill_number, number_alt: String(b.bill_number ?? "").replace(/^([A-Z]+)0+(\d)/, "$1$2"), state: STATE, session: Number(b.session_id), chamber: chamber(b.body),
    title: b.title ?? "", description: b.description ?? undefined, status: b.status_desc ?? undefined, committee: b.committee || undefined,
    sponsor: b.sponsor || undefined, party: b.party || undefined, district: b.district || undefined, cosponsors: Math.max(0, Number(b.cosponsors ?? 0)),
    last_action: b.last_action ?? undefined, last_action_date: day(b.last_action_date) || undefined, last_action_ts: ts_of(b.last_action_date),
    memo: b.memo ?? undefined, crs: b.crs ?? undefined, text: b.text ?? undefined, text_chars: Number(b.text_chars ?? 0) || 0, url: b.state_link || b.url || undefined,
  }));
  const r = await ts("/collections/bills/documents/import?action=upsert", { method: "POST", headers: { "Content-Type": "text/plain" }, body: docs.map((d) => JSON.stringify(d)).join("\n") });
  const lines = (await r.text()).trim().split("\n");
  const failed = lines.filter((l) => !l.includes('"success":true'));
  if (failed.length) console.error(`  ${failed.length} failed, e.g. ${failed[0].slice(0, 200)}`);
  done += docs.length; last = Number(rows[rows.length - 1].bill_id);
  console.log(`  ${done.toLocaleString()} / ${n.toLocaleString()}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
}

const states = ALL_STATES
  ? (await sql.query(`SELECT state FROM "Bills" WHERE session_id >= $1 GROUP BY state ORDER BY count(*) DESC`, [SINCE])).map((r) => r.state)
  : [STATE];
for (const st of states) await indexState(st);
const c = await (await ts("/collections/bills")).json();
console.log(`done: ${c.num_documents.toLocaleString()} documents in Typesense`);
