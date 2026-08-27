import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { MobileFilterDrawer } from "@/components/MobileFilterDrawer";
import { SearchInput } from "@/components/SearchInput";
import { RecordCard } from "@/components/RecordCard";
import { DictCombobox } from "@/components/DictCombobox";
import { Skeleton } from "@/components/ui/skeleton";
import { ARCHIVE_LABEL } from "@/hooks/useArchive";
import { useRecordSearch, type SearchMode } from "@/hooks/useRecordSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRecords } from "@/hooks/useRecords";
import { useStructuredSearch } from "@/hooks/useStructuredSearch";
import { useFeedEmitter } from "@/hooks/useFeedEmitter";
import { RecordPanel } from "@/components/RecordPanel";
import { useAppPanel } from "@/hooks/useAppPanel";
import type { CorpusRecord } from "@/types/record";

const CARDS_PER_PAGE = 99;

/* ------------------------------------------------------------------ */
/*  Dropdown filter component                                          */
/* ------------------------------------------------------------------ */

interface FilterDropdownProps {
  label: string;
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}

function FilterDropdown({ label, options, value, onChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
          value
            ? "bg-foreground text-background font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        {value ? `${label}: ${value}` : label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] max-h-[280px] overflow-y-auto rounded-lg border bg-background shadow-md animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Clear option */}
          {value && (
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className="flex w-full items-center px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Clear filter
            </button>
          )}
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              className={`flex w-full items-center px-3 py-2 text-sm transition-colors ${
                value === opt
                  ? "bg-muted font-medium text-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Years actually in the corpus: bioRxiv opened 2013-11, medRxiv 2019-06 (LANE-RXIV-MAP.md §4).
// The NSR-era list started at 2000 and offered thirteen dead years.
const CORPUS_FIRST_YEAR = 2013;
const YEAR_OPTIONS = Array.from(
  { length: new Date().getFullYear() - CORPUS_FIRST_YEAR + 1 },
  (_, i) => String(new Date().getFullYear() - i),
);

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

/** With `server`, this page is an archive's Papers view (/medrxiv/papers,
 *  browse, search, and filters all confined to that archive. */
export default function References({ server }: { server?: "biorxiv" | "medrxiv" }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial state from URL params (from feed item clicks)
  const initialQ = searchParams.get("q") ?? "";
  const initialMode = (searchParams.get("mode") as SearchMode) || "hybrid";
  const initialCategory = searchParams.get("category") ?? "";
  const initialJournal = searchParams.get("journal") ?? "";
  const [query, setQuery] = useState(initialQ);
  const [yearFilter, setYearFilter] = useState<string | null>(null);
  const [authorsSortAsc, setAuthorsSortAsc] = useState<boolean | null>(null);
  const [keySortAsc, setKeySortAsc] = useState<boolean | null>(null);
  const [page, setPage] = useState(1);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialMode);

  // Structured search inputs
  // Record detail — the app-shell push panel (see components/AppPanel).
  const { openPanel } = useAppPanel();

  const [categoryInput, setCategoryInput] = useState(initialCategory);
  const [journalInput, setJournalInput] = useState(initialJournal);
  const [structuredParams, setStructuredParams] = useState<{
    categories?: string[];
    journals?: string[];
  } | null>(() => {
    // Initialize structured params from URL if present
    const categories = initialCategory ? [initialCategory] : [];
    const journals = initialJournal ? [initialJournal] : [];
    if (categories.length > 0 || journals.length > 0) {
      return {
        categories: categories.length > 0 ? categories : undefined,
        journals: journals.length > 0 ? journals : undefined,
      };
    }
    return null;
  });

  // React to URL param changes (from feed item clicks while already here)
  const paramKey = searchParams.toString();
  useEffect(() => {
    if (!paramKey) return;
    const q = searchParams.get("q") ?? "";
    const mode = (searchParams.get("mode") as SearchMode) || "hybrid";
    const category = searchParams.get("category") ?? "";
    const journal = searchParams.get("journal") ?? "";

    // Apply search params
    if (q) {
      setQuery(q);
      setSearchMode(mode);
      setCategoryInput("");
      setJournalInput("");
      setStructuredParams(null);
    } else {
      setQuery("");
      setCategoryInput(category);
      setJournalInput(journal);
      const categories = category ? [category] : [];
      const journals = journal ? [journal] : [];
      if (categories.length > 0 || journals.length > 0) {
        setStructuredParams({
          categories: categories.length > 0 ? categories : undefined,
          journals: journals.length > 0 ? journals : undefined,
        });
      }
    }
    setPage(1);

    // Clear URL params after applying
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const debouncedQuery = useDebouncedValue(query, 320);
  const search = useRecordSearch(debouncedQuery, searchMode, server);
  // A category arriving from a subject/agent card browses that subject —
  // paginated, with the real total. The structured path caps at 50 and would
  // show 50 of 397 with no way to reach the rest.
  const browse = useRecords({
    year: yearFilter ? Number(yearFilter) : undefined,
    page,
    pageSize: CARDS_PER_PAGE,
    server,
    category: categoryInput.trim() || undefined,
  });
  const structured = useStructuredSearch(
    structuredParams?.journals?.length ? { ...structuredParams, server } : null,
  );

  // Feed emitter
  const { emit } = useFeedEmitter();
  const prevSearchQueryRef = useRef<string>("");
  const prevStructuredRef = useRef<string>("");

  // Emit semantic/keyword search events
  useEffect(() => {
    if (!search.data || !debouncedQuery || debouncedQuery.length < 3) return;
    if (debouncedQuery === prevSearchQueryRef.current) return;
    prevSearchQueryRef.current = debouncedQuery;
    emit({
      event_type: searchMode === "keyword" ? "keyword_search" : "semantic_search",
      category: "search",
      entity_type: "query",
      entity_value: debouncedQuery,
      display_text: `Searched "${debouncedQuery}"`,
    });
  }, [search.data, debouncedQuery, searchMode, emit]);

  // Emit structured filter events
  useEffect(() => {
    if (!structured.data || !structuredParams) return;
    const key = JSON.stringify(structuredParams);
    if (key === prevStructuredRef.current) return;
    prevStructuredRef.current = key;

    if (structuredParams.categories?.length) {
      emit({
        event_type: "category_filter",
        category: "search",
        entity_type: "category",
        entity_value: structuredParams.categories.join(", "),
        display_text: `Filtered by category ${structuredParams.categories.join(", ")}`,
      });
    }
    if (structuredParams.journals?.length) {
      emit({
        event_type: "journal_filter",
        category: "search",
        entity_type: "journal",
        entity_value: structuredParams.journals.join(", "),
        display_text: `Filtered by journal ${structuredParams.journals.join(", ")}`,
      });
    }
  }, [structured.data, structuredParams, emit]);

  const clearStructuredSearch = () => {
    setStructuredParams(null);
    setCategoryInput("");
    setJournalInput("");
  };

  const handleStructuredSearch = (overrides?: { category?: string; journal?: string }) => {
    const cat = overrides?.category ?? categoryInput;
    const jrnl = overrides?.journal ?? journalInput;
    const categories = cat.trim() ? [cat.trim()] : [];
    const journals = jrnl.trim() ? [jrnl.trim()] : [];

    if (categories.length === 0 && journals.length === 0) {
      clearStructuredSearch();
      return;
    }

    // Clear text search when using structured search
    setQuery("");
    setPage(1);
    setStructuredParams({
      categories: categories.length > 0 ? categories : undefined,
      journals: journals.length > 0 ? journals : undefined,
    });
  };

  // Auto-clear structured search when all inputs are emptied
  const handleCategoryChange = (v: string) => {
    setCategoryInput(v);
    if (!v && !journalInput && structuredParams) {
      setStructuredParams(null);
    }
  };
  const handleJournalChange = (v: string) => {
    setJournalInput(v);
    if (!categoryInput && !v && structuredParams) {
      setStructuredParams(null);
    }
  };

  const isSearching = debouncedQuery.length >= 3;
  const isStructured = (structuredParams?.journals?.length ?? 0) > 0;

  // Determine which data source to show
  let rawRecords: CorpusRecord[] | null | undefined;
  let isLoading: boolean;
  let error: Error | null;
  let browseTotalCount = 0;

  if (isStructured) {
    rawRecords = structured.data;
    isLoading = structured.isLoading;
    error = structured.error;
  } else if (isSearching) {
    rawRecords = search.data?.records;
    isLoading = search.isLoading;
    error = search.error;
  } else {
    rawRecords = browse.data?.records;
    isLoading = browse.isLoading;
    error = browse.error;
    browseTotalCount = browse.data?.totalCount ?? 0;
  }

  // Apply sort
  const records = useMemo(() => {
    if (!rawRecords) return null;
    let filtered = rawRecords;

    if (authorsSortAsc !== null) {
      filtered = [...filtered].sort((a, b) => {
        const aa = a.authors ?? "";
        const ab = b.authors ?? "";
        return authorsSortAsc ? aa.localeCompare(ab) : ab.localeCompare(aa);
      });
    }

    if (keySortAsc !== null) {
      filtered = [...filtered].sort((a, b) => {
        return keySortAsc
          ? a.key_number.localeCompare(b.key_number)
          : b.key_number.localeCompare(a.key_number);
      });
    }

    return filtered;
  }, [rawRecords, authorsSortAsc, keySortAsc]);

  // Pagination — server-side for browse, client-side for search/structured
  const isBrowsing = !isSearching && !isStructured;
  const totalRecords = isBrowsing ? browseTotalCount : (records?.length ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalRecords / CARDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  // For search/structured, slice client-side. For browse, records are already paged from server.
  const pagedRecords = useMemo(() => {
    if (!records) return null;
    if (isBrowsing) return records;
    const start = (currentPage - 1) * CARDS_PER_PAGE;
    return records.slice(start, start + CARDS_PER_PAGE);
  }, [records, currentPage, isBrowsing]);

  const pagedRecordsRef = useRef<CorpusRecord[] | null>(null);
  pagedRecordsRef.current = pagedRecords;

  const [visibleCount, setVisibleCount] = useState(20);
  const [renderCompletedAt, setRenderCompletedAt] = useState<number | null>(null);
  const searchRequestStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (query.length >= 3) {
      searchRequestStartRef.current = performance.now();
    }
  }, [query, searchMode]);

  useEffect(() => {
    if (!pagedRecords || pagedRecords.length === 0) {
      setVisibleCount(20);
      return;
    }

    setVisibleCount(Math.min(20, pagedRecords.length));
    if (pagedRecords.length > 20) {
      const t = window.setTimeout(() => setVisibleCount(pagedRecords.length), 50);
      return () => window.clearTimeout(t);
    }
  }, [pagedRecords]);

  useEffect(() => {
    if (!search.data || !isSearching) return;

    requestAnimationFrame(() => {
      const renderEnd = performance.now();
      setRenderCompletedAt(renderEnd);
      const requestStart = searchRequestStartRef.current;
      console.table({
        query: debouncedQuery,
        mode: searchMode,
        request_to_render_ms: requestStart ? Number((renderEnd - requestStart).toFixed(1)) : undefined,
        result_count: search.data?.count ?? 0,
      });
    });
  }, [search.data, isSearching, debouncedQuery, searchMode]);

  // Reset page when data source changes
  useEffect(() => { setPage(1); }, [debouncedQuery, yearFilter, structuredParams]);

  // Opening a record pushes the panel; prev/next walk this page of results, and
  // a related-paper click swaps the panel to that paper without closing it.
  const showRecord = useCallback((index: number) => {
    const list = pagedRecordsRef.current ?? [];
    const rec = list[index];
    if (!rec) return;
    openPanel({
      title: rec.title,
      content: (
        <RecordPanel
          record={rec}
          onOpenRelated={(key) => {
            const i = (pagedRecordsRef.current ?? []).findIndex((r) => r.key_number === key);
            if (i >= 0) showRecord(i);
          }}
        />
      ),
      onPrev: index > 0 ? () => showRecord(index - 1) : undefined,
      onNext: index < list.length - 1 ? () => showRecord(index + 1) : undefined,
    });
  }, [openPanel]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const goToPage = (p: number) => {
    setPage(p);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Portal search bar into header */}
      {document.getElementById("header-search") &&
        createPortal(
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              if (v.length >= 3) clearStructuredSearch();
            }}
            isLoading={search.isFetching}
          />,
          document.getElementById("header-search")!
        )}

      {/* Desktop sticky filter bar — hidden on mobile */}
      <div className="hidden md:block sticky top-0 z-10 bg-background px-6 pt-3 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Page scope. sam has one archive and one section, so this is a
              label rather than a switcher. */}
          {server && (
            <span className="px-1.5 py-1 -mx-1.5 text-sm font-medium text-foreground">
              {ARCHIVE_LABEL[server]} papers
            </span>
          )}

          {/* Authors sort toggle */}
          <button
            onClick={() => {
              setAuthorsSortAsc((prev) =>
                prev === null ? true : prev ? false : null
              );
              setKeySortAsc(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              authorsSortAsc !== null
                ? "bg-foreground text-background font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Authors
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>

          {/* Key # sort toggle */}
          <button
            onClick={() => {
              setKeySortAsc((prev) =>
                prev === null ? true : prev ? false : null
              );
              setAuthorsSortAsc(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              keySortAsc !== null
                ? "bg-foreground text-background font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Key #
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>

          <FilterDropdown
            label="Year"
            options={YEAR_OPTIONS}
            value={yearFilter}
            onChange={setYearFilter}
          />

          {/* Nuclide filter */}
          <DictCombobox
            label="Category"
            dictType="categories"
            placeholder="e.g. neuroscience"
            value={categoryInput}
            onChange={handleCategoryChange}
            onSubmit={(v) => handleStructuredSearch({ category: v })}
            server={server}
          />

          {/* Reaction filter */}
          <DictCombobox
            label="Journal"
            dictType="journals"
            placeholder="e.g. eLife"
            value={journalInput}
            onChange={handleJournalChange}
            onSubmit={(v) => handleStructuredSearch({ journal: v })}
          />

          {/* Search mode toggle + pagination (far right) */}
          {totalPages > 0 && (
            <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {/* Search mode toggle */}
              <div className="inline-flex items-center rounded border text-xs text-muted-foreground overflow-hidden">
                {(["hybrid", "semantic", "keyword"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSearchMode(mode)}
                    className={`px-2 py-0.5 transition-colors ${
                      searchMode === mode
                        ? "bg-muted font-medium text-foreground"
                        : "hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>

              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="inline-flex items-center justify-center h-6 w-6 rounded border hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>Page</span>
              <input
                type="text"
                value={currentPage}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val >= 1 && val <= totalPages) goToPage(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = Number((e.target as HTMLInputElement).value);
                    if (val >= 1 && val <= totalPages) goToPage(val);
                  }
                }}
                className="h-6 w-10 rounded border bg-transparent text-center text-xs text-foreground outline-none focus:ring-1 focus:ring-foreground/20"
              />
              <span>of {totalPages}</span>
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center justify-center h-6 w-6 rounded border hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile toolbar — search mode toggle (left) + pagination (right) */}
      <div className="md:hidden sticky top-0 z-10 bg-background px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {/* Search mode toggle */}
          <div className="inline-flex items-center rounded border text-xs text-muted-foreground overflow-hidden">
            {(["hybrid", "semantic", "keyword"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSearchMode(mode)}
                className={`px-2 py-0.5 transition-colors ${
                  searchMode === mode
                    ? "bg-muted font-medium text-foreground"
                    : "hover:bg-muted hover:text-foreground"
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 0 && (
            <div className="ml-auto inline-flex items-center gap-1.5">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="inline-flex items-center justify-center h-6 w-6 rounded border hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>Page</span>
              <input
                type="text"
                value={currentPage}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val >= 1 && val <= totalPages) goToPage(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = Number((e.target as HTMLInputElement).value);
                    if (val >= 1 && val <= totalPages) goToPage(val);
                  }
                }}
                className="h-6 w-10 rounded border bg-transparent text-center text-xs text-foreground outline-none focus:ring-1 focus:ring-foreground/20"
              />
              <span>of {totalPages}</span>
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center justify-center h-6 w-6 rounded border hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* FAB → Popover with filter controls (mobile only) */}
      <MobileFilterDrawer>
        <button
          onClick={() => {
            setAuthorsSortAsc((prev) =>
              prev === null ? true : prev ? false : null
            );
            setKeySortAsc(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            authorsSortAsc !== null
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Authors
          <ArrowUpDown className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => {
            setKeySortAsc((prev) =>
              prev === null ? true : prev ? false : null
            );
            setAuthorsSortAsc(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            keySortAsc !== null
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Key #
          <ArrowUpDown className="h-3.5 w-3.5" />
        </button>

        <FilterDropdown
          label="Year"
          options={YEAR_OPTIONS}
          value={yearFilter}
          onChange={setYearFilter}
        />

        <DictCombobox
            label="Category"
            dictType="categories"
            placeholder="e.g. neuroscience"
            value={categoryInput}
            onChange={handleCategoryChange}
            onSubmit={(v) => handleStructuredSearch({ category: v })}
            server={server}
          />

        <DictCombobox
            label="Journal"
            dictType="journals"
            placeholder="e.g. eLife"
            value={journalInput}
            onChange={handleJournalChange}
            onSubmit={(v) => handleStructuredSearch({ journal: v })}
          />
      </MobileFilterDrawer>

      {/* Scrollable content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-4">
        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mb-6">
            {error.message}
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-muted/40 p-6 min-h-[280px] space-y-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-12 ml-auto" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <div className="space-y-2 pt-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Results grid */}
        {pagedRecords && pagedRecords.length > 0 && (
          <>
            <div className="mb-2 text-xs text-muted-foreground">
              Showing {Math.min(visibleCount, pagedRecords.length)} of {pagedRecords.length} results
              {renderCompletedAt ? ` • Render @ ${Math.round(renderCompletedAt)}ms` : ""}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pagedRecords.slice(0, visibleCount).map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                searchQuery={isSearching ? debouncedQuery : undefined}
                searchMode={searchMode}
                onClick={() => showRecord(pagedRecords?.indexOf(record) ?? 0)}
              />
            ))}
          </div>
          </>
        )}


        {/* Empty state */}
        {records && records.length === 0 && (isSearching || isStructured || yearFilter) && (
          <p className="text-center text-muted-foreground py-12">
            No matching records found. Try a different query or clear filters.
          </p>
        )}
      </div>

    </div>
  );
}
