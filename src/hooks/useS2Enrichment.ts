import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { S2Author } from "@/types/record";

export interface S2Enrichment {
  s2_paper_id: string | null;
  citation_count: number | null;
  influential_citation_count: number | null;
  reference_count: number | null;
  abstract: string | null;
  tldr: string | null;
  venue: string | null;
  publication_date: string | null;
  is_open_access: boolean;
  open_access_pdf_url: string | null;
  fields_of_study: string[] | null;
  s2_authors: S2Author[] | null;
  s2_lookup_status: "pending" | "found" | "not_found" | "error" | null;
  s2_looked_up_at: string | null;
}

async function fetchRecord(recordId: number): Promise<S2Enrichment> {
  const res = await fetch(`/api/record?id=${recordId}`);
  if (!res.ok) throw new Error(`record ${res.status}`);
  return (await res.json()) as S2Enrichment;
}

/** Enrichment for one record, from Neon via /api/record (was Supabase REST). */
export function useS2Enrichment(recordId: number | null, initialData?: Partial<S2Enrichment>) {
  return useQuery({
    queryKey: ["s2-enrichment", recordId],
    queryFn: () => fetchRecord(recordId!),
    enabled: recordId != null,
    staleTime: 1000 * 60 * 30,
    // render immediately from whatever the caller already holds (a search hit
    // carries abstract/citations/…); the fetch only fills the S2-only fields.
    placeholderData: initialData ? (initialData as S2Enrichment) : undefined,
  });
}

/** Warm the cache before the click — call on row hover. */
export function usePrefetchRecord() {
  const qc = useQueryClient();
  return (recordId: number) =>
    qc.prefetchQuery({ queryKey: ["s2-enrichment", recordId], queryFn: () => fetchRecord(recordId), staleTime: 1000 * 60 * 30 });
}
