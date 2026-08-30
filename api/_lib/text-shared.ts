// api/_lib/text-shared.ts — what every bill-text source shares.
//
// Extracted verbatim from api/bill-text.ts on 2026-08-29 when the native-feed
// sources (California's pubinfo zips first) made that file the wrong place for
// them. Nothing here changed in the move: the converters, the retry, the
// batched TextBuffer with its 50-row / 8 MB / 30 s flush and hash-idempotent
// upsert, and the pooler rewrite are the ones lane BT measured and paid for.
// One copy, imported everywhere — two that agree today drift tomorrow.

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * TEXT_SINK_BUCKET: when set, a batch's TEXT goes to S3 as gzipped JSONL and
 * the database gets only the stub — ids, version, hash, chars, and an error
 * column that says where the text is (`s3-text: s3://bucket/key`). Brendan,
 * 2026-08-30 01:20 ET: "store the rows in S3 and we'll add the outputs to Neon
 * in an orderly fashion instead of all at once." A serial loader
 * (`?source=s3-load`) fills `text` in later at the database's own pace; the
 * corpus meanwhile exists as files, which is what a training rig reads anyway.
 * Keys: <prefix>/<state>/<yyyymmdd>/<tag>-<epoch>-<n>.jsonl.gz.
 */
export const TEXT_SINK_BUCKET = process.env.TEXT_SINK_BUCKET || "";
export const TEXT_SINK_PREFIX = process.env.TEXT_SINK_PREFIX || "text";
const TEXT_SINK_TAG = (process.env.TEXT_SINK_TAG || process.env.HOSTNAME || "box").replace(/[^A-Za-z0-9_-]/g, "");
let s3Shared: S3Client | null = null;
export const s3 = () => (s3Shared ??= new S3Client({ region: process.env.AWS_REGION || "us-east-1" }));

export type Sql = NeonQueryFunction<false, false>;
export type Counts = Record<string, number>;
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;

/**
 * ep-xxx.region.aws.neon.tech -> ep-xxx-pooler.region.aws.neon.tech
 * Left alone if it is already pooled, or if the URL will not parse.
 */
export function poolerUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("-pooler")) return url;
    const parts = u.hostname.split(".");
    parts[0] = `${parts[0]}-pooler`;
    u.hostname = parts.join(".");
    return u.toString();
  } catch { return url; }
}

/* ---- text extraction ----------------------------------------------------- */

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sect: "§", para: "¶", deg: "°",
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Tidy without destroying: legislative text is meaningful line by line, and
 * fixed-width bill text is meaningful column by column — New York centres its
 * headings with leading spaces and the line-number gutter is indentation. So
 * runaway padding is collapsed only INSIDE a line (after the first non-blank
 * character), never at the start of one, and the first line keeps its indent
 * too: only leading blank lines and trailing whitespace go. (Rows converted
 * before 2026-08-29 had their indentation collapsed.)
 */
export function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?<=\S)[ \t]{2,}/g, (m) => (m.length > 8 ? "  " : m))   // keep small gaps, collapse runaway padding
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}

/**
 * Redlines survive the conversion. Legislative drafting marks language added
 * to current law by underlining it and language removed by striking it —
 * Texas committee substitutes carry <u> and <s>, Michigan <u>, others <ins>,
 * <del>, <strike> — and stripping those tags while keeping their words turned
 * every amended text into an unreadable mixture of old and new. Now the marks
 * are kept in the text itself, wdiff-style: {+added+} and [-deleted-]. Plain
 * enough to read and to index, and enough for a redline view to render from.
 * (Not applied to PDFs: pdftotext has no strikethrough to give us. Rows
 * converted before 2026-08-29 carry the words without the marks.)
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => (inner.trim() ? `[-${inner}-]` : ""))
    .replace(/<(ins|u)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => (inner.trim() ? `{+${inner}+}` : ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|section|article|blockquote)\s*>/gi, "\n")
    .replace(/<(p|div|tr|li|h[1-6]|section|article|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(stripped));
}

/** govinfo BILLS XML. Sections and paragraphs become newlines; everything else goes. */
export function xmlToText(xml: string): string {
  const stripped = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<\/(section|subsection|paragraph|subparagraph|clause|text|header|enum|toc-entry|title|official-title)\s*>/gi, "\n")
    .replace(/<(section|subsection|paragraph|subparagraph|clause|text|header|enum|toc-entry|title|official-title)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return tidy(decodeEntities(stripped));
}

/** poppler's pdftotext, over stdin/stdout — no temp files, no cleanup to forget. */
export function pdfToText(buf: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("pdftotext", ["-layout", "-q", "-", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (b: Buffer) => out.push(b));
    p.stderr.on("data", (b: Buffer) => { err += String(b); });
    p.on("error", (e) => reject(new Error(`pdftotext: ${e.message}`)));
    p.on("close", (code) => {
      if (code !== 0 && out.length === 0) return reject(new Error(`pdftotext exited ${code}: ${err.slice(0, 200)}`));
      resolve(tidy(Buffer.concat(out).toString("utf8")));
    });
    p.stdin.on("error", () => undefined);   // a pdftotext that dies early closes stdin under us
    p.stdin.end(Buffer.from(buf));
  });
}

/** antiword over a temp file (it will not read stdin); `-w 0` = no line wrapping. Empty when it is not a Word file after all. */
export async function docToText(buf: Uint8Array): Promise<string> {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "doc-"));
  const file = join(dir, "in.doc");
  try {
    await writeFile(file, buf);
    return await new Promise<string>((resolve, reject) => {
      const p = spawn("antiword", ["-w", "0", file], { stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; let err = "";
      p.stdout.setEncoding("utf8"); p.stdout.on("data", (d) => { out += d; });
      p.stderr.setEncoding("utf8"); p.stderr.on("data", (d) => { err += d; });
      p.on("error", (e) => reject(new Error(`antiword: ${e.message}`)));
      p.on("close", (code) => { if (code !== 0 && out.length === 0) return reject(new Error(`antiword exited ${code}: ${err.slice(0, 200)}`)); resolve(out); });
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function bodyToText(mime: string, buf: Uint8Array): Promise<{ text: string; how: string }> {
  const m = (mime || "").toLowerCase();
  const looksPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
  if (looksPdf || m.includes("pdf")) return { text: await pdfToText(buf), how: "pdftotext" };
  // Word 97-2003 (OLE compound file: D0 CF 11 E0) — Kentucky's pre-2019 record is bill.doc. antiword on the box.
  const looksOle = buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  if (looksOle || m.includes("msword")) return { text: tidy(await docToText(buf)), how: "antiword" };
  const s = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (m.includes("xml") || /^\s*<\?xml/.test(s)) return { text: xmlToText(s), how: "xml" };
  if (m.includes("html") || /<html[\s>]/i.test(s)) return { text: htmlToText(s), how: "html" };
  if (m.includes("text/") || !m) return { text: tidy(s), how: "plain" };
  return { text: "", how: `unsupported:${m}` };
}

/* ---- storage ------------------------------------------------------------- */

export type TextRow = {
  document_id: number; bill_id: number; state: string; session_id: number | null;
  version: string | null; source: string; mime: string | null; text: string | null; error: string | null;
  /** Set on an S3-sink stub: the real text's size and hash, so the row stays idempotent without the text. */
  chars?: number; text_hash?: string;
};

/**
 * Idempotent by hash: a document whose text has not changed is NOT rewritten,
 * so a re-run costs a comparison and nothing else — and `fetched_at` keeps
 * meaning "when this text last changed", which is the more useful of the two
 * things it could mean.
 */
/**
 * Neon's compute has a finite connection pool and this lane runs several jobs at
 * once, so "remaining connection slots are reserved for roles with the SUPERUSER
 * attribute", "sorry, too many clients already" and "Failed to acquire permit to
 * connect to the database" are all things that happen under load and all things
 * that succeed on the next try. Retrying them costs a second, not a document.
 */
export async function withRetry<T>(what: () => Promise<T>, counts: Counts, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try { return await what(); } catch (e) {
      last = e;
      const m = String((e as Error).message ?? e);
      const transient = /connection slots|too many clients|acquire permit|too many database connection|fetch failed|ECONNRESET|ETIMEDOUT|too many connections|Connection terminated|Client has encountered a connection error/i.test(m);
      if (!transient || i === tries - 1) throw e;
      counts.dbRetries = (counts.dbRetries ?? 0) + 1;
      await new Promise((ok) => setTimeout(ok, 400 * 2 ** i + Math.random() * 400));
    }
  }
  throw last;
}

/**
 * Writes go out in batches, not one statement per document.
 *
 * One row per commit was the plan and it was wrong for a measurable reason: the
 * neon HTTP driver opens a CONNECTION per query, the direct endpoint allows 450
 * and holds them idle for two minutes, and the `-pooler` endpoint answers a fast
 * enough stream of new connections with "Failed to acquire permit to connect to
 * the database. Too many database connection attempts are currently ongoing."
 * Six jobs writing a row per document is thousands of connection attempts a
 * minute, and no amount of retrying makes that sustainable — the query COUNT is
 * the thing that has to come down.
 *
 * So: flush at 50 rows OR 30 seconds, whichever comes first. The 30 seconds is
 * what keeps the checkpoint honest — a job killed mid-state loses at most half a
 * minute of fetching, and every one of those documents is simply absent from
 * "BillTexts" and gets walked again, because that absence IS the resume point.
 */
export class TextBuffer {
  private rows: TextRow[] = [];
  private stamps = new Map<number, number>();
  private lastFlush = Date.now();
  private bytes = 0;
  // Neon rejects a request over 64 MB outright — "request is too large (max is
  // 67108864 bytes)", HTTP 413 — and fifty New York bill texts can pass that on
  // their own. A row cap alone is not a size cap, and the difference cost a
  // 44-page run of the NY backfill. 8 MB leaves the ceiling a wide berth.
  private maxBytes = 8 * 1024 * 1024;
  constructor(private sql: Sql, private counts: Counts, private size = 50, private maxAgeMs = 30_000) {}

  async add(r: TextRow, chars?: number) {
    // Postgres text cannot hold NUL. A Michigan document carried one and its
    // whole 50-row batch failed with 'invalid byte sequence for encoding "UTF8":
    // 0x00' — twenty of those in a row would have ended a fleet driver and its
    // box (2026-08-30 05:20Z). Strip it here, once, for every source.
    if (r.text && r.text.includes("\u0000")) { r.text = r.text.replace(/\u0000/g, ""); this.counts.nulStripped = (this.counts.nulStripped ?? 0) + 1; }
    if (r.error && r.error.includes("\u0000")) r.error = r.error.replace(/\u0000/g, "");
    if (r.version && r.version.includes("\u0000")) r.version = r.version.replace(/\u0000/g, "");
    this.rows.push(r);
    this.bytes += (r.text?.length ?? 0) + 200;
    if (chars && chars > 0) this.stamp(r.bill_id, chars);
    if (this.rows.length >= this.size || this.bytes >= this.maxBytes || Date.now() - this.lastFlush >= this.maxAgeMs) await this.flush();
  }

  stamp(billId: number, chars: number) {
    this.stamps.set(billId, Math.max(this.stamps.get(billId) ?? 0, chars));
  }


  private async writeBatch(batch: TextRow[]) {
    if (!batch.length) return;
      if (TEXT_SINK_BUCKET) batch = await this.sinkToS3(batch);
      const text = batch.map((r) => r.text);
      const hash = batch.map((r) => (r.text ? sha(r.text) : r.text_hash ?? null));
      const chars = batch.map((r) => (r.text ? r.text.length : r.chars ?? 0));
      const out = (await this.sql.query(
        `INSERT INTO "BillTexts" (document_id, bill_id, state, session_id, version, source, mime, chars, text, text_hash, error, fetched_at)
         SELECT *, now() FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::int[], $9::text[], $10::text[], $11::text[])
         ON CONFLICT (document_id) DO UPDATE
            SET bill_id = EXCLUDED.bill_id, state = EXCLUDED.state, session_id = EXCLUDED.session_id,
                version = EXCLUDED.version, source = EXCLUDED.source, mime = EXCLUDED.mime,
                chars = EXCLUDED.chars, text = EXCLUDED.text, text_hash = EXCLUDED.text_hash,
                fetched_at = now(), error = EXCLUDED.error
          WHERE "BillTexts".text_hash IS DISTINCT FROM EXCLUDED.text_hash
             OR "BillTexts".error IS DISTINCT FROM EXCLUDED.error
         RETURNING (xmax = 0) AS inserted`,
        [batch.map((r) => r.document_id), batch.map((r) => r.bill_id), batch.map((r) => r.state), batch.map((r) => r.session_id),
         batch.map((r) => r.version), batch.map((r) => r.source), batch.map((r) => r.mime), chars, text, hash, batch.map((r) => r.error)],
      )) as { inserted: boolean }[];
      const inserted = out.filter((o) => o.inserted).length;
      this.counts.inserted = (this.counts.inserted ?? 0) + inserted;
      this.counts.updated = (this.counts.updated ?? 0) + (out.length - inserted);
      this.counts.unchanged = (this.counts.unchanged ?? 0) + (batch.length - out.length);
      this.counts.chars = (this.counts.chars ?? 0) + chars.reduce((n, c) => n + c, 0);
      this.counts.writes = (this.counts.writes ?? 0) + 1;
  }

  /** Text rows → one JSONL.gz object per batch (grouped by state); each row comes back as a stub pointing at it. */
  private async sinkToS3(batch: TextRow[]): Promise<TextRow[]> {
    const withText = batch.filter((r) => r.text);
    if (!withText.length) return batch;
    const byState = new Map<string, TextRow[]>();
    for (const r of withText) { const l = byState.get(r.state); if (l) l.push(r); else byState.set(r.state, [r]); }
    const out = batch.filter((r) => !r.text);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    for (const [state, rows] of byState) {
      const key = `${TEXT_SINK_PREFIX}/${state}/${day}/${TEXT_SINK_TAG}-${Date.now()}-${rows.length}.jsonl.gz`;
      const body = gzipSync(Buffer.from(rows.map((r) => JSON.stringify({ ...r, chars: r.text!.length, text_hash: sha(r.text!) })).join("\n") + "\n"));
      await s3().send(new PutObjectCommand({ Bucket: TEXT_SINK_BUCKET, Key: key, Body: body, ContentType: "application/x-ndjson", ContentEncoding: "gzip" }));
      this.counts.s3TextObjects = (this.counts.s3TextObjects ?? 0) + 1;
      this.counts.s3TextRows = (this.counts.s3TextRows ?? 0) + rows.length;
      this.counts.s3TextBytes = (this.counts.s3TextBytes ?? 0) + body.byteLength;
      for (const r of rows) out.push({ ...r, text: null, chars: r.text!.length, text_hash: sha(r.text!), error: `s3-text: s3://${TEXT_SINK_BUCKET}/${key}` });
    }
    return out;
  }

  async flush() {
    this.lastFlush = Date.now();
    const rows = this.rows;
    this.rows = [];
    this.bytes = 0;
    if (rows.length) {
      // Two rows for one document_id in the same statement would trip
      // "ON CONFLICT DO UPDATE command cannot affect row a second time".
      const byId = new Map<number, TextRow>();
      for (const r of rows) byId.set(r.document_id, r);
      let batch = [...byId.values()];
      // A single document bigger than the ceiling cannot be batched with
      // anything, and must not take its neighbours down with it.
      const huge = batch.filter((r) => (r.text?.length ?? 0) > this.maxBytes);
      if (huge.length) {
        batch = batch.filter((r) => (r.text?.length ?? 0) <= this.maxBytes);
        for (const one of huge) { this.rows = [one]; this.bytes = one.text?.length ?? 0; await this.writeBatch([one]); }
        this.rows = [];
        this.bytes = 0;
      }
      await this.writeBatch(batch);
    }
    if (this.stamps.size) {
      const ids = [...this.stamps.keys()];
      const cs = ids.map((id) => this.stamps.get(id) ?? 0);
      this.stamps.clear();
      await this.sql.query(
        `UPDATE "Bills" b SET text_fetched_at = now(), text_chars = v.chars
           FROM unnest($1::bigint[], $2::int[]) AS v(bill_id, chars)
          WHERE b.bill_id = v.bill_id`,
        [ids, cs],
      );
      this.counts.writes = (this.counts.writes ?? 0) + 1;
    }
  }
}


/** Read one sink object back: the rows it holds, text included. */
export async function readSinkObject(uri: string): Promise<TextRow[]> {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!m) throw new Error(`not an s3 uri: ${uri}`);
  const obj = await s3().send(new GetObjectCommand({ Bucket: m[1], Key: m[2] }));
  const bytes = await obj.Body!.transformToByteArray();
  return gunzipSync(Buffer.from(bytes)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TextRow);
}
