// /api/chat — the RAG chat route, on the real stack.
//
// Replaces the Supabase edge function (which died with "Not implemented:
// Http2Session.settings" — the AWS SDK no longer runs in that runtime).
// Vercel Node function: retrieval hits NEON (the full 433k corpus),
// generation streams from AWS Bedrock, and the SSE shape is byte-compatible
// with what the client already parses.
//
// Retrieval lanes (parallel):
//   0. key/DOI     — an explicit 10.1101/... or bare key_number in the message
//                    fetches that record directly (it must reach the prompt;
//                    FTS tokenizes DOIs into noise)
//   1. structured  — category mentions matched against the live dictionary
//   2. author      — ILIKE on the flattened author string
//   3. full-text   — weighted tsvector over title/keywords/abstract
//   4. dense       — kNN over the active encoder's vector table
//   5. Semantic Scholar API (best-effort)
//
// SUBJECT SCOPE. The body may carry `room: {server, category}` (the wire name
// predates the rename and is kept for deployed clients);
// arms 1–4 are then confined to that slice. Inside a subject the dense arm runs
// an EXACT scan (filter first, then order by distance) instead of HNSW —
// subjects are ≤12.7k vectors, where exact is both correct and affordable, and
// an ANN over-fetch would miss most of a small subject. Subject-first is never
// subject-only: if scoped retrieval comes back sparse the corpus-wide arms run
// too, and the payload + prompt both say the search was widened.
//
// FULL TEXT (Task 1b). The top few records that reach the prompt get their
// body fetched on demand (JATS → article HTML → Europe PMC, cached in
// preprint_fulltext) — see api/_lib/fulltext.ts for the timing contract.
//
// Env: DATABASE_URL, BEDROCK_API_KEY (bearer), BEDROCK_REGION,
//      SEMANTIC_SCHOLAR_API_KEY (optional).

import { neon } from "@neondatabase/serverless";
import { activeEncoder, embedQueryCached, hasEmbeddings, toVectorLiteral, vectorTable, type EncoderName } from "./_lib/embed.js";
import { getFulltext, type FulltextResult } from "./_lib/fulltext.js";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

export const config = { maxDuration: 120 };

// STRUCTURE, WITH A MEASUREMENT BEHIND IT.
//
// The earlier rule here banned headings outright: of five failed test answers,
// the two that used headers fabricated, so scaffolding was treated as the
// cause. That was a proxy. We now score every answer against the very text the
// generator read (api/grounding.ts + Bedrock contextual grounding), so
// fabrication is measured directly instead of being guessed at from shape —
// and a wall of undifferentiated prose is its own failure, one a reader pays
// for on every answer. Structure is allowed back; the grounding rules below,
// and the score in the footer, are what hold the line.
const SYSTEM_PROMPT_BASE = `You are livingston, an AI research assistant grounded in the bioRxiv and medRxiv preprint corpora.

INSTRUCTIONS:
- Organize the answer so it can be read: markdown headings (##, ###) for the two or three real divisions of your answer, bullet or numbered lists where items are genuinely parallel, and bold for the specific term or finding that carries a sentence. Lead with a sentence that answers the question, not with a heading.
- Structure must follow the evidence, never generate it. Never open a section you cannot fill from the retrieved text — no empty "Limitations" or "Future Work" heading written because the shape expects one. Fewer, fuller sections beat a complete-looking outline.
- Ground every claim in the retrieved records below. Never describe a finding, method, or number that is not present in the supplied text. When the retrieved text does not answer part of the question, say plainly that the retrieved text does not say — never fill the gap with a plausible completion.
- Records marked "Full text" include body sections beyond the abstract; prefer their specifics (quantities, comparisons, named results) when reporting what a paper found.
- Each record carries a PUBLICATION STATUS line. Follow it exactly. When it says peer reviewed, say so and cite the published journal and DOI; when it was retitled on publication, use the published title. When it says UNKNOWN, say nothing about publication status — never call a paper unpublished, "still a preprint", or not peer reviewed, and never frame your answer around its being preliminary. When a record's status says withdrawn, never present its findings as standing.
- Even when no record is an exact match, discuss what the retrieved preprints reveal about the topic — the same subject category, adjacent clinical or biological questions, and later versions of the same work are all relevant.
- Cite corpus records by key number (e.g., 2021.05.04.442622). Cite Semantic Scholar papers by title and author with their URL.
- Only say "no relevant records" if the retrieved list is truly empty or entirely unrelated.
- Never fabricate key numbers, DOIs, author names, or quantities.`;

const DEFAULT_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/* ── entity extraction ─────────────────────────────────────────────────── */

function extractAuthorQuery(text: string): string | null {
  const patterns = [
    /(?:papers?|publications?|work|research|articles?)\s+(?:by|from|of)\s+(.+?)(?:\?|$|\.|\bin\b|\bfrom\b|\babout\b)/i,
    /(?:what\s+(?:did|has|have))\s+(.+?)\s+(?:publish|write|author|research|study|contribute)/i,
    /(?:authored?\s+by|written\s+by)\s+(.+?)(?:\?|$|\.)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const name = m[1].trim().replace(/[?.!,]+$/, "").trim();
      if (name.length >= 3 && !/^\d+[A-Z][a-z]?$/.test(name)) return name;
    }
  }
  return null;
}

/** An explicit identifier in the message is the strongest routing signal there
 *  is: that exact record must reach the prompt. Accepts a 10.1101/… DOI (with
 *  or without a vN suffix) or a bare key_number. */
function extractKeyNumber(text: string): string | null {
  const m = text.match(/(?:10\.1101\/)?(\d{4}\.\d{2}\.\d{2}\.\d{5,10})(?:v\d+)?/);
  return m ? m[1] : null;
}

/** Which subject categories does this question mention? Matched against the live
 *  `categories` dictionary rather than a regex, so the vocabulary can never
 *  drift from what the corpus actually holds. */
let CATEGORY_CACHE: string[] | null = null;
async function extractCategories(sql: { query: (t: string, p: unknown[]) => Promise<{ category: string }[]> }, text: string): Promise<string[]> {
  try {
    if (!CATEGORY_CACHE) CATEGORY_CACHE = (await sql.query("SELECT category FROM categories", [])).map((r) => r.category);
    const t = text.toLowerCase();
    return CATEGORY_CACHE.filter((c) => c.length > 4 && t.includes(c)).slice(0, 3);
  } catch { return []; }
}

/* ── context building ──────────────────────────────────────────────────── */

interface Rec {
  key_number: string; title: string | null; authors: string | null;
  pub_year: number; doi: string | null; abstract: string | null;
  categories: string[] | null; status_tags: string[] | null;
  server: string | null; published_journal: string | null; published_doi: string | null;
  version: number | null; jatsxml_url: string | null; similarity: number;
}

// Total full-text budget across the prompt: generous enough for real body
// sections, bounded so a turn can never dump the whole corpus into context.
const FULLTEXT_PROMPT_BUDGET = 40_000;

function formatCorpusContext(records: Rec[], fulltext: Map<string, FulltextResult>): string {
  if (records.length === 0) return "\n## Retrieved Records\nNo relevant records found.";
  let ftBudget = FULLTEXT_PROMPT_BUDGET;
  // Share the budget across however many papers actually have full text, so a
  // question about ONE paper spends the whole allowance on it rather than
  // reserving space for three papers nobody asked about. Floor at 6k so a
  // four-paper answer still gets real body text for each.
  const ftCount = records.filter((r) => fulltext.has(r.key_number)).length || 1;
  const perPaper = Math.max(6_000, Math.floor(FULLTEXT_PROMPT_BUDGET / ftCount));
  const lines = records.map((r, i) => {
    const parts = [
      `[${i + 1}] ${r.key_number} (${r.server ?? "preprint"}) — "${r.title ?? "Untitled"}"`,
      // NEVER assert unpublished status. published_journal is null for 50.3% of
      // the corpus, including papers that ARE published (the record just wasn't
      // backfilled), so " | not yet published" made the generator state a
      // falsehood in our own voice — it wasn't hallucinating, it was obeying.
      // Silence when unknown; the system prompt tells it not to speculate.
      `    Authors: ${r.authors ?? "N/A"} | Year: ${r.pub_year}${r.doi ? ` | DOI: ${r.doi}` : ""}${r.published_journal ? ` | published in ${r.published_journal}` : ""}`,
    ];
    if (r.categories?.length) parts.push(`    Category: ${r.categories.join(", ")}`);
    if (r.status_tags?.length) parts.push(`    Status: ${r.status_tags.join(", ")}`);
    const ft = fulltext.get(r.key_number);
    // Publication status, resolved rather than assumed. published_journal is
    // null for half the corpus INCLUDING papers that are published, so the
    // resolver (api/_lib/dossier.ts) is the authority when the column is empty.
    if (ft?.published) {
      const p = ft.published;
      parts.push(
        `    PUBLICATION STATUS: peer reviewed — published${p.journal ? ` in ${p.journal}` : ""}` +
        `${p.year ? ` (${p.year})` : ""}, DOI ${p.doi}.` +
        (p.title && p.title.toLowerCase() !== (r.title ?? "").toLowerCase()
          ? ` NOTE: retitled on publication to "${p.title}" — cite the published title.`
          : ""),
      );
    } else if (r.published_journal) {
      parts.push(`    PUBLICATION STATUS: published in ${r.published_journal}.`);
    } else {
      parts.push(`    PUBLICATION STATUS: UNKNOWN — we could not determine whether this has been published. Do not describe it as unpublished or as not peer reviewed.`);
    }
    if (ft && ftBudget > 2000) {
      const body = ft.text.slice(0, Math.min(perPaper, ftBudget));
      ftBudget -= body.length;
      const label = ft.published
        ? `Full text of the PUBLISHED version (section-trimmed). Where it differs from the preprint abstract above, the published text is authoritative`
        : `Full text of the preprint (section-trimmed, fetched from source)`;
      parts.push(`    ${label}: ${body}`);
    } else if (r.abstract) {
      // Full abstract, capped only as a runaway guard. The old 500-char cut is
      // what lost the Vink comparison to AWS's managed KB — its generator read
      // whole chunks while ours read stubs; a worse retriever beat us on content
      // because it was allowed to read.
      parts.push(`    Abstract: ${r.abstract.slice(0, 4000)}`);
    }
    return parts.join("\n");
  });
  return `\n## Retrieved Records\n${lines.join("\n\n")}`;
}

interface S2Paper {
  title: string; authors?: { name: string }[]; year?: number;
  abstract?: string; citationCount?: number; url?: string;
}

function formatS2Context(papers: S2Paper[]): string {
  if (papers.length === 0) return "";
  const lines = papers.map((p, i) => {
    const parts = [`[S${i + 1}] "${p.title}" — ${p.authors?.map((a) => a.name).join(", ") ?? "Unknown"} (${p.year ?? "N/A"}) | ${p.citationCount ?? 0} citations`];
    if (p.abstract) parts.push(`     Abstract: ${p.abstract.slice(0, 200)}...`);
    if (p.url) parts.push(`     ${p.url}`);
    return parts.join("\n");
  });
  return `\n\n## Related Papers (Semantic Scholar)\n${lines.join("\n\n")}`;
}

/* ── handler ───────────────────────────────────────────────────────────── */

const SELECT = `key_number, title, authors, pub_year, doi, abstract,
  categories, status_tags, server, published_journal, published_doi, version, jatsxml_url`;

const ROOM_SERVERS = new Set(["biorxiv", "medrxiv"]);

// Classic Vercel Node signature — the Web-handler form hung in production
// (the builder invoked (req, res) and ignored a returned Response).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") return res.status(200).send("ok");
  if (req.method !== "POST") return res.status(405).send("POST only");

  try {
    const { messages = [], userMessage, systemContext, modelId, room: roomRaw } = req.body ?? {};
    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "userMessage is required" });
    }

    // The room is set by navigation, not guessed: it arrives on the body.
    const room =
      roomRaw && typeof roomRaw === "object" &&
      ROOM_SERVERS.has(String(roomRaw.server)) &&
      typeof roomRaw.category === "string" && roomRaw.category.trim()
        ? { server: String(roomRaw.server), category: String(roomRaw.category).trim().toLowerCase() }
        : null;

    // Flush headers immediately: the client sees a live stream during
    // retrieval instead of 30s of dead air.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": retrieving\n\n");
    const t0 = Date.now();

    // ── FORM MODE ────────────────────────────────────────────────────────
    // A form was dropped on the conversation. The chat IS the form now, so
    // there is nothing to retrieve — corpus context would only argue with the
    // interview. Straight to the model with the form's own instructions.
    if (req.body?.mode === "form" && typeof systemContext === "string" && systemContext.trim()) {
      const history = (messages as { role: string; content: string }[])
        .slice(-16)
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim());
      const firstUser = history.findIndex((m) => m.role === "user");
      const turns: { role: "user" | "assistant"; content: { text: string }[] }[] = [];
      for (const m of [...(firstUser === -1 ? [] : history.slice(firstUser)), { role: "user", content: userMessage }]) {
        const role = m.role as "user" | "assistant";
        const prev = turns[turns.length - 1];
        if (prev && prev.role === role) prev.content.push({ text: m.content });
        else turns.push({ role, content: [{ text: m.content }] });
      }
      if (!process.env.AWS_BEARER_TOKEN_BEDROCK && process.env.BEDROCK_API_KEY) {
        process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
      }
      const fClient = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? "us-east-1" });
      const fModel = typeof modelId === "string" && modelId.trim() ? modelId.trim() : DEFAULT_MODEL_ID;
      const fRes = await fClient.send(
        new ConverseStreamCommand({
          modelId: fModel,
          system: [{ text: systemContext }],
          messages: turns,
          inferenceConfig: { maxTokens: 2048 },
        }),
      );
      if (!fRes.stream) throw new Error(`Bedrock returned no stream for ${fModel}`);
      console.log(`chat form-mode start: ${Date.now() - t0}ms, model=${fModel}`);
      res.write(`data: ${JSON.stringify({ sources: { nsr: [], s2: [], fulltext: [] } })}\n\n`);
      try {
        for await (const event of fRes.stream as AsyncIterable<Record<string, unknown>>) {
          const delta = (event as { contentBlockDelta?: { delta?: { text?: string } } }).contentBlockDelta?.delta?.text;
          if (delta) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : "stream failed" })}\n\n`);
      }
      return res.end();
    }

    const sql = neon(process.env.DATABASE_URL!);
    const categories = await extractCategories(sql as never, userMessage);
    const authorQuery = extractAuthorQuery(userMessage);
    const keyNumber = extractKeyNumber(userMessage);

    const q = (text: string, params: unknown[]) => (sql as unknown as { query: (t: string, p: unknown[]) => Promise<Rec[]> }).query(text, params);

    // Subject predicate, appended to each scoped arm. $n placeholders are offset
    // per query, so the clause is built where it is used.
    const roomCond = (n: number) => `server = $${n} AND categories && $${n + 1}::text[]`;
    const roomParams = room ? [room.server, [room.category]] : [];

    // Arm 0: explicit key/DOI — never room-filtered (an explicit identifier is
    // an explicit scope of its own, and the user typed it).
    const keyP: Promise<Rec[]> = keyNumber
      ? q(`SELECT ${SELECT}, 1.0 AS similarity FROM preprints WHERE key_number = $1`, [keyNumber]).catch(() => [])
      : Promise.resolve([]);

    const structuredP: Promise<Rec[]> = categories.length
      ? q(
          `SELECT ${SELECT}, 1.0 AS similarity FROM preprints
           WHERE categories && $1::text[]${room ? ` AND ${roomCond(2)}` : ""}
           ORDER BY pub_year DESC, posted_date DESC LIMIT 10`,
          [categories, ...roomParams],
        ).catch(() => [])
      : Promise.resolve([]);
    const authorP: Promise<Rec[]> = authorQuery
      ? q(
          `SELECT ${SELECT}, 1.0 AS similarity FROM preprints
           WHERE authors ILIKE $1${room ? ` AND ${roomCond(2)}` : ""} ORDER BY pub_year DESC LIMIT 8`,
          ["%" + authorQuery + "%", ...roomParams],
        ).catch(() => [])
      : Promise.resolve([]);

    const ftsFor = (query: string, scoped: boolean) =>
      q(
        `SELECT ${SELECT},
                least(ts_rank_cd(fts, websearch_to_tsquery('english', $1)) / 4.0, 0.99)::float AS similarity
         FROM preprints
         WHERE fts @@ websearch_to_tsquery('english', $1)${scoped && room ? ` AND ${roomCond(2)}` : ""}
         ORDER BY ts_rank_cd(fts, websearch_to_tsquery('english', $1)) DESC
         LIMIT 8`,
        scoped && room ? [query, ...roomParams] : [query],
      );
    // websearch ANDs every term, which is too strict for conversational
    // queries — when the strict pass finds nothing, retry with terms OR'ed.
    // The OR retry MUST prune high-document-frequency lexemes via fts_high_df,
    // exactly as /api/search does: a naive OR ranks every match, and a message
    // like "please read <DOI> and report what it says" ORs 'read', 'report',
    // 'say' over 433k docs — measured 42.7 s inside this handler before the
    // pruning was copied over. Same query pruned: ~100 ms.
    const ftsOrPruned = (scoped: boolean) =>
      q(
        `WITH terms AS (
           SELECT unnest(string_to_array(
                    replace(plainto_tsquery('english', $1)::text, '''', ''), ' & ')) AS l
         ), kept AS (
           SELECT string_agg(l, ' | ') AS expr FROM terms
            WHERE l NOT IN (SELECT lexeme FROM fts_high_df)
         ), tq AS (
           SELECT nullif((SELECT expr FROM kept), '')::tsquery AS q
         )
         SELECT ${SELECT},
                least(ts_rank_cd(fts, tq.q) / 4.0, 0.99)::float AS similarity
         FROM preprints, tq
         WHERE tq.q IS NOT NULL AND fts @@ tq.q${scoped && room ? ` AND ${roomCond(2)}` : ""}
         ORDER BY ts_rank_cd(fts, tq.q) DESC
         LIMIT 8`,
        scoped && room ? [userMessage, ...roomParams] : [userMessage],
      );
    const ftsP: Promise<Rec[]> = ftsFor(userMessage, true)
      .then((rows) => (rows.length > 0 ? rows : ftsOrPruned(true)))
      .catch(() => []);

    // Dense arm — the query vector is computed once and shared with the
    // widening pass. Encoder fallback ladder as before: fine-tuned serve box
    // first, stock bge-m3 (free Cloudflare) when it is cold or gone — box down
    // costs retrieval QUALITY, not the hybrid. The vector table follows the
    // encoder that actually answered, because querying one model's space with
    // another model's vector returns confident nonsense.
    const vecP: Promise<{ enc: EncoderName; vector: number[] } | null> = (async () => {
      try {
        if (!(await hasEmbeddings(sql as never))) return null;
        let enc = activeEncoder();
        try {
          const { vector } = await embedQueryCached(sql as never, userMessage, enc);
          return { enc, vector };
        } catch (err) {
          if (enc === "bge") throw err;
          enc = "bge";
          const { vector } = await embedQueryCached(sql as never, userMessage, "bge");
          return { enc, vector };
        }
      } catch { return null; }
    })();

    const denseQuery = async (v: { enc: EncoderName; vector: number[] }, scoped: boolean): Promise<Rec[]> => {
      try {
        if (scoped && room) {
          // Inside a subject: EXACT search, filter first. Subjects are ≤12.7k
          // vectors; HNSW over-fetch would miss most of a small room, and an
          // exact scan at this size is affordable. Correct-but-slow is a
          // measured trade — timings ride the payload log.
          return await q(
            `SELECT ${SELECT}, (1 - (e.embedding <=> $1::vector))::float AS similarity
             FROM preprints JOIN ${vectorTable(v.enc)} e USING (key_number)
             WHERE ${roomCond(2)}
             ORDER BY e.embedding <=> $1::vector
             LIMIT 8`,
            [toVectorLiteral(v.vector), ...roomParams],
          );
        }
        // Corpus-wide: HNSW. The probe vector is a BOUND $1::vector parameter —
        // a correlated reference defeats the index. SET LOCAL must share the
        // transaction with the scan or it lands on a different pooled connection.
        const [, rows] = (await sql.transaction([
          sql.query(`SET LOCAL hnsw.ef_search = 60`),
          sql.query(
            `SELECT ${SELECT}, (1 - (e.embedding <=> $1::vector))::float AS similarity
             FROM ${vectorTable(v.enc)} e
             JOIN preprints USING (key_number)
             ORDER BY e.embedding <=> $1::vector
             LIMIT 8`,
            [toVectorLiteral(v.vector)],
          ),
        ])) as [unknown, Rec[]];
        return rows;
      } catch { return []; }
    };
    const denseP: Promise<Rec[]> = vecP.then((v) => (v ? denseQuery(v, true) : []));

    const [keyRecs, structured, authorRecs, ftsRecs, denseRecs, s2Papers] = await Promise.all([
      keyP,
      structuredP,
      authorP,
      ftsP,
      denseP,
      (async (): Promise<S2Paper[]> => {
        try {
          const headers: Record<string, string> = {};
          if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
          const res = await fetch(
            `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(userMessage)}&limit=5&fields=title,authors,year,abstract,citationCount,url`,
            { headers, signal: AbortSignal.timeout(3000) },
          );
          if (!res.ok) return [];
          return (await res.json()).data ?? [];
        } catch { return []; }
      })(),
    ]);

    // merge: explicit key first, then structured, author, and the ranked arms
    // interleaved by rank (never merge raw scores across arms)
    const merge = (arms: Rec[][], cap: number): Rec[] => {
      const seen = new Set<string>();
      const out: Rec[] = [];
      for (const arm of arms) {
        for (const r of arm) {
          if (!seen.has(r.key_number)) { seen.add(r.key_number); out.push(r); }
          if (out.length >= cap) return out;
        }
      }
      return out;
    };
    const interleave = (a: Rec[], b: Rec[]): Rec[] => {
      const out: Rec[] = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]) out.push(a[i]);
        if (b[i]) out.push(b[i]);
      }
      return out;
    };
    let records = merge([keyRecs, structured, authorRecs, interleave(denseRecs, ftsRecs)], 14);

    // Subject-first, corpus-second, never subject-only: a filter that hides the
    // answer and produces a confident empty-handed response is the worst
    // failure we have. Weak in-subject retrieval widens to the corpus and the
    // prompt + payload both say so. Weakness is evidence, not row count — the
    // scoped dense arm is an exact kNN that always fills its limit, so a tiny
    // room answers any query with its nearest strangers. Measured on the nsr
    // encoder: relevant in-subject hits ≥0.60 cosine, filler ≤0.26; 0.45 splits
    // them with margin. An explicit key match is evidence by itself.
    const WEAK_SIM = 0.45;
    const inRoomEvidence =
      keyRecs.length > 0 || ftsRecs.length > 0 ||
      denseRecs.some((r) => Number(r.similarity) >= WEAK_SIM);
    let widened = false;
    if (room && (!inRoomEvidence || records.length < 3)) {
      const [ftsWide, denseWide] = await Promise.all([
        ftsFor(userMessage, false).then((r) => (r.length ? r : ftsOrPruned(false))).catch(() => []),
        vecP.then((v) => (v ? denseQuery(v, false) : [])),
      ]);
      const wide = merge([records, interleave(denseWide, ftsWide)], 14);
      widened = wide.length > records.length;
      records = wide;
    }

    // Task 1b: the records that reach the prompt get their body fetched on
    // demand (top 4). The prompt budget keeps a slow origin from hanging the
    // turn; stragglers land in preprint_fulltext for the next ask.
    const tArms = Date.now() - t0;
    const ftTargets = records.slice(0, 4).map((r) => ({
      key_number: r.key_number, doi: r.doi, server: r.server,
      version: r.version, jatsxml_url: r.jatsxml_url,
      // the resolver matches on content, so it needs these
      title: r.title, authors: r.authors, pub_year: r.pub_year,
      published_doi: r.published_doi, published_journal: r.published_journal,
    }));
    const fulltextResults = await getFulltext(sql as never, ftTargets).catch(() => [] as FulltextResult[]);
    const fulltextByKey = new Map(fulltextResults.map((f) => [f.key_number, f]));
    const tFulltext = Date.now() - t0 - tArms;

    const roomContext = room
      ? `\n\nSCOPE: This conversation is scoped to the "${room.category}" room — ${room.server} preprints in that category. The retrieved records reflect that scope.${
          widened
            ? " In-room retrieval was sparse, so the results below were widened to the whole corpus — tell the user the search was widened beyond the subject."
            : ""
        }`
      : "";

    const systemPrompt =
      `${SYSTEM_PROMPT_BASE}${systemContext ? `\n\n${systemContext}` : ""}${roomContext}\n` +
      formatCorpusContext(records, fulltextByKey) + formatS2Context(s2Papers);

    const sources = {
      nsr: records.map((r) => ({
        key_number: r.key_number, title: r.title, doi: r.doi, similarity: r.similarity,
        categories: r.categories, server: r.server,
        fulltext: fulltextByKey.has(r.key_number) || undefined,
      })),
      s2: s2Papers.map((p) => ({
        title: p.title, url: p.url ?? "",
        authors: p.authors?.map((a) => a.name).join(", ") ?? "Unknown",
        citations: p.citationCount ?? 0,
      })),
      fulltext: fulltextResults.map((f) => ({ key_number: f.key_number, source: f.source, chars: f.text.length })),
      room: room ? { ...room, widened } : undefined,
    };

    // Bedrock turn shape: first turn must be user, roles alternate, no empties
    const history = (messages as { role: string; content: string }[])
      .slice(-10)
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim());
    const firstUser = history.findIndex((m) => m.role === "user");
    const turns: { role: "user" | "assistant"; content: { text: string }[] }[] = [];
    for (const m of [...(firstUser === -1 ? [] : history.slice(firstUser)), { role: "user", content: userMessage }]) {
      const role = m.role as "user" | "assistant";
      const prev = turns[turns.length - 1];
      if (prev && prev.role === role) prev.content.push({ text: m.content });
      else turns.push({ role, content: [{ text: m.content }] });
    }

    // Bedrock API keys authenticate via AWS_BEARER_TOKEN_BEDROCK — the
    // inline token config is silently ignored by the SDK's auth resolution.
    if (!process.env.AWS_BEARER_TOKEN_BEDROCK && process.env.BEDROCK_API_KEY) {
      process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
    }
    const client = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION ?? "us-east-1",
    });
    const chosenModel = typeof modelId === "string" && modelId.trim() ? modelId.trim() : DEFAULT_MODEL_ID;
    const bedrockRes = await client.send(
      new ConverseStreamCommand({
        modelId: chosenModel,
        system: [{ text: systemPrompt }],
        messages: turns,
        inferenceConfig: { maxTokens: 2048 },
      }),
    );
    if (!bedrockRes.stream) throw new Error(`Bedrock returned no stream for ${chosenModel}`);

    console.log(
      `chat retrieval+bedrock-start: ${Date.now() - t0}ms (arms=${tArms}ms, fulltext=${tFulltext}ms), records=${records.length}` +
      `, fulltext=${fulltextResults.map((f) => `${f.key_number}:${f.source}`).join("|") || "none"}` +
      (room ? `, room=${room.server}/${room.category}${widened ? " (widened)" : ""}` : ""),
    );
    res.write(`data: ${JSON.stringify({ sources })}\n\n`);
    try {
      for await (const event of bedrockRes.stream as AsyncIterable<Record<string, unknown>>) {
        const delta = (event as { contentBlockDelta?: { delta?: { text?: string } } })
          .contentBlockDelta?.delta?.text;
        if (delta) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
        }
      }
      res.write("data: [DONE]\n\n");
    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : "stream failed" })}\n\n`);
    }
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ error: (err as Error).message });
  }
}
