// api/_lib/text-sources/ca-pubinfo.ts — California, from the Legislative
// Counsel's own database dump.
//
// leginfo.legislature.ca.gov closes /faces/billTextClient.xhtml to crawlers in
// robots.txt, and lane BT's walker recorded that refusal 7,000 times and moved
// on. What the Legislative Counsel publishes INSTEAD is the whole thing:
//
//   https://downloads.leginfo.legislature.ca.gov/pubinfo_<year>.zip
//
// one zip per two-year session (1989 → today, ~1 GB each for recent sessions),
// refreshed weekly, plus pubinfo_<Mon..Sat>.zip daily deltas. Inside: tab-
// delimited `*_TBL.dat` files, one per table of the `capublic` schema
// (pubinfo_load.zip carries the DDL), and `BILL_VERSION_TBL_<n>.lob` files —
// one per bill version — holding the `bill_xml` column: the version's full text
// as CAML XML. That LOB is what this source stores. Four HTTP requests for a
// state the walker could never have.
//
// Identity (why some rows carry LegiScan's document_id and some a synthetic one):
// `"BillTexts".document_id` is the walker's resume point — it selects
// "Documents" rows with no "BillTexts" row of the same id — so a native row
// written under the REAL id is a document the walker stops asking for. LegiScan's
// CA links carry enough to match exactly:
//   2021+  …billTextClient.xhtml?bill_id=202520260AB946#98AMD   → (ca bill_id, version 98)
//   2009-15 …/ab_1644_bill_20100317_amended_asm_v97.html         → (measure, version 97)
//   2017-19 …billTextClient.xhtml?bill_id=201920200AB347         → no version; matched
//           only when the bill has ONE LegiScan document of that kind (Introduced /
//           Amended / Enrolled / Chaptered) and ONE native version of that kind.
// Everything else gets the synthetic id -(bill_id * 100 + (100 - version_num)):
// CA numbers versions downward from 99 (introduced) so slot 1 is the introduced
// text, slot 2 the first amendment, and so on. Fixed, documented, never
// renumbered — an id whose meaning changes is the "Documents" chimera bug again.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TextBuffer, decodeEntities, tidy, type Counts, type Sql } from "../text-shared.js";

const PUBINFO = "https://downloads.leginfo.legislature.ca.gov";
const UA = "livingston-bill-text/1.0 (legislative full-text archive; contact: brendan@nysgpt.com)";
export const SOURCE = "ca-pubinfo";

export type CaOpts = {
  session: number;        // the session's first year: 2025 for 2025-2026
  cacheDir: string;       // where the zip lands and is unpacked; the zip stays, the unpack does not
  zipName?: string;       // override, e.g. pubinfo_Sat.zip for a cheap sample
  keep: boolean;          // leave the unpacked directory behind (debugging)
  sample: number;         // stop after this many versions (0 = all)
};

/** 202520260AB1651 -> { start: 2025, end: 2026, sessionNum: 0, type: "AB", num: 1651 } */
export function parseCaBillId(id: string): { start: number; end: number; sessionNum: number; type: string; num: number } | null {
  const m = /^(\d{4})(\d{4})(\d)([A-Z]+)(\d+)$/.exec(id);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), sessionNum: Number(m[3]), type: m[4], num: Number(m[5]) };
}

/** LegiScan's bill_number for a CA measure: AB1651 in a regular session, ABX11 for AB 1 of the 1st extraordinary. */
export function legiscanNumber(type: string, sessionNum: number, num: number): string {
  return sessionNum === 0 ? `${type}${num}` : `${type}X${sessionNum}${num}`;
}

/** Introduced / Amended / Enrolled / Chaptered — the four kinds LegiScan's document_desc uses, from CA's action text. */
export function versionKind(action: string): string {
  const a = action.toLowerCase();
  if (a.startsWith("introduced")) return "Introduced";
  if (a.startsWith("amended")) return "Amended";
  if (a.startsWith("enrolled")) return "Enrolled";
  if (a.startsWith("chaptered")) return "Chaptered";
  return action;
}

/**
 * CAML (California Legislative Markup) → text. Structure becomes newlines —
 * every caml:* element boundary and every xhtml block — and the typographic
 * `<span class="EnSpace"/>` placeholders become the space they stand for.
 * Amended versions carry their strike/insert markup as spans; the text of both
 * is kept, the way every other state's amended text is kept, because the
 * comparison IS the document.
 */
export function camlToText(xml: string): string {
  const s = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    // caml:Description is half machine record, half document. The record —
    // version id, the action history as codes and dates, the structured author
    // list, the indicator flags — is already in "Bills"/"History Table" and is
    // noise in a text corpus. The document — "Introduced by Assembly Member
    // Dixon", the title, and the Legislative Counsel's Digest (a human-written
    // summary of the bill; the best paragraph in the file) — stays.
    .replace(/<caml:(Id|VersionNum|History|LegislativeInfo|Authors|MeasureIndicators|DigestKey)\b[^>]*>[\s\S]*?<\/caml:\1>/g, "")
    .replace(/<span\b[^>]*\bclass="(?:En|Em|Thin|Hair|Fig)Space"[^>]*\/>/gi, " ")
    .replace(/<span\b[^>]*\/>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|h[1-6]|table|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/?caml:[A-Za-z]+\b[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ");
  return tidy(decodeEntities(s));
}

/** One tab-delimited pubinfo row: backtick-quoted strings, bare numbers/dates, the literal NULL. */
function unquote(v: string): string | null {
  if (v === "NULL") return null;
  if (v.length >= 2 && v[0] === "`" && v[v.length - 1] === "`") return v.slice(1, -1);
  return v;
}

async function download(url: string, to: string, counts: Counts) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30 * 60 * 1000) });
  counts.queries = (counts.queries ?? 0) + 1;
  if (!r.ok || !r.body) throw new Error(`pubinfo ${r.status} for ${url}`);
  const tmp = `${to}.part`;
  await pipeline(Readable.fromWeb(r.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, to);
  counts.zipBytes = (counts.zipBytes ?? 0) + fs.statSync(to).size;
}

function unzip(zip: string, into: string, members: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("unzip", ["-oq", zip, ...members, "-d", into], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (b: Buffer) => { err += String(b); });
    p.on("error", (e) => reject(new Error(`unzip: ${e.message}`)));
    // 11 = "no matching files" for a pattern; a delta zip may legitimately lack a table.
    p.on("close", (code) => (code === 0 || code === 11 ? resolve() : reject(new Error(`unzip exited ${code}: ${err.slice(0, 300)}`))));
  });
}

export async function runCaPubinfo(sql: Sql, opts: CaOpts, counts: Counts) {
  const zipName = opts.zipName ?? `pubinfo_${opts.session}.zip`;
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  const zipPath = path.join(opts.cacheDir, zipName);
  if (!fs.existsSync(zipPath)) {
    console.log(`ca-pubinfo: downloading ${PUBINFO}/${zipName}`);
    await download(`${PUBINFO}/${zipName}`, zipPath, counts);
  } else counts.zipCached = 1;
  console.log(`ca-pubinfo: ${zipName} is ${(fs.statSync(zipPath).size / 1e6).toFixed(0)} MB`);

  const dir = path.join(opts.cacheDir, zipName.replace(/\.zip$/i, ""));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Only the three things this source reads. The rest of the dump (votes,
  // history, analyses, the codes) is real data for another lane, not this one.
  await unzip(zipPath, dir, ["BILL_TBL.dat", "BILL_VERSION_TBL.dat", "BILL_VERSION_TBL_*.lob"]);
  const datPath = path.join(dir, "BILL_VERSION_TBL.dat");
  if (!fs.existsSync(datPath)) throw new Error(`${zipName} has no BILL_VERSION_TBL.dat`);
  counts.lobFiles = fs.readdirSync(dir).filter((f) => /^BILL_VERSION_TBL_\d+\.lob$/.test(f)).length;

  // --- our side of the join --------------------------------------------------
  const bills = (await sql.query(
    `SELECT bill_id, bill_number FROM "Bills" WHERE state = 'CA' AND session_id = $1`,
    [opts.session],
  )) as { bill_id: number; bill_number: string }[];
  const byNumber = new Map<string, number>();
  for (const b of bills) byNumber.set(String(b.bill_number).toUpperCase(), Number(b.bill_id));
  counts.billsKnown = bills.length;

  const docs = (await sql.query(
    `SELECT d.document_id, d.bill_id, d.document_desc, d.state_link
       FROM "Documents" d JOIN "Bills" b ON b.bill_id = d.bill_id
      WHERE b.state = 'CA' AND b.session_id = $1 AND d.document_type = 'text' AND coalesce(d.state_link, '') <> ''`,
    [opts.session],
  )) as { document_id: number; bill_id: number; document_desc: string; state_link: string }[];
  counts.legiscanDocs = docs.length;
  const byVersion = new Map<string, number>();            // "bill_id:version_num" -> document_id
  const byKind = new Map<string, number[]>();             // "bill_id:Kind" -> document_ids (version unknown)
  for (const d of docs) {
    const frag = /#(\d{2})[A-Z]+\s*$/.exec(d.state_link) ?? /_v(\d{2})\.html?$/i.exec(d.state_link);
    if (frag) { byVersion.set(`${d.bill_id}:${Number(frag[1])}`, Number(d.document_id)); continue; }
    const k = `${d.bill_id}:${versionKind(d.document_desc || "")}`;
    const list = byKind.get(k);
    if (list) list.push(Number(d.document_id)); else byKind.set(k, [Number(d.document_id)]);
  }
  counts.docsWithVersion = byVersion.size;

  // --- the dump ----------------------------------------------------------------
  const buf = new TextBuffer(sql, counts);
  const best = new Map<number, number>();
  const kindCount = new Map<string, number>();            // "bill_id:Kind" -> native versions of that kind (pass 1)
  type Row = { versionId: string; caId: string; versionNum: number; action: string; lob: string | null };
  const rows: Row[] = [];
  let malformed = 0;
  let carry = "";
  const rl = readline.createInterface({ input: fs.createReadStream(datPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const raw of rl) {
    // A subject with an embedded newline splits a record across lines; glue
    // until the record has its 18 columns.
    const line = carry ? `${carry}\n${raw}` : raw;
    const f = line.split("\t");
    if (f.length < 18) { carry = line; continue; }
    carry = "";
    if (f.length > 18) { malformed += 1; continue; }
    const versionId = unquote(f[0]) ?? "";
    const caId = unquote(f[1]) ?? "";
    const versionNum = Number(unquote(f[2]));
    const action = unquote(f[4]) ?? "";
    const lob = unquote(f[14]);
    if (!versionId || !caId || !Number.isFinite(versionNum)) { malformed += 1; continue; }
    rows.push({ versionId, caId, versionNum, action, lob });
  }
  if (carry) malformed += 1;
  counts.versionsInDump = rows.length;
  counts.malformedRows = malformed;

  for (const r of rows) {
    const p = parseCaBillId(r.caId);
    if (!p) continue;
    const billId = byNumber.get(legiscanNumber(p.type, p.sessionNum, p.num));
    if (!billId) continue;
    const k = `${billId}:${versionKind(r.action)}`;
    kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
  }

  let n = 0;
  for (const r of rows) {
    if (opts.sample && n >= opts.sample) break;
    const p = parseCaBillId(r.caId);
    if (!p) { counts.badBillId = (counts.badBillId ?? 0) + 1; continue; }
    if (p.start !== opts.session) { counts.otherSession = (counts.otherSession ?? 0) + 1; continue; }
    const billId = byNumber.get(legiscanNumber(p.type, p.sessionNum, p.num));
    if (!billId) { counts.unmatched = (counts.unmatched ?? 0) + 1; continue; }
    if (!(r.versionNum >= 1 && r.versionNum <= 99)) { counts.oddVersionNum = (counts.oddVersionNum ?? 0) + 1; continue; }
    n += 1;

    // Which id this row is written under — see the header.
    let documentId = byVersion.get(`${billId}:${r.versionNum}`);
    if (documentId === undefined) {
      const k = `${billId}:${versionKind(r.action)}`;
      const candidates = byKind.get(k);
      if (candidates && candidates.length === 1 && kindCount.get(k) === 1) documentId = candidates[0];
    }
    if (documentId !== undefined) counts.realIds = (counts.realIds ?? 0) + 1;
    else { documentId = -(billId * 100 + (100 - r.versionNum)); counts.syntheticIds = (counts.syntheticIds ?? 0) + 1; }

    const row = {
      document_id: documentId, bill_id: billId, state: "CA", session_id: opts.session,
      version: `${r.action || versionKind("")} (v${r.versionNum})`, source: SOURCE, mime: "application/xml",
    };
    if (!r.lob) { counts.noLob = (counts.noLob ?? 0) + 1; await buf.add({ ...row, text: null, error: "pubinfo: version has no bill_xml LOB" }); continue; }
    const lobPath = path.join(dir, r.lob);
    if (!fs.existsSync(lobPath)) { counts.lobMissing = (counts.lobMissing ?? 0) + 1; await buf.add({ ...row, text: null, error: `pubinfo: ${r.lob} not in ${zipName}` }); continue; }
    const text = camlToText(fs.readFileSync(lobPath, "utf8"));
    if (!text) { counts.emptyVersions = (counts.emptyVersions ?? 0) + 1; await buf.add({ ...row, text: null, error: "no text extracted (caml)" }); continue; }
    await buf.add({ ...row, text, error: null }, text.length);
    best.set(billId, Math.max(best.get(billId) ?? 0, text.length));
    if (n % 2000 === 0) { await buf.flush(); console.log(`ca-pubinfo ${opts.session}: ${n.toLocaleString()} versions · ${best.size.toLocaleString()} bills · ${((counts.chars ?? 0) / 1e6).toFixed(0)}M chars`); }
  }
  for (const [billId, chars] of best) buf.stamp(billId, chars);
  await buf.flush();
  counts.versions = n;
  counts.bills = best.size;

  if (!opts.keep) fs.rmSync(dir, { recursive: true, force: true });
}
