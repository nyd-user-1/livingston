import { useState, useRef, useEffect } from "react";
import {
  Plus, ChevronRight, ArrowLeft,
  Lightbulb, HandCoins, HeartHandshake, BadgeCheck, X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Prompts                                                            */
/*                                                                     */
/*  Four lists, all static: questions people actually bring to a       */
/*  benefits office. The preprint lists this menu used to hold         */
/*  (categories, journals, authors) went with the corpus.              */
/* ------------------------------------------------------------------ */

interface Prompt {
  title: string;
  description: string;
  prompt: string;
}

const SAMPLE_QUESTIONS: Prompt[] = [
  {
    title: "What can I apply for?",
    description: "Which programs fit your household",
    prompt: "What can I apply for? Ask me what you need to know about my household and tell me which programs fit.",
  },
  {
    title: "What do I need before I start?",
    description: "Papers to have on hand",
    prompt: "What documents and information should I have on hand before I fill out a New York benefits application?",
  },
  {
    title: "How long does LDSS-2921 take?",
    description: "What the form asks, section by section",
    prompt: "How long does the LDSS-2921 application take, and what does it ask for section by section?",
  },
  {
    title: "Can I apply for SNAP by itself?",
    description: "Without cash assistance or Medicaid",
    prompt: "Can I apply for SNAP by itself, without Public Assistance or Medicaid?",
  },
  {
    title: "What happens after I send it?",
    description: "Interviews, notices, and timelines",
    prompt: "After I send a benefits application to my county, what happens next — interviews, notices, and how long it takes?",
  },
  {
    title: "I already applied. How do I check on it?",
    description: "Following up with the county",
    prompt: "I already sent an application to my county. How do I check on it, and who do I call?",
  },
];

const GRANTS: Prompt[] = [
  {
    title: "Is HEAP open right now?",
    description: "Heating help and when it opens",
    prompt: "Is HEAP open right now, and how do I apply for help with my heating bill?",
  },
  {
    title: "Help with a shut-off notice",
    description: "Emergency HEAP and utility help",
    prompt: "I have a utility shut-off notice. What emergency help is there and how fast can I get it?",
  },
  {
    title: "Does Weatherization cover renters?",
    description: "Insulation and heating repairs",
    prompt: "Does the Weatherization Assistance Program cover renters, and what work does it pay for?",
  },
  {
    title: "What does the Earned Income Tax Credit pay?",
    description: "Federal, state and city credits",
    prompt: "What does the Earned Income Tax Credit pay, and how do I claim the federal, New York State and city credits?",
  },
  {
    title: "Head Start — how do I apply?",
    description: "Free preschool under five",
    prompt: "How do I apply for Head Start or Early Head Start, and who qualifies?",
  },
  {
    title: "Money back after a crime",
    description: "Office of Victim Services compensation",
    prompt: "What costs does the Office of Victim Services pay back, and how do I apply?",
  },
];

const BENEFITS: Prompt[] = [
  {
    title: "What does Public Assistance cover?",
    description: "Cash help and what comes with it",
    prompt: "What does Public Assistance in New York cover, and what comes with it?",
  },
  {
    title: "SNAP or WIC — which one is for me?",
    description: "Food help, and who each is for",
    prompt: "What is the difference between SNAP and WIC, and which one is for my situation?",
  },
  {
    title: "What is Child Care Assistance?",
    description: "Help paying for care while you work or study",
    prompt: "What is Child Care Assistance, who qualifies, and what does it pay for?",
  },
  {
    title: "What is the Medicare Savings Program?",
    description: "The state pays your Part B premium",
    prompt: "What is the Medicare Savings Program, and what does it pay for?",
  },
  {
    title: "What is Emergency Assistance?",
    description: "One-time help in a crisis",
    prompt: "What is Emergency Assistance in New York, and what kinds of emergencies does it cover?",
  },
  {
    title: "SSI and the state supplement",
    description: "Monthly cash if you are 65+, blind or disabled",
    prompt: "How do SSI and the New York State Supplement work together, and how do I apply?",
  },
];

const ELIGIBILITY: Prompt[] = [
  {
    title: "Who counts as my household?",
    description: "Who goes on the application",
    prompt: "Who counts as part of my household on a New York benefits application, and who does not?",
  },
  {
    title: "How is my income counted?",
    description: "What counts, and what is left out",
    prompt: "How is income counted for SNAP and Public Assistance in New York — what counts, and what is left out?",
  },
  {
    title: "Does owning a car affect SNAP?",
    description: "Vehicles, savings and other resources",
    prompt: "Does owning a car or having savings affect whether I can get SNAP in New York?",
  },
  {
    title: "I am not a citizen. Can I apply?",
    description: "Immigration status and each program",
    prompt: "I am not a U.S. citizen. Which New York benefits can I apply for, and does applying affect my status?",
  },
  {
    title: "Can I apply with no address?",
    description: "Applying while homeless or staying with someone",
    prompt: "Can I apply for benefits if I have no fixed address or am staying with a relative?",
  },
  {
    title: "Who decides if I qualify?",
    description: "The county district, and your right to apply",
    prompt: "Who decides whether I qualify for benefits, and can I apply even if a screener says I do not?",
  },
];

/* ------------------------------------------------------------------ */
/*  + menu                                                             */
/* ------------------------------------------------------------------ */

type DrawerKey = "prompts" | "grants" | "benefits" | "eligibility";

interface CategoryDef {
  key: DrawerKey;
  label: string;
  icon: React.ReactNode;
  items: Prompt[];
}

const CATEGORIES: CategoryDef[] = [
  { key: "prompts", label: "Sample Questions", icon: <Lightbulb className="h-5 w-5" />, items: SAMPLE_QUESTIONS },
  { key: "grants", label: "Grants", icon: <HandCoins className="h-5 w-5" />, items: GRANTS },
  { key: "benefits", label: "Benefits", icon: <HeartHandshake className="h-5 w-5" />, items: BENEFITS },
  { key: "eligibility", label: "Eligibility", icon: <BadgeCheck className="h-5 w-5" />, items: ELIGIBILITY },
];

interface PlusMenuProps {
  onSelect: (text: string) => void;
  /** Kept for callers that still pass it; every list is a question either way. */
  mode?: "chat" | "search";
}

export function PlusMenu({ onSelect }: PlusMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [openAbove, setOpenAbove] = useState(true);
  const [search, setSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // ---- close menu on outside click ----
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setDrawer(null);
        setSearch("");
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    setDrawer(null);
    setSearch("");
  };

  const current = CATEGORIES.find((c) => c.key === drawer);
  const needle = search.trim().toLowerCase();
  const shown = (current?.items ?? []).filter(
    (p) => !needle || p.title.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle),
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
            setDrawer(null);
            setSearch("");
          }
        }}
        className="h-9 w-9 rounded-lg flex items-center justify-center transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-5 w-5" />
      </button>

      {menuOpen && !drawer && (
        /* -------- Category list -------- */
        <div className={`absolute left-0 w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] md:w-56 rounded-2xl border border-border/60 bg-popover shadow-popover animate-in fade-in duration-150 overflow-hidden ${
          openAbove ? "bottom-full mb-2 slide-in-from-bottom-2" : "top-full mt-2 slide-in-from-top-2"
        }`}>
          <div className="py-1">
            {CATEGORIES.map((cat, i) => (
              <button
                key={cat.key}
                onClick={() => { setDrawer(cat.key); setSearch(""); }}
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

      {menuOpen && current && (
        /* -------- Drawer -------- */
        <div className={`absolute left-0 w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] md:w-80 rounded-2xl border border-border/60 bg-popover shadow-popover animate-in fade-in duration-150 overflow-hidden ${
          openAbove ? "bottom-full mb-2 slide-in-from-bottom-2" : "top-full mt-2 slide-in-from-top-2"
        }`}>
          {/* Header: back + search + clear */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
            <button
              onClick={() => { setDrawer(null); setSearch(""); }}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${current.label}…`}
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/50"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {shown.map((p, i) => (
              <button
                key={p.title}
                onClick={() => { onSelect(p.prompt); closeMenu(); }}
                className={`flex w-full flex-col items-start px-4 py-3 hover:bg-muted transition-colors ${
                  i > 0 ? "border-t border-border/40" : ""
                }`}
              >
                <span className="text-sm font-semibold text-foreground">{p.title}</span>
                <span className="text-xs text-muted-foreground line-clamp-2 text-left">{p.description}</span>
              </button>
            ))}
            {shown.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
