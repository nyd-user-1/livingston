// /api/paper?doi=… — Semantic Scholar lookup for the chat footer (replaces the
// retired Supabase edge function `paper-lookup`). Same PaperData shape.
export const config = { maxDuration: 15 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const doi = String(req.query?.doi ?? "").trim();
  if (!doi) return res.status(400).json({ error: "doi required" });
  try {
    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,abstract,authors,year,citationCount,venue,openAccessPdf`;
    let r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    // a rejected key (403) must not take the feature down — S2 serves DOI lookups keyless
    if (r.status === 403 && headers["x-api-key"]) r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ error: `s2 ${r.status}` });
    const p = await r.json();
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      title: p.title ?? null, abstract: p.abstract ?? null,
      authors: (p.authors ?? []).map((a: { name: string }) => a.name),
      year: p.year ?? null, citationCount: p.citationCount ?? null, venue: p.venue ?? null,
      openAccessPdfUrl: p.openAccessPdf?.url ?? null, doi,
    });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}
