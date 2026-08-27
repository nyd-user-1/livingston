// /api/dict — dictionaries for the filter comboboxes and the "+" menu, from Neon.
//   ?type=categories|journals|institutions|authors [&q=prefix] [&limit=N]
//   ?type=categories&server=medrxiv — per-server category counts, the subject
//   cards' real numbers. Read from category_server_counts (sql/22), which is
//   materialized because the live unnest+GROUP BY measured 3.1 s cold. The
//   `categories` table's paper_count is cross-server and lies for any category
//   both servers use, so it is not a substitute. Falls back to the live
//   aggregate if the table has not been created yet.
//
// Returns [{ value, record_count }], the same shape the pickers already consume.
// The NSR-era types (nuclides, reactions) map onto this corpus as categories and
// journals per LANE-RXIV-MAP.md §4; the old names are accepted as aliases so a
// stale client or a bookmarked URL keeps working.
import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 30 };

const ALIAS: Record<string, string> = { nuclides: "categories", reactions: "journals" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const sql = neon(process.env.DATABASE_URL!);
  const raw = String(req.query?.type ?? "");
  const type = ALIAS[raw] ?? raw;
  const q = String(req.query?.q ?? "").trim();
  const limit = Math.min(20000, Math.max(1, Number(req.query?.limit ?? 5000) || 5000));
  const like = q.replace(/[%_]/g, "") + "%";

  try {
    let rows: Record<string, unknown>[];
    const server = req.query?.server === "biorxiv" || req.query?.server === "medrxiv" ? String(req.query.server) : null;
    if (type === "categories" && server) {
      const live = () =>
        sql.query(
          `SELECT c.category AS value, count(*)::int AS record_count
           FROM preprints p, unnest(p.categories) c(category)
           WHERE p.server = $1 ${q ? "AND c.category ILIKE $2" : ""}
           GROUP BY 1 ORDER BY record_count DESC, value`,
          q ? [server, like] : [server],
        );
      rows = await sql
        .query(
          `SELECT category AS value, paper_count AS record_count
           FROM category_server_counts
           WHERE server = $1 ${q ? "AND category ILIKE $2" : ""}
           ORDER BY record_count DESC, value`,
          q ? [server, like] : [server],
        )
        .then((r) => (r.length ? r : live()))
        .catch(live);
    } else if (type === "categories") {
      rows = await sql.query(
        `SELECT category AS value, paper_count AS record_count FROM categories
         ${q ? "WHERE category ILIKE $2" : ""}
         ORDER BY record_count DESC, value LIMIT $1`,
        q ? [limit, like] : [limit],
      );
    } else if (type === "journals") {
      rows = await sql.query(
        `SELECT journal_name AS value, paper_count AS record_count FROM journals
         ${q ? "WHERE journal_name ILIKE $2" : ""}
         ORDER BY record_count DESC, value LIMIT $1`,
        q ? [limit, like] : [limit],
      );
    } else if (type === "institutions") {
      rows = await sql.query(
        `SELECT institution AS value, paper_count AS record_count FROM institutions
         ${q ? "WHERE institution ILIKE $2" : ""}
         ORDER BY record_count DESC, value LIMIT $1`,
        q ? [limit, like] : [limit],
      );
    } else if (type === "authors") {
      // same output shape as the NSR dict: "I.Last" style display value
      rows = await sql.query(
        `SELECT (coalesce(a.initial1,'') || CASE WHEN a.initial2 IS NOT NULL AND a.initial2 <> '' THEN '.' || a.initial2 ELSE '' END || '.' || initcap(lower(a.last_name))) AS value,
                count(pa.key_number)::int AS record_count
         FROM authors a JOIN preprint_authors pa ON pa.author_key = a.author_key
         ${q ? "WHERE a.last_name ILIKE $2" : ""}
         GROUP BY a.author_key, a.initial1, a.initial2, a.last_name
         ORDER BY record_count DESC, value LIMIT $1`,
        q ? [limit, like] : [limit],
      );
    } else {
      return res.status(400).json({ error: "type must be categories | journals | institutions | authors" });
    }
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
