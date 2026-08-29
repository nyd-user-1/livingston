// api/_lib/text-sources/va-lis.ts — Virginia's 2026 session, from the new LIS API.
//
// Virginia rebuilt LIS for 2026 as a React app. LegiScan's links for that
// session — https://lis.virginia.gov/bill-details/20261/HB872/text/HB872 —
// return the app's shell ("You need to enable JavaScript to run this app."),
// and 19,000 of those shells were stored as bill text before the walker learned
// to call them a verdict. The text itself comes from the API the app calls:
//
//   GET /LegislationText/api/getlegislationtextlistasync/?sessionCode=20261&legislationNumber=HB872
//       → LegislationTextList[]: { LegislationTextID, DocumentCode ("HB872", "HB872HC1"), Version, … }
//   GET /LegislationText/api/GetLegislationTextByIDAsync?legislationTextID=258955
//       → TextsList[0].DraftText: the version as HTML
//
// both under a `WebAPIKey` header. VA_LIS_API_KEY is Brendan's registered key
// (https://lis.virginia.gov/apiregistration). Sessions before 2026 are served
// by the legacy CGI (legacylis.virginia.gov) and come through the walker.
//
// Identity: the link's DocumentCode is the API's DocumentCode, so every row is
// written under LegiScan's real document_id. Politeness: one PoliteFetcher-
// style lane per `parallel`, Retry-After honoured, no artificial delay — it is
// an API with a key, and the key is the courtesy.

import { TextBuffer, htmlToText, type Counts, type Sql } from "../text-shared.js";

const API = "https://lis.virginia.gov/LegislationText/api";
export const SOURCE = "va-lis";

export type VaOpts = { key: string; limit: number; parallel: number; ua: string };

/** …/bill-details/20261/HB872/text/HB872HC1 -> { sessionCode: "20261", bill: "HB872", doc: "HB872HC1" } */
export function parseVaLink(link: string): { sessionCode: string; bill: string; doc: string } | null {
  const m = /\/bill-details\/(\d{5})\/([A-Z]{2,3}\d+)\/text\/([A-Z0-9]+)\/?$/i.exec(link);
  return m ? { sessionCode: m[1], bill: m[2].toUpperCase(), doc: m[3].toUpperCase() } : null;
}

type TextListItem = { LegislationTextID: number; DocumentCode: string; Version?: string; Description?: string; IsPublic?: boolean };

async function api<T>(path: string, opts: VaOpts, counts: Counts): Promise<{ status: number; body: T | null }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let r: Response;
    try {
      r = await fetch(`${API}${path}`, { headers: { WebAPIKey: opts.key, Accept: "application/json", "User-Agent": opts.ua }, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
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
    if (r.status === 204) return { status: 204, body: null };
    if (!r.ok) return { status: r.status, body: null };
    try { return { status: r.status, body: (await r.json()) as T }; } catch { return { status: r.status, body: null }; }
  }
  return { status: 429, body: null };
}

export async function runVaLis(sql: Sql, opts: VaOpts, counts: Counts) {
  // The 2026 documents: LegiScan links on the new site, with no text yet — a
  // js-shell verdict row counts as "no text yet" here, because this is the route
  // that verdict points at.
  const rows = (await sql.query(
    `SELECT d.document_id, d.bill_id, d.document_desc, d.state_link, b.session_id
       FROM "Documents" d JOIN "Bills" b ON b.bill_id = d.bill_id
       LEFT JOIN "BillTexts" t ON t.document_id = d.document_id
      WHERE b.state = 'VA' AND d.document_type = 'text' AND d.state_link LIKE '%/bill-details/%'
        AND (t.document_id IS NULL OR (t.text IS NULL AND (t.error LIKE 'js-shell%' OR t.error LIKE 'va-lis: list HTTP%' OR t.error LIKE 'va-lis: text HTTP%')))
      ORDER BY d.bill_id, d.document_id
      LIMIT $1`,
    [opts.limit],
  )) as { document_id: number; bill_id: number; document_desc: string; state_link: string; session_id: number }[];
  counts.considered = rows.length;
  if (!rows.length) return;

  // Group by bill so the list call is made once per bill, not once per version.
  const byBill = new Map<string, typeof rows>();
  for (const r of rows) {
    const p = parseVaLink(r.state_link);
    if (!p) { counts.unparseableLink = (counts.unparseableLink ?? 0) + 1; continue; }
    const k = `${p.sessionCode}:${p.bill}`;
    const list = byBill.get(k);
    if (list) list.push(r); else byBill.set(k, [r]);
  }
  const bills = [...byBill.entries()];
  const buf = new TextBuffer(sql, counts);
  const best = new Map<number, number>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const entry = bills[next++];
      if (!entry) return;
      const [k, docs] = entry;
      const [sessionCode, bill] = k.split(":");
      const list = await api<{ LegislationTextList?: TextListItem[] }>(`/getlegislationtextlistasync/?sessionCode=${sessionCode}&legislationNumber=${bill}`, opts, counts);
      // A special session the API does not know answers with a bare string, not an object.
      const items = (list.body && typeof list.body === "object" && Array.isArray(list.body.LegislationTextList)) ? list.body.LegislationTextList : [];
      for (const d of docs) {
        const p = parseVaLink(d.state_link)!;
        const base = { document_id: d.document_id, bill_id: d.bill_id, state: "VA", session_id: d.session_id, version: d.document_desc || null, source: SOURCE, mime: "text/html" };
        // 2025-session codes come back space-padded ('HB338AH   '); 2026's do not.
        const item = items.find((i) => String(i.DocumentCode ?? "").trim().toUpperCase() === p.doc);
        if (!item) {
          counts.noVersion = (counts.noVersion ?? 0) + 1;
          await buf.add({ ...base, text: null, error: list.status === 200 || list.status === 204 ? `va-lis: ${p.doc} not in the API's text list for ${bill} (${items.length} versions)` : `va-lis: list HTTP ${list.status}` });
          continue;
        }
        const t = await api<{ TextsList?: { DraftText?: string }[] }>(`/GetLegislationTextByIDAsync?legislationTextID=${item.LegislationTextID}`, opts, counts);
        const html = t.body?.TextsList?.[0]?.DraftText ?? "";
        const text = html ? htmlToText(html) : "";
        if (!text) { counts.emptyText = (counts.emptyText ?? 0) + 1; await buf.add({ ...base, text: null, error: t.status === 200 ? "va-lis: empty DraftText" : `va-lis: text HTTP ${t.status}` }); continue; }
        await buf.add({ ...base, version: item.Version || item.Description || d.document_desc || null, text, error: null }, text.length);
        best.set(d.bill_id, Math.max(best.get(d.bill_id) ?? 0, text.length));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel, bills.length)) }, worker));
  for (const [billId, chars] of best) buf.stamp(billId, chars);
  await buf.flush();
  counts.bills = best.size;
}
