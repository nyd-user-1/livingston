import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Loader2, Calendar, Atom, Zap, BookOpen, Users, Tag, Layers, FileText, Quote, Grid3x3,
  TrendingUp, Activity, PieChart as PieIcon, ScatterChart as ScatterIcon,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis, ZAxis, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip,
  Line, LineChart, Area, AreaChart, Pie, PieChart,
} from "recharts";
import { ELEMENTS } from "@/lib/structure";
import { useRecordSearch, type SearchMode } from "@/hooks/useRecordSearch";
import { SearchBox } from "@/components/SearchInput";
import { RecordPanel } from "@/components/RecordPanel";
import { RecordDialog } from "@/components/RecordDialog";
import { PanelChat } from "@/components/PanelChat";
import { TOOLTIP_SURFACE } from "@/components/ui/tooltip";
import { RecordRow } from "@/components/RecordRow";
import { SHELL_CLS, WidgetHeader } from "@/components/WidgetCard";
import { useAppPanel } from "@/hooks/useAppPanel";
import { usePrefetchRecord } from "@/hooks/useS2Enrichment";
import type { CorpusRecord } from "@/types/record";

/* ------------------------------------------------------------------ */
/*  Stat helpers                                                        */
/* ------------------------------------------------------------------ */

interface CountEntry {
  value: string;
  count: number;
}

function countField(
  records: CorpusRecord[],
  getter: (r: CorpusRecord) => string[] | null | undefined,
): CountEntry[] {
  const map = new Map<string, number>();
  for (const r of records) {
    const vals = getter(r);
    if (!vals) continue;
    for (const v of vals) {
      map.set(v, (map.get(v) ?? 0) + 1);
    }
  }
  return Array.from(map, ([value, count]) => ({ value, count })).sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  );
}

function countYears(records: CorpusRecord[]): CountEntry[] {
  const map = new Map<string, number>();
  for (const r of records) {
    if (r.pub_year) {
      const y = String(r.pub_year);
      map.set(y, (map.get(y) ?? 0) + 1);
    }
  }
  return Array.from(map, ([value, count]) => ({ value, count })).sort(
    (a, b) => Number(a.value) - Number(b.value),
  );
}

/** Extract journal name from reference like "Phys.Rev. C 100, 064319 (2019)" */
function extractJournal(ref: string | null): string | null {
  if (!ref) return null;
  // Strip everything from the first digit-comma or digit-space-( pattern onward
  // to get "Phys.Rev. C" from "Phys.Rev. C 100, 064319 (2019)"
  const cleaned = ref
    .replace(/\s+\d+[\s,].*$/, "")  // strip from " 100, ..." onward
    .replace(/\s*\(.*$/, "")         // strip from " (" onward
    .trim()
    .replace(/[.,;:]+$/, "");        // strip trailing punctuation
  return cleaned.length >= 3 ? cleaned : null;
}

function countJournals(records: CorpusRecord[]): CountEntry[] {
  const map = new Map<string, number>();
  for (const r of records) {
    const j = extractJournal(r.reference);
    if (j) map.set(j, (map.get(j) ?? 0) + 1);
  }
  return Array.from(map, ([value, count]) => ({ value, count })).sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  );
}


/** "A.B.Smith; C.Doe" → ["A.B.Smith", "C.Doe"] */
function splitAuthors(a: string | null | undefined): string[] {
  if (!a) return [];
  return a.split(";").map((x) => x.trim()).filter(Boolean);
}

const TOPIC_LABEL: Record<string, string> = {
  NUCLEAR_REACTIONS: "Nuclear reactions",
  NUCLEAR_STRUCTURE: "Nuclear structure",
  RADIOACTIVITY: "Radioactivity",
  NUCLEAR_MOMENTS: "Nuclear moments",
  ATOMIC_PHYSICS: "Atomic physics",
  ATOMIC_MASSES: "Atomic masses",
  COMPILATION: "Compilation",
};
const TYPE_LABEL: Record<string, string> = {
  JOURNAL: "Journal", PREPRINT: "Preprint", REPORT: "Report", CONFERENCE: "Conference",
  THESIS: "Thesis", PRIVATE_COMMUNICATION: "Private comm.", BOOK: "Book", UNKNOWN: "Unknown",
};
const typeOf = (r: CorpusRecord) => r.reference_type ?? "UNKNOWN";
const labelFor = (map: Record<string, string>) => (v: string) => map[v] ?? v;

/** Ensure every known value appears (count 0 when absent); observed order first, then the rest. */
function withAllValues(entries: CountEntry[], all: string[]): CountEntry[] {
  const seen = new Set(entries.map((e) => e.value));
  return [...entries, ...all.filter((v) => !seen.has(v)).map((v) => ({ value: v, count: 0 }))];
}

/** "137Cs" → { z, n, a, symbol } via the ELEMENTS table; null if unparseable. */
function parseNuclide(code: string): { z: number; n: number; a: number; symbol: string } | null {
  const m = /^(\d{1,3})([A-Za-z]{1,2})$/.exec(code);
  if (!m) return null;
  const a = Number(m[1]);
  const symbol = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  const z = ELEMENTS.indexOf(symbol);
  if (z < 0 || a < z) return null;
  return { z, n: a - z, a, symbol };
}

/** Top-cited records in the set (key → cites); records without a count are skipped. */
function countCitations(records: CorpusRecord[]): CountEntry[] {
  return records
    .filter((r) => (r.citation_count ?? 0) > 0)
    .map((r) => ({ value: r.key_number, count: r.citation_count as number }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

/** Brand blue — the accent this page's widgets are anchored on. */
const BRAND = "#004982";
/** Axis tick labels: the brand hue lightened until it clears text contrast on
 *  the white card, at the luminance of the gold it replaces. */
const AXIS_INK = "#4E7695";
/** The widgets' series ramp, anchored on BRAND and stepping lighter. */
const RAMP = ["#004982", "#1B5E9B", "#3573B4", "#5189C6", "#6FA0D6", "#93B9E4", "#B8D2F0"];
const decadeOf = (y: number) => `${Math.floor(y / 10) * 10}s`;

/** rows: one per decade, columns: one per series key (stacked area input) */
function seriesByDecade(records: CorpusRecord[], getter: (r: CorpusRecord) => string[] | null | undefined, topN = 5) {
  const totals = new Map<string, number>();
  for (const r of records) for (const k of getter(r) ?? []) totals.set(k, (totals.get(k) ?? 0) + 1);
  const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k);
  const rows = new Map<string, Record<string, number | string>>();
  for (const r of records) {
    if (!r.pub_year) continue;
    const d = decadeOf(r.pub_year);
    const row = rows.get(d) ?? { decade: d, ...Object.fromEntries(keys.map((k) => [k, 0])) };
    for (const k of getter(r) ?? []) if (keys.includes(k)) row[k] = (row[k] as number) + 1;
    rows.set(d, row);
  }
  return { keys, rows: [...rows.values()].sort((a, b) => String(a.decade).localeCompare(String(b.decade))) };
}

/* ------------------------------------------------------------------ */
/*  Filter types                                                        */
/* ------------------------------------------------------------------ */

interface Filters {
  years: Set<string>;
  nuclides: Set<string>;
  reactions: Set<string>;
  journals: Set<string>;
  authors: Set<string>;
  subjects: Set<string>;
  topics: Set<string>;
  types: Set<string>;
}

const EMPTY_SET: Set<string> = new Set();

const EMPTY_FILTERS: Filters = {
  years: new Set(),
  nuclides: new Set(),
  reactions: new Set(),
  journals: new Set(),
  authors: new Set(),
  subjects: new Set(),
  topics: new Set(),
  types: new Set(),
};

function applyFilters(records: CorpusRecord[], filters: Filters): CorpusRecord[] {
  return records.filter((r) => {
    if (filters.years.size > 0 && !filters.years.has(String(r.pub_year))) return false;
    if (filters.nuclides.size > 0) {
      if (!r.categories || !r.categories.some((n) => filters.nuclides.has(n))) return false;
    }
    if (filters.reactions.size > 0) {
      if (!r.status_tags || !r.status_tags.some((rx) => filters.reactions.has(rx))) return false;
    }
    if (filters.journals.size > 0) {
      const j = extractJournal(r.reference);
      if (!j || !filters.journals.has(j)) return false;
    }
    if (filters.authors.size > 0 && !splitAuthors(r.authors).some((a) => filters.authors.has(a))) return false;
    if (filters.subjects.size > 0 && !(r.subjects ?? []).some((x) => filters.subjects.has(x))) return false;
    if (filters.topics.size > 0 && !(r.topics ?? []).some((x) => filters.topics.has(x))) return false;
    if (filters.types.size > 0 && !filters.types.has(typeOf(r))) return false;
    return true;
  });
}

function hasActiveFilters(f: Filters): boolean {
  return (
    f.years.size > 0 ||
    f.nuclides.size > 0 ||
    f.reactions.size > 0 ||
    f.journals.size > 0 ||
    f.authors.size > 0 ||
    f.subjects.size > 0 ||
    f.topics.size > 0 ||
    f.types.size > 0
  );
}

/* ------------------------------------------------------------------ */
/*  Shared widget chrome — every card is 280px tall, header is the drag  */
/*  handle (grab cursor + grip glyph), ✕ hides.                          */
/* ------------------------------------------------------------------ */

const WIDGET_H = 280;

/* ------------------------------------------------------------------ */
/*  Interactive StatWidget (table with clickable rows)                  */
/* ------------------------------------------------------------------ */

function StatWidget({
  icon,
  title,
  entries,
  activeValues,
  onToggle,
  onClose,
  label,
}: {
  icon: React.ReactNode;
  title: string;
  entries: CountEntry[];
  activeValues: Set<string>;
  onToggle: (value: string) => void;
  onClose: () => void;
  /** optional display label for a value (values stay raw for filtering) */
  label?: (value: string) => string;
}) {
  if (entries.length === 0) return null;

  return (
    <div className={SHELL_CLS} style={{ height: WIDGET_H }}>
      <WidgetHeader
        icon={icon}
        title={title}
        onClose={onClose}
        right={activeValues.size > 0 ? <span className="text-[10px] text-muted-foreground">{activeValues.size} selected</span> : undefined}
      />
      <div className="p-1 overflow-y-auto flex-1 min-h-0">
        {entries.map((e) => {
          const isActive = activeValues.has(e.value);
          return (
            <button
              key={e.value}
              onClick={() => onToggle(e.value)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 transition-colors text-left ${
                isActive
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="text-xs truncate mr-2">{label ? label(e.value) : e.value}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {e.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Year bar chart widget                                               */
/* ------------------------------------------------------------------ */

function YearBarChart({
  entries,
  activeYears,
  onToggle,
  onClose,
}: {
  entries: CountEntry[];
  activeYears: Set<string>;
  onToggle: (value: string) => void;
  onClose: () => void;
}) {
  if (entries.length === 0) return null;

  const data = entries.map((e) => ({
    year: e.value,
    count: e.count,
    fill: activeYears.size === 0 || activeYears.has(e.value)
      ? BRAND
      : "#333333",
  }));

  return (
    <div className={SHELL_CLS} style={{ height: WIDGET_H }}>
      <WidgetHeader icon={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />} title="Year" onClose={onClose} />
      <div className="px-2 py-3 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#222" />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: AXIS_INK }}
              tickMargin={4}
            />
            <YAxis hide />
            <Bar
              dataKey="count"
              radius={[2, 2, 0, 0]}
              onClick={(_data, index) => onToggle(data[index].year)}
              className="cursor-pointer"
            >
              {data.map((entry) => (
                <Cell key={entry.year} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Nuclide map widget — the result set on the Z–N plane                */
/* ------------------------------------------------------------------ */

function NuclideMap({
  entries,
  activeNuclides,
  onToggle,
  onClose,
}: {
  entries: CountEntry[];
  activeNuclides: Set<string>;
  onToggle: (value: string) => void;
  onClose: () => void;
}) {
  const points = entries
    .map((e) => {
      const p = parseNuclide(e.value);
      return p ? { code: e.value, z: p.z, n: p.n, a: p.a, symbol: p.symbol, count: e.count } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (points.length < 2) return null;
  const anyActive = activeNuclides.size > 0;
  return (
    <div className={SHELL_CLS} style={{ height: WIDGET_H }}>
      <WidgetHeader icon={<Grid3x3 className="h-3.5 w-3.5 text-muted-foreground" />} title="Nuclide map" sub="Z vs N · size = papers" onClose={onClose} />
      <div className="px-2 py-3 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis type="number" dataKey="n" name="N" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS_INK }} tickMargin={4} domain={["dataMin - 2", "dataMax + 2"]} />
            <YAxis type="number" dataKey="z" name="Z" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS_INK }} width={28} domain={["dataMin - 2", "dataMax + 2"]} />
            <ZAxis type="number" dataKey="count" range={[24, 220]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "#444" }}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as (typeof points)[number] | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground shadow">
                    <span className="font-medium">{p.a}{p.symbol}</span>
                    <span className="text-muted-foreground"> · Z={p.z} N={p.n} · {p.count}</span>
                  </div>
                );
              }}
            />
            <Scatter data={points} onClick={(d) => onToggle((d as unknown as { code: string }).code)} className="cursor-pointer">
              {points.map((p) => (
                <Cell key={p.code} fill={!anyActive || activeNuclides.has(p.code) ? BRAND : "#333333"} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chart shell + the line / area / doughnut / scatter widgets          */
/* ------------------------------------------------------------------ */

function ChartShell({ icon, title, sub, onClose, children }: {
  icon: React.ReactNode; title: string; sub?: string; onClose: () => void; children: React.ReactElement;
}) {
  return (
    <div className={SHELL_CLS} style={{ height: WIDGET_H }}>
      <WidgetHeader icon={icon} title={title} sub={sub} onClose={onClose} />
      <div className="px-2 py-3 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

const AXIS = { fontSize: 10, fill: AXIS_INK } as const;
/** Chart tooltips and the hover tooltip share one surface. */
const TIP_CLS = TOOLTIP_SURFACE;

/** Line: cumulative papers over publication year. */
function CumulativeChart({ entries, onClose }: { entries: CountEntry[]; onClose: () => void }) {
  if (entries.length < 3) return null;
  const data = entries.reduce<{ year: string; total: number }[]>((acc, e) => {
    acc.push({ year: e.value, total: (acc.at(-1)?.total ?? 0) + e.count });
    return acc;
  }, []);
  return (
    <ChartShell icon={<TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />} title="Cumulative" sub="papers over time" onClose={onClose}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#222" />
        <XAxis dataKey="year" tickLine={false} axisLine={false} tick={AXIS} tickMargin={4} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS} width={28} />
        <Tooltip content={({ payload }) => payload?.[0] ? <div className={TIP_CLS}>{String(payload[0].payload.year)} · {String(payload[0].value)} papers</div> : null} />
        <Line type="monotone" dataKey="total" stroke={BRAND} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: BRAND }} />
      </LineChart>
    </ChartShell>
  );
}

/** Line: relevance score by rank position — how fast the match quality falls off. */
function RelevanceChart({ records, onClose }: { records: CorpusRecord[]; onClose: () => void }) {
  const data = records.filter((r) => r.similarity != null).map((r, i) => ({ rank: i + 1, score: Math.round((r.similarity as number) * 100), key: r.key_number }));
  if (data.length < 5) return null;
  return (
    <ChartShell icon={<Activity className="h-3.5 w-3.5 text-muted-foreground" />} title="Relevance" sub="score by rank" onClose={onClose}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#222" />
        <XAxis dataKey="rank" tickLine={false} axisLine={false} tick={AXIS} tickMargin={4} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS} width={28} domain={[0, 100]} />
        <Tooltip content={({ payload }) => payload?.[0] ? <div className={TIP_CLS}>#{String(payload[0].payload.rank)} {String(payload[0].payload.key)} · {String(payload[0].value)}%</div> : null} />
        <Line type="monotone" dataKey="score" stroke={BRAND} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: BRAND }} />
      </LineChart>
    </ChartShell>
  );
}

/** Stacked area: a categorical field across decades (topics, reference types). */
function DecadeAreaChart({ icon, title, records, getter, label, onClose }: {
  icon: React.ReactNode; title: string; records: CorpusRecord[]; getter: (r: CorpusRecord) => string[] | null | undefined; label: (v: string) => string; onClose: () => void;
}) {
  const { keys, rows } = seriesByDecade(records, getter);
  if (rows.length < 3 || keys.length === 0) return null;
  return (
    <ChartShell icon={icon} title={title} sub="by decade" onClose={onClose}>
      <AreaChart data={rows} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#222" />
        <XAxis dataKey="decade" tickLine={false} axisLine={false} tick={AXIS} tickMargin={4} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS} width={28} />
        <Tooltip content={({ payload, label: l }) => payload?.length ? (
          <div className={TIP_CLS}>
            <div className="font-medium">{String(l)}</div>
            {payload.map((p) => <div key={String(p.dataKey)}><span style={{ color: p.color as string }}>■</span> {label(String(p.dataKey))}: {String(p.value)}</div>)}
          </div>
        ) : null} />
        {keys.map((k, i) => (
          <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={RAMP[i % RAMP.length]} fill={RAMP[i % RAMP.length]} fillOpacity={0.55} />
        ))}
      </AreaChart>
    </ChartShell>
  );
}

/** Doughnut: share of a categorical field; click a slice to filter. */
function DoughnutChart({ icon, title, entries, activeValues, onToggle, label, onClose }: {
  icon: React.ReactNode; title: string; entries: CountEntry[]; activeValues: Set<string>; onToggle: (v: string) => void; label: (v: string) => string; onClose: () => void;
}) {
  if (entries.length < 2) return null;
  const top = entries.slice(0, 6);
  const anyActive = activeValues.size > 0;
  return (
    <ChartShell icon={icon} title={title} sub="share" onClose={onClose}>
      <PieChart margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
        <Tooltip content={({ payload }) => payload?.[0] ? <div className={TIP_CLS}>{label(String(payload[0].name))} · {String(payload[0].value)}</div> : null} />
        <Pie data={top} dataKey="count" nameKey="value" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none"
          onClick={(d) => onToggle((d as unknown as { value: string }).value)} className="cursor-pointer"
          label={({ name, percent }) => (percent && percent > 0.08 ? `${label(String(name)).slice(0, 14)} ${Math.round(percent * 100)}%` : "")}
          labelLine={false} fontSize={10}>
          {top.map((e, i) => (
            <Cell key={e.value} fill={!anyActive || activeValues.has(e.value) ? RAMP[i % RAMP.length] : "#333333"} />
          ))}
        </Pie>
      </PieChart>
    </ChartShell>
  );
}

/** Scatter: publication year vs citations; click a point to open the record. */
function CitationScatter({ records, onOpen, onClose }: { records: CorpusRecord[]; onOpen: (key: string) => void; onClose: () => void }) {
  const pts = records.filter((r) => r.pub_year && (r.citation_count ?? 0) > 0).map((r) => ({ year: r.pub_year, cites: r.citation_count as number, key: r.key_number, title: r.title }));
  if (pts.length < 3) return null;
  return (
    <ChartShell icon={<ScatterIcon className="h-3.5 w-3.5 text-muted-foreground" />} title="Citations" sub="year vs cites · click opens" onClose={onClose}>
      <ScatterChart margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#222" />
        <XAxis type="number" dataKey="year" name="Year" tickLine={false} axisLine={false} tick={AXIS} tickMargin={4} domain={["dataMin - 1", "dataMax + 1"]} />
        <YAxis type="number" dataKey="cites" name="Citations" tickLine={false} axisLine={false} tick={AXIS} width={34} />
        <Tooltip cursor={{ strokeDasharray: "3 3", stroke: "#444" }} content={({ payload }) => {
          const p = payload?.[0]?.payload as (typeof pts)[number] | undefined;
          return p ? <div className={TIP_CLS}><span className="font-medium">{p.key}</span> · {p.year} · {p.cites} cites<div className="text-muted-foreground max-w-[240px] truncate">{p.title}</div></div> : null;
        }} />
        <Scatter data={pts} fill={BRAND} onClick={(d) => onOpen((d as unknown as { key: string }).key)} className="cursor-pointer" />
      </ScatterChart>
    </ChartShell>
  );
}
/* ------------------------------------------------------------------ */
/*  Search page                                                         */
/* ------------------------------------------------------------------ */

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [inputValue, setInputValue] = useState(urlQuery);
  const [mode, setMode] = useState<SearchMode>("hybrid");
  // Record detail — the app-shell push panel, same as References.
  const [detailRecord, setDetailRecord] = useState<CorpusRecord | null>(null);
  const { openPanel } = useAppPanel();
  const prefetchRecord = usePrefetchRecord();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [hiddenWidgets, setHiddenWidgets] = useState<Set<string>>(new Set());

  // Reset filters and hidden widgets when query changes
  useEffect(() => {
    setInputValue(urlQuery);
    setFilters(EMPTY_FILTERS);
    setHiddenWidgets(new Set());
  }, [urlQuery]);

  // livingston searches medRxiv only — the archive its Papers page browses.
  const { data, isLoading } = useRecordSearch(urlQuery, mode, "medrxiv");
  const records = useMemo(() => data?.records ?? [], [data]);

  // Apply client-side filters
  const filteredRecords = useMemo(
    () => (hasActiveFilters(filters) ? applyFilters(records, filters) : records),
    [records, filters],
  );

  // Stats computed from ALL results (not filtered) so widgets stay stable
  const yearEntries = useMemo(() => countYears(records), [records]);
  const nuclideEntries = useMemo(
    () => countField(records, (r) => r.categories),
    [records],
  );
  const reactionEntries = useMemo(
    () => countField(records, (r) => r.status_tags),
    [records],
  );
  const journalEntries = useMemo(() => countJournals(records), [records]);
  const authorEntries = useMemo(() => countField(records, (r) => splitAuthors(r.authors)).slice(0, 40), [records]);
  const subjectEntries = useMemo(() => countField(records, (r) => r.subjects), [records]);
  // Topic and Type have a fixed, known vocabulary (7 and 7 values in the corpus) —
  // list all of them, absent ones at 0, so the widgets keep a stable shape.
  const topicEntries = useMemo(() => withAllValues(countField(records, (r) => r.topics), Object.keys(TOPIC_LABEL)), [records]);
  const typeEntries = useMemo(() => withAllValues(countField(records, (r) => [typeOf(r)]), Object.keys(TYPE_LABEL)), [records]);
  const citationEntries = useMemo(() => countCitations(records), [records]);

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSearchParams({ q: trimmed });
  };


  // Toggle helpers
  const toggleSet = useCallback(
    (key: "years" | "nuclides" | "reactions" | "journals" | "authors" | "subjects" | "topics" | "types", value: string) => {
      setFilters((prev) => {
        const next = new Set(prev[key]);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return { ...prev, [key]: next };
      });
    },
    [],
  );

  const hideWidget = useCallback((name: string) => {
    setHiddenWidgets((prev) => new Set(prev).add(name));
  }, []);

  /* ---------- Widget order (draggable) ---------- */
  // The two line charts read as a set with the year bars — same shape of
  // question, same time axis — so they sit directly under it by default and
  // the facet tables follow. Still draggable; this is only the initial order.
  const DEFAULT_ORDER = useMemo(() => [
    "yearChart", "cumulative", "relevance",
    "nuclideMap", "yearTable", "journals", "nuclides", "reactions",
    "subjects", "authors", "topics", "types", "cited",
    "topicsArea", "typesArea", "topicPie", "citationScatter",
  ], []);
  const [widgetOrder, setWidgetOrder] = useState<string[]>(DEFAULT_ORDER);
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const moveWidget = useCallback((from: string | null, to: string) => {
    if (!from || from === to) return;
    setWidgetOrder((prev) => {
      const next = prev.filter((x) => x !== from);
      const i = next.indexOf(to);
      next.splice(i < 0 ? next.length : i, 0, from);
      return next;
    });
  }, []);

  const hasQuery = urlQuery.length >= 3;

  const showRecord = (index: number) => {
    const rec = filteredRecords[index];
    if (!rec) return;
    openPanel({
      title: rec.title,
      content: <RecordPanel record={rec} onOpenRelated={openByKey} />,
      onPrev: index > 0 ? () => showRecord(index - 1) : undefined,
      onNext: index < filteredRecords.length - 1 ? () => showRecord(index + 1) : undefined,
    });
  };
  const openByKey = (key: string) => {
    const i = filteredRecords.findIndex((r) => r.key_number === key);
    if (i >= 0) showRecord(i);
  };
  const widgets: Record<string, { full?: boolean; node: React.ReactNode }> = {
    yearChart: { full: true, node: <YearBarChart entries={yearEntries} activeYears={filters.years} onToggle={(v) => toggleSet("years", v)} onClose={() => hideWidget("yearChart")} /> },
    nuclideMap: { full: true, node: <NuclideMap entries={nuclideEntries} activeNuclides={filters.nuclides} onToggle={(v) => toggleSet("nuclides", v)} onClose={() => hideWidget("nuclideMap")} /> },
    yearTable: { node: <StatWidget icon={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />} title="Year" entries={yearEntries} activeValues={filters.years} onToggle={(v) => toggleSet("years", v)} onClose={() => hideWidget("yearTable")} /> },
    journals: { node: <StatWidget icon={<BookOpen className="h-3.5 w-3.5 text-muted-foreground" />} title="Journal" entries={journalEntries} activeValues={filters.journals} onToggle={(v) => toggleSet("journals", v)} onClose={() => hideWidget("journals")} /> },
    nuclides: { node: <StatWidget icon={<Atom className="h-3.5 w-3.5 text-muted-foreground" />} title="Category" entries={nuclideEntries} activeValues={filters.nuclides} onToggle={(v) => toggleSet("nuclides", v)} onClose={() => hideWidget("nuclides")} /> },
    reactions: { node: <StatWidget icon={<Zap className="h-3.5 w-3.5 text-muted-foreground" />} title="Status" entries={reactionEntries} activeValues={filters.reactions} onToggle={(v) => toggleSet("reactions", v)} onClose={() => hideWidget("reactions")} /> },
    subjects: { node: <StatWidget icon={<Tag className="h-3.5 w-3.5 text-muted-foreground" />} title="Measured" entries={subjectEntries} activeValues={filters.subjects} onToggle={(v) => toggleSet("subjects", v)} onClose={() => hideWidget("subjects")} /> },
    authors: { node: <StatWidget icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />} title="Authors" entries={authorEntries} activeValues={filters.authors} onToggle={(v) => toggleSet("authors", v)} onClose={() => hideWidget("authors")} /> },
    topics: { node: <StatWidget icon={<Layers className="h-3.5 w-3.5 text-muted-foreground" />} title="Topic" entries={topicEntries} activeValues={filters.topics} onToggle={(v) => toggleSet("topics", v)} onClose={() => hideWidget("topics")} label={labelFor(TOPIC_LABEL)} /> },
    types: { node: <StatWidget icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />} title="Type" entries={typeEntries} activeValues={filters.types} onToggle={(v) => toggleSet("types", v)} onClose={() => hideWidget("types")} label={labelFor(TYPE_LABEL)} /> },
    cited: { node: <StatWidget icon={<Quote className="h-3.5 w-3.5 text-muted-foreground" />} title="Most cited" entries={citationEntries} activeValues={EMPTY_SET} onToggle={openByKey} onClose={() => hideWidget("cited")} /> },
    cumulative: { full: true, node: <CumulativeChart entries={yearEntries} onClose={() => hideWidget("cumulative")} /> },
    topicsArea: { full: true, node: <DecadeAreaChart icon={<Layers className="h-3.5 w-3.5 text-muted-foreground" />} title="Topics over time" records={records} getter={(r) => r.topics} label={labelFor(TOPIC_LABEL)} onClose={() => hideWidget("topicsArea")} /> },
    typesArea: { full: true, node: <DecadeAreaChart icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />} title="Types over time" records={records} getter={(r) => [typeOf(r)]} label={labelFor(TYPE_LABEL)} onClose={() => hideWidget("typesArea")} /> },
    relevance: { full: true, node: <RelevanceChart records={records} onClose={() => hideWidget("relevance")} /> },
    topicPie: { node: <DoughnutChart icon={<PieIcon className="h-3.5 w-3.5 text-muted-foreground" />} title="Topic" entries={topicEntries} activeValues={filters.topics} onToggle={(v) => toggleSet("topics", v)} label={labelFor(TOPIC_LABEL)} onClose={() => hideWidget("topicPie")} /> },
    citationScatter: { node: <CitationScatter records={records} onOpen={openByKey} onClose={() => hideWidget("citationScatter")} /> },
  };

  /* ---------- Empty state ---------- */
  if (!hasQuery) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <div className="w-full max-w-[720px]">
          <SearchBox
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            mode={mode}
            onModeChange={setMode}
          />
        </div>
      </div>
    );
  }

  /* ---------- Results state ---------- */
  const hasWidgets =
    yearEntries.length > 0 ||
    nuclideEntries.length > 0 ||
    reactionEntries.length > 0 ||
    journalEntries.length > 0 ||
    authorEntries.length > 0 ||
    subjectEntries.length > 0;

  return (
    <div className="h-full px-4 pt-4 pb-6 overflow-x-hidden">
      <div className="mx-auto flex h-full max-w-[1200px] flex-col lg:flex-row gap-6">
        {/* Left column — search box + scrollable results */}
        <div className="flex flex-1 min-w-0 flex-col">
          {/* Search box (stays put) */}
          <div className="shrink-0 max-w-[720px]">
            <SearchBox
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              mode={mode}
              onModeChange={setMode}
              isLoading={isLoading}
            />

            {/* Count header — one line: count on the left, "Clear filters" right-aligned when filtering */}
            <div className="mt-3 flex items-center justify-between gap-3">
              {isLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Searching…</span>
                </div>
              ) : filteredRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {hasActiveFilters(filters)
                    ? `No results match the current filters (${records.length} before filtering)`
                    : <>No results found for &ldquo;{urlQuery}&rdquo;</>}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {hasActiveFilters(filters)
                    ? `About ${filteredRecords.length} of ${records.length} results`
                    : `About ${data?.count ?? records.length} results`}
                </p>
              )}
              {hasActiveFilters(filters) && !isLoading && (
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="text-sm text-brand hover:underline shrink-0"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Scrollable results list */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 mt-2">
            {!isLoading && filteredRecords.length > 0 && (
              <div key={urlQuery} className="pr-1 animate-in fade-in slide-in-from-bottom-2 duration-500">
                {filteredRecords.map((record, i) => (
                  <RecordRow
                    key={record.id}
                    record={record}
                    first={i === 0}
                    query={urlQuery}
                    onClick={() => showRecord(i)}
                    onDetail={() => setDetailRecord(record)}
                    onHover={() => prefetchRecord(record.id)}
                    onChat={() => openPanel({
                      title: (
                        <span className="inline-flex items-center gap-2">
                          Chat
                          <span className="inline-flex items-center rounded border bg-muted/40 px-1 font-mono text-[0.85em] font-semibold text-foreground">{record.key_number}</span>
                        </span>
                      ),
                      content: <PanelChat key={record.key_number} record={record} />,
                    })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — widgets: drag a card to reorder, ✕ to hide */}
        {!isLoading && hasWidgets && (
          <div key={`w-${urlQuery}`} className="w-full lg:w-auto lg:min-w-[280px] lg:max-w-[620px] shrink-0 overflow-y-auto animate-in fade-in slide-in-from-right-2 duration-500">
            <div className="flex flex-wrap gap-4">
              {widgetOrder.map((id) => {
                const w = widgets[id];
                if (!w || hiddenWidgets.has(id)) return null;
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={(e) => { dragId.current = id; e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); if (overId !== id) setOverId(id); }}
                    onDragLeave={() => setOverId((o) => (o === id ? null : o))}
                    onDrop={(e) => { e.preventDefault(); moveWidget(dragId.current, id); dragId.current = null; setOverId(null); }}
                    onDragEnd={() => { dragId.current = null; setOverId(null); }}
                    className={`${w.full ? "w-full min-w-[222px]" : "flex-1 min-w-[222px] max-w-[300px]"} rounded-lg transition-shadow ${overId === id ? "ring-2 ring-brand/60" : ""}`}
                  >
                    {w.node}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* What the % badge means */}

      {/* Record detail dialog (stand-in for a /record page) */}
      <RecordDialog record={detailRecord} open={detailRecord !== null} onOpenChange={(o) => !o && setDetailRecord(null)} />

    </div>
  );
}
