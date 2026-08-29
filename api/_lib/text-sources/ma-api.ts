// api/_lib/text-sources/ma-api.ts — Massachusetts, from the General Court's own API.
//
//   GET https://malegislature.gov/api/GeneralCourts/{court}/Documents/{billNumber}
//     → { BillNumber, Title, DocumentText, … }   no key, JSON, the text inline
//
// LegiScan links one document per Massachusetts bill — the PDF at
// https://malegislature.gov/Bills/194/S1247.pdf (older courts:
// /Bills/186/House/H1648) — and the walker fetched those one a second through
// pdftotext. The same text is one JSON call away with no conversion, so this
// source takes the court and number off the link and asks the API; the PDF is
// the fallback when DocumentText is empty (the budget bills are). Rows carry
// LegiScan's real document_id. Brendan, 2026-08-29: "the bill text should be
// so simple here."

import { TextBuffer, bodyToText, tidy, type Counts, type Sql } from "../text-shared.js";

const API = "https://malegislature.gov/api/GeneralCourts";
export const SOURCE = "ma-api";

export type MaOpts = { limit: number; parallel: number; ua: string };

/**
 * …/Bills/194/S1247.pdf | …/Bills/186/House/H1648 | …/Document/Bill/188/Senate/S1957.pdf
 *   -> { court, bill } from the link itself.
 * Older links carry no usable number — Bills/PDF?billId=…&generalCourtId=…,
 * mass.gov/legis/bills/house/186/ht00/ht00001.htm — so the caller falls back to
 * the bill number LegiScan already gave us and the court the session implies:
 * the 186th General Court sat 2009-10, one court per two-year session since.
 */
export function parseMaLink(link: string): { court: number; bill: string } | null {
  const m = /malegislature\.gov\/(?:Bills|Document\/Bill)\/(\d+)\/(?:House\/|Senate\/)?([HS]D?\d+)(?:\.pdf)?\/?$/i.exec(link);
  return m ? { court: Number(m[1]), bill: m[2].toUpperCase() } : null;
}
export const courtOfSession = (sessionYear: number) => 186 + Math.floor((sessionYear - 2009) / 2);

async function getJson(url: string, ua: string, counts: Counts): Promise<{ status: number; body: Record<string, unknown> | null }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let r: Response;
    try {
      r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": ua }, signal: AbortSignal.timeout(60_000) });
    } catch {
      counts.fetchErrors = (counts.fetchErrors ?? 0) + 1;
      if (attempt === 2) return { status: 0, body: null };
      await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
      continue;
    }
    counts.queries = (counts.queries ?? 0) + 1;
    if (r.status === 429 || r.status === 503) {
      const ra = Number(r.headers.get("retry-after") ?? 0);
      counts.backoffs = (counts.backoffs ?? 0) + 1;
      await new Promise((ok) => setTimeout(ok, Math.min(120_000, (Number.isFinite(ra) && ra > 0 ? ra : 10) * 1000)));
      continue;
    }
    if (!r.ok) return { status: r.status, body: null };
    try { return { status: r.status, body: (await r.json()) as Record<string, unknown> }; } catch { return { status: r.status, body: null }; }
  }
  return { status: 429, body: null };
}

export async function runMaApi(sql: Sql, opts: MaOpts, counts: Counts) {
  const rows = (await sql.query(
    `SELECT d.document_id, d.bill_id, d.document_desc, d.state_link, d.document_mime, b.session_id, b.bill_number
       FROM "Documents" d JOIN "Bills" b ON b.bill_id = d.bill_id
       LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
      WHERE b.state = 'MA' AND d.document_type = 'text' AND coalesce(d.state_link, '') <> ''
        AND (t.document_id IS NULL OR (t.text IS NULL AND (t.error LIKE 'ma-api: HTTP%' OR t.error LIKE 'ma-api: link is not%')))
      ORDER BY b.session_id DESC, d.bill_id, d.document_id
      LIMIT $1`,
    [opts.limit],
  )) as { document_id: number; bill_id: number; document_desc: string; state_link: string; document_mime: string; session_id: number; bill_number: string }[];
  counts.considered = rows.length;
  if (!rows.length) return;

  const buf = new TextBuffer(sql, counts);
  const best = new Map<number, number>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const d = rows[next++];
      if (!d) return;
      const base = { document_id: d.document_id, bill_id: d.bill_id, state: "MA", session_id: d.session_id, version: d.document_desc || null, source: SOURCE, mime: "text/plain" };
      let p = parseMaLink(d.state_link);
      if (!p && /^[HS]D?\d+$/i.test(d.bill_number ?? "") && d.session_id >= 2009) { p = { court: courtOfSession(d.session_id), bill: d.bill_number.toUpperCase() }; counts.courtFromSession = (counts.courtFromSession ?? 0) + 1; }
      if (!p) { counts.unparseableLink = (counts.unparseableLink ?? 0) + 1; await buf.add({ ...base, mime: null, text: null, error: `ma-api: link is not a malegislature bill: ${d.state_link.slice(0, 120)}` }); continue; }
      const r = await getJson(`${API}/${p.court}/Documents/${p.bill}`, opts.ua, counts);
      let text = r.body && typeof r.body.DocumentText === "string" ? tidy(r.body.DocumentText) : "";
      let mime = "text/plain";
      if (!text && r.status === 200) {
        // Empty DocumentText (the budget bills, some resolves): the PDF still exists.
        counts.pdfFallbacks = (counts.pdfFallbacks ?? 0) + 1;
        try {
          const pr = await fetch(`https://malegislature.gov/Bills/${p.court}/${p.bill}.pdf`, { headers: { "User-Agent": opts.ua }, signal: AbortSignal.timeout(60_000) });
          counts.queries = (counts.queries ?? 0) + 1;
          if (pr.ok) { const got = await bodyToText(pr.headers.get("content-type") ?? "application/pdf", new Uint8Array(await pr.arrayBuffer())); text = got.text; mime = "application/pdf"; }
        } catch { counts.pdfErrors = (counts.pdfErrors ?? 0) + 1; }
      }
      if (!text) {
        counts.noText = (counts.noText ?? 0) + 1;
        await buf.add({ ...base, mime: null, text: null, error: r.status === 200 ? "ma-api: empty DocumentText and no PDF text" : `ma-api: HTTP ${r.status}` });
        continue;
      }
      await buf.add({ ...base, mime, text, error: null }, text.length);
      best.set(d.bill_id, Math.max(best.get(d.bill_id) ?? 0, text.length));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel, rows.length)) }, worker));
  for (const [billId, chars] of best) buf.stamp(billId, chars);
  await buf.flush();
  counts.bills = best.size;
}
