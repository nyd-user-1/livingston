// The model roster — every model this AWS account can ACTUALLY call.
//
// ── How this list was produced, because it matters ───────────────────────────
// Not from `aws bedrock list-inference-profiles`, and not by copying 44b or
// Leuk. All three are wrong in the same way: Bedrock ADVERTISES far more
// profiles than any account is GRANTED, so a listing is a catalogue, not an
// entitlement. `list-inference-profiles` reports Claude Opus 5, Sonnet 5,
// Fable 5, Opus 4.7/4.8 and the whole GPT-5.6 family as ACTIVE here; every one
// of them answers AccessDeniedException when called. Three more —
// nova-premier, claude-3-haiku, claude-sonnet-4 — list as active and throw
// ResourceNotFoundException. 44b's roster ships two of those.
//
// So each id below was verified by ACTUALLY CALLING IT: bedrock-runtime
// converse, maxTokens 1, on 2026-08-15. 39 candidates in, 27 out. Re-run that
// probe before adding anything; a listing is not proof.
//
// ── Chat only ────────────────────────────────────────────────────────────────
// EMBEDDINGS ARE NOT AFFECTED AND MUST NOT BE. The NSR corpus is embedded with
// OpenAI text-embedding-3-small at 256 dimensions (sql/02-pgvector-setup.sql),
// and the chat model is a separate call in the same edge function. Changing the
// model here has no bearing on vector search whatsoever. Query embedding stays
// on OpenAI until the corpus is re-embedded.
//
// Leuk's smaller list exists because its directory agent attaches tools, and
// several of these reject tool use in streaming mode. This chat has no tools —
// embed, search, generate — so that filter does not apply and the roster is
// bigger here.

export interface ModelOption {
  /** Bedrock inference-profile id, sent to the edge function verbatim. */
  id: string;
  label: string;
  description: string;
  logo: string;
}

const ANTHROPIC = "/logos/anthropic.webp";
const AMAZON = "/logos/amazon.webp";
const META = "/logos/meta_small.svg";
const MISTRAL = "/logos/mistral_small.png";
const OPENAI = "/logos/openai.webp";
const DEEPSEEK = "/logos/deepseek_small.svg";
const QWEN = "/logos/alibaba_small.svg";
const KIMI = "/logos/kimi.jpg";
const MINIMAX = "/logos/minimax_small.svg";
const ZAI = "/logos/zai_small.svg";
const WRITER = "/logos/writer.webp";

export const MODEL_OPTIONS: ModelOption[] = [
  // Anthropic — 6 granted
  { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5", description: "Fastest", logo: ANTHROPIC },
  { id: "us.anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "Fast and smart", logo: ANTHROPIC },
  { id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5", description: "Balanced", logo: ANTHROPIC },
  { id: "us.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6", description: "Most capable", logo: ANTHROPIC },
  { id: "us.anthropic.claude-opus-4-5-20251101-v1:0", label: "Claude Opus 4.5", description: "Deep reasoning", logo: ANTHROPIC },
  { id: "us.anthropic.claude-opus-4-1-20250805-v1:0", label: "Claude Opus 4.1", description: "Previous flagship", logo: ANTHROPIC },

  // Amazon — 4 granted (nova-premier lists but 404s)
  { id: "us.amazon.nova-pro-v1:0", label: "Nova Pro", description: "Amazon, capable", logo: AMAZON },
  { id: "us.amazon.nova-2-lite-v1:0", label: "Nova 2 Lite", description: "Amazon, newest", logo: AMAZON },
  { id: "us.amazon.nova-lite-v1:0", label: "Nova Lite", description: "Amazon, fast", logo: AMAZON },
  { id: "us.amazon.nova-micro-v1:0", label: "Nova Micro", description: "Amazon, cheapest", logo: AMAZON },

  // Meta — 5 granted
  { id: "us.meta.llama4-maverick-17b-instruct-v1:0", label: "Llama 4 Maverick", description: "Meta, open weight", logo: META },
  { id: "us.meta.llama4-scout-17b-instruct-v1:0", label: "Llama 4 Scout", description: "Meta, long context", logo: META },
  { id: "us.meta.llama3-3-70b-instruct-v1:0", label: "Llama 3.3 70B", description: "Meta workhorse", logo: META },
  { id: "us.meta.llama3-1-70b-instruct-v1:0", label: "Llama 3.1 70B", description: "Meta, previous", logo: META },
  { id: "us.meta.llama3-1-8b-instruct-v1:0", label: "Llama 3.1 8B", description: "Meta, small", logo: META },

  // Reasoning and open weight
  { id: "us.deepseek.r1-v1:0", label: "DeepSeek-R1", description: "Reasoning, open weight", logo: DEEPSEEK },
  { id: "mistral.mistral-large-3-675b-instruct", label: "Mistral Large 3", description: "Mistral 675B", logo: MISTRAL },
  { id: "us.mistral.pixtral-large-2502-v1:0", label: "Pixtral Large", description: "Mistral, vision", logo: MISTRAL },
  { id: "moonshotai.kimi-k2.5", label: "Kimi K2.5", description: "Moonshot, open weight", logo: KIMI },
  { id: "moonshot.kimi-k2-thinking", label: "Kimi K2 Thinking", description: "Moonshot, reasoning", logo: KIMI },
  { id: "qwen.qwen3-next-80b-a3b", label: "Qwen3 Next 80B", description: "Alibaba, open weight", logo: QWEN },
  { id: "qwen.qwen3-coder-next", label: "Qwen3 Coder Next", description: "Alibaba, code", logo: QWEN },
  { id: "minimax.minimax-m2.5", label: "MiniMax M2.5", description: "MiniMax, open weight", logo: MINIMAX },
  { id: "zai.glm-5", label: "GLM-5", description: "Z AI, open weight", logo: ZAI },
  { id: "openai.gpt-oss-120b-1:0", label: "gpt-oss 120B", description: "OpenAI, open weight", logo: OPENAI },

  // Writer — 2 granted
  { id: "us.writer.palmyra-x5-v1:0", label: "Palmyra X5", description: "Writer, long context", logo: WRITER },
  { id: "us.writer.palmyra-x4-v1:0", label: "Palmyra X4", description: "Writer, previous", logo: WRITER },
];

/** Haiku 4.5: this is a lookup chat over a paper corpus, and latency is the
 *  felt quality. Change freely — every id above is verified callable. */
export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;

export const modelById = (id: string): ModelOption =>
  MODEL_OPTIONS.find((m) => m.id === id) ?? MODEL_OPTIONS[0];
