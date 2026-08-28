import { useEffect, useRef, useState } from "react";
import { BillCard, BillDetail } from "@/components/BillCard";
import { SearchInput } from "@/components/SearchInput";
import { SHELL_CLS } from "@/components/WidgetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppPanel } from "@/hooks/useAppPanel";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { BillsUnavailable, useBillSearch, useRecentBills } from "@/hooks/useBills";
import type { Bill } from "@/types/bill";

/** The upstream search fires from three characters; the rail follows the same rule. */
const MIN_QUERY = 3;

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="px-4 py-8 text-center text-xs text-muted-foreground">{children}</p>
);

/** Cards in outline while the first page lands. */
const Outline = () => (
  <div className="flex flex-col gap-3 px-3 pb-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className={SHELL_CLS}>
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="h-[174px] space-y-2 px-3 py-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The Bills rail — the forms rail, with New York State bills in it.
 *
 * Live from the NY Senate through /api/bills: an empty field browses the
 * bills with the most recent action, newest first, a page at a time; typing
 * searches the session's full text. Each card is the drag unit and carries
 * the bill with it (`billEntity`), so dropping one on the chat attaches it
 * as context with no second fetch.
 */
export function BillsList() {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const searching = debounced.trim().length >= MIN_QUERY;

  const recent = useRecentBills();
  const found = useBillSearch(searching ? debounced : "");
  const { openPanel } = useAppPanel();
  const sentinel = useRef<HTMLDivElement | null>(null);

  // Pull the next page as the bottom comes into view. Browsing only — a
  // search returns its own bounded set.
  const { fetchNextPage, hasNextPage } = recent;
  const paging = !searching && hasNextPage;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !paging) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [paging, fetchNextPage]);

  const open = (bill: Bill) => () => openPanel({ title: bill.printNo, content: <BillDetail bill={bill} /> });

  const bills: Bill[] | undefined = searching ? found.data?.bills : recent.data?.pages.flat();
  const error = searching ? found.error : recent.error;
  const unconfigured = error instanceof BillsUnavailable && !error.configured;

  return (
    <div className="flex flex-col">
      {/* Pinned under the panel header, so the cards scroll beneath it. */}
      <div className="sticky top-0 z-10 bg-background px-3 pb-3 pt-2">
        <SearchInput value={query} onChange={setQuery} isLoading={searching && found.isFetching} placeholder="Search bills…" />
      </div>

      <div className="flex flex-col gap-3 px-3 pb-3">
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          Drag one onto the chat. Penny reads the bill with you and talks it through.
        </p>
        <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {searching ? `Matching “${debounced.trim()}”` : "Latest action in Albany"}
        </p>
      </div>

      {unconfigured ? (
        <Note>Bills need the NY Senate API key — set NYS_LEGISLATION_API_KEY on the deployment.</Note>
      ) : error ? (
        <Note>Could not load bills from the NY Senate.</Note>
      ) : !bills ? (
        <Outline />
      ) : !bills.length ? (
        <Note>{searching ? `Nothing matches “${debounced.trim()}”.` : "No bills on record."}</Note>
      ) : (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {bills.map((bill) => (
            <BillCard key={`${bill.session}/${bill.printNo}`} bill={bill} onOpen={open(bill)} />
          ))}
          {!searching && <div ref={sentinel} className="h-px" />}
          {!searching && recent.isFetchingNextPage && (
            <p className="pb-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
