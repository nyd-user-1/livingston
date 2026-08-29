// api/_lib/text-sources/tx-ftp.ts — Texas, from the Legislature's anonymous FTP mirror.
//
//   ftp://ftp.legis.state.tx.us/bills/<session>/billtext/html/<chamber_dir>/<block>/<FILE>.htm
//   e.g. /bills/88R/billtext/html/house_bills/HB03900_HB03999/HB03971I.htm
//
// It is the same file LegiScan links on the website —
//   https://capitol.texas.gov/tlodocs/88R/billtext/html/HB03971I.htm
// — served from a different host that exists to be mirrored. The walker gets
// Texas at one request a second from capitol.texas.gov; this source gets it,
// in parallel, from the mirror, so Texas moves at three files a second instead
// of one. Every row is written under LegiScan's REAL document_id, so the walker
// stops asking for whatever this has fetched, and vice versa.
//
// The mirror answers ~1 file/s per connection (data-connection setup per file,
// not bandwidth), so `parallel` FTP connections is the knob: 2 by default.
// It is an anonymous bulk mirror, not a web server; two connections is well
// inside what such a service is for, and it is not raised without a reason.
//
// Per (session, chamber) the block directories (HB00100_HB00199 …) are listed
// once and files are addressed by number range, so a bill's path is never
// guessed. Fetching is `curl -K` with a config of url/output pairs: one process,
// one control connection, sequential transfers — the FTP client we already have
// on every box, and no library to trust.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { TextBuffer, htmlToText, type Counts, type Sql } from "../text-shared.js";

const FTP = "ftp://ftp.legis.state.tx.us/bills";
export const SOURCE = "tx-ftp";

/** LegiScan's filename prefix → the mirror's chamber directory. */
const CHAMBER_DIR: Record<string, string> = {
  HB: "house_bills", SB: "senate_bills", HR: "house_resolutions", SR: "senate_resolutions",
  HJ: "house_joint_resolutions", SJ: "senate_joint_resolutions", HC: "house_concurrent_resolutions", SC: "senate_concurrent_resolutions",
};

export type TxOpts = { session: string; limit: number; parallel: number; cacheDir: string };

/** https://capitol.texas.gov/tlodocs/88R/billtext/html/HB03971I.htm -> { session: "88R", file: "HB03971I.htm", prefix: "HB", num: 3971 } */
export function parseTloLink(link: string): { session: string; file: string; prefix: string; num: number } | null {
  const m = /tlodocs\/([0-9A-Z]+)\/billtext\/html\/(([A-Z]{2})(\d{5})[A-Z]\.htm)$/i.exec(link);
  if (!m) return null;
  return { session: m[1].toUpperCase(), file: m[2], prefix: m[3].toUpperCase(), num: Number(m[4]) };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (b: Buffer) => { out += String(b); });
    p.stderr.on("data", (b: Buffer) => { err += String(b); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out, err }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: 1, out, err: String(e) }); });
  });
}

/** One FTP directory listing → the block dirs, as numeric ranges. */
async function listBlocks(session: string, chamberDir: string, counts: Counts): Promise<{ lo: number; hi: number; name: string }[]> {
  const r = await run("curl", ["-s", "--max-time", "60", "--list-only", `${FTP}/${session}/billtext/html/${chamberDir}/`], 90_000);
  counts.ftpListings = (counts.ftpListings ?? 0) + 1;
  if (r.code !== 0) return [];
  const blocks: { lo: number; hi: number; name: string }[] = [];
  for (const line of r.out.split("\n")) {
    const m = /^([A-Z]{2})(\d+)_[A-Z]{2}(\d+)\s*$/.exec(line.trim());
    if (m) blocks.push({ lo: Number(m[2]), hi: Number(m[3]), name: line.trim() });
  }
  return blocks;
}

export async function runTxFtp(sql: Sql, opts: TxOpts, counts: Counts) {
  // What the walker has not got yet, for this session — the absence of a row is
  // the resume point here too, and the walker's rows count as "got".
  const rows = (await sql.query(
    `SELECT d.document_id, d.bill_id, d.document_desc, d.state_link, b.session_id
       FROM "Documents" d JOIN "Bills" b ON b.bill_id = d.bill_id
       LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
      WHERE b.state = 'TX' AND d.document_type = 'text' AND t.document_id IS NULL
        AND d.state_link LIKE $1
      ORDER BY d.bill_id, d.document_id
      LIMIT $2`,
    [`%/tlodocs/${opts.session}/billtext/html/%`, opts.limit],
  )) as { document_id: number; bill_id: number; document_desc: string; state_link: string; session_id: number }[];
  counts.considered = rows.length;
  if (!rows.length) return;

  // Resolve each document to a mirror path through the listed block directories.
  const blockCache = new Map<string, { lo: number; hi: number; name: string }[]>();
  type Job = { row: typeof rows[number]; url: string; file: string };
  const jobs: Job[] = [];
  const buf = new TextBuffer(sql, counts);
  for (const row of rows) {
    const p = parseTloLink(row.state_link);
    const dir = p ? CHAMBER_DIR[p.prefix] : undefined;
    if (!p || !dir) {
      counts.unparseableLink = (counts.unparseableLink ?? 0) + 1;
      await buf.add({ document_id: row.document_id, bill_id: row.bill_id, state: "TX", session_id: row.session_id, version: row.document_desc || null, source: SOURCE, mime: null, text: null, error: `tx-ftp: link is not a tlodocs html file: ${row.state_link.slice(0, 120)}` });
      continue;
    }
    if (!blockCache.has(dir)) blockCache.set(dir, await listBlocks(p.session, dir, counts));
    const block = blockCache.get(dir)!.find((b) => p.num >= b.lo && p.num <= b.hi);
    if (!block) {
      counts.noBlock = (counts.noBlock ?? 0) + 1;
      await buf.add({ document_id: row.document_id, bill_id: row.bill_id, state: "TX", session_id: row.session_id, version: row.document_desc || null, source: SOURCE, mime: null, text: null, error: `tx-ftp: no block directory for ${p.file} under ${dir}` });
      continue;
    }
    jobs.push({ row, url: `${FTP}/${p.session}/billtext/html/${dir}/${block.name}/${p.file}`, file: p.file });
  }

  // Fetch: `parallel` curl processes, each one connection, each its own batch.
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(opts.cacheDir, "tx-ftp-"));
  try {
    const per = Math.ceil(jobs.length / Math.max(1, opts.parallel));
    const batches: Job[][] = [];
    for (let i = 0; i < jobs.length; i += per) batches.push(jobs.slice(i, i + per));
    await Promise.all(batches.map(async (batch, bi) => {
      const cfg = path.join(work, `batch-${bi}.cfg`);
      fs.writeFileSync(cfg, batch.map((j) => `url = "${j.url}"\noutput = "${path.join(work, `${bi}-${j.file}`)}"\n`).join(""));
      const r = await run("curl", ["-s", "--max-time", String(60 * batch.length + 60), "--connect-timeout", "30", "--retry", "2", "-K", cfg], (60 * batch.length + 120) * 1000);
      counts.ftpSessions = (counts.ftpSessions ?? 0) + 1;
      if (r.code !== 0) counts[`curl_exit_${r.code}`] = (counts[`curl_exit_${r.code}`] ?? 0) + 1;
    }));

    const best = new Map<number, number>();
    for (const [bi, batch] of batches.entries()) {
      for (const j of batch) {
        const f = path.join(work, `${bi}-${j.file}`);
        const base = { document_id: j.row.document_id, bill_id: j.row.bill_id, state: "TX", session_id: j.row.session_id, version: j.row.document_desc || null, source: SOURCE, mime: "text/html" };
        if (!fs.existsSync(f) || fs.statSync(f).size === 0) {
          counts.ftpMissing = (counts.ftpMissing ?? 0) + 1;
          await buf.add({ ...base, text: null, error: `ftp: not found or empty: ${j.url.slice(FTP.length)}` });
          continue;
        }
        const text = htmlToText(fs.readFileSync(f, "utf8"));
        if (!text) { counts.emptyText = (counts.emptyText ?? 0) + 1; await buf.add({ ...base, text: null, error: "no text extracted (html)" }); continue; }
        await buf.add({ ...base, text, error: null }, text.length);
        best.set(j.row.bill_id, Math.max(best.get(j.row.bill_id) ?? 0, text.length));
      }
    }
    for (const [billId, chars] of best) buf.stamp(billId, chars);
    await buf.flush();
    counts.bills = best.size;
    counts.fetched = jobs.length;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export const defaultCacheDir = () => path.join(os.tmpdir(), "livingston-tx-ftp");
