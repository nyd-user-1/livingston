import { useState, useRef, useEffect } from "react";
import { ArrowUp, ChevronDown, X, Loader2, Search } from "lucide-react";
import type { SearchMode } from "@/hooks/useRecordSearch";
import { PlusMenu } from "@/components/PlusMenu";

/* ------------------------------------------------------------------ */
/*  Simple SearchInput (used by Home, Endf, References)                 */
/* ------------------------------------------------------------------ */

interface SimpleSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function SearchInput({ value, onChange, isLoading, placeholder = "Search preprints..." }: SimpleSearchInputProps) {
  return (
    <div className="relative w-full">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 md:h-9 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-base md:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {isLoading && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode options                                                        */
/* ------------------------------------------------------------------ */

interface ModeOption {
  value: SearchMode;
  label: string;
  badge?: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "hybrid", label: "Hybrid" },
  { value: "semantic", label: "Semantic", badge: "beta" },
  { value: "keyword", label: "Keyword" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  isLoading?: boolean;
}

export function SearchBox({
  value,
  onChange,
  onSubmit,
  mode,
  onModeChange,
  isLoading,
}: SearchBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [bannerVisible, setBannerVisible] = useState(true);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modeMenuAbove, setModeMenuAbove] = useState(true);
  const modeRef = useRef<HTMLDivElement>(null);
  const modeBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const maxHeight = 144;
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, maxHeight) + "px";
      textareaRef.current.style.overflowY =
        textareaRef.current.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }, [value]);

  // Close mode menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    }
    if (modeMenuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modeMenuOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const selectedMode = MODE_OPTIONS.find((m) => m.value === mode)!;

  return (
    <div className="w-full">
      {/* Search-mode banner — appended to the top of the input container; ✕ dismisses it */}
      {bannerVisible && (
        <div className="-mb-2 flex items-center gap-1.5 rounded-t-2xl border border-b-0 border-border bg-muted/60 px-4 pb-4 pt-2 text-[11px] text-muted-foreground">
          <Search className="h-3 w-3 shrink-0" />
          <span className="uppercase tracking-wide">Search Mode</span>
          <button
            type="button"
            onClick={() => setBannerVisible(false)}
            className="ml-auto shrink-0 rounded hover:text-foreground"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="relative rounded-2xl bg-secondary border border-border p-3 shadow-lg">
        {/* Textarea with clear button */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search the bioRxiv & medRxiv preprint corpus..."
            rows={1}
            className="min-h-[40px] w-full resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 pr-8 placeholder:text-muted-foreground/60 text-base text-foreground outline-none"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                textareaRef.current?.focus();
              }}
              className="absolute right-0 top-1 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between pt-1">
          {/* + menu for quick insertion */}
          <PlusMenu mode="search" onSelect={(text) => { onChange(text); }} />

          <div className="flex items-center gap-2">
            {/* Mode selector */}
            <div className="relative" ref={modeRef}>
              <button
                ref={modeBtnRef}
                type="button"
                onClick={() => {
                  if (!modeMenuOpen && modeBtnRef.current) {
                    const rect = modeBtnRef.current.getBoundingClientRect();
                    setModeMenuAbove(rect.top > 200);
                  }
                  setModeMenuOpen(!modeMenuOpen);
                }}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors rounded-lg px-2 py-1"
              >
                <span className="font-medium">{selectedMode.label}</span>
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${modeMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {modeMenuOpen && (
                <div className={`absolute right-0 w-[calc(100vw-2rem)] md:w-[260px] rounded-xl border bg-background shadow-xl animate-in fade-in duration-150 overflow-hidden py-1 ${
                  modeMenuAbove ? "bottom-full mb-2 slide-in-from-bottom-2" : "top-full mt-2 slide-in-from-top-2"
                }`}>
                  {MODE_OPTIONS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => {
                        onModeChange(m.value);
                        setModeMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
                    >
                      <div className="flex-1 text-left">
                        <span className="font-medium text-foreground">
                          {m.label}
                          {m.badge && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {m.badge}
                            </span>
                          )}
                        </span>
                      </div>
                      {m.value === mode && (
                        <svg
                          className="h-4 w-4 shrink-0 text-foreground"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Submit button */}
            <button
              type="button"
              onClick={onSubmit}
              disabled={isLoading || !value.trim()}
              className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                isLoading
                  ? "bg-muted text-muted-foreground"
                  : "bg-foreground hover:bg-foreground/85 text-background"
              }`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
