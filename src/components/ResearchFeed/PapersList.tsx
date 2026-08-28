import { useEffect, useRef, useState } from "react";
import { RecordRow } from "@/components/RecordRow";
import { RecordPanel } from "@/components/RecordPanel";
import { PanelChat } from "@/components/PanelChat";
import { SearchInput } from "@/components/SearchInput";
import { SHELL_CLS, WidgetHeader } from "@/components/WidgetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppPanel } from "@/hooks/useAppPanel";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRecentPapers } from "@/hooks/useRecentPapers";
import { useRecordSearch } from "@/hooks/useRecordSearch";
import { paperEntity, setDragEntity } from "@/lib/drag-entity";
import type { CorpusRecord } from "@/types/record";

/** `useRecordSearch` only fires at three characters; the panel follows the same rule. */
const MIN_QUERY = 3;

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="px-4 py-8 text-center text-xs text-muted-foreground">{children}</p>
);

/** Cards in outline while a page lands. A cold Neon plus a cold function
 *  measured 5.9s against production (265ms once the edge has it, and a deploy
 *  purges that cache) — long enough that a bare "Loading…" reads as broken. */
const Outline = () => (
  <div className="flex flex-col gap-3 px-3 pb-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className={SHELL_CLS}>
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="space-y-2 px-3 py-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The Papers panel: search the corpus, or browse the newest preprints.
 *
 * Both halves are machinery the app already has. The field is `SearchInput` —
 * the same pill the Papers page and the home page use. Typing runs
 * `useRecordSearch` (hybrid `/api/search`, the query the search page makes,
 * sharing its cache keys); an empty field falls back to `useRecentPapers`,
 * which pages `/api/records` newest-first. Both are scoped to medRxiv.
 *
 * Each result is the card the /search widgets are drawn in (`SHELL_CLS` +
 * `WidgetHeader`) around the row the search results use. The card is the drag
 * unit: it carries its whole record in the payload (`paperEntity`), so dropping
 * one on the chat input attaches it as context with no second fetch.
 */
export function PapersList() {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const searching = debounced.trim().length >= MIN_QUERY;

  const recent = useRecentPapers();
  const found = useRecordSearch(debounced, "hybrid", "medrxiv");

  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const { openPanel } = useAppPanel();
  const sentinel = useRef<HTMLDivElement | null>(null);

  // Pull the next page as the bottom comes into view. Browsing only — a search
  // returns its own bounded set, so there is nothing below it to fetch.
  const { fetchNextPage, hasNextPage } = recent;
  const paging = !searching && hasNextPage;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !paging) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void fetchNextPage(); },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [paging, fetchNextPage]);

  const detail = (record: CorpusRecord) => () =>
    openPanel({ title: record.key_number, content: <RecordPanel record={record} /> });

  const records: CorpusRecord[] | undefined = searching
    ? found.data?.records
    : recent.data?.pages.flat();
  const failed = searching ? found.isError : recent.isError;
  const shown = (records ?? []).filter((r) => !dismissed.has(r.id));

  return (
    <div className="flex flex-col">
      {/* Pinned under the panel header, so the cards scroll beneath it. */}
      <div className="sticky top-0 z-10 bg-background px-3 pb-3 pt-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          isLoading={searching && found.isFetching}
          placeholder="Search bills…"
        />
      </div>

      {failed ? (
        <Note>Could not load bills.</Note>
      ) : !records ? (
        <Outline />
      ) : !shown.length ? (
        <Note>{searching ? `Nothing matches “${debounced.trim()}”.` : "No bills on record."}</Note>
      ) : (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {shown.map((record) => (
            <div
              key={record.id}
              className={SHELL_CLS}
              draggable
              onDragStart={(e) => {
                setDragEntity(e.dataTransfer, paperEntity(record));
                // Pin the drag image to this card. Left to itself Chrome does not
                // hand you the element — it composites its auto-generated snapshot
                // onto a padded backing plate with a drop shadow, which is the box
                // that appeared to be wrapped around the widget. Naming the element
                // makes the preview exactly the card's own bounds, and passing the
                // grab point keeps the card under the cursor where it was picked up
                // instead of snapping to a corner.
                const r = e.currentTarget.getBoundingClientRect();
                e.dataTransfer.setDragImage(e.currentTarget, e.clientX - r.left, e.clientY - r.top);
              }}
            >
              <WidgetHeader
                gripFirst
                title={record.key_number}
                onClose={() => setDismissed((d) => new Set(d).add(record.id))}
              />
              <RecordRow
                variant="card"
                record={record}
                first={false}
                query={searching ? debounced : undefined}
                onClick={detail(record)}
                onDetail={detail(record)}
                onChat={() =>
                  openPanel({
                    title: (
                      <span className="inline-flex items-center gap-2">
                        Chat
                        <span className="inline-flex items-center rounded border bg-muted/40 px-1 font-mono text-[0.85em] font-semibold text-foreground">
                          {record.key_number}
                        </span>
                      </span>
                    ),
                    content: <PanelChat key={record.key_number} record={record} />,
                  })
                }
              />
            </div>
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
