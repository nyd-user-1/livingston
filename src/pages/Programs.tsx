import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SearchInput } from "@/components/SearchInput";
import { ProgramGridCard } from "@/components/ProgramGridCard";
import { useAppPanel } from "@/hooks/useAppPanel";
import { useFeedEmitter } from "@/hooks/useFeedEmitter";
import { FORMS, fillable, formStats, type ProgramForm } from "@/lib/programs";

/**
 * Every programme you can apply for, as a browsable grid.
 *
 * Deliberately not paginated and not ranked: there are twenty of these, a
 * person should be able to see all of them, and the one that matters to
 * somebody is not the one that matters on average. The filter row narrows by
 * the thing people actually arrive knowing — "I need help with food", "my heat
 * is being shut off" — rather than by agency or form number.
 */

const CATEGORIES: { key: ProgramForm["category"] | "all" | "forms"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "forms", label: "Fill in with sam" },
  { key: "food", label: "Food" },
  { key: "health", label: "Health" },
  { key: "energy", label: "Heat & utilities" },
  { key: "family", label: "Children & family" },
  { key: "money", label: "Cash & credits" },
  { key: "older", label: "Older adults" },
];

function ProgramDetail({ program }: { program: ProgramForm }) {
  const stats = formStats(program);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="font-medium text-foreground">{program.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {program.agency}
          {program.revision ? ` · rev. ${program.revision}` : ""}
        </p>
      </div>

      <p className="text-sm text-foreground">{program.blurb}</p>

      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Covers</p>
        <ul className="mt-1.5 space-y-1">
          {program.covers.map((c) => (
            <li key={c} className="text-xs text-foreground">
              {c}
            </li>
          ))}
        </ul>
      </div>

      {program.pdf ? (
        <>
          <p className="text-xs text-muted-foreground">
            {program.pages} pages. {stats.questionSections} sections ask you something; {stats.readingPages} pages
            are notices to read, with nothing to fill in.
          </p>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sections</p>
            <ol className="mt-1.5 space-y-1.5">
              {program.sections.map((s) => (
                <li key={s.n} className="text-xs">
                  <span className="font-medium text-foreground">
                    {/^\d/.test(s.n) ? `${s.n}. ` : ""}
                    {s.title}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · p.{s.pages.join(", ")}
                    {s.consent ? " · read only" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <a
            href={program.pdf}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs text-brand hover:bg-muted"
          >
            Open the blank form
          </a>
        </>
      ) : (
        program.apply && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">How to apply</p>
            <p className="mt-1 text-xs text-foreground">{program.apply.how}</p>
            {program.apply.phone && <p className="mt-1.5 text-xs font-medium text-foreground">{program.apply.phone}</p>}
            {program.apply.url && (
              <a
                href={program.apply.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block truncate text-xs text-brand hover:underline"
              >
                {program.apply.url}
              </a>
            )}
          </div>
        )
      )}
    </div>
  );
}

export default function Programs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [cat, setCat] = useState<string>(searchParams.get("cat") ?? "all");
  const { openPanel } = useAppPanel();
  const { emit } = useFeedEmitter();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FORMS.filter((f) => {
      if (cat === "forms" && !fillable(f)) return false;
      if (cat !== "all" && cat !== "forms" && f.category !== cat) return false;
      if (!q) return true;
      return [f.code, f.title, f.blurb, f.agency, ...f.covers].join(" ").toLowerCase().includes(q);
    });
  }, [query, cat]);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 3) return;
    const t = setTimeout(() => {
      emit({
        event_type: "keyword_search",
        category: "search",
        entity_type: "query",
        entity_value: query.trim(),
        display_text: `Looked for "${query.trim()}" in benefits`,
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [query, emit]);

  const setFilter = (next: string) => {
    setCat(next);
    const p = new URLSearchParams(searchParams);
    next === "all" ? p.delete("cat") : p.set("cat", next);
    setSearchParams(p, { replace: true });
  };

  /** Drop a programme into a fresh chat without needing to drag it. */
  const ask = (f: ProgramForm) => {
    sessionStorage.setItem("sam-open-form", f.id);
    navigate("/new-chat");
  };

  const header = mounted ? document.getElementById("header-search") : null;

  return (
    <div className="h-full overflow-y-auto">
      {header &&
        createPortal(
          <SearchInput value={query} onChange={setQuery} placeholder="Search benefits and programs…" />,
          header,
        )}

      <div className="sticky top-0 z-10 bg-background px-4 pb-2 pt-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-1.5 py-1 text-sm font-medium text-foreground">Grants &amp; benefits</span>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(String(c.key))}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                cat === c.key
                  ? "bg-foreground font-medium text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-6">
        <p className="py-2 text-sm text-muted-foreground">
          Showing {shown.length} of {FORMS.length} programs
          {cat === "forms" ? " sam can fill in with you" : ""}
        </p>

        {shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Nothing matches “{query.trim()}”. Try a word like food, heat, rent, child care or Medicare.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 pb-8 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((f) => (
              <ProgramGridCard
                key={f.id}
                program={f}
                onOpen={() => openPanel({ title: f.code, content: <ProgramDetail program={f} /> })}
                onAsk={() => ask(f)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
