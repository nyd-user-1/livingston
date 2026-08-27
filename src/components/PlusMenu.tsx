import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus, ChevronRight, ArrowLeft,
  Lightbulb, Atom, Zap, Users, X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Sample prompts                                                      */
/* ------------------------------------------------------------------ */

interface SamplePrompt {
  title: string;
  description: string;
  prompt: string;
  searchTerm: string;
}

const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    title: "CRISPR Base Editing Off-Targets",
    description: "Off-target effects reported in primary human cells",
    prompt: "What off-target effects of CRISPR base editing have been reported in primary human cells?",
    searchTerm: "CRISPR base editing off-target",
  },
  {
    title: "Long COVID Cognitive Impairment",
    description: "Evidence across recent preprints",
    prompt: "What evidence do recent preprints report on cognitive impairment in long COVID?",
    searchTerm: "long COVID cognitive impairment",
  },
  {
    title: "Ferroptosis in Cancer",
    description: "Mechanisms and therapeutic angles",
    prompt: "What mechanisms and therapeutic strategies involving ferroptosis in cancer appear in recent preprints?",
    searchTerm: "ferroptosis cancer therapy",
  },
  {
    title: "AlphaFold in Practice",
    description: "How predicted structures are being used",
    prompt: "How are AlphaFold-predicted structures being used in recent structural biology and drug discovery preprints?",
    searchTerm: "AlphaFold structure prediction application",
  },
  {
    title: "Single-Cell Atlases",
    description: "New tissue atlases and methods",
    prompt: "What new single-cell RNA-seq tissue atlases have been posted recently, and what methods do they use?",
    searchTerm: "single-cell RNA-seq atlas",
  },
  {
    title: "Gut Microbiome & Neurodegeneration",
    description: "The gut–brain axis in disease models",
    prompt: "What do recent preprints say about the gut microbiome's role in neurodegenerative disease?",
    searchTerm: "gut microbiome neurodegeneration",
  },
  {
    title: "Organoid Disease Models",
    description: "Leading groups and protocols",
    prompt: "Which groups have posted preprints on organoid models of human disease, and what protocols do they describe?",
    searchTerm: "organoid disease model",
  },
  {
    title: "mRNA Vaccine Platforms",
    description: "Beyond COVID: new targets and delivery",
    prompt: "What new applications of mRNA vaccine platforms beyond COVID-19 appear in recent preprints?",
    searchTerm: "mRNA vaccine platform delivery",
  },
  {
    title: "Spatial Transcriptomics Methods",
    description: "Method comparisons and benchmarks",
    prompt: "How do recent preprints compare spatial transcriptomics methods, and what benchmarks do they use?",
    searchTerm: "spatial transcriptomics benchmark",
  },
  {
    title: "Aging Clocks",
    description: "Epigenetic clocks and biological age",
    prompt: "What do recent preprints report about epigenetic aging clocks and interventions that shift biological age?",
    searchTerm: "epigenetic clock biological age",
  },
];

/* ------------------------------------------------------------------ */
/*  + menu category types                                              */
/* ------------------------------------------------------------------ */

type DrawerCategory = "prompts" | "categories" | "journals" | "authors";

interface CategoryDef {
  key: DrawerCategory;
  label: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryDef[] = [
  { key: "prompts", label: "Sample Questions", icon: <Lightbulb className="h-5 w-5" /> },
  { key: "categories", label: "Categories", icon: <Atom className="h-5 w-5" /> },
  { key: "journals", label: "Journals", icon: <Zap className="h-5 w-5" /> },
  { key: "authors", label: "Authors", icon: <Users className="h-5 w-5" /> },
];

/* ------------------------------------------------------------------ */
/*  DB item shape                                                      */
/* ------------------------------------------------------------------ */

interface DbItem {
  value: string;
  record_count: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 30;
const SCROLL_THRESHOLD = 60;
const SEARCH_DEBOUNCE = 300;
const MIN_SEARCH_LEN = 2;

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PlusMenuProps {
  onSelect: (text: string) => void;
  mode: "chat" | "search";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PlusMenu({ onSelect, mode }: PlusMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] = useState<DrawerCategory | null>(null);
  const [openAbove, setOpenAbove] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Per-category DB items
  const [availableCategories, setAvailableCategories] = useState<DbItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesHasMore, setCategoriesHasMore] = useState(true);

  const [availableJournals, setAvailableJournals] = useState<DbItem[]>([]);
  const [journalsLoading, setJournalsLoading] = useState(false);
  const [journalsHasMore, setJournalsHasMore] = useState(true);

  const [availableAuthors, setAvailableAuthors] = useState<DbItem[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [authorsHasMore, setAuthorsHasMore] = useState(true);

  // Drawer search
  const [drawerSearch, setDrawerSearch] = useState("");
  const [drawerSearchResults, setDrawerSearchResults] = useState<DbItem[] | null>(null);
  const [drawerSearchLoading, setDrawerSearchLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- close menu on outside click ----
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // ---- fetch functions (Neon via /api/dict; the whole list is one cached call,
  //      paged client-side to keep the popover's infinite scroll) ----
  const dictCache = useRef<Record<string, DbItem[]>>({});
  const loadDict = useCallback(async (type: "categories" | "journals" | "authors"): Promise<DbItem[]> => {
    if (dictCache.current[type]) return dictCache.current[type];
    const res = await fetch(`/api/dict?type=${type}&limit=20000`);
    const rows = res.ok ? ((await res.json()) as DbItem[]) : [];
    rows.sort((a, b) => a.value.localeCompare(b.value));
    dictCache.current[type] = rows;
    return rows;
  }, []);

  const fetchCategoriesForSelection = useCallback(async (offset: number) => {
    setCategoriesLoading(true);
    const all = await loadDict("categories");
    const rows = all.slice(offset, offset + PAGE_SIZE);
    setAvailableCategories((prev) => (offset === 0 ? rows : [...prev, ...rows]));
    setCategoriesHasMore(offset + PAGE_SIZE < all.length);
    setCategoriesLoading(false);
  }, [loadDict]);

  const fetchJournalsForSelection = useCallback(async (offset: number) => {
    setJournalsLoading(true);
    const all = await loadDict("journals");
    const rows = all.slice(offset, offset + PAGE_SIZE);
    setAvailableJournals((prev) => (offset === 0 ? rows : [...prev, ...rows]));
    setJournalsHasMore(offset + PAGE_SIZE < all.length);
    setJournalsLoading(false);
  }, [loadDict]);

  const fetchAuthorsForSelection = useCallback(async (offset: number) => {
    setAuthorsLoading(true);
    const all = await loadDict("authors");
    const rows = all.slice(offset, offset + PAGE_SIZE);
    setAvailableAuthors((prev) => (offset === 0 ? rows : [...prev, ...rows]));
    setAuthorsHasMore(offset + PAGE_SIZE < all.length);
    setAuthorsLoading(false);
  }, [loadDict]);

  // ---- open a drawer category ----
  const openDrawer = useCallback(
    (cat: DrawerCategory) => {
      setDrawerCategory(cat);
      setDrawerSearch("");
      setDrawerSearchResults(null);
      if (cat === "categories" && availableCategories.length === 0) fetchCategoriesForSelection(0);
      if (cat === "journals" && availableJournals.length === 0) fetchJournalsForSelection(0);
      if (cat === "authors" && availableAuthors.length === 0) fetchAuthorsForSelection(0);
    },
    [availableCategories.length, availableJournals.length, availableAuthors.length,
     fetchCategoriesForSelection, fetchJournalsForSelection, fetchAuthorsForSelection],
  );

  // ---- server-side search with debounce ----
  useEffect(() => {
    if (!drawerCategory || drawerCategory === "prompts") return;
    if (drawerSearch.length < MIN_SEARCH_LEN) {
      setDrawerSearchResults(null);
      return;
    }

    setDrawerSearchLoading(true);
    const timer = setTimeout(async () => {
      const all = await loadDict(drawerCategory === "categories" ? "categories" : drawerCategory === "journals" ? "journals" : "authors");
      const needle = drawerSearch.toLowerCase();
      setDrawerSearchResults(all.filter((r) => r.value.toLowerCase().includes(needle)).slice(0, PAGE_SIZE));
      setDrawerSearchLoading(false);
    }, SEARCH_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [drawerSearch, drawerCategory]);

  // ---- infinite scroll ----
  const handlePopoverScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !drawerCategory || drawerCategory === "prompts") return;
    if (drawerSearch.length >= MIN_SEARCH_LEN) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    if (!nearBottom) return;

    if (drawerCategory === "categories" && !categoriesLoading && categoriesHasMore) {
      fetchCategoriesForSelection(availableCategories.length);
    } else if (drawerCategory === "journals" && !journalsLoading && journalsHasMore) {
      fetchJournalsForSelection(availableJournals.length);
    } else if (drawerCategory === "authors" && !authorsLoading && authorsHasMore) {
      fetchAuthorsForSelection(availableAuthors.length);
    }
  }, [
    drawerCategory, drawerSearch,
    categoriesLoading, categoriesHasMore, availableCategories.length,
    journalsLoading, journalsHasMore, availableJournals.length,
    authorsLoading, authorsHasMore, availableAuthors.length,
    fetchCategoriesForSelection, fetchJournalsForSelection, fetchAuthorsForSelection,
  ]);

  // ---- helpers ----
  const closeMenu = () => {
    setMenuOpen(false);
    setDrawerCategory(null);
    setDrawerSearch("");
    setDrawerSearchResults(null);
  };

  const handleItemSelect = (text: string) => {
    onSelect(text);
    closeMenu();
  };

  // ---- what to render in the drawer ----
  const getDrawerItems = (): DbItem[] => {
    if (drawerSearchResults !== null) return drawerSearchResults;
    if (drawerCategory === "categories") return availableCategories;
    if (drawerCategory === "journals") return availableJournals;
    if (drawerCategory === "authors") return availableAuthors;
    return [];
  };

  const isDrawerLoading = () => {
    if (drawerSearchLoading) return true;
    if (drawerCategory === "categories") return categoriesLoading;
    if (drawerCategory === "journals") return journalsLoading;
    if (drawerCategory === "authors") return authorsLoading;
    return false;
  };

  const handleDbItemClick = (item: DbItem) => {
    if (mode === "search") {
      handleItemSelect(item.value);
      return;
    }

    let prompt = "";
    if (drawerCategory === "categories") {
      prompt = `What notable preprints are in the ${item.value} category? Summarize their key findings and significance.`;
    } else if (drawerCategory === "journals") {
      prompt = `What preprints in the corpus were later published in ${item.value}? Summarize their key findings.`;
    } else if (drawerCategory === "authors") {
      prompt = `What preprints by ${item.value} are in the corpus? Summarize their research contributions and key findings.`;
    }
    handleItemSelect(prompt);
  };

  const handleSamplePromptClick = (p: SamplePrompt) => {
    handleItemSelect(mode === "search" ? p.searchTerm : p.prompt);
  };

  // client-side filtered sample prompts
  const filteredPrompts = SAMPLE_PROMPTS.filter(
    (p) =>
      !drawerSearch ||
      p.title.toLowerCase().includes(drawerSearch.toLowerCase()) ||
      p.description.toLowerCase().includes(drawerSearch.toLowerCase()),
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (menuOpen) {
            closeMenu();
          } else {
            if (btnRef.current) {
              const rect = btnRef.current.getBoundingClientRect();
              setOpenAbove(rect.top > 300);
            }
            setMenuOpen(true);
            setDrawerCategory(null);
            setDrawerSearch("");
            setDrawerSearchResults(null);
          }
        }}
        className="h-9 w-9 rounded-lg flex items-center justify-center transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-5 w-5" />
      </button>

      {menuOpen && !drawerCategory && (
        /* -------- Category list -------- */
        <div className={`absolute left-0 w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] md:w-56 rounded-2xl border border-border/60 bg-background shadow-xl animate-in fade-in duration-150 overflow-hidden ${
          openAbove ? "bottom-full mb-2 slide-in-from-bottom-2" : "top-full mt-2 slide-in-from-top-2"
        }`}>
          <div className="py-1">
            {CATEGORIES.map((cat, i) => (
              <button
                key={cat.key}
                onClick={() => openDrawer(cat.key)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-muted transition-colors ${
                  i > 0 ? "border-t border-border/40" : ""
                }`}
              >
                <span className="text-muted-foreground">{cat.icon}</span>
                {cat.label}
                <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}

      {menuOpen && drawerCategory && (
        /* -------- Drawer -------- */
        <div className={`absolute left-0 w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] md:w-80 rounded-2xl border border-border/60 bg-background shadow-xl animate-in fade-in duration-150 overflow-hidden ${
          openAbove ? "bottom-full mb-2 slide-in-from-bottom-2" : "top-full mt-2 slide-in-from-top-2"
        }`}>
          {/* Header: back + search + clear */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
            <button
              onClick={() => {
                setDrawerCategory(null);
                setDrawerSearch("");
                setDrawerSearchResults(null);
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={drawerSearch}
              onChange={(e) => setDrawerSearch(e.target.value)}
              placeholder={`Search ${CATEGORIES.find((c) => c.key === drawerCategory)?.label ?? ""}...`}
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/50"
            />
            {drawerSearch && (
              <button
                onClick={() => {
                  setDrawerSearch("");
                  setDrawerSearchResults(null);
                }}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Scrollable list */}
          <div
            ref={scrollRef}
            onScroll={handlePopoverScroll}
            className="max-h-[320px] overflow-y-auto"
          >
            {drawerCategory === "prompts" ? (
              /* Sample Questions — client-side */
              <>
                {filteredPrompts.map((p, i) => (
                  <button
                    key={p.title}
                    onClick={() => handleSamplePromptClick(p)}
                    className={`flex w-full flex-col items-start px-4 py-3 hover:bg-muted transition-colors ${
                      i > 0 ? "border-t border-border/40" : ""
                    }`}
                  >
                    <span className="text-sm font-semibold text-foreground">
                      {p.title}
                    </span>
                    <span className="text-xs text-muted-foreground line-clamp-2 text-left">
                      {p.description}
                    </span>
                  </button>
                ))}
                {filteredPrompts.length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted-foreground">No matches</p>
                )}
              </>
            ) : (
              /* DB-backed category (categories / journals / authors) */
              <>
                {getDrawerItems().map((item, i) => (
                  <button
                    key={item.value}
                    onClick={() => handleDbItemClick(item)}
                    className={`flex w-full flex-col items-start px-4 py-3 hover:bg-muted transition-colors ${
                      i > 0 ? "border-t border-border/40" : ""
                    }`}
                  >
                    <span className="text-sm font-semibold text-foreground">
                      {item.value}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.record_count.toLocaleString()} record{item.record_count !== 1 ? "s" : ""}
                    </span>
                  </button>
                ))}
                {isDrawerLoading() && (
                  <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>
                )}
                {!isDrawerLoading() && getDrawerItems().length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted-foreground">No matches</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
