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
//   ?source=ca-pubinfo&session=2025          California, from the Legislative
//        Counsel's pubinfo_<year>.zip — the whole session database including
//        every bill version's CAML XML. leginfo's website is robots-closed to
//        crawlers; this is the route it publishes instead. api/_lib/text-sources/.
//   ?source=tx-ftp&session=88R[&limit=&parallel=2]   Texas, from ftp.legis.state.tx.us — the
//        same html files the website serves, from the mirror that exists to be mirrored.
//   ?source=va-lis[&limit=&parallel=8]         Virginia 2026+, from the new LIS API (VA_LIS_API_KEY):
//        LegiScan's links for that session are a React shell; the text is behind the API.
//   ?source=ma-api[&limit=&parallel=12]         Massachusetts, from malegislature.gov/api — DocumentText inline, no key.
//   ?source=pdf-batch[&state=][&limit=][&concurrency=]   convert the PDFs parked in S3 by PDF_DEFER_BUCKET.
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

import { neon } from "@neondatabase/serverless";
import { Unzip, UnzipInflate } from "fflate";
import fs from "node:fs";
import { PoliteFetcher, type PoliteStats } from "./_lib/polite-fetch.js";
import { TextBuffer, bodyToText, htmlToText, xmlToText, poolerUrl, withRetry, MAX_TEXT_BYTES, type Sql, type Counts } from "./_lib/text-shared.js";
import { runCaPubinfo } from "./_lib/text-sources/ca-pubinfo.js";
import { runTxFtp, defaultCacheDir as txCacheDir } from "./_lib/text-sources/tx-ftp.js";
import { runVaLis } from "./_lib/text-sources/va-lis.js";
import { runMaApi } from "./_lib/text-sources/ma-api.js";
import os from "node:os";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import path from "node:path";

export const config = { maxDuration: 300 };
export { poolerUrl };

const NY_API = "https://legislation.nysenate.gov/api/3";
const GOVINFO_BULK = "https://www.govinfo.gov/bulkdata";
const GOVINFO = `${GOVINFO_BULK}/BILLS`;
const LEGISCAN = "https://api.legiscan.com/";
const LEGISCAN_MONTHLY_STOP = 25_000;


/* ---- schema -------------------------------------------------------------- */

async function prepareSchema(sql: Sql) {
  // Look before altering. ALTER TABLE … ADD COLUMN IF NOT EXISTS takes an
  // ACCESS EXCLUSIVE lock even when the column exists, and with 320 fleet
  // processes each running this on start, Neon showed 338 sessions waiting on
  // "Lock: relation" — the whole fleet queued behind schema no-ops, every
  // writer blocked while they waited. Measured 2026-08-29 22:45 ET.
  const have = (await sql.query(
    `SELECT (SELECT count(*) FROM pg_attribute WHERE attrelid = '"BillTexts"'::regclass AND attname = 'search_tsv' AND NOT attisdropped)::int AS tsv,
            (SELECT count(*) FROM pg_indexes WHERE tablename = 'BillTexts' AND indexname IN ('billtexts_bill_idx','billtexts_state_session_idx','billtexts_source_idx','billtexts_search_idx'))::int AS idx,
            (SELECT count(*) FROM pg_attribute WHERE attrelid = '"Bills"'::regclass AND attname IN ('text_fetched_at','text_chars') AND NOT attisdropped)::int AS bills,
            (SELECT count(*) FROM pg_indexes WHERE tablename = 'Bills' AND indexname = 'bills_text_fetched_idx')::int AS bidx`,
  ).catch(() => [{ tsv: 0, idx: 0, bills: 0, bidx: 0 }])) as { tsv: number; idx: number; bills: number; bidx: number }[];
  if (have[0] && have[0].tsv === 1 && have[0].idx === 4 && have[0].bills === 2 && have[0].bidx === 1) return;
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


/* ---- source 1: the New York Senate --------------------------------------- */

/** LegiScan stores NY print numbers zero-padded ("S00143"); Open Legislation wants "S143". */
export function nyPrintNo(billNumber: string): string {
  const m = /^([A-Z]+)0*(\d+)([A-Z]?)$/.exec(String(billNumber).trim().toUpperCase());
  return m ? `${m[1]}${m[2]}` : String(billNumber).trim().toUpperCase();
}

/** Base amendment is 0, "A" is 1, "B" is 2 — stable whatever else the bill has. */
const nyVersionIndex = (key: string) => (key ? key.toUpperCase().charCodeAt(0) - 64 : 0);

// The text is asked for as HTML and converted here rather than taken as the
// API's plain text: only the HTML carries the redlines — <u> around matter
// added to current law, <s> around matter struck — and htmlToText keeps those
// as {+added+} / [-deleted-]. Plain fullText has the brackets and nothing else.
const NY_TEXT_FORMAT = "fullTextFormat=HTML";
type NyAmendment = { fullText?: string; fullTextHtml?: string; memo?: string };
function nyAmendmentText(v: NyAmendment | undefined): string {
  const html = String(v?.fullTextHtml ?? "");
  return html.trim() ? htmlToText(html) : String(v?.fullText ?? "");
}

async function runNySenate(sql: Sql, key: string, session: number, limit: number, retryErrors: boolean, counts: Counts, billIds: number[] = []) {
  // `billIds` / `billIdsFile` re-fetches exactly these, fetched or not — the
  // way to bring a set of bills forward onto a newer conversion (the redlines,
  // 2026-08-29).
  const bills = (billIds.length
    ? await sql.query(`SELECT bill_id, bill_number, session_id FROM "Bills" WHERE state = 'NY' AND bill_id = ANY($1::bigint[]) ORDER BY bill_id`, [billIds])
    : await sql.query(
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
    const url = `${NY_API}/bills/${b.session_id}/${printNo}?key=${key}&${NY_TEXT_FORMAT}`;
    let best = 0;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      counts.queries = (counts.queries ?? 0) + 1;
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 30_000)); throw new Error("NY Open Legislation throttled"); }
      const j = (await r.json()) as { success?: boolean; message?: string; result?: { amendments?: { items?: Record<string, NyAmendment> } } };
      if (!r.ok || j.success === false) throw new Error(`NY ${r.status} ${String(j.message ?? "").slice(0, 120)}`);
      const items = j.result?.amendments?.items ?? {};
      const keys = Object.keys(items);
      if (!keys.length) throw new Error("no amendments in the response");
      for (const k of keys) {
        const text = nyAmendmentText(items[k]);
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
        const r = await fetch(`${NY_API}/bills/${yr}?key=${key}&limit=1000&offset=${offset}&full=true&${NY_TEXT_FORMAT}`, { signal: AbortSignal.timeout(300_000) });
        counts.queries = (counts.queries ?? 0) + 1;
        if (r.status === 429) { strikes += 1; if (strikes > 5) throw new Error("throttled six times in a row"); await new Promise((ok) => setTimeout(ok, 30_000)); continue; }
        j = (await r.json()) as typeof j;
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
          const full = nyAmendmentText(v);
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
      const nextOffset = Number(j.offsetEnd ?? 0) > 0 ? Number(j.offsetEnd) + 1 : offset + items.length;
      // A listing that stops advancing is a loop, not a page. Re-processing the
      // same thousand bills burns CPU, grows the heap and writes nothing, because
      // every row comes back `unchanged` — which is invisible in a row count and
      // is precisely how this job spent six minutes looking alive.
      if (nextOffset <= offset) {
        counts.offsetStalled = offset;
        console.log(`${new Date().toISOString().slice(11, 19)} NY ${yr}: offsetEnd did not advance past ${offset} (total ${total}) — stopping this session`);
        break;
      }
      offset = nextOffset;
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

type NyBill = { printNo?: string; basePrintNo?: string; amendments?: { items?: Record<string, NyAmendment> } };

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
async function byHostPool<T extends { state_link: string }>(rows: T[], concurrency: number, counts: Counts, one: (row: T) => Promise<void>, fetcher?: PoliteFetcher) {
  const byHost = new Map<string, T[]>();
  for (const d of rows) {
    let h = "";
    try { h = new URL(d.state_link).host; } catch { h = "(unparseable)"; }
    const list = byHost.get(h);
    if (list) list.push(d); else byHost.set(h, [d]);
  }
  counts.hostsInBatch = byHost.size;
  const queue = [...byHost.entries()];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const entry = queue[next++];
      if (!entry) return;
      const [host, mine] = entry;
      // One lane per host, unless a human overrode this host's concurrency — then
      // that many lanes over the same list, and the fetcher still serialises each lane.
      const lanes = Math.max(1, fetcher?.maxLanesFor(host) ?? 1);
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(lanes, mine.length) }, async () => { for (;;) { const d = mine[i++]; if (!d) return; await one(d); } }));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
}


/**
 * LegiScan's link is where the legislature published the document WHEN LEGISCAN
 * SAW IT. Sites move. Illinois rebuilt ilga.gov in 2025 and every pre-redesign
 * link — /legislation/96/SB/09600SB1346.htm, /legislation/publicacts/… — now
 * 404s, while the same file is served under /documents/legislation/…; 7,600
 * documents of older sessions were recorded as dead before this existed. The
 * rewrite is per host, explicit, and verified by hand before it was added; the
 * stored row keeps LegiScan's document_id, so nothing else changes.
 */
export function rewriteLink(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.)?ilga\.gov\/legislation\//i, "https://www.ilga.gov/documents/legislation/")
    // Michigan: the same path 404s over plain http and serves over https (6,000 older links).
    .replace(/^http:\/\/(www\.)?legislature\.mi\.gov\//i, "https://www.legislature.mi.gov/")
    // Hawaii: www.capitol.hawaii.gov 403s everyone now (a browser too); the same paths serve on data.capitol.hawaii.gov.
    .replace(/^https?:\/\/www\.capitol\.hawaii\.gov\//i, "https://data.capitol.hawaii.gov/")
    // Ohio: LegiScan's older links are the retired solarapi v1; the v2 API serves the same version as HTML.
    //   solarapi/v1/general_assembly_134/bills/hb433/RH/01/hb433_01_RH?format=pdf
    //   -> api/v2/general_assembly_134/legislation/hb433/01_RH/html/
    .replace(/^https?:\/\/search-prod\.lis\.state\.oh\.us\/solarapi\/v1\/general_assembly_(\d+)\/(?:bills|resolutions)\/([a-z]+\d+)\/([A-Z]+)\/(\d+)\/.*$/i,
      (_m, ga: string, num: string, code: string, ver: string) => `https://search-prod.lis.state.oh.us/api/v2/general_assembly_${ga}/legislation/${num.toLowerCase()}/${ver}_${code.toUpperCase()}/html/`);
}

/**
 * "2/8" → the third of eight shards: this worker takes documents whose id % 8 = 2.
 * Several boxes, several IPs, no overlap, no chatter — the database is the
 * coordinator. In shard mode the selection is NOT ordered: with 300 fleet
 * processes each asking Neon to sort a state's whole document set before
 * handing back 400, the selects ran 80–300 s each and the fleet did 38k/hour
 * (measured 2026-08-29 22:55 ET). Without the sort the scan stops at LIMIT.
 */
export function parseShard(spec: string): { index: number; of: number } {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(spec.trim());
  if (!m) return { index: 0, of: 1 };
  const of = Math.max(1, Number(m[2])); const index = Math.min(of - 1, Math.max(0, Number(m[1])));
  return { index, of };
}

async function runStateLink(sql: Sql, state: string, since: number, limit: number, includeAmendments: boolean, concurrency: number, requeueErrors: boolean, billIds: number[], counts: Counts, fetcher: PoliteFetcher, shard = { index: 0, of: 1 }) {
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
            AND (d.document_id % $5::int) = $6::int
          ${shard.of > 1 ? "" : "ORDER BY b.session_id DESC, d.bill_id, d.document_id"}
          LIMIT $3`,
    billIds.length
      ? [includeAmendments ? ["text", "amendment"] : ["text"], billIds, limit]
      : [state, since, limit, includeAmendments ? ["text", "amendment"] : ["text"], shard.of, shard.index],
  )) as { document_id: number; bill_id: number; state_link: string; document_mime: string; document_desc: string; state: string; session_id: number }[];
  counts.considered = rows.length;

  const best = new Map<number, number>();
  const buf = new TextBuffer(sql, counts);
  const one = async (d: typeof rows[number]) => {
    const link = rewriteLink(d.state_link);
    let got = await fetcher.get(link);
    // LegiScan's older links are http://; many legislatures now answer only on
    // https and do not redirect (Louisiana, Utah, New Hampshire, Michigan…).
    // A network failure or a 404 on an http link gets one try over https.
    if (!got.ok && !got.skipped && /^http:\/\//i.test(link) && (got.status === 0 || got.status === 404)) {
      const retry = await fetcher.get(link.replace(/^http:\/\//i, "https://"));
      if (retry.ok) { counts.httpsRescued = (counts.httpsRescued ?? 0) + 1; got = retry; }
    }
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
      // PDF deferral (PDF_DEFER_BUCKET): park the bytes in S3 and move on. A
      // fetch is bound by what the host gives one IP; a conversion is bound by
      // CPU; tying them together made Tennessee run at pdftotext's pace, not the
      // host's. The original is kept (redlines, OCR, re-conversion later), the
      // row says where it is, and `?source=pdf-batch` converts the lot in one
      // pass on a big box. Brendan, 2026-08-29: "get the pdf into s3 and we
      // run it all at once."
      const body = got.body as Uint8Array;
      const isPdf = (body.length > 4 && body[0] === 0x25 && body[1] === 0x50 && body[2] === 0x44 && body[3] === 0x46) || /pdf/i.test(got.mime || d.document_mime || "");
      if (isPdf && PDF_DEFER_BUCKET) {
        const key = `pdf/${d.state}/${d.document_id}.pdf`;
        await s3().send(new PutObjectCommand({ Bucket: PDF_DEFER_BUCKET, Key: key, Body: body, ContentType: "application/pdf", Metadata: { source: d.state_link.slice(0, 1000), bill_id: String(d.bill_id) } }));
        counts.pdfDeferred = (counts.pdfDeferred ?? 0) + 1;
        counts.pdfDeferredBytes = (counts.pdfDeferredBytes ?? 0) + body.byteLength;
        // The driver reads `chars` as "did this round produce anything" and closes
        // a state after two empty rounds; a parked PDF is progress, so it counts
        // its bytes here. (Text chars and parked bytes are reported separately too.)
        counts.chars = (counts.chars ?? 0) + body.byteLength;
        await buf.add({
          document_id: d.document_id, bill_id: d.bill_id, state: d.state, session_id: d.session_id,
          version: d.document_desc || null, source: "state_link", mime: "application/pdf",
          text: null, error: `pdf-deferred: s3://${PDF_DEFER_BUCKET}/${key}`,
        });
        return;
      }
      const { text, how } = await bodyToText(got.mime || d.document_mime, body);
      counts[`via_${how.split(":")[0]}`] = (counts[`via_${how.split(":")[0]}`] ?? 0) + 1;
      // A single-page app's shell is not a bill. Virginia's new LIS and Indiana's
      // IGA both answer a crawler with "You need to enable JavaScript to run this
      // app." — 25,000 rows of it were stored as text before this existed. Those
      // sites' text comes through their APIs; here it is a verdict, not a document.
      if (text && text.length < 400 && /enable JavaScript to run this app/i.test(text)) {
        counts.jsShell = (counts.jsShell ?? 0) + 1;
        await buf.add({
          document_id: d.document_id, bill_id: d.bill_id, state: d.state, session_id: d.session_id,
          version: d.document_desc || null, source: "state_link", mime: got.mime || d.document_mime || null,
          text: null, error: "js-shell: the page is a JavaScript app; this site's text comes through its API",
        });
        return;
      }
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

  await byHostPool(rows, concurrency, counts, one, fetcher);
  await buf.flush();
  counts.bills = best.size;
}

const PDF_DEFER_BUCKET = process.env.PDF_DEFER_BUCKET || "";
let s3Client: S3Client | null = null;
const s3 = () => (s3Client ??= new S3Client({ region: process.env.AWS_REGION || "us-east-1" }));

/**
 * The second half of PDF deferral: rows whose error says `pdf-deferred: s3://…`
 * are read back from S3, converted, and rewritten as text. Runs anywhere with
 * pdftotext and the bucket; meant for one big pass on a many-core box.
 */
async function runPdfBatch(sql: Sql, state: string, limit: number, concurrency: number, counts: Counts) {
  const rows = (await sql.query(
    `SELECT document_id, bill_id, state, session_id, version, error
       FROM "BillTexts" WHERE text IS NULL AND error LIKE 'pdf-deferred: s3://%' AND ($1 = '' OR state = $1)
      ORDER BY state, document_id LIMIT $2`,
    [state, limit],
  )) as { document_id: number; bill_id: number; state: string; session_id: number; version: string | null; error: string }[];
  counts.considered = rows.length;
  if (!rows.length) return;
  const buf = new TextBuffer(sql, counts);
  const best = new Map<number, number>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const r = rows[next++];
      if (!r) return;
      const m = /^pdf-deferred: s3:\/\/([^/]+)\/(.+)$/.exec(r.error);
      if (!m) { counts.badMarker = (counts.badMarker ?? 0) + 1; continue; }
      const base = { document_id: r.document_id, bill_id: r.bill_id, state: r.state, session_id: r.session_id, version: r.version, source: "state_link", mime: "application/pdf" };
      try {
        const obj = await s3().send(new GetObjectCommand({ Bucket: m[1], Key: m[2] }));
        const bytes = await obj.Body!.transformToByteArray();
        const { text } = await bodyToText("application/pdf", bytes);
        if (!text) { counts.emptyText = (counts.emptyText ?? 0) + 1; await buf.add({ ...base, text: null, error: `no text extracted (pdftotext) [s3://${m[1]}/${m[2]}]` }); continue; }
        await buf.add({ ...base, text, error: null }, text.length);
        best.set(r.bill_id, Math.max(best.get(r.bill_id) ?? 0, text.length));
      } catch (e) {
        counts.convertErrors = (counts.convertErrors ?? 0) + 1;
        await buf.add({ ...base, text: null, error: `pdf-batch: ${String((e as Error).message).slice(0, 200)} [s3://${m[1]}/${m[2]}]` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, rows.length)) }, worker));
  for (const [billId, chars] of best) buf.stamp(billId, chars);
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
      else await runNySenate(sql, key, Number(req.query?.session ?? 0) || 0, limit, Boolean(req.query?.retryErrors), counts, billIds);
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
    } else if (source === "ca-pubinfo") {
      const session = Number(req.query?.session ?? 0) || 0;
      if (!session) return res.status(400).json({ error: "source=ca-pubinfo needs ?session= (the session's first year, e.g. 2025)" });
      await runCaPubinfo(sql, {
        session,
        cacheDir: String(req.query?.cache ?? "") || path.join(os.homedir(), "cache", "pubinfo"),
        zipName: String(req.query?.zip ?? "") || undefined,
        keep: Boolean(req.query?.keep),
        sample: Number(req.query?.sample ?? 0) || 0,
      }, counts);
      counts.session = session;
    } else if (source === "tx-ftp") {
      const session = String(req.query?.session ?? "").toUpperCase();
      if (!/^\d{2}[R0-9]$/.test(session)) return res.status(400).json({ error: "source=tx-ftp needs ?session= a TLO code (88R, 883, …)" });
      await runTxFtp(sql, { session, limit, parallel: Math.min(16, Math.max(1, Number(req.query?.parallel ?? 2) || 2)), cacheDir: String(req.query?.cache ?? "") || txCacheDir() }, counts);
      counts.txSession = session as unknown as number;
    } else if (source === "va-lis") {
      const key = process.env.VA_LIS_API_KEY;
      if (!key) return res.status(503).json({ error: "VA_LIS_API_KEY is required for source=va-lis (https://lis.virginia.gov/apiregistration)" });
      await runVaLis(sql, { key, limit, parallel: Math.min(16, Math.max(1, Number(req.query?.parallel ?? 8) || 8)), ua: fetcher.ua }, counts);
    } else if (source === "ma-api") {
      await runMaApi(sql, { limit, parallel: Math.min(24, Math.max(1, Number(req.query?.parallel ?? 12) || 12)), ua: fetcher.ua }, counts);
    } else if (source === "pdf-batch") {
      // Conversion is bound by S3 and Neon round-trips, not CPU: a 16-core box at 24 in flight idled at load 0.4.
      await runPdfBatch(sql, state, limit, Math.min(128, Math.max(1, Number(req.query?.concurrency ?? 32) || 32)), counts);
    } else if (source === "state_link") {
      await runStateLink(sql, state, since, limit, Boolean(req.query?.amendments), concurrency, Boolean(req.query?.requeueErrors), billIds, counts, fetcher, parseShard(String(req.query?.shard ?? "")));
    } else {
      return res.status(400).json({ error: "pass ?source=nysenate|govinfo|govinfo-billsum|state_link|ca-pubinfo|tx-ftp|va-lis|ma-api|pdf-batch, or ?mode=delta, or ?census=1" });
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
