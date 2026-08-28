// /api/bill-text — the text of the bills.
//
// We hold 2.2M bills and, until this route, not one word of what any of them
// actually says. "Documents" holds 3.4M LINKS; this fetches what is behind them
// and puts it in "BillTexts", joined to "Bills" by bill_id, with a tsvector for
// the search lane.
//
// Four sources, in the order they are worth having:
//
//   ?source=nysenate-bulk[&session=]          NY Senate, 1,000 bills a request:
//        /bills/{session}?limit=1000&offset=N&full=true returns every amendment
//        version's fullText AND its sponsor memo. This is the backfill.
//   ?source=nysenate&session=2025[&limit=]    the same API one bill at a time —
//        now the mop-up for whatever the listing does not carry.
//   ?source=govinfo&congress=119[&type=hr]    govinfo bulk data, no key.
//        One zip per congress/session/type; filenames carry congress, type,
//        number and version. ~1.8 GB for the 111th-119th, downloaded once.
//   ?source=govinfo-billsum&congress=119      the CRS summary of every federal
//        bill, from govinfo BILLSUM. Same join, no session segment in the path,
//        one row per bill holding the LATEST summary. Not the bill's text and
//        deliberately not stamped as such — see runBillsum.
//   ?source=state_link&state=TX[&since=2023]  the legislature's own site, for
//        everyone else. Politeness lives in api/_lib/polite-fetch.ts.
//   ?mode=delta[&days=7]                      nightly. state_link first (free);
//        LegiScan getBillText only as the fallback, because that one is metered:
//        30,000 queries a month for the whole key, and this route stops at 25,000.
//
//   ?census=1[&since=2023]                    counts only. Fetches nothing.
//
// PDF -> text needs `pdftotext` (poppler-utils) on PATH. That is true on the
// worker box and false on Vercel, which is deliberate: the backfill is a box
// job. The nightly delta is mostly text/html and degrades to "mime recorded,
// text skipped" rather than failing.
//
//   Auth: Authorization: Bearer $CRON_SECRET, or ?secret=
//   Env:  POLICY_DATABASE_URL, NYS_LEGISLATION_API_KEY, LEGISCAN_API_KEY, CRON_SECRET

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { Unzip, UnzipInflate } from "fflate";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { PoliteFetcher, type PoliteStats } from "./_lib/polite-fetch.js";

export const config = { maxDuration: 300 };

type Sql = NeonQueryFunction<false, false>;
type Counts = Record<string, number>;

const NY_API = "https://legislation.nysenate.gov/api/3";
const GOVINFO_BULK = "https://www.govinfo.gov/bulkdata";
const GOVINFO = `${GOVINFO_BULK}/BILLS`;
const LEGISCAN = "https://api.legiscan.com/";
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const LEGISCAN_MONTHLY_STOP = 25_000;

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

/* ---- schema -------------------------------------------------------------- */

async function prepareSchema(sql: Sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS "BillTexts" (
    document_id bigint PRIMARY KEY,
    bill_id bigint NOT NULL,
    state text NOT NULL,
    session_id int,
    version text,
    source text NOT NULL,
    mime text,
    chars int,
    text text,
    text_hash text,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    error text)`);
  // The search lane's raw material. GENERATED ... STORED needs an IMMUTABLE
  // expression, so the two-argument to_tsvector with an explicit regconfig —
  // the one-argument form is only STABLE and Postgres refuses it here. left()
  // guards to_tsvector's own 1 MB input ceiling; a bill longer than a million
  // characters is indexed on its first million and stored whole.
  await sql.query(`ALTER TABLE "BillTexts" ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english'::regconfig, left(coalesce(text, ''), 1000000))) STORED`);
  await sql.query(`CREATE INDEX IF NOT EXISTS billtexts_bill_idx ON "BillTexts" (bill_id)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS billtexts_state_session_idx ON "BillTexts" (state, session_id)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS billtexts_source_idx ON "BillTexts" (source)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS billtexts_search_idx ON "BillTexts" USING GIN (search_tsv)`);
  // On "Bills" so a list page can say "text available" without touching a 90 GB
  // table, and so the nightly delta knows what it still owes.
  await sql.query(`ALTER TABLE "Bills" ADD COLUMN IF NOT EXISTS text_fetched_at timestamptz`);
  await sql.query(`ALTER TABLE "Bills" ADD COLUMN IF NOT EXISTS text_chars int`);
  await sql.query(`CREATE INDEX IF NOT EXISTS bills_text_fetched_idx ON "Bills" (state, session_id) WHERE text_fetched_at IS NULL`);
}

/* ---- text extraction ----------------------------------------------------- */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sect: "§", para: "¶", deg: "°",
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Tidy without destroying: legislative text is meaningful line by line. */
function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, (m) => (m.length > 8 ? "  " : m))   // keep small indents, collapse runaway padding
    .trim();
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|section|article|blockquote)\s*>/gi, "\n")
    .replace(/<(p|div|tr|li|h[1-6]|section|article|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(stripped));
}

/** govinfo BILLS XML. Sections and paragraphs become newlines; everything else goes. */
function xmlToText(xml: string): string {
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
function pdfToText(buf: Uint8Array): Promise<string> {
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

async function bodyToText(mime: string, buf: Uint8Array): Promise<{ text: string; how: string }> {
  const m = (mime || "").toLowerCase();
  const looksPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
  if (looksPdf || m.includes("pdf")) return { text: await pdfToText(buf), how: "pdftotext" };
  const s = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (m.includes("xml") || /^\s*<\?xml/.test(s)) return { text: xmlToText(s), how: "xml" };
  if (m.includes("html") || /<html[\s>]/i.test(s)) return { text: htmlToText(s), how: "html" };
  if (m.includes("text/") || !m) return { text: tidy(s), how: "plain" };
  return { text: "", how: `unsupported:${m}` };
}

/* ---- storage ------------------------------------------------------------- */

type TextRow = {
  document_id: number; bill_id: number; state: string; session_id: number | null;
  version: string | null; source: string; mime: string | null; text: string | null; error: string | null;
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
async function withRetry<T>(what: () => Promise<T>, counts: Counts, tries = 5): Promise<T> {
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
class TextBuffer {
  private rows: TextRow[] = [];
  private stamps = new Map<number, number>();
  private lastFlush = Date.now();
  constructor(private sql: Sql, private counts: Counts, private size = 50, private maxAgeMs = 30_000) {}

  async add(r: TextRow, chars?: number) {
    this.rows.push(r);
    if (chars && chars > 0) this.stamp(r.bill_id, chars);
    if (this.rows.length >= this.size || Date.now() - this.lastFlush >= this.maxAgeMs) await this.flush();
  }

  stamp(billId: number, chars: number) {
    this.stamps.set(billId, Math.max(this.stamps.get(billId) ?? 0, chars));
  }

  async flush() {
    this.lastFlush = Date.now();
    const rows = this.rows;
    this.rows = [];
    if (rows.length) {
      // Two rows for one document_id in the same statement would trip
      // "ON CONFLICT DO UPDATE command cannot affect row a second time".
      const byId = new Map<number, TextRow>();
      for (const r of rows) byId.set(r.document_id, r);
      const batch = [...byId.values()];
      const text = batch.map((r) => r.text);
      const hash = batch.map((r) => (r.text ? sha(r.text) : null));
      const chars = batch.map((r) => (r.text ? r.text.length : 0));
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


/* ---- source 1: the New York Senate --------------------------------------- */

/** LegiScan stores NY print numbers zero-padded ("S00143"); Open Legislation wants "S143". */
export function nyPrintNo(billNumber: string): string {
  const m = /^([A-Z]+)0*(\d+)([A-Z]?)$/.exec(String(billNumber).trim().toUpperCase());
  return m ? `${m[1]}${m[2]}` : String(billNumber).trim().toUpperCase();
}

/** Base amendment is 0, "A" is 1, "B" is 2 — stable whatever else the bill has. */
const nyVersionIndex = (key: string) => (key ? key.toUpperCase().charCodeAt(0) - 64 : 0);

async function runNySenate(sql: Sql, key: string, session: number, limit: number, retryErrors: boolean, counts: Counts) {
  const bills = (await sql.query(
    `SELECT bill_id, bill_number, session_id FROM "Bills"
      WHERE state = 'NY' AND ($1 = 0 OR session_id = $1)
        AND (${retryErrors ? "text_chars = 0" : "text_fetched_at IS NULL"})
      ORDER BY session_id DESC, bill_id
      LIMIT $2`,
    [session, limit],
  )) as { bill_id: number; bill_number: string; session_id: number }[];
  counts.considered = bills.length;
  const buf = new TextBuffer(sql, counts);

  for (const b of bills) {
    const printNo = nyPrintNo(b.bill_number);
    const url = `${NY_API}/bills/${b.session_id}/${printNo}?key=${key}`;
    let best = 0;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      counts.queries = (counts.queries ?? 0) + 1;
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 30_000)); throw new Error("NY Open Legislation throttled"); }
      const j = (await r.json()) as { success?: boolean; message?: string; result?: { amendments?: { items?: Record<string, { fullText?: string }> } } };
      if (!r.ok || j.success === false) throw new Error(`NY ${r.status} ${String(j.message ?? "").slice(0, 120)}`);
      const items = j.result?.amendments?.items ?? {};
      const keys = Object.keys(items);
      if (!keys.length) throw new Error("no amendments in the response");
      for (const k of keys) {
        const text = String(items[k]?.fullText ?? "");
        if (!text.trim()) { counts.emptyVersions = (counts.emptyVersions ?? 0) + 1; continue; }
        best = Math.max(best, text.length);
        await buf.add({
          document_id: -(b.bill_id * 100 + nyVersionIndex(k)),
          bill_id: b.bill_id, state: "NY", session_id: b.session_id,
          version: k ? `Amendment ${k.toUpperCase()}` : "Original",
          source: "nysenate", mime: "text/plain", text, error: null,
        });
      }
      buf.stamp(b.bill_id, best);
      counts.bills = (counts.bills ?? 0) + 1;
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      await buf.add({
        document_id: -(b.bill_id * 100 + 99), bill_id: b.bill_id, state: "NY", session_id: b.session_id,
        version: "(fetch failed)", source: "nysenate", mime: null, text: null, error: msg,
      });
      // Stamped even on failure, with 0 chars: "we tried and resolved it". The
      // driver moves on; --retry-errors is the way back to it. Without this a
      // permanently 404ing bill would be the head of the queue forever.
      buf.stamp(b.bill_id, 0);
      counts.failed = (counts.failed ?? 0) + 1;
    }
    // ~5 requests/s is the stated ceiling; 210 ms keeps us under it with one in flight.
    await new Promise((ok) => setTimeout(ok, 210));
  }
  await buf.flush();
}

/**
 * The same corpus, 1,000 bills a request instead of one.
 *
 * `GET /api/3/bills/{session}?limit=1000&offset=N&full=true` returns every
 * amendment version's `fullText` AND its sponsor `memo` for a thousand bills at
 * a time (lane DP found this; measured here at 33.6 MB and 11 s a page, 1,220
 * versions and 9.4 M characters per 1,000 bills). The per-bill route did 300
 * bills a minute; this does 1,000 in twelve seconds, which turns fifteen hours
 * into well under one.
 *
 * COVERAGE, because it is not a clean superset. For session 2025 the listing
 * reports `total: 25,402` while we hold 28,790 NY rows — the same +13% gap the
 * report already documents, our table holding print types the listing's total
 * does not count. The listing DOES carry J and K resolutions (checked at offsets
 * 20,001 and 24,001), just not all of what we have. So this is the bulk pass and
 * `source=nysenate` remains the mop-up: it selects on `text_fetched_at IS NULL`,
 * so whatever the listing missed is exactly what it picks up afterwards, one bill
 * at a time. Nothing is silently dropped by going fast.
 */
async function runNySenateBulk(sql: Sql, key: string, session: number, maxPages: number, counts: Counts) {
  const sessions = session
    ? [session]
    : ((await sql.query(`SELECT DISTINCT session_id FROM "Bills" WHERE state = 'NY' AND session_id IS NOT NULL ORDER BY session_id DESC`)) as { session_id: number }[]).map((r) => Number(r.session_id));
  counts.sessions = sessions.length;
  const buf = new TextBuffer(sql, counts);
  let lastCall = 0;
  // One connection, and never closer together than 1.2 s.
  const pace = async () => {
    const wait = lastCall + 1200 - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    lastCall = Date.now();
  };

  let pages = 0;
  for (const yr of sessions) {
    const bills = (await sql.query(`SELECT bill_id, bill_number FROM "Bills" WHERE state = 'NY' AND session_id = $1`, [yr])) as { bill_id: number; bill_number: string }[];
    const byPrint = new Map<string, number>();
    for (const b of bills) byPrint.set(nyPrintNo(b.bill_number), Number(b.bill_id));

    let offset = 1;
    let total = Infinity;
    let strikes = 0;
    while (offset <= total) {
      if (maxPages && pages >= maxPages) { counts.pageLimitHit = 1; break; }
      await pace();
      let j: { success?: boolean; message?: string; total?: number; offsetEnd?: number; result?: { items?: NyBill[] } };
      try {
        const r = await fetch(`${NY_API}/bills/${yr}?key=${key}&limit=1000&offset=${offset}&full=true`, { signal: AbortSignal.timeout(300_000) });
        counts.queries = (counts.queries ?? 0) + 1;
        if (r.status === 429) { strikes += 1; if (strikes > 5) throw new Error("throttled six times in a row"); await new Promise((ok) => setTimeout(ok, 30_000)); continue; }
        j = await r.json();
        if (!r.ok || j.success === false) throw new Error(`NY ${r.status} ${String(j.message ?? "").slice(0, 140)}`);
      } catch (e) {
        strikes += 1;
        counts.pageErrors = (counts.pageErrors ?? 0) + 1;
        if (strikes > 5) throw e;
        await new Promise((ok) => setTimeout(ok, 15_000));
        continue;
      }
      strikes = 0;
      total = Number(j.total ?? 0);
      const items = j.result?.items ?? [];
      if (!items.length) break;

      for (const b of items) {
        const billId = byPrint.get(String(b.printNo ?? "")) ?? byPrint.get(String(b.basePrintNo ?? ""));
        if (!billId) { counts.unmatched = (counts.unmatched ?? 0) + 1; continue; }
        let best = 0;
        for (const [k, v] of Object.entries(b.amendments?.items ?? {})) {
          const idx = nyVersionIndex(k);
          const label = k ? `Amendment ${k.toUpperCase()}` : "Original";
          const full = String(v?.fullText ?? "");
          if (full.trim()) {
            best = Math.max(best, full.length);
            await buf.add({ document_id: -(billId * 100 + idx), bill_id: billId, state: "NY", session_id: yr, version: label, source: "nysenate", mime: "text/plain", text: full, error: null });
          }
          // The sponsor's memo is a different document about the same bill —
          // NY's plain-English statement of what the bill does and why. Stored as
          // its own version at slot 50+idx, which cannot collide with the text
          // versions at 0-26 or the failure marker at 99. It does NOT count
          // toward Bills.text_chars: that column means the length of the BILL.
          const memo = String(v?.memo ?? "");
          if (memo.trim()) {
            await buf.add({ document_id: -(billId * 100 + 50 + idx), bill_id: billId, state: "NY", session_id: yr, version: k ? `Sponsor memo (${k.toUpperCase()})` : "Sponsor memo", source: "nysenate", mime: "text/plain", text: memo, error: null });
            counts.memos = (counts.memos ?? 0) + 1;
          }
        }
        if (best) buf.stamp(billId, best);
        counts.bills = (counts.bills ?? 0) + 1;
      }
      offset = Number(j.offsetEnd ?? offset + items.length) + 1;
      pages += 1;
      counts.pages = pages;
      // One line a page, to stdout, which is the job log. A ninety-minute job
      // that prints nothing until it finishes is indistinguishable from a hung
      // one, and "watch state, not activity" cuts both ways: the lead is polling
      // this log.
      console.log(`${new Date().toISOString().slice(11, 19)} NY ${yr}: page ${pages}, offset ${offset - 1}/${total}, ${counts.bills ?? 0} bills, ${counts.inserted ?? 0} stored, ${counts.unchanged ?? 0} unchanged, ${counts.memos ?? 0} memos`);
    }
    await buf.flush();
  }
  await buf.flush();
}

type NyBill = { printNo?: string; basePrintNo?: string; amendments?: { items?: Record<string, { fullText?: string; memo?: string }> } };

/* ---- source 2: govinfo bulk data ----------------------------------------- */

const GOVINFO_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"] as const;
/** our bill_number prefix -> govinfo type, and back */
const TYPE_BY_PREFIX: Record<string, string> = { HB: "hr", SB: "s", HJR: "hjres", SJR: "sjres", HCR: "hconres", SCR: "sconres", HR: "hres", SR: "sres" };
const PREFIX_BY_TYPE: Record<string, string> = Object.fromEntries(Object.entries(TYPE_BY_PREFIX).map(([k, v]) => [v, k]));
/** Every govinfo bill-version code, in the order govinfo documents them. Index+1 is the synthetic-id slot. */
const VERSION_CODES = ["as", "ash", "ath", "ats", "cdh", "cds", "cph", "cps", "eah", "eas", "ech", "eh", "enr", "eph", "es", "fah", "fph", "fps", "hdh", "hds", "ih", "iph", "ips", "is", "lth", "lts", "oph", "ops", "pap", "pcs", "pp", "pwah", "rah", "ras", "rch", "rcs", "rdh", "rds", "reah", "renr", "res", "rfh", "rfs", "rh", "rih", "ris", "rs", "rth", "rts", "sas", "sc"];
const VERSION_LABEL: Record<string, string> = {
  ih: "Introduced in House", is: "Introduced in Senate", rh: "Reported in House", rs: "Reported in Senate",
  eh: "Engrossed in House", es: "Engrossed in Senate", enr: "Enrolled", eas: "Engrossed Amendment Senate",
  eah: "Engrossed Amendment House", pcs: "Placed on Calendar Senate", rfh: "Referred in House", rfs: "Referred in Senate",
  ats: "Agreed to Senate", ath: "Agreed to House", cps: "Considered and Passed Senate", cph: "Considered and Passed House",
};
export const congressOf = (sessionYear: number) => Math.floor((sessionYear - 1789) / 2) + 1;
export const yearOfCongress = (congress: number) => (congress - 1) * 2 + 1789;

/** BILLS-119hr23ih.xml -> { congress, type, number, version } */
export function parseGovinfoName(name: string): { congress: number; type: string; number: number; version: string } | null {
  const m = /BILLS-(\d+)([a-z]+?)(\d+)([a-z]+)\.xml$/i.exec(name);
  if (!m) return null;
  return { congress: Number(m[1]), type: m[2].toLowerCase(), number: Number(m[3]), version: m[4].toLowerCase() };
}

async function runGovinfo(sql: Sql, congress: number, onlyType: string, counts: Counts) {
  const year = yearOfCongress(congress);
  const bills = (await sql.query(
    `SELECT bill_id, bill_number FROM "Bills" WHERE state = 'US' AND session_id = $1`,
    [year],
  )) as { bill_id: number; bill_number: string }[];
  const byNumber = new Map<string, number>();
  for (const b of bills) byNumber.set(String(b.bill_number).toUpperCase(), Number(b.bill_id));
  counts.billsKnown = bills.length;

  const types = onlyType ? [onlyType] : [...GOVINFO_TYPES];
  const best = new Map<number, number>();
  const buf = new TextBuffer(sql, counts);

  for (const session of [1, 2]) {
    for (const type of types) {
      const url = `${GOVINFO}/${congress}/${session}/${type}/BILLS-${congress}-${session}-${type}.zip`;
      let zip: Uint8Array;
      try {
        const r = await fetch(url, { headers: { "User-Agent": "livingston-bill-text/1.0 (contact: brendan@nysgpt.com)" }, signal: AbortSignal.timeout(300_000) });
        counts.queries = (counts.queries ?? 0) + 1;
        if (r.status === 404) { counts.absentZips = (counts.absentZips ?? 0) + 1; continue; }
        if (!r.ok) throw new Error(`govinfo ${r.status} for ${congress}/${session}/${type}`);
        zip = new Uint8Array(await r.arrayBuffer());
      } catch (e) {
        counts.zipErrors = (counts.zipErrors ?? 0) + 1;
        counts[`err_${congress}_${session}_${type}`] = 1;
        void e;
        continue;
      }
      counts.zipBytes = (counts.zipBytes ?? 0) + zip.byteLength;

      // Stream the archive the way legiscan-sync does: fflate recurses once per
      // file boundary inside a slice, and thousands of small files in one push
      // overflows the stack.
      const pending: Promise<void>[] = [];
      const unzip = new Unzip();
      unzip.register(UnzipInflate);
      unzip.onfile = (file) => {
        const meta = parseGovinfoName(file.name);
        if (!meta) { file.ondata = () => undefined; return; }
        const decoder = new TextDecoder();
        let xml = "";
        file.ondata = (err, data, final) => {
          if (err) { counts.badFiles = (counts.badFiles ?? 0) + 1; return; }
          xml += decoder.decode(data, { stream: !final });
          if (!final) return;
          const body = xml; xml = "";
          pending.push((async () => {
            const prefix = PREFIX_BY_TYPE[meta.type];
            const billId = prefix ? byNumber.get(`${prefix}${meta.number}`) : undefined;
            if (!billId) { counts.unmatched = (counts.unmatched ?? 0) + 1; return; }
            const slot = VERSION_CODES.indexOf(meta.version);
            if (slot < 0) { counts.unknownVersion = (counts.unknownVersion ?? 0) + 1; return; }
            const text = xmlToText(body);
            if (!text) { counts.emptyVersions = (counts.emptyVersions ?? 0) + 1; return; }
            await buf.add({
              document_id: -(billId * 100 + slot + 1), bill_id: billId, state: "US", session_id: year,
              version: VERSION_LABEL[meta.version] ?? meta.version.toUpperCase(),
              source: "govinfo", mime: "application/xml", text, error: null,
            }, text.length);
            best.set(billId, Math.max(best.get(billId) ?? 0, text.length));
          })());
        };
        file.start();
      };
      const STEP = 1 << 16;
      for (let i = 0; i < zip.length; i += STEP) unzip.push(zip.subarray(i, Math.min(i + STEP, zip.length)), i + STEP >= zip.length);
      // Sequentially now, because the writes themselves are batched: the buffer
      // is what bounds connection use, and running these in parallel would only
      // race each other into the same buffer.
      for (const p of pending) await p;
      await buf.flush();
      counts.zips = (counts.zips ?? 0) + 1;
    }
  }

  for (const [billId, chars] of best) buf.stamp(billId, chars);
  await buf.flush();
  counts.bills = best.size;
}

/* ---- source 2b: govinfo BILLSUM, the CRS summaries ----------------------- */

/**
 * The Congressional Research Service writes a plain-English summary of every
 * federal bill, and govinfo publishes them in the same bulk shape as the bills
 * themselves — minus the session segment: BILLSUM/{congress}/{type}/, with
 * BILLSUM-119hr23.xml and a BILLSUM-119-hr.zip beside it.
 *
 * Two decisions worth stating, because both could reasonably have gone the other
 * way and the difference is not visible from the row:
 *
 * 1. ONE ROW PER BILL, holding the LATEST summary. A bill accumulates a summary
 *    per stage ("Introduced in House", "Passed House", "Public Law"), all in the
 *    same file. Keeping every one would trip the same trap `ebb1337` just fixed
 *    one table over, and the lead asked for the latest; `update-date` decides,
 *    with document order as the tie-break.
 *
 * 2. IT DOES NOT STAMP `Bills.text_fetched_at` / `text_chars`. Those two columns
 *    mean "we hold the text of this bill", and a 2,000-character CRS summary is
 *    emphatically not the text of a 400,000-character bill. Stamping here would
 *    make every summarised bill look like a bill we hold in full, and would
 *    overwrite a real BILLS length with a smaller wrong one. The summary is
 *    discoverable exactly where it belongs — a "BillTexts" row whose `source`
 *    says what it is.
 */
async function runBillsum(sql: Sql, congress: number, onlyType: string, counts: Counts) {
  const year = yearOfCongress(congress);
  const bills = (await sql.query(
    `SELECT bill_id, bill_number FROM "Bills" WHERE state = 'US' AND session_id = $1`,
    [year],
  )) as { bill_id: number; bill_number: string }[];
  const byNumber = new Map<string, number>();
  for (const b of bills) byNumber.set(String(b.bill_number).toUpperCase(), Number(b.bill_id));
  counts.billsKnown = bills.length;

  const types = onlyType ? [onlyType] : [...GOVINFO_TYPES];
  const buf = new TextBuffer(sql, counts);

  for (const type of types) {
    const url = `${GOVINFO_BULK}/BILLSUM/${congress}/${type}/BILLSUM-${congress}-${type}.zip`;
    let zip: Uint8Array;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "livingston-bill-text/1.0 (contact: brendan@nysgpt.com)" }, signal: AbortSignal.timeout(300_000) });
      counts.queries = (counts.queries ?? 0) + 1;
      if (r.status === 404) { counts.absentZips = (counts.absentZips ?? 0) + 1; continue; }
      if (!r.ok) throw new Error(`govinfo BILLSUM ${r.status} for ${congress}/${type}`);
      zip = new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      counts.zipErrors = (counts.zipErrors ?? 0) + 1;
      void e;
      continue;
    }
    counts.zipBytes = (counts.zipBytes ?? 0) + zip.byteLength;

    const pending: Promise<void>[] = [];
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (file) => {
      if (!/\.xml$/i.test(file.name)) { file.ondata = () => undefined; return; }
      const decoder = new TextDecoder();
      let xml = "";
      file.ondata = (err, data, final) => {
        if (err) { counts.badFiles = (counts.badFiles ?? 0) + 1; return; }
        xml += decoder.decode(data, { stream: !final });
        if (!final) return;
        const body = xml; xml = "";
        counts.files = (counts.files ?? 0) + 1;
        pending.push((async () => {
          const parsed = parseBillsum(body);
          if (!parsed) { counts.unparsed = (counts.unparsed ?? 0) + 1; return; }
          const prefix = PREFIX_BY_TYPE[parsed.type];
          const billId = prefix ? byNumber.get(`${prefix}${parsed.number}`) : undefined;
          if (!billId) { counts.unmatched = (counts.unmatched ?? 0) + 1; return; }
          if (!parsed.text) { counts.emptyVersions = (counts.emptyVersions ?? 0) + 1; return; }
          await buf.add({
            // Slot 90: BILLS versions occupy 1-52 for the same bill_id, so a
            // summary can never collide with a version of its own bill.
            document_id: -(billId * 100 + 90), bill_id: billId, state: "US", session_id: year,
            version: "CRS summary", source: "govinfo-billsum", mime: "application/xml",
            text: parsed.text, error: null,
          });
          counts.summaries = (counts.summaries ?? 0) + 1;
        })());
      };
      file.start();
    };
    const STEP = 1 << 16;
    for (let i = 0; i < zip.length; i += STEP) unzip.push(zip.subarray(i, Math.min(i + STEP, zip.length)), i + STEP >= zip.length);
    for (const p of pending) await p;
    await buf.flush();
    counts.zips = (counts.zips ?? 0) + 1;
  }
  await buf.flush();
}

/** One BILLSUM file: its measure identity, and the latest of the summaries inside it. */
export function parseBillsum(xml: string): { type: string; number: number; text: string; actionDesc: string; updated: string } | null {
  const item = /<item\b([^>]*)>/i.exec(xml);
  if (!item) return null;
  const attr = (n: string) => (new RegExp(`${n}="([^"]*)"`, "i").exec(item[1]) ?? [, ""])[1];
  const type = attr("measure-type").toLowerCase();
  const number = Number(attr("measure-number"));
  if (!type || !Number.isFinite(number) || !number) return null;

  const summaries = [...xml.matchAll(/<summary\b([^>]*)>([\s\S]*?)<\/summary>/gi)].map((m, i) => ({
    updated: (/update-date="([^"]*)"/i.exec(m[1]) ?? [, ""])[1],
    actionDesc: (/<action-desc>([\s\S]*?)<\/action-desc>/i.exec(m[2]) ?? [, ""])[1].trim(),
    cdata: (/<summary-text>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/summary-text>/i.exec(m[2]) ?? [, ""])[1],
    order: i,
  }));
  if (!summaries.length) return null;
  // Latest by update-date; document order breaks a tie, which is also the order
  // govinfo writes them in.
  summaries.sort((a, b) => (a.updated === b.updated ? a.order - b.order : a.updated < b.updated ? -1 : 1));
  const latest = summaries[summaries.length - 1];
  return { type, number, text: htmlToText(latest.cdata), actionDesc: latest.actionDesc, updated: latest.updated };
}

/* ---- source 3/4: the legislature's own site ------------------------------ */

/**
 * Run `one` over `rows`, one worker per HOST and several hosts at once, each
 * host drained strictly in order.
 *
 * The fetcher already serialises a host, so this is not what makes the crawl
 * polite — it is what stops the crawl being pointlessly slow. Without it, a
 * batch that happens to contain one Arizona document (Crawl-delay 30 s) blocks
 * every other state behind it. Hosts are disjoint by state in our data —
 * measured, zero hosts serve two states — so grouping by host also groups by
 * state, and a slow legislature can only ever hold up its own queue.
 */
async function byHostPool<T extends { state_link: string }>(rows: T[], concurrency: number, counts: Counts, one: (row: T) => Promise<void>) {
  const byHost = new Map<string, T[]>();
  for (const d of rows) {
    let h = "";
    try { h = new URL(d.state_link).host; } catch { h = "(unparseable)"; }
    const list = byHost.get(h);
    if (list) list.push(d); else byHost.set(h, [d]);
  }
  counts.hostsInBatch = byHost.size;
  const queue = [...byHost.values()];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const mine = queue[next++];
      if (!mine) return;
      for (const d of mine) await one(d);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
}


async function runStateLink(sql: Sql, state: string, since: number, limit: number, includeAmendments: boolean, concurrency: number, requeueErrors: boolean, billIds: number[], counts: Counts, fetcher: PoliteFetcher) {
  // Default: documents with no "BillTexts" row at all — the absence IS the resume
  // point, so there is no checkpoint to keep.
  //
  // --requeue-errors: documents whose stored row carries a TRANSIENT error, so a
  // sweep at the end of a multi-day walk can pick up the handful that lost a
  // database connection or timed out. Deliberately narrow: `robots` and
  // `host-dropped` are verdicts, not accidents, and re-asking a site that told us
  // no is the one thing this lane must never do.
  // Each branch gets its OWN parameter list. A shared one left $1 and $2 unused in
  // the bill-ids branch, and Postgres cannot infer the type of a parameter that
  // never appears in the statement — "could not determine data type of parameter $1".
  const rows = (await sql.query(
    billIds.length
      // An explicit list of bills, NO session filter. Lane MB's curated CPI
      // matches are 2003-2019 bills and this walker is scoped to session_id >=
      // 2023, so the labels and the text sat in different halves of the corpus.
      // 545 named documents is a minute of fetching, not a change of scope.
      ? `SELECT d.document_id, d.bill_id, d.state_link, d.document_mime, d.document_desc, d.document_size, b.state, b.session_id
           FROM "Documents" d
           JOIN "Bills" b ON b.bill_id = d.bill_id
           LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
          WHERE d.document_type = ANY($1::text[])
            AND d.state_link <> ''
            AND d.bill_id = ANY($2::bigint[])
            AND t.document_id IS NULL
            AND d.state_link NOT LIKE '%legiscan.com%'
            AND (d.document_size IS NULL OR d.document_size <= ${MAX_TEXT_BYTES})
          ORDER BY d.bill_id, d.document_id
          LIMIT $3`
    : requeueErrors
      ? `SELECT d.document_id, d.bill_id, d.state_link, d.document_mime, d.document_desc, d.document_size, b.state, b.session_id
           FROM "BillTexts" t
           JOIN "Documents" d ON d.document_id = t.document_id
           JOIN "Bills" b ON b.bill_id = d.bill_id
          WHERE t.text IS NULL
            AND t.error IS NOT NULL
            AND t.error !~* '^(robots|host-dropped)'
            AND t.error ~* '(connection|too many|permit|timeout|ETIMEDOUT|ECONNRESET|fetch failed|HTTP 5)'
            AND ($1 = '' OR b.state = $1)
            AND b.session_id >= $2
            AND d.document_type = ANY($4::text[])
          ORDER BY b.session_id DESC, d.document_id
          LIMIT $3`
      : `SELECT d.document_id, d.bill_id, d.state_link, d.document_mime, d.document_desc, d.document_size, b.state, b.session_id
           FROM "Documents" d
           JOIN "Bills" b ON b.bill_id = d.bill_id
           LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
          WHERE d.document_type = ANY($4::text[])
            AND d.state_link <> ''
            AND ($1 = '' OR b.state = $1)
            AND b.session_id >= $2
            AND t.document_id IS NULL
            AND d.state_link NOT LIKE '%legiscan.com%'
            AND (d.document_size IS NULL OR d.document_size <= ${MAX_TEXT_BYTES})
          ORDER BY b.session_id DESC, d.bill_id, d.document_id
          LIMIT $3`,
    billIds.length
      ? [includeAmendments ? ["text", "amendment"] : ["text"], billIds, limit]
      : [state, since, limit, includeAmendments ? ["text", "amendment"] : ["text"]],
  )) as { document_id: number; bill_id: number; state_link: string; document_mime: string; document_desc: string; state: string; session_id: number }[];
  counts.considered = rows.length;

  const best = new Map<number, number>();
  const buf = new TextBuffer(sql, counts);
  const one = async (d: typeof rows[number]) => {
    const got = await fetcher.get(d.state_link);
    if (!got.ok) {
      counts[`skip_${got.skipped ?? "error"}`] = (counts[`skip_${got.skipped ?? "error"}`] ?? 0) + 1;
      await buf.add({
        document_id: d.document_id, bill_id: d.bill_id, state: d.state, session_id: d.session_id,
        version: d.document_desc || null, source: "state_link", mime: d.document_mime || null,
        text: null, error: `${got.skipped ?? "fetch"}: ${String(got.error ?? got.status).slice(0, 200)}`,
      });
      return;
    }
    try {
      const { text, how } = await bodyToText(got.mime || d.document_mime, got.body as Uint8Array);
      counts[`via_${how.split(":")[0]}`] = (counts[`via_${how.split(":")[0]}`] ?? 0) + 1;
      await buf.add({
        document_id: d.document_id, bill_id: d.bill_id, state: d.state, session_id: d.session_id,
        version: d.document_desc || null, source: "state_link", mime: got.mime || d.document_mime || null,
        text: text || null, error: text ? null : `no text extracted (${how})`,
      }, text ? text.length : 0);
      if (text) best.set(d.bill_id, Math.max(best.get(d.bill_id) ?? 0, text.length));
    } catch (e) {
      counts.convertErrors = (counts.convertErrors ?? 0) + 1;
      await buf.add({
        document_id: d.document_id, bill_id: d.bill_id, state: d.state, session_id: d.session_id,
        version: d.document_desc || null, source: "state_link", mime: got.mime || null,
        text: null, error: String((e as Error).message).slice(0, 300),
      });
    }
  };

  await byHostPool(rows, concurrency, counts, one);
  await buf.flush();
  counts.bills = best.size;
}

/* ---- source 5: the nightly delta ----------------------------------------- */

async function legiscanMonthToDate(sql: Sql): Promise<number> {
  const r = (await sql.query(
    `SELECT count(*)::int AS n FROM "BillTexts" WHERE source = 'legiscan' AND fetched_at >= date_trunc('month', now())`,
  )) as { n: number }[];
  return r[0]?.n ?? 0;
}

async function runDelta(sql: Sql, legiscanKey: string | undefined, days: number, limit: number, concurrency: number, counts: Counts, fetcher: PoliteFetcher) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = (await sql.query(
    `SELECT d.document_id, d.bill_id, d.state_link, d.document_mime, d.document_desc, b.state, b.session_id
       FROM "Documents" d
       JOIN "Bills" b ON b.bill_id = d.bill_id
       LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
      WHERE d.document_type = 'text'
        AND t.document_id IS NULL
        AND b.last_action_date >= $1
      ORDER BY b.last_action_date DESC, d.document_id
      LIMIT $2`,
    [since, limit],
  )) as { document_id: number; bill_id: number; state_link: string; document_mime: string; document_desc: string; state: string; session_id: number }[];
  counts.considered = rows.length;
  counts.since = Number(since.replace(/-/g, ""));

  let spent = await legiscanMonthToDate(sql);
  counts.legiscanMonthToDateAtStart = spent;
  const best = new Map<number, number>();
  const buf = new TextBuffer(sql, counts);

  const one = async (d: typeof rows[number]) => {
    let text = "";
    let mime = d.document_mime || null;
    let source = "state_link";
    let error: string | null = null;

    // Free route first, always.
    if (d.state_link && !d.state_link.includes("legiscan.com")) {
      const got = await fetcher.get(d.state_link);
      if (got.ok) {
        try { const c = await bodyToText(got.mime || d.document_mime, got.body as Uint8Array); text = c.text; mime = got.mime || mime; }
        catch (e) { error = String((e as Error).message).slice(0, 200); }
      } else error = `${got.skipped ?? "fetch"}: ${String(got.error ?? got.status).slice(0, 160)}`;
    }

    // Metered fallback. The stop is hard and it is checked per document, not per
    // run, because a run that starts under the line can still cross it.
    if (!text && legiscanKey) {
      if (spent >= LEGISCAN_MONTHLY_STOP) {
        counts.legiscanStopped = (counts.legiscanStopped ?? 0) + 1;
        error = `${error ?? ""} | legiscan skipped: ${spent} queries used this month, stop is ${LEGISCAN_MONTHLY_STOP}`.trim();
      } else {
        try {
          const r = await fetch(`${LEGISCAN}?key=${legiscanKey}&op=getBillText&id=${d.document_id}`, { signal: AbortSignal.timeout(60_000) });
          spent += 1;
          counts.legiscanQueries = (counts.legiscanQueries ?? 0) + 1;
          const j = (await r.json()) as { status?: string; text?: { doc?: string; mime?: string }; alert?: { message?: string } };
          if (j?.status !== "OK" || !j.text?.doc) throw new Error(String(j?.alert?.message ?? j?.status ?? "no doc").slice(0, 160));
          const buf = new Uint8Array(Buffer.from(j.text.doc, "base64"));
          if (buf.byteLength > MAX_TEXT_BYTES) throw new Error(`${buf.byteLength} bytes over the cap`);
          const c = await bodyToText(j.text.mime ?? d.document_mime, buf);
          text = c.text; mime = j.text.mime ?? mime; source = "legiscan"; error = null;
        } catch (e) { error = `${error ?? ""} | legiscan: ${String((e as Error).message).slice(0, 160)}`.trim(); }
      }
    }

    await buf.add({
      document_id: d.document_id, bill_id: d.bill_id, state: d.state, session_id: d.session_id,
      version: d.document_desc || null, source, mime, text: text || null, error: text ? null : (error ?? "no text"),
    }, text ? text.length : 0);
    if (text) best.set(d.bill_id, Math.max(best.get(d.bill_id) ?? 0, text.length));
  };

  await byHostPool(rows, concurrency, counts, one);
  await buf.flush();
  counts.bills = best.size;
  counts.legiscanMonthToDateAtEnd = spent;
}

/* ---- census -------------------------------------------------------------- */

async function census(sql: Sql, since: number, state: string) {
  const perState = await sql.query(
    `SELECT b.state,
            count(*)::int AS docs,
            count(DISTINCT b.bill_id)::int AS bills,
            COALESCE(sum(d.document_size), 0)::bigint AS bytes,
            count(DISTINCT split_part(split_part(d.state_link, '/', 3), ':', 1))::int AS hosts,
            count(*) FILTER (WHERE t.document_id IS NOT NULL)::int AS have,
            count(*) FILTER (WHERE d.document_size > ${MAX_TEXT_BYTES})::int AS oversize
       FROM "Documents" d
       JOIN "Bills" b ON b.bill_id = d.bill_id
       LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
      WHERE d.document_type = 'text' AND d.state_link <> '' AND b.session_id >= $1 AND ($2 = '' OR b.state = $2)
      GROUP BY 1 ORDER BY 2 DESC`,
    [since, state],
  );
  const stored = await sql.query(
    `SELECT source, count(*)::int AS rows, count(*) FILTER (WHERE text IS NOT NULL)::int AS with_text,
            COALESCE(sum(chars), 0)::bigint AS chars
       FROM "BillTexts" GROUP BY 1 ORDER BY 2 DESC`,
  );
  return { since, perState, stored };
}

/* ---- the handler --------------------------------------------------------- */

export default async function handler(req: { headers?: Record<string, string>; query?: Record<string, string> }, res: { status: (n: number) => { json: (o: unknown) => unknown } }) {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query?.secret ?? "");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (given !== secret) return res.status(401).json({ error: "unauthorised" });
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!dbUrl) return res.status(503).json({ error: "POLICY_DATABASE_URL is required" });

  // Every query in this route goes through the retry, not just the writes. The
  // first version wrapped putText and stampBill and left the SELECTs bare, and
  // then a batch died on "sorry, too many clients already" while READING its
  // work list — six jobs on one Neon compute is enough to lose a connection
  // race anywhere, so the wrapper belongs on the handle rather than at each
  // call site anyone remembers to change.
  const t0 = Date.now();
  const counts: Counts = {};
  // Through PgBouncer, not straight at the compute. POLICY_DATABASE_URL names
  // the DIRECT endpoint, whose ceiling is max_connections = 450 — and the neon
  // HTTP driver opens a connection per query which the proxy holds idle for
  // about two minutes, so a sustained few queries a second is enough to fill it.
  // Measured while this lane was running: 441 of 450 connections in use, 422 of
  // them idle, the oldest 62 seconds old, and batches failing with "sorry, too
  // many clients already" while merely READING their work list. The `-pooler`
  // endpoint is transaction-mode PgBouncer and multiplexes all of it onto a few
  // backends. Probed once, and if this project has no pooler we fall back to the
  // direct endpoint rather than refusing to run.
  const sql = { query: (text: string, params?: unknown[]) => withRetry(() => handle.query(text, params ?? []), counts) } as unknown as Sql;
  let handle = neon(poolerUrl(dbUrl));
  try { await handle.query("select 1"); counts.pooled = 1; }
  catch { handle = neon(dbUrl); counts.pooled = 0; }
  const source = String(req.query?.source ?? "");
  const mode = String(req.query?.mode ?? "");
  const state = String(req.query?.state ?? "").toUpperCase();
  const since = Number(req.query?.since ?? 2023) || 2023;
  const limit = Math.min(20_000, Number(req.query?.limit ?? 200) || 200);
  const concurrency = Math.min(24, Math.max(1, Number(req.query?.concurrency ?? 12) || 12));
  // From a file, not the query string: 545 ids inline is 5 KB of URL nobody can
  // read in a log. One id per line, blanks and #comments ignored.
  const billIds: number[] = (() => {
    const f = String(req.query?.billIdsFile ?? "");
    if (!f) return String(req.query?.billIds ?? "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (!fs.existsSync(f)) throw new Error(`billIdsFile not found: ${f}`);
    return fs.readFileSync(f, "utf8").split("\n").map((l) => Number(l.split("#")[0].trim())).filter((n) => Number.isFinite(n) && n > 0);
  })();
  const fetcher = new PoliteFetcher({
    minDelayMs: Math.max(1000, Number(req.query?.delay ?? 1000) || 1000),
    maxBytes: MAX_TEXT_BYTES,
  });

  try {
    await prepareSchema(sql);

    if (req.query?.census) {
      const c = await census(sql, since, state);
      return res.status(200).json({ ok: true, census: true, ...c, ms: Date.now() - t0 });
    }

    if (mode === "delta") {
      await runDelta(sql, process.env.LEGISCAN_API_KEY, Math.max(1, Number(req.query?.days ?? 7) || 7), limit, concurrency, counts, fetcher);
    } else if (source === "nysenate" || source === "nysenate-bulk") {
      const key = process.env.NYS_LEGISLATION_API_KEY;
      if (!key) return res.status(503).json({ error: "NYS_LEGISLATION_API_KEY is required for source=nysenate" });
      if (source === "nysenate-bulk") await runNySenateBulk(sql, key, Number(req.query?.session ?? 0) || 0, Number(req.query?.pages ?? 0) || 0, counts);
      else await runNySenate(sql, key, Number(req.query?.session ?? 0) || 0, limit, Boolean(req.query?.retryErrors), counts);
    } else if (source === "govinfo") {
      const congress = Number(req.query?.congress ?? 0) || (Number(req.query?.session ?? 0) ? congressOf(Number(req.query?.session)) : 0);
      if (!congress) return res.status(400).json({ error: "source=govinfo needs ?congress= or ?session=" });
      await runGovinfo(sql, congress, String(req.query?.type ?? "").toLowerCase(), counts);
      counts.congress = congress;
    } else if (source === "govinfo-billsum") {
      const congress = Number(req.query?.congress ?? 0) || (Number(req.query?.session ?? 0) ? congressOf(Number(req.query?.session)) : 0);
      if (!congress) return res.status(400).json({ error: "source=govinfo-billsum needs ?congress= or ?session=" });
      await runBillsum(sql, congress, String(req.query?.type ?? "").toLowerCase(), counts);
      counts.congress = congress;
    } else if (source === "state_link") {
      await runStateLink(sql, state, since, limit, Boolean(req.query?.amendments), concurrency, Boolean(req.query?.requeueErrors), billIds, counts, fetcher);
    } else {
      return res.status(400).json({ error: "pass ?source=nysenate|govinfo|govinfo-billsum|state_link, or ?mode=delta, or ?census=1" });
    }

    const hosts: PoliteStats[] = fetcher.stats();
    return res.status(200).json({
      ok: true, source: source || mode, state: state || undefined, ...counts,
      billIdsGiven: billIds.length || undefined,
      hosts: hosts.length ? hosts : undefined,
      dropped: hosts.filter((h) => h.dropped).map((h) => h.host),
      ms: Date.now() - t0,
    });
  } catch (err) {
    return res.status(500).json({ error: String((err as Error).message), source: source || mode, state, ...counts, hosts: fetcher.stats(), ms: Date.now() - t0 });
  }
}
