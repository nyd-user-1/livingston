// /api/search — the search backend for the preprint corpus, on Neon.
//
//   ?q=…&mode=keyword     weighted FTS (sql/02: title A, category+journal+institution B,
//                         abstract C), newest first on ties.
//   ?q=…&mode=semantic    dense kNN over the active encoder's vector table (HNSW, cosine).
//   ?q=…&mode=hybrid      RRF(dense, FTS) — the configuration the benchmark scores best.
//   ?q=#2026.07.31        key_number prefix, any mode.
//   ?mode=structured      typed chip search: &categories=…&journals=…
//   &limit=               1..200 (default 100)
//   &server=…&category=…  the ROOM (LANE-MEDRXIV-SUBJECTS): both arms are confined
//                         to that server+category slice. Inside a subject the dense
//                         arm switches from HNSW to an EXACT filter-first scan —
//                         subjects are ≤12.7k vectors, where exact is affordable and
//                         an ANN over-fetch would miss most of a small room.
//
// DENSE RETRIEVAL RESTORED 2026-08-20. The header this replaces said "this corpus has no
// embeddings yet" and degraded semantic/hybrid into the FTS path. That was true when it
// was written and became false at 2026-08-19 14:29Z, when the vector tables were gated at
// 433,449 rows — but nobody re-wired this file, so the UI's Hybrid/Semantic toggle went on
// silently serving keyword results for a day. A degradation notice that outlives its
// cause is indistinguishable from a bug; the payload said `degraded: true` and the UI
// never surfaced it. Measured cost of the gap, on the frozen benchmark: MeSH R@10 0.081
// (FTS alone) against 0.53 for the fused arm this file now serves.
//
// Degradation is KEPT, but it is now conditional and honest: if the vector sidecar is
// empty or the encoder round trip fails, we fall back to FTS and say so in the payload.
// The encoder itself has the same fallback ladder as /chat — if the fine-tuned serve box
// is unreachable we retry on stock bge-m3, and **the vector table follows whichever
// encoder actually answered**, because querying one model's space with another model's
// vector returns confident nonsense with a 200.

import { neon } from "@neondatabase/serverless";
import {
  activeEncoder, embedQueryCached, hasEmbeddings, rrf, toVectorLiteral, vectorTable,
  type EncoderName,
} from "./_lib/embed.js";

export const config = { maxDuration: 30 };

type Row = Record<string, unknown>;

const SELECT = `p.id, p.key_number, p.pub_year, p.reference, p.authors, p.title, p.doi,
  p.abstract, p.categories, p.status_tags, p.server, p.version, p.type, p.license,
  p.posted_date, p.published_doi, p.published_journal, p.institution, p.pdf_url`;

// OR semantics with high-frequency pruning, not AND.
//
// Production shipped `websearch_to_tsquery`, which ANDs space-separated terms:
// a four-concept query matched 13 documents out of 433,449, and three-concept
// queries routinely matched none. Measured on the frozen benchmark, switching to
// OR is +17% MeSH R@10 and +48% author-keyword.
//
// Naive OR is unshippable — it ranks every match, and one query measured
// **10,157 ms**. The cost is carried by high-document-frequency lexemes
// ("use", "studi", "univers"), so those are pruned via `fts_high_df`, a small
// precomputed table of terms appearing in >2% of the corpus. Same query,
// pruned: **108 ms**. If pruning empties the query (every term was common) we
// fall back to the AND path rather than return nothing.
//
// One constant, used by BOTH the scoped lexical arm and the corpus-wide widening
// below, so the two cannot drift. Until 2026-08-25 the widening query still used
// the AND form on its own: for a multi-concept query it matched 0–6 rows out of
// 433,449, so the widening silently failed to widen exactly when it was needed.
// Binds $1 = the query text; exposes `tq.q`.
const TQ_CTE = `WITH terms AS (
    SELECT unnest(string_to_array(
             replace(plainto_tsquery('english', $1)::text, '''', ''), ' & ')) AS l
  ), kept AS (
    SELECT string_agg(l, ' | ') AS expr FROM terms
     WHERE l NOT IN (SELECT lexeme FROM fts_high_df)
  ), tq AS (
    SELECT coalesce(
             nullif((SELECT expr FROM kept), '')::tsquery,
             websearch_to_tsquery('english', $1)
           ) AS q
  )`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const sql = neon(process.env.DATABASE_URL!);
  const q = (text: string, params: unknown[] = []) =>
    (sql as unknown as { query: (t: string, p: unknown[]) => Promise<Row[]> }).query(text, params);

  const list = (v: unknown) =>
    (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

  /* ── structured: typed chip search, no free text ─────────────────────────── */
  if (req.query?.mode === "structured") {
    // nuclides/reactions are the NSR-era parameter names, kept as aliases
    const categories = list(req.query?.categories ?? req.query?.nuclides);
    const journals = list(req.query?.journals ?? req.query?.reactions);
    const lim = Math.min(200, Math.max(1, Number(req.query?.limit ?? 50) || 50));
    if (!categories.length && !journals.length)
      return res.status(200).json({ records: [], count: 0, mode: "structured" });
    const conds: string[] = []; const params: unknown[] = [];
    if (categories.length) { params.push(categories); conds.push(`p.categories && $${params.length}::text[]`); }
    if (journals.length) { params.push(journals); conds.push(`lower(p.published_journal) = ANY($${params.length}::text[])`); }
    // &server= confines chip search to one archive (the Papers pages).
    if (req.query?.server === "biorxiv" || req.query?.server === "medrxiv") {
      params.push(String(req.query.server)); conds.push(`p.server = $${params.length}`);
    }
    params.push(lim);
    const rows = await q(
      `SELECT ${SELECT}, 1.0::float AS similarity FROM preprints p
       WHERE ${conds.join(" AND ")}
       ORDER BY p.pub_year DESC NULLS LAST, p.posted_date DESC LIMIT $${params.length}`, params);
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ records: rows, count: rows.length, mode: "structured" });
  }

  const raw = String(req.query?.q ?? "").trim();
  const requested = String(req.query?.mode ?? "semantic");
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit ?? 100) || 100));

  // The room, when navigation set one. Scope rides the request as parameters —
  // there is no filter widget and no guessing.
  const roomServer = req.query?.server === "biorxiv" || req.query?.server === "medrxiv" ? String(req.query.server) : null;
  const roomCategory = roomServer && req.query?.category ? String(req.query.category).trim().toLowerCase() : null;
  const room = roomServer && roomCategory ? { server: roomServer, category: roomCategory } : null;
  // Server without category: the whole-archive scope (the Papers pages). Not a
  // room — no widening — just both arms confined to one server.
  const serverOnly = roomServer && !roomCategory ? roomServer : null;

  if (raw.length < 2) return res.status(200).json({ records: [], count: 0, mode: requested });

  const t0 = Date.now();
  try {
    /* ── #KEY: key_number prefix ──────────────────────────────────────────── */
    if (raw.startsWith("#")) {
      const key = raw.slice(1).trim().replace(/[%_]/g, "");
      if (!key) return res.status(200).json({ records: [], count: 0, mode: "key" });
      const rows = await q(
        `SELECT ${SELECT} FROM preprints p WHERE p.key_number LIKE $1 ORDER BY p.key_number LIMIT $2`,
        [key + "%", limit]);
      return res.status(200).json({ records: rows, count: rows.length, mode: "key", timings: { total_ms: Date.now() - t0 } });
    }

    const wantsDense = requested === "semantic" || requested === "hybrid";
    const wantsFts = requested !== "semantic";

    /* ── dense arm ────────────────────────────────────────────────────────── */
    let denseRows: Row[] = [];
    let encoderUsed: EncoderName | null = null;
    let denseNote: string | undefined;
    const tDense0 = Date.now();
    if (wantsDense) {
      try {
        if (!(await hasEmbeddings(sql as never))) {
          denseNote = "vector sidecar empty — FTS only";
        } else {
          let enc = activeEncoder();
          let vector: number[];
          try {
            ({ vector } = await embedQueryCached(sql as never, raw, enc));
          } catch (err) {
            // Fine-tuned arm depends on one serve box. If it is cold, throttled or gone,
            // fall back to stock bge-m3 rather than dropping the dense arm entirely: a box
            // failure should cost retrieval QUALITY, not the hybrid.
            if (enc === "bge") throw err;
            enc = "bge";
            denseNote = "fine-tuned encoder unreachable — stock bge-m3 served this query";
            ({ vector } = await embedQueryCached(sql as never, raw, "bge"));
          }
          encoderUsed = enc;
          if (room) {
            // In-room: EXACT search, filter first, no index gymnastics. The
            // HNSW index cannot honor a selective filter without over-fetching
            // past the subject, so at room scale we pay the exact scan and get
            // perfect in-subject recall. Latency rides `timings.dense_ms`.
            denseRows = await q(
              `SELECT ${SELECT}, (1 - (e.embedding <=> $1::vector))::float AS similarity
               FROM preprints p JOIN ${vectorTable(enc)} e USING (key_number)
               WHERE p.server = $2 AND p.categories && $3::text[]
               ORDER BY e.embedding <=> $1::vector
               LIMIT $4`,
              [toVectorLiteral(vector), room.server, [room.category], limit],
            );
          } else {
          // ef_search must be set inside the same transaction as the probe, and the vector
          // is BOUND, never interpolated — a join-sourced or inlined probe defeats HNSW.
          //
          // Whole-archive scope (serverOnly): same HNSW probe with the server
          // filter applied post-scan; ef_search rises to 400 so that even the
          // smaller archive (medRxiv ≈ 20% of vectors) fills the limit.
          const [, rows] = (await (sql as unknown as {
            transaction: (qs: unknown[]) => Promise<unknown[]>;
          }).transaction([
            (sql as unknown as { query: (t: string, p?: unknown[]) => unknown }).query(
              `SET LOCAL hnsw.ef_search = ${serverOnly ? 400 : 100}`),
            (sql as unknown as { query: (t: string, p?: unknown[]) => unknown }).query(
              `SELECT ${SELECT}, (1 - (e.embedding <=> $1::vector))::float AS similarity
               FROM ${vectorTable(enc)} e
               JOIN preprints p USING (key_number)
               ${serverOnly ? "WHERE p.server = $3" : ""}
               ORDER BY e.embedding <=> $1::vector
               LIMIT $2`,
              serverOnly ? [toVectorLiteral(vector), limit, serverOnly] : [toVectorLiteral(vector), limit],
            ),
          ])) as [unknown, Row[]];
          denseRows = rows ?? [];
          }
        }
      } catch (err) {
        denseNote = `dense arm failed — FTS only (${(err as Error).message.slice(0, 120)})`;
      }
    }
    const denseMs = Date.now() - tDense0;

    /* ── lexical arm ──────────────────────────────────────────────────────── */
    const tFts0 = Date.now();
    let ftsRows: Row[] = [];
    if (wantsFts || !denseRows.length) {
      // TQ_CTE: OR with high-DF pruning, AND only as the empty-query fallback —
      // the measurements are on the constant.
      ftsRows = await q(
        `${TQ_CTE}
         SELECT ${SELECT},
                least(ts_rank_cd(p.fts, tq.q) / 4.0, 0.99)::float AS similarity
         FROM preprints p, tq
         WHERE p.fts @@ tq.q${room ? ` AND p.server = $3 AND p.categories && $4::text[]` : serverOnly ? ` AND p.server = $3` : ""}
         ORDER BY ts_rank_cd(p.fts, tq.q) DESC, p.pub_year DESC NULLS LAST
         LIMIT $2`,
        room ? [raw, limit, room.server, [room.category]] : serverOnly ? [raw, limit, serverOnly] : [raw, limit]);
    }
    const ftsMs = Date.now() - tFts0;

    /* ── fuse ─────────────────────────────────────────────────────────────── */
    // Reciprocal rank fusion, the configuration the frozen benchmark scores best.
    // `similarity` stays the dense cosine wherever the dense arm found the row, because
    // that is the only number on this payload that means anything to a reader; rows that
    // only FTS found keep their (much smaller) lexical score and are labelled `arm`.
    const key = (r: Row) => String(r.key_number);
    const byKey = new Map<string, Row>();
    for (const r of ftsRows) byKey.set(key(r), { ...r, arm: "fts" });
    for (const r of denseRows) {
      const k = key(r);
      byKey.set(k, { ...r, arm: byKey.has(k) ? "both" : "dense" });
    }

    let records: Row[];
    let mode: string;
    if (denseRows.length && wantsFts) {
      const scores = rrf([denseRows.map(key), ftsRows.map(key)]);
      // Ties are the common case at the head of the list: rank 1 of each arm scores
      // identically under RRF, so without a tie-break the order is whatever the Map
      // yields and a weak lexical hit can lead a page of strong dense ones. Break
      // toward the arm the benchmark says is better — rows both arms found, then dense,
      // then by score — instead of leaving it to insertion order.
      const armRank = (r: Row) => (r.arm === "both" ? 2 : r.arm === "dense" ? 1 : 0);
      records = [...byKey.values()]
        .sort((a, b) =>
          ((scores.get(key(b)) ?? 0) - (scores.get(key(a)) ?? 0)) ||
          (armRank(b) - armRank(a)) ||
          ((Number(b.similarity) || 0) - (Number(a.similarity) || 0)))
        .slice(0, limit);
      mode = "hybrid";
    } else if (denseRows.length) {
      records = denseRows.map((r) => ({ ...r, arm: "dense" })).slice(0, limit);
      mode = "semantic";
    } else {
      records = ftsRows.slice(0, limit);
      mode = "keyword";
    }

    // Subject-first, corpus-second, never subject-only: a scoped search with weak
    // results widens to the whole corpus and SAYS SO — a filter that hides the
    // answer behind a confident-but-irrelevant list is the worst failure we
    // have. Weakness cannot be a row count: the in-subject dense arm is an EXACT
    // kNN, so it always fills the limit even when nothing is relevant (a
    // 30-paper room answers any query with its 10 nearest strangers). The
    // signal is evidence: no in-subject lexical match AND no in-subject dense hit
    // above WEAK_SIM. Measured on the nsr encoder: relevant in-subject hits score
    // ≥0.60, filler ≤0.26 — 0.45 splits them with margin on both sides.
    const WEAK_SIM = 0.45;
    const inRoomEvidence =
      ftsRows.length > 0 || denseRows.some((r) => Number(r.similarity) >= WEAK_SIM);
    let widened = false;
    if (room && (!inRoomEvidence || records.length < 5)) {
      const have = new Set(records.map((r) => String(r.key_number)));
      // The same lexical shape as the in-room arm (TQ_CTE), not the AND form: the
      // widening exists for the multi-concept query the room could not answer, and
      // AND is the shape that matches almost nothing for exactly that query.
      const wide = await q(
        `${TQ_CTE}
         SELECT ${SELECT},
                least(ts_rank_cd(p.fts, tq.q) / 4.0, 0.99)::float AS similarity
         FROM preprints p, tq
         WHERE p.fts @@ tq.q
         ORDER BY ts_rank_cd(p.fts, tq.q) DESC, p.pub_year DESC NULLS LAST
         LIMIT $2`, [raw, limit]).catch(() => [] as Row[]);
      for (const r of wide) {
        if (!have.has(String(r.key_number)) && records.length < limit) {
          records.push({ ...r, arm: "fts", widened: true });
          widened = true;
        }
      }
    }

    const degraded = wantsDense && !denseRows.length;
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      records,
      count: records.length,
      mode,
      requested_mode: requested,
      encoder: encoderUsed,
      arms: { dense: denseRows.length, fts: ftsRows.length },
      degraded,
      note: denseNote,
      room: room ?? undefined,
      widened: room ? widened : undefined,
      timings: { total_ms: Date.now() - t0, dense_ms: denseMs, fts_ms: ftsMs },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
