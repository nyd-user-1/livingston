import { useQuery, type QueryFunctionContext } from "@tanstack/react-query";
import type { CorpusRecord } from "@/types/record";

/**
 * /search backend: `/api/search` on Neon — bge-m3 kNN over nsr_embeddings
 * (semantic) or weighted FTS + typed nuclides (keyword). `#KEY` prefix hits
 * key_number in either mode. Replaced the retired Supabase edge function.
 */

/**
 * hybrid   — RRF fusion of the encoder + full-text search (default; best-or-tied on every benchmark segment)
 * semantic — the NSR-CPT encoder alone (badge = true cosine similarity)
 * keyword  — Postgres full-text search
 */
export type SearchMode = "hybrid" | "semantic" | "keyword";

interface SearchResult {
  records: CorpusRecord[];
  count: number;
  mode: string;
  timings?: Record<string, number | string>;
}

const IN_MEMORY_QUERY_CACHE_LIMIT = 10;
const queryCache = new Map<string, SearchResult>();

function remember(cacheKey: string, result: SearchResult) {
  queryCache.delete(cacheKey);
  queryCache.set(cacheKey, result);
  while (queryCache.size > IN_MEMORY_QUERY_CACHE_LIMIT) {
    const oldest = queryCache.keys().next().value;
    if (!oldest) break;
    queryCache.delete(oldest);
  }
}

const cacheKeyFor = (query: string, mode: SearchMode, server?: string) =>
  `${server ?? "all"}:${mode}:${query.trim().toLowerCase()}`;

async function searchNsr(query: string, mode: SearchMode, server?: string, signal?: AbortSignal): Promise<SearchResult> {
  const t0 = performance.now();
  // The mode goes through as it is. This used to map every non-keyword mode to
  // `semantic` and add `arm=dense` for semantic — but the API resolves
  // `wantsFts = requested !== "semantic"`, so `hybrid` never ran the lexical arm
  // and never fused, and it does not read `arm` at all. Hybrid and Semantic were
  // therefore the same request, and the dropdown's default was dense-only.
  // Measured after the fix: hybrid returns 43 dense / 46 fts / 11 both.
  const params = new URLSearchParams({ q: query, mode, limit: "100" });
  if (server) params.set("server", server);
  const res = await fetch(`/api/search?${params}`, { signal });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* body wasn't JSON */
    }
    throw new Error(`Search error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const result = (await res.json()) as SearchResult;
  if (import.meta.env.DEV) {
    console.table({ query, mode: result.mode, rows: result.count, client_ms: Math.round(performance.now() - t0), ...(result.timings ?? {}) });
  }
  if (result.records.length > 0) remember(cacheKeyFor(query, mode, server), result);
  return result;
}

export function useRecordSearch(query: string, mode: SearchMode = "hybrid", server?: "biorxiv" | "medrxiv") {
  return useQuery({
    queryKey: ["nsr-search", query, mode, server ?? "all"],
    queryFn: ({ signal }: QueryFunctionContext) => searchNsr(query, mode, server, signal),
    enabled: query.length >= 3,
    staleTime: 1000 * 60 * 5,
    placeholderData: queryCache.get(cacheKeyFor(query, mode, server)),
    gcTime: 1000 * 60 * 30,
    retry: 1,
  });
}
