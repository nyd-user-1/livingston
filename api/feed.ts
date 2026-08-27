// /api/feed — the research feed (sql/09), on Neon.
//   GET  → newest 50 events
//   POST {event_type, category?, entity_type?, entity_value?, display_text, metadata?} → INSERT
//
// The POST used to call an insert_feed_event() stored function. That function was
// never created in this database, so every write 500'd and research_feed stayed
// empty — the live feed had nothing to show. This inserts into the table directly
// instead: same columns, no schema change required (id and created_at have
// defaults). Do not reintroduce the function call without shipping the DDL.
// The Supabase realtime channel is replaced by the client polling this GET.
import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 15 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    if (req.method === "GET") {
      const rows = await sql.query(`SELECT * FROM research_feed ORDER BY created_at DESC LIMIT 50`);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(rows);
    }
    if (req.method === "POST") {
      const b = req.body ?? {};
      if (!b.event_type) return res.status(400).json({ error: "event_type required" });
      await sql.query(
        `INSERT INTO research_feed (event_type, category, entity_type, entity_value, display_text, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          String(b.event_type), String(b.category ?? "activity"), b.entity_type ?? null, b.entity_value ?? null,
          String(b.display_text ?? ""), JSON.stringify(b.metadata ?? {}),
        ],
      );
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
