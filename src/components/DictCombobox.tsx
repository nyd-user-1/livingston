import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

/**
 * One typeahead over any /api/dict vocabulary. Replaces the NSR-era
 * NuclideCombobox/ReactionCombobox pair: this corpus filters on subject category
 * (76 values) and publishing journal (thousands), so the two filters differ only
 * by which dictionary they read. Markup and classes are unchanged from the
 * originals, so the filter bar keeps its exact layout.
 */
interface DictComboboxProps {
  label: string;
  dictType: "categories" | "journals" | "institutions" | "authors";
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value?: string) => void;
  /** Confine the vocabulary to one archive (per-server categories/counts). */
  server?: "biorxiv" | "medrxiv";
}

async function fetchDict(type: string, server?: string): Promise<string[]> {
  const res = await fetch(`/api/dict?type=${type}&limit=20000${server ? `&server=${server}` : ""}`);
  if (!res.ok) throw new Error(`dict ${type} ${res.status}`);
  const rows = (await res.json()) as { value: string }[];
  return rows.map((r) => r.value).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function DictCombobox({ label, dictType, placeholder, value, onChange, onSubmit, server }: DictComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: options = [] } = useQuery({
    queryKey: ["dict", dictType, server ?? "all"],
    queryFn: () => fetchDict(dictType, server),
    staleTime: 1000 * 60 * 30,
  });

  const filtered = useMemo(() => {
    const q = inputValue.toLowerCase().trim();
    if (!q) return options.slice(0, 500);
    return options.filter((o) => o.toLowerCase().includes(q)).slice(0, 500);
  }, [options, inputValue]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!value) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") { onChange(""); setInputValue(""); }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [value, onChange]);

  // Sync when the parent changes `value` (URL params, clear-all). React's
  // adjust-state-during-render pattern, not an effect.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setInputValue(value || "");
  }

  const select = (v: string) => {
    onChange(v); setInputValue(v); setOpen(false); onSubmit(v);
  };
  const clearSelection = () => { onChange(""); setInputValue(""); inputRef.current?.focus(); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const exact = options.find((o) => o.toLowerCase() === inputValue.toLowerCase().trim());
      if (exact) select(exact);
      else { setOpen(false); onSubmit(inputValue); }
    }
    if (e.key === "Escape") { if (open) setOpen(false); else clearSelection(); }
  };

  return (
    <div className="relative" ref={ref}>
      <div className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>

        {value && !open ? (
          <button
            onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground max-w-[160px] truncate"
          >
            {value}
          </button>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setOpen(true); onChange(e.target.value); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="bg-transparent text-sm w-24 outline-none placeholder:text-muted-foreground/50"
          />
        )}

        {value ? (
          <button onClick={clearSelection} className="text-muted-foreground hover:text-foreground" title="Clear">
            <X className="h-3 w-3" />
          </button>
        ) : (
          <button onClick={() => setOpen(!open)} className="text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[calc(100vw-2rem)] md:w-[280px] max-h-[240px] overflow-y-auto rounded-lg border bg-background shadow-md animate-in fade-in slide-in-from-top-1 duration-150">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No {label.toLowerCase()} found.</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o}
                onClick={() => select(o)}
                className={`flex w-full items-center px-3 py-1.5 text-sm transition-colors hover:bg-muted ${value === o ? "bg-muted font-medium" : ""}`}
              >
                <span className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground truncate">
                  {o}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
