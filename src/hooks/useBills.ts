import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Bill } from "@/types/bill";

/** Small first page so the rail paints immediately; the rest arrives on scroll. */
export const BILLS_PAGE = 12;

/** `configured: false` means the deployment has no NY Senate key — not a transient failure. */
export class BillsUnavailable extends Error {
  configured: boolean;
  constructor(message: string, configured: boolean) {
    super(message);
    this.configured = configured;
  }
}

async function fetchBills(params: Record<string, string | number>): Promise<{ bills: Bill[]; total: number }> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`/api/bills?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new BillsUnavailable(data?.error ?? `bills ${res.status}`, data?.configured !== false);
  return { bills: (data.bills ?? []) as Bill[], total: Number(data.total ?? 0) };
}

/**
 * The bills with the most recent action, a page at a time, live from the NY
 * Senate. AppLayout warms this on mount so opening the rail is a render, not
 * a request; the edge caches the function for ten minutes behind that.
 */
export function useRecentBills() {
  return useInfiniteQuery({
    queryKey: ["bills", "recent", BILLS_PAGE],
    queryFn: ({ pageParam }) => fetchBills({ limit: BILLS_PAGE, offset: pageParam }).then((d) => d.bills),
    initialPageParam: 1,
    // Upstream offsets are 1-based item positions, not page numbers.
    getNextPageParam: (last, all) => (last.length < BILLS_PAGE ? undefined : all.length * BILLS_PAGE + 1),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: (count, err) => !(err instanceof BillsUnavailable && !err.configured) && count < 2,
  });
}

/** Full-text search over the current session. Fires from three characters. */
export function useBillSearch(term: string) {
  const q = term.trim();
  return useQuery({
    queryKey: ["bills", "search", q],
    queryFn: () => fetchBills({ q, limit: 24, offset: 1 }),
    enabled: q.length >= 3,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
