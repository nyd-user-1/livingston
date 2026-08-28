// /api/bills — New York State bills, live from the NY Senate Open Legislation
// API (v3), the same source the policy app syncs from.
//
//   GET /api/bills?limit=12&offset=1[&session=2025]        newest action first
//   GET /api/bills?q=housing&limit=12&offset=1[&session=]  full-text search
//
// The key never reaches the browser: it rides only this function. Offsets are
// 1-based, as the upstream API counts them. Cached at the edge for ten minutes
// — the Senate publishes in batches, not per second.
//
// Env: NYS_LEGISLATION_API_KEY (legislation.nysenate.gov — free, per account).

export const config = { maxDuration: 15 };

const API = "https://legislation.nysenate.gov/api/3";

/** The shape the rail renders. Flat on purpose: the card needs six things. */
export interface Bill {
  printNo: string;
  session: number;
  title: string;
  summary: string;
  chamber: "senate" | "assembly" | "";
  sponsor: string;
  status: string;
  committee: string;
  actionDate: string;
  published: string;
  signed: boolean;
  url: string;
}

/** Odd years open a two-year session. */
const currentSession = () => {
  const y = new Date().getFullYear();
  return y % 2 === 1 ? y : y - 1;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(raw: any): Bill | null {
  const b = raw?.result ?? raw; // search wraps each hit in { result, rank, highlights }
  if (!b?.basePrintNo) return null;
  const chamber = String(b.billType?.chamber ?? "").toLowerCase();
  return {
    printNo: String(b.basePrintNo),
    session: Number(b.session ?? 0),
    title: String(b.title ?? "").trim(),
    summary: String(b.summary ?? "").trim(),
    chamber: chamber === "senate" || chamber === "assembly" ? chamber : "",
    sponsor: String(b.sponsor?.member?.fullName ?? b.sponsor?.member?.shortName ?? "").trim(),
    status: String(b.status?.statusDesc ?? "").trim(),
    committee: String(b.status?.committeeName ?? "").trim(),
    actionDate: String(b.status?.actionDate ?? ""),
    published: String(b.publishedDateTime ?? ""),
    signed: Boolean(b.signed),
    url: `https://www.nysenate.gov/legislation/bills/${b.session}/${b.basePrintNo}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const key = process.env.NYS_LEGISLATION_API_KEY;
  if (!key) return res.status(503).json({ error: "NYS_LEGISLATION_API_KEY is not set", configured: false });

  const q = String(req.query?.q ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(req.query?.limit ?? 12) || 12));
  const offset = Math.max(1, Number(req.query?.offset ?? 1) || 1);
  const session = Number(req.query?.session) || currentSession();

  const url = q
    ? `${API}/bills/${session}/search?term=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&key=${key}`
    : `${API}/bills/${session}?limit=${limit}&offset=${offset}&sort=status.actionDate:DESC&key=${key}`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return res.status(502).json({ error: `NY Senate API answered ${r.status}`, detail });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await r.json();
    if (data?.success === false) return res.status(502).json({ error: data?.message ?? "NY Senate API error" });
    const items = (data?.result?.items ?? []).map(normalise).filter(Boolean) as Bill[];
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    return res.status(200).json({
      bills: items,
      total: Number(data?.total ?? items.length),
      offset,
      limit,
      session,
      query: q || undefined,
    });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}
