// /api/chat-sessions — the chat sidebar's history, on Neon (sql/03).
//   GET            → [{id,title,updated_at}] (50 newest)
//   GET ?id=       → {id,title,messages}
//   POST {title,messages} → {id}
//   PATCH ?id= {title?, messages?}
//   DELETE ?id=
// No auth by ruling (display names only) — same posture the Supabase table had.
import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 15 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const sql = neon(process.env.DATABASE_URL!);
  const id = req.query?.id ? String(req.query.id) : null;
  try {
    if (req.method === "GET") {
      if (id) {
        const rows = await sql.query(`SELECT id, title, messages FROM chat_sessions WHERE id = $1`, [id]);
        if (!rows[0]) return res.status(404).json({ error: "not found" });
        return res.status(200).json(rows[0]);
      }
      const rows = await sql.query(`SELECT id, title, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 50`);
      return res.status(200).json(rows);
    }
    if (req.method === "POST") {
      const { title, messages } = req.body ?? {};
      if (!title) return res.status(400).json({ error: "title required" });
      const rows = await sql.query(`INSERT INTO chat_sessions (title, messages) VALUES ($1, $2::jsonb) RETURNING id`, [String(title), JSON.stringify(messages ?? [])]);
      return res.status(200).json(rows[0]);
    }
    if (req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id required" });
      const { title, messages } = req.body ?? {};
      await sql.query(
        `UPDATE chat_sessions SET title = coalesce($2, title), messages = coalesce($3::jsonb, messages), updated_at = now() WHERE id = $1`,
        [id, title ?? null, messages !== undefined ? JSON.stringify(messages) : null],
      );
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id required" });
      await sql.query(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
