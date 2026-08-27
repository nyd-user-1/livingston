// /api/records — paginated browse of the corpus (the /references page), on Neon.
//   ?page=1&pageSize=99&year=2024&published=1&category=neuroscience&server=biorxiv
//
// The corpus is bioRxiv + medRxiv preprints. The row
// shape is unchanged from the NSR era on purpose — the card renders `categories`
// where it used to render `nuclides` and `status_tags` where it rendered
// `reactions`, so the grid needs no layout change.
//
// Sort is pub_year DESC, posted_date DESC, key_number DESC (idx_pp_year). Total
// counts: unfiltered from pg_class.reltuples (exact enough for a pager, free),
// filtered via the btree. Cached at the edge for an hour.
import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 15 };

const COLS = `id, key_number, pub_year, reference, authors, title, doi, abstract,
  categories, status_tags, server, version, type, license, posted_date,
  published_doi, published_journal, published_date, institution, author_corresponding,
  jatsxml_url, pdf_url`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const sql = neon(process.env.DATABASE_URL!);
  const page = Math.max(1, Number(req.query?.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query?.pageSize ?? 99) || 99));
  const year = req.query?.year ? Number(req.query.year) : null;
  // the EXFOR toggle's replacement: "has a link into another database"
  const published = req.query?.published === "1" || req.query?.published === "true";
  const category = req.query?.category ? String(req.query.category).trim().toLowerCase() : null;
  const server = req.query?.server === "biorxiv" || req.query?.server === "medrxiv" ? String(req.query.server) : null;

  const where: string[] = []; const params: unknown[] = [];
  if (year) { params.push(year); where.push(`pub_year = $${params.length}`); }
  if (published) where.push(`published_doi IS NOT NULL`);
  if (category) { params.push([category]); where.push(`categories && $${params.length}::text[]`); }
  if (server) { params.push(server); where.push(`server = $${params.length}`); }
  const W = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const off = (page - 1) * pageSize;
    const [rows, cnt] = await Promise.all([
      sql.query(`SELECT ${COLS} FROM preprints ${W} ORDER BY pub_year DESC NULLS LAST, posted_date DESC, key_number DESC LIMIT ${pageSize} OFFSET ${off}`, params),
      where.length
        ? sql.query(`SELECT count(*)::int AS n FROM preprints ${W}`, params)
        // Unfiltered: the exact total, materialized at load time (sql/10). reltuples is
        // free but overstated it by 1.17% after this load — fine for the planner, wrong
        // for a number a human reads. Falls back to reltuples if the row is absent.
        : sql.query(`SELECT coalesce((SELECT papers FROM corpus_stats WHERE id = 1),
                                     (SELECT reltuples::bigint::int FROM pg_class WHERE relname = 'preprints')) AS n`),
    ]);
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ records: rows, totalCount: Number(cnt[0]?.n ?? 0), page, pageSize });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
