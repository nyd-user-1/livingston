// /api/similar — "related preprints", powered by the CITE encoder.
//
//   ?key=<key_number>&limit=<1..25>
//
// WHY THIS IS FREE. The query here IS a document that is already in the corpus, so
// there is nothing to encode: we read that paper's stored vector and run a kNN
// against the same table. No encoder round trip, no serve box, no inference — one
// indexed vector lookup and one HNSW probe.
//
// WHY IT USES A DIFFERENT TABLE FROM /api/search. Search runs on
// preprint_embeddings_cshl_qp2, trained on query→paper pairs, because a search box
// takes queries. This endpoint runs on preprint_embeddings_cshl — the CITE encoder,
// trained on citation pairs — because "what else is like this paper?" is a
// document→document question and that is the model measured best at it:
// R@10 0.212 against MedCPT's 0.179 (p = 0.0001) on 2,000 held-out citation pairs,
// where the query-trained encoder scores 0.196, statistically indistinguishable from
// stock bge-m3. Using the search encoder here would silently cost that advantage.
//
// The probe vector is BOUND ($1::vector) rather than join-sourced: a join-sourced
// probe defeats the HNSW index and turns this into a sequential scan over 433,449
// rows. `SET LOCAL hnsw.ef_search` must ride in the same transaction as the probe.
import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 15 };

const CITE_TABLE = "preprint_embeddings_cshl";

const COLS = `p.id, p.key_number, p.pub_year, p.reference, p.authors, p.title, p.doi,
  p.categories, p.server, p.posted_date, p.published_journal, p.pdf_url`;

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const key = String(req.query?.key ?? "").trim();
  const limit = Math.min(25, Math.max(1, Number(req.query?.limit ?? 8) || 8));
  if (!key) return res.status(400).json({ error: "key required" });

  const sql = neon(process.env.DATABASE_URL!);
  const t0 = Date.now();
  try {
    const probe = (await (sql as unknown as {
      query: (t: string, p?: unknown[]) => Promise<Row[]>;
    }).query(
      `SELECT embedding::text AS v FROM ${CITE_TABLE} WHERE key_number = $1`,
      [key],
    )) as Row[];

    if (!probe[0]?.v) {
      // No vector for this paper — say so rather than returning an empty list that
      // reads as "nothing is related".
      return res.status(200).json({
        records: [], count: 0, model: "cite",
        note: "no vector for this paper",
        timings: { total_ms: Date.now() - t0 },
      });
    }

    const [, rows] = (await (sql as unknown as {
      transaction: (qs: unknown[]) => Promise<unknown[]>;
    }).transaction([
      (sql as unknown as { query: (t: string, p?: unknown[]) => unknown }).query(
        `SET LOCAL hnsw.ef_search = 100`,
      ),
      (sql as unknown as { query: (t: string, p?: unknown[]) => unknown }).query(
        `SELECT ${COLS}, (1 - (e.embedding <=> $1::vector))::float AS similarity
         FROM ${CITE_TABLE} e
         JOIN preprints p USING (key_number)
         WHERE e.key_number <> $2
         ORDER BY e.embedding <=> $1::vector
         LIMIT $3`,
        [String(probe[0].v), key, limit],
      ),
    ])) as [unknown, Row[]];

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      records: rows ?? [],
      count: rows?.length ?? 0,
      model: "cite",
      timings: { total_ms: Date.now() - t0 },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
