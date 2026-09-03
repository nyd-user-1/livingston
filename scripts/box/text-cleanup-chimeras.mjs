#!/usr/bin/env node
// scripts/box/text-cleanup-chimeras.mjs — drop the "BillTexts" rows that were
// fetched through a link belonging to a different bill.
//
//   node scripts/box/text-cleanup-chimeras.mjs --dry-run     # counts only, writes nothing
//   node scripts/box/text-cleanup-chimeras.mjs --apply
//
// WHY THIS EXISTS. "Documents" was keyed on document_id alone, but LegiScan uses
// three separate id spaces — text, amendment, supplement — so one id could name
// three different documents and about 18% of the rows were chimeras: a New York
// bill pointing at a Louisiana link (lane IN, fixed in ebb1337, key is now
// (document_type, document_id)). Lane BT walked those links in good faith. Every
// `source = 'state_link'` row this lane stored before the rebuild is therefore
// suspect, and the ones whose document_id no longer joins back to a text
// document of the SAME bill are provably wrong: we hold Louisiana's words under
// a New York bill_id.
//
// Deleting rows is otherwise against this lane's rules. It is authorised here by
// the lead's 15:20 resume, and it is narrow in the way that matters: only
// `source = 'state_link'`, only rows this lane inserted, and only rows that fail
// the join. nysenate and govinfo rows never touched "Documents" — their ids are
// synthetic and derived from bill_id — so they are not in scope and are not
// counted, let alone removed.
//
// The bills are then RE-STAMPED from what actually survives, rather than set to
// NULL wholesale: a bill that still has a good version keeps an accurate
// text_chars, and a bill left with nothing goes back to NULL so the walker and
// the nightly delta both see it as owed again.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon, policyUrl } from "./policy-db.mjs";
// Aurora, not Neon, since 2026-09-03 — see policy-db.mjs.
policyUrl("text-cleanup-chimeras");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const APPLY = process.argv.includes("--apply");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

for (const line of (fs.existsSync(path.join(REPO, ".env.local")) ? fs.readFileSync(path.join(REPO, ".env.local"), "utf8") : "").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#")) continue;
  const eq = s.indexOf("=");
  if (eq < 1 || process.env[s.slice(0, eq).trim()] !== undefined) continue;
  process.env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}
if (!process.env.POLICY_DATABASE_URL) { console.error("POLICY_DATABASE_URL is required"); process.exit(2); }

const u = new URL(process.env.POLICY_DATABASE_URL);
if (!u.hostname.includes("-pooler")) { const p = u.hostname.split("."); p[0] += "-pooler"; u.hostname = p.join("."); }
const sql = neon(u.toString());

/** The join that decides it: this document_id must still name a TEXT document of the SAME bill. */
const ORPHAN = `
  FROM "BillTexts" t
 WHERE t.source = 'state_link'
   AND NOT EXISTS (
     SELECT 1 FROM "Documents" d
      WHERE d.document_id = t.document_id
        AND d.document_type = 'text'
        AND d.bill_id = t.bill_id)`;

const one = async (q, p = []) => (await sql.query(q, p))[0];

log(`${APPLY ? "APPLY" : "DRY RUN"} — cleaning "BillTexts" rows whose link no longer belongs to their bill`);

const before = await one(`SELECT count(*)::int AS rows,
                                 count(*) FILTER (WHERE source = 'state_link')::int AS state_link,
                                 count(*) FILTER (WHERE source = 'state_link' AND text IS NOT NULL)::int AS state_link_with_text
                            FROM "BillTexts"`);
log(`before: ${before.rows.toLocaleString()} rows total · ${before.state_link.toLocaleString()} state_link · ${before.state_link_with_text.toLocaleString()} of those hold text`);

const doomed = await one(`SELECT count(*)::int AS n,
                                 count(*) FILTER (WHERE t.text IS NOT NULL)::int AS with_text,
                                 COALESCE(sum(t.chars), 0)::bigint AS chars,
                                 count(DISTINCT t.bill_id)::int AS bills ${ORPHAN}`);
log(`orphaned: ${doomed.n.toLocaleString()} rows (${doomed.with_text.toLocaleString()} holding ${Number(doomed.chars).toLocaleString()} characters) across ${doomed.bills.toLocaleString()} bills`);

const byState = await sql.query(`SELECT t.state, count(*)::int AS n ${ORPHAN} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
if (byState.length) log(`   by state: ${byState.map((r) => `${r.state}:${r.n}`).join(" ")}`);

if (!APPLY) {
  log("dry run — nothing written. Re-run with --apply.");
  process.exit(0);
}

// The bills that are about to lose at least one row, remembered BEFORE the delete
// so they can be re-stamped from whatever survives it.
const touched = (await sql.query(`SELECT DISTINCT t.bill_id ${ORPHAN}`)).map((r) => Number(r.bill_id));
log(`re-stamping ${touched.length.toLocaleString()} bills after the delete`);

let deleted = 0;
// In slices, so one statement never has to hold the whole thing.
for (let i = 0; i < touched.length; i += 2000) {
  const slice = touched.slice(i, i + 2000);
  const r = await sql.query(
    `DELETE FROM "BillTexts" t
      WHERE t.source = 'state_link'
        AND t.bill_id = ANY($1::bigint[])
        AND NOT EXISTS (SELECT 1 FROM "Documents" d WHERE d.document_id = t.document_id AND d.document_type = 'text' AND d.bill_id = t.bill_id)
      RETURNING 1`,
    [slice],
  );
  deleted += r.length;
}
log(`deleted ${deleted.toLocaleString()} rows`);

// Re-stamp from what survives: the longest surviving version, or NULL if the
// bill has nothing left, which is what puts it back in the walker's queue.
let restamped = 0;
for (let i = 0; i < touched.length; i += 2000) {
  const slice = touched.slice(i, i + 2000);
  const r = await sql.query(
    `UPDATE "Bills" b
        SET text_chars = s.chars,
            text_fetched_at = s.fetched_at
       FROM (SELECT x.bill_id,
                    NULLIF(COALESCE(max(t.chars), 0), 0) AS chars,
                    max(t.fetched_at) AS fetched_at
               FROM unnest($1::bigint[]) AS x(bill_id)
               LEFT JOIN "BillTexts" t ON t.bill_id = x.bill_id AND t.text IS NOT NULL
              GROUP BY x.bill_id) s
      WHERE b.bill_id = s.bill_id
      RETURNING 1`,
    [slice],
  );
  restamped += r.length;
}
log(`re-stamped ${restamped.toLocaleString()} bills (text_chars from the longest surviving version; NULL where nothing survived, which is what re-queues them)`);

const after = await one(`SELECT count(*)::int AS rows,
                                count(*) FILTER (WHERE source = 'state_link')::int AS state_link,
                                count(*) FILTER (WHERE source = 'state_link' AND text IS NOT NULL)::int AS state_link_with_text
                           FROM "BillTexts"`);
log(`after: ${after.rows.toLocaleString()} rows total · ${after.state_link.toLocaleString()} state_link · ${after.state_link_with_text.toLocaleString()} of those hold text`);

const left = await one(`SELECT count(*)::int AS n ${ORPHAN}`);
log(`orphans remaining: ${left.n} ${left.n === 0 ? "(clean)" : "(NOT CLEAN — investigate)"}`);
process.exit(left.n === 0 ? 0 : 1);
