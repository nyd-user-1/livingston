// /api/grounding — score a finished answer against the preprints it was given.
//
// Bedrock's ApplyGuardrail contextual-grounding check, used as a MEASUREMENT
// rather than a filter (the guardrail's action is NONE): it returns
//   grounding — is every claim supported by the retrieved passages?
//   relevance — does the answer address the question that was asked?
//
// Why this exists: the failure mode this product has actually shipped is a
// confident answer built on nothing — a tool that fails closed still produces
// fluent prose. Measured on a real pair: a faithful answer scores 0.95, an
// answer with invented FDA approval and detection limits scores 0.00. That is
// a signal worth putting in front of the reader instead of asking them to
// trust us.
//
// POST { answer, query, keys: string[] }  →  { grounding, relevance, ok }
// The passages are looked up here by key_number rather than shipped from the
// browser: the client never held the abstracts, and the round trip stays small.
import { BedrockRuntimeClient, ApplyGuardrailCommand } from "@aws-sdk/client-bedrock-runtime";
import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 30 };

const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID ?? "1a0cn7441mk6";
const GUARDRAIL_VERSION = process.env.BEDROCK_GUARDRAIL_VERSION ?? "DRAFT";

// A text unit is 1,000 characters and the check is billed per unit, so the
// grounding source is capped rather than sent whole.
const MAX_SOURCE_CHARS = 40000;
const MAX_ANSWER_CHARS = 6000;

/** Score the PROSE, not the scaffolding.
 *
 *  A heading ("## Significance of X") and a citation marker ("[1]") appear
 *  nowhere in the source text, so the guardrail counts each as an unsupported
 *  claim and the score collapses. Measured on one answer, identical content:
 *  0.58 with markup, 0.87 stripped. The markup is ours, not the model's
 *  assertion about the literature, so it does not belong in the evidence check. */
function plainProse(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")     // code fences
    .replace(/^#{1,6}\s+.*$/gm, "")      // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")     // bold
    .replace(/\*(.+?)\*/g, "$1")         // italic
    .replace(/`(.+?)`/g, "$1")           // inline code
    .replace(/^\s*[-*+]\s+/gm, "")       // bullets
    .replace(/^\s*\d+\.\s+/gm, "")       // numbered items
    .replace(/^\s*(?:-{3,}|\*{3,})\s*$/gm, "") // rules
    .replace(/\[[\d.\s,;v-]+\]/g, "")     // [1] and [2026.08.17.26360592] markers
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")  // links → their text
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { answer, query, keys } = req.body ?? {};
    // Citations are detected on the RAW answer — plainProse() removes the very
    // markers that name the papers the answer leans on.
    const raw = String(answer ?? "");
    const text = plainProse(raw).slice(0, MAX_ANSWER_CHARS);
    const q = String(query ?? "").trim().slice(0, 2000);
    const keyList = (Array.isArray(keys) ? keys : [])
      .map((k) => String(k ?? "").trim())
      .filter(Boolean)
      .slice(0, 12);
    if (!text || !keyList.length) return res.status(200).json({ skipped: true });

    const sql = neon(process.env.DATABASE_URL!);
    // The generator reads FULL TEXT when we have it, so the grounding source
    // must too. Scoring a body-grounded answer against abstracts alone was
    // measured at 1% on an answer that was in fact faithful — the check has to
    // see the same material the model did, or it is just noise in a badge.
    const rows = (await sql.query(
      `SELECT p.key_number, p.title, p.authors, p.abstract, f.text AS fulltext
         FROM preprints p
         LEFT JOIN preprint_fulltext f USING (key_number)
        WHERE p.key_number = ANY($1::text[])`,
      [keyList],
    )) as {
      key_number: string; title: string | null; authors: string | null;
      abstract: string | null; fulltext: string | null;
    }[];
    // Authors and the key number belong in the source: our answers attribute
    // ("McMahon et al. found…") and cite by key, and a source of bare abstracts
    // scores those true attributions as unsupported. Measured: the same claim
    // went 0.17 → 0.96 once the byline was part of the grounding source.
    // Spend the budget on the papers the answer actually cites. An answer that
    // leans on two of ten retrieved papers should be checked against those two
    // in depth, not against ten shallow slices — the passage that supports a
    // claim is usually past the first few thousand characters of a body.
    const cited = new Set(rows.filter((r) => raw.includes(r.key_number)).map((r) => r.key_number));
    const ordered = cited.size
      ? [...rows].sort((a, b) => Number(cited.has(b.key_number)) - Number(cited.has(a.key_number)))
      : rows;
    const budgetFor = (key: string) =>
      cited.size && cited.has(key)
        ? Math.floor((MAX_SOURCE_CHARS * 0.8) / cited.size)
        : Math.max(1200, Math.floor((MAX_SOURCE_CHARS * 0.2) / Math.max(1, rows.length - cited.size)));
    const source = ordered
      .map((r) =>
        [
          `${r.key_number} — ${r.title ?? ""}`,
          r.authors ? `Authors: ${r.authors}` : "",
          (r.fulltext ?? r.abstract ?? "").slice(0, budgetFor(r.key_number)),
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n\n")
      .slice(0, MAX_SOURCE_CHARS);
    if (!source) return res.status(200).json({ skipped: true });

    if (!process.env.AWS_BEARER_TOKEN_BEDROCK && process.env.BEDROCK_API_KEY) {
      process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
    }
    const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? "us-east-1" });
    const out = await client.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier: GUARDRAIL_ID,
        guardrailVersion: GUARDRAIL_VERSION,
        source: "OUTPUT",
        content: [
          { text: { text: source, qualifiers: ["grounding_source"] } },
          ...(q ? [{ text: { text: q, qualifiers: ["query" as const] } }] : []),
          { text: { text } },
        ],
      }),
    );

    let grounding: number | null = null;
    let relevance: number | null = null;
    for (const a of out.assessments ?? []) {
      for (const f of a.contextualGroundingPolicy?.filters ?? []) {
        if (f.type === "GROUNDING") grounding = f.score ?? null;
        if (f.type === "RELEVANCE") relevance = f.score ?? null;
      }
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      grounding,
      relevance,
      // GROUNDING only. Relevance is returned and worth watching — it reads 1.0
      // on real answers now that the question is passed with them — but the
      // verdict a reader sees is about evidence, not aboutness.
      ok: (grounding ?? 0) >= 0.6,
    });
  } catch (err) {
    // A scoring failure must never break the answer that was already delivered.
    return res.status(200).json({ error: (err as Error).message.slice(0, 200) });
  }
}
