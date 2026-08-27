// Query-side encoder + reranker clients for sam's retrieval.
//
// The corpus vectors are permanent sidecars on `preprints`, one table per model.
// Every search still has to encode the user's text in the SAME model as the table
// it searches, so:
//
//   SEARCH_ENCODER=bge (default)  Cloudflare Workers AI @cf/baai/bge-m3 — free
//        tier 10k neurons/day (~450k queries/day), hard-fails rather than bills.
//        Parity vs stored TEI vectors cos ≥ 0.996, identical top-10 (2026-08-16).
//        Fallback: HF hf-inference BAAI/bge-m3 (cos 0.99999) when HF_TOKEN set.
//   SEARCH_ENCODER=nsr            our fine-tuned encoder served by TEI on the
//        the self-hosted serve box: NSR_ENCODER_URL (the /embed URL) +
//        NSR_SERVE_KEY (bearer; falls back to HF_TOKEN). If the endpoint errors,
//        callers fall back to bge — and the table follows, see vectorTable().
//        The env var name is `nsr` for the same reason NSR_ENCODER_URL is: this
//        app was cloned from the NSR program. It selects whatever fine-tuned
//        encoder the serve box is currently loaded with, not a specific model.
//
//   SEARCH_RERANK=on              NYSgpt/nsr-reranker-gte-modernbert by TEI:
//        NSR_RERANKER_URL (base URL; /rerank is appended) + NSR_SERVE_KEY.
//
// Kill-switch = flip the env var and redeploy; the bge path never goes away.

export type EncoderName = "bge" | "nsr";

const CF_MODEL = "@cf/baai/bge-m3";
const HF_BGE_URL = "https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction";

export function activeEncoder(): EncoderName {
  return process.env.SEARCH_ENCODER === "nsr" && process.env.NSR_ENCODER_URL ? "nsr" : "bge";
}
// Corpus vector tables. All three are populated (433,449 rows each) and all
// three stay populated — this constant chooses which one the dense arm reads.
//   bge -> preprint_embeddings          stock bge-m3
//   nsr -> preprint_embeddings_cshl_qp  the qpairs encoder (query->doc supervision,
//                                       run 20260819-192100-train). Serving as of
//                                       2026-08-20: MeSH R@10 0.4319 vs the CITE
//                                       model's 0.3320, statistical parity with MedCPT.
//          preprint_embeddings_cshl     the CITE encoder (doc->doc supervision) —
//                                       NOT dead weight and NOT to be dropped: it is
//                                       still the better document->document encoder
//                                       (R@10 0.2120 vs 0.1980) and is the right arm
//                                       for "more like this" / reviewer matching. It
//                                       has no query-side route today; whatever reads
//                                       it must serve the CITE weights, not these.
//
// This name is load-bearing and was wrong once: it read `preprint_embeddings_ft`, a
// table that does not exist. hasEmbeddings() would have probed it, found nothing, and
// silently degraded the dense arm to FTS-only — so /chat would have looked like it was
// running on the fine-tuned encoder while serving keyword-only results. No error, no
// signal, plausible output. Caught by rig-port before the flip. This constant and the
// weights loaded on the serve box are ONE decision in two places: change either and the
// other has to move with it, or the app queries one model's space with another model's
// vector and returns confident nonsense with a 200.
export const vectorTable = (enc: EncoderName) => (enc === "nsr" ? "preprint_embeddings_cshl_qp2" : "preprint_embeddings");

/**
 * Is the vector sidecar actually populated? The dense arm is worth an encoder round
 * trip only if there is something to search. Cached per process with a short TTL so
 * this costs one cheap probe a minute, not one per request — which means retrieval
 * turns itself on when the embed sweep lands, with no deploy and nobody awake.
 */
let embProbe = { at: 0, ok: false };
export async function hasEmbeddings(
  sql: { query: (t: string, p?: unknown[]) => Promise<Record<string, unknown>[]> },
  enc: EncoderName = activeEncoder(),
): Promise<boolean> {
  const now = Date.now();
  if (now - embProbe.at < 60_000) return embProbe.ok;
  try {
    const r = await sql.query(`SELECT 1 AS x FROM ${vectorTable(enc)} LIMIT 1`);
    embProbe = { at: now, ok: r.length > 0 };
  } catch {
    embProbe = { at: now, ok: false };   // table absent → FTS-only, never an error
  }
  return embProbe.ok;
}
const serveKey = () => process.env.NSR_SERVE_KEY ?? process.env.HF_TOKEN ?? "";
export const rerankEnabled = () => process.env.SEARCH_RERANK === "on" && !!process.env.NSR_RERANKER_URL && !!serveKey();

async function cloudflare(text: string): Promise<number[]> {
  const { CF_ACCOUNT_ID, CF_AI_TOKEN } = process.env;
  if (!CF_ACCOUNT_ID || !CF_AI_TOKEN) throw new Error("CF_ACCOUNT_ID / CF_AI_TOKEN not set");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_AI_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: [text] }),
    signal: AbortSignal.timeout(8000),
  });
  const j = (await r.json()) as { success: boolean; errors?: unknown; result?: { data?: number[][] } };
  const v = j.result?.data?.[0];
  if (!r.ok || !j.success || !v) throw new Error(`cloudflare embed failed: ${r.status} ${JSON.stringify(j.errors ?? "")}`);
  return v;
}

/** TEI-style endpoint (nsr-serve, HF Inference Endpoints and hf-inference all accept {inputs}). */
async function tei(url: string, text: string, key: string): Promise<number[]> {
  if (!key) throw new Error("no bearer key for embed endpoint");
  // A cold or wedged serve box must fail FAST into the bge fallback, not hang
  // the turn: measured 2026-08-21, an un-timed fetch here held /api/chat for
  // ~50 s before the rest of retrieval could proceed.
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: text, normalize: true, truncate: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`embed endpoint failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as number[] | number[][];
  const v = Array.isArray(j[0]) ? (j as number[][])[0] : (j as number[]);
  if (!Array.isArray(v) || v.length !== 1024) throw new Error("embed endpoint: unexpected shape");
  return v;
}

/** 1024-d unit vector for a query, in the requested model's space. */
export async function embedQuery(
  text: string,
  encoder: EncoderName = activeEncoder(),
): Promise<{ vector: number[]; provider: string; encoder: EncoderName }> {
  const input = text.trim().slice(0, 2000);
  if (encoder === "nsr") {
    return { vector: await tei(process.env.NSR_ENCODER_URL!, input, serveKey()), provider: "nsr-serve", encoder: "nsr" };
  }
  try {
    return { vector: await cloudflare(input), provider: "cloudflare", encoder: "bge" };
  } catch (err) {
    if (!process.env.HF_TOKEN) throw err;
    return { vector: await tei(HF_BGE_URL, input, process.env.HF_TOKEN!), provider: "hf", encoder: "bge" };
  }
}

/** pgvector literal form — pass as a bound parameter, never interpolate. */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;

/** Cross-encoder rerank via TEI /rerank. Returns scores aligned to `texts`. */
export async function rerank(query: string, texts: string[]): Promise<number[]> {
  const url = process.env.NSR_RERANKER_URL!.replace(/\/$/, "");
  const r = await fetch(`${url}/rerank`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serveKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.slice(0, 600), texts: texts.map((t) => t.slice(0, 900)), truncate: true }),
  });
  if (!r.ok) throw new Error(`rerank endpoint failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { index: number; score: number }[];
  const out = new Array<number>(texts.length).fill(-Infinity);
  for (const { index, score } of j) out[index] = score;
  return out;
}

/** Reciprocal-rank fusion (k=60) over ranked lists of keys. */
export function rrf(lists: string[][], k = 60): Map<string, number> {
  const s = new Map<string, number>();
  for (const list of lists) list.forEach((key, i) => s.set(key, (s.get(key) ?? 0) + 1 / (k + i + 1)));
  return s;
}

/**
 * Cache key for a query vector. It is the CORPUS TABLE NAME, not the encoder name.
 *
 * This matters and it was a live trap. `SEARCH_ENCODER=nsr` names a *slot* — "whatever
 * the serve box is loaded with" — not a model. The 2026-08-20 flip changed the weights
 * behind that slot (CITE -> qpairs) while the slot kept its name, so a cache keyed on
 * `'nsr'` would have gone on serving CITE-space vectors for every previously-seen
 * question and used them to search the qpairs table. Confident nonsense, HTTP 200, no
 * error, and only on the queries users repeat most.
 *
 * The table name is 1:1 with the embedding space by construction, so keying on it means
 * a future re-flip invalidates the cache by *not matching* it rather than by anyone
 * remembering to purge. Rows written under the old `'bge'` / `'nsr'` keys simply stop
 * matching and age out; the miss costs one encoder call.
 *
 * (Measured 2026-08-20: `query_vec_cache` does not exist in this database —
 * `sql/09-query-vec-cache.sql` was inherited from NSR and never applied here, so
 * embedQueryCached currently falls through to embedQuery on every call. The trap was
 * therefore not armed tonight. It arms itself the day someone applies that migration,
 * which is exactly when nobody is thinking about encoder flips.)
 */
const cacheKeyModel = (enc: EncoderName) => vectorTable(enc);

/**
 * Memoized query embedding: a Neon table keyed by md5(space:text) so a repeated
 * question costs one indexed lookup (~ms) instead of an encoder call (~1 s on the CPU
 * serve box). Falls through to embedQuery on any cache error, including the table not
 * existing. Table: sql/09-query-vec-cache.sql.
 */
export async function embedQueryCached(
  sql: { query: (t: string, p?: unknown[]) => Promise<Record<string, unknown>[]> },
  text: string,
  encoder: EncoderName = activeEncoder(),
): Promise<{ vector: number[]; provider: string; encoder: EncoderName; cached: boolean }> {
  const norm = text.trim().slice(0, 2000);
  const space = cacheKeyModel(encoder);
  try {
    const hit = await sql.query(
      `UPDATE query_vec_cache SET hits = hits + 1, last_seen = now()
       WHERE text_hash = md5($1) AND model = $2 RETURNING embedding::text AS v`,
      [`${space}:${norm}`, space],
    );
    if (hit[0]?.v) return { vector: JSON.parse(String(hit[0].v)), provider: "cache", encoder, cached: true };
  } catch { /* cache table missing or unreachable — encode */ }
  const e = await embedQuery(norm, encoder);
  try {
    await sql.query(
      `INSERT INTO query_vec_cache (text_hash, model, embedding) VALUES (md5($1), $2, $3::vector)
       ON CONFLICT (text_hash, model) DO UPDATE SET hits = query_vec_cache.hits + 1, last_seen = now()`,
      [`${cacheKeyModel(e.encoder)}:${norm}`, cacheKeyModel(e.encoder), toVectorLiteral(e.vector)],
    );
  } catch { /* best effort */ }
  return { ...e, cached: false };
}
