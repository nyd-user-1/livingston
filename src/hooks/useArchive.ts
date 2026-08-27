import { useQuery } from "@tanstack/react-query";

/** The two preprint archives. Every Agents/Papers/Subjects page is one of these. */
export type ArchiveServer = "medrxiv" | "biorxiv";

export const ARCHIVE_LABEL: Record<ArchiveServer, string> = {
  medrxiv: "medRxiv",
  biorxiv: "bioRxiv",
};

/** One subject: an archive category and its real paper count (from /api/dict
 *  with the server filter — counts computed per server, never cross-server). */
export interface ArchiveCategory {
  value: string;
  record_count: number;
}

export function useArchiveCategories(server: ArchiveServer) {
  return useQuery<ArchiveCategory[]>({
    queryKey: ["archive-categories", server],
    queryFn: async () => {
      const r = await fetch(`/api/dict?type=categories&server=${server}`);
      if (!r.ok) throw new Error(`dict ${r.status}`);
      return r.json();
    },
    // ≤51 rows that change when the corpus reloads, i.e. rarely. The endpoint
    // is edge-cached for a day; match that client-side.
    staleTime: 24 * 3600 * 1000,
    gcTime: 24 * 3600 * 1000,
  });
}

/** Exact per-archive corpus size (from /api/records' count path, edge-cached). */
export function useArchiveCount(server: ArchiveServer) {
  return useQuery<number>({
    queryKey: ["archive-count", server],
    queryFn: async () => {
      const r = await fetch(`/api/records?server=${server}&pageSize=1`);
      if (!r.ok) throw new Error(`records ${r.status}`);
      return (await r.json()).totalCount as number;
    },
    staleTime: 24 * 3600 * 1000,
    gcTime: 24 * 3600 * 1000,
  });
}
