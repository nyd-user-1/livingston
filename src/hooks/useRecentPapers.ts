import { useInfiniteQuery } from "@tanstack/react-query";
import type { CorpusRecord } from "@/types/record";

/** Small first page so the panel paints immediately; the rest arrives on scroll. */
export const PAPERS_PAGE = 12;

/** sam is a medRxiv app: the rail browses that archive, not the whole corpus. */
const SERVER = "medrxiv";

async function fetchPage(page: number): Promise<CorpusRecord[]> {
  const res = await fetch(`/api/records?page=${page}&pageSize=${PAPERS_PAGE}&server=${SERVER}`);
  if (!res.ok) throw new Error(`records ${res.status}`);
  const data = await res.json();
  return (data.records ?? []) as CorpusRecord[];
}

/**
 * The newest preprints, a page at a time.
 *
 * `/api/records` already returns exactly this — ordered `pub_year DESC,
 * posted_date DESC, key_number DESC`, edge-cached for an hour — so the panel
 * needs no endpoint of its own.
 *
 * AppLayout calls this on mount: the first twelve are fetched while the reader
 * is doing something else, so opening the panel is a render, not a request.
 * `staleTime` keeps toggling the panel from refetching; the corpus gains rows
 * about once a day.
 */
export function useRecentPapers() {
  return useInfiniteQuery({
    queryKey: ["recent-papers", SERVER, PAPERS_PAGE],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    // A short page means the last one is the end of the corpus, not a gap.
    getNextPageParam: (last, all) => (last.length < PAPERS_PAGE ? undefined : all.length + 1),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
}
