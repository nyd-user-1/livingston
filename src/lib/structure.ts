import { useQuery } from "@tanstack/react-query";

/** Pre-rendered ENSDF/XUNDL data layer (public/data/structure/*, built by
 *  scripts/build-structure-data.mjs). Static JSON on the CDN — no backend. */

export interface NuclideEval {
  el: string;
  citation: string | null;
  /** NSR key number for the citation, when it resolves to exactly one paper. */
  key?: string | null;
  cutoff: string | null;
  xundl_sets: number;
}

export interface MassSummary {
  a: number;
  citation: string | null;
  key?: string | null;
  cutoff: string | null;
  xundl_sets: number;
  papers: number;
  nuclideEvals: NuclideEval[];
}

/** One charted nuclide with its dataset census (build-structure-data.mjs). */
export interface NuclideRow {
  code: string; z: number; n: number; a: number; el: string;
  ensdf: number; xundl: number; xundlSince: number; revised: string | null; age: number;
}

export interface StructureIndex {
  generated: string;
  masses: MassSummary[];
  /** [z, n, a, ageBucket, xundlSetCount] per known nuclide */
  grid: [number, number, number, number, number][];
  nuclides: NuclideRow[];
}

export interface LitPaper {
  key: string;
  title: string | null;
  authors: string | null;
  year: number;
  doi: string | null;
  cites: number | null;
  pdf: boolean;
  nsr: boolean;
  snippet: string | null;
  /** nuclides of this mass chain the paper's selectors carry, e.g. ["148Gd","148Tb"] */
  nucs?: string[];
}

export interface MassChain {
  a: number;
  citation: string | null;
  key?: string | null;
  cutoff: string | null;
  ageBucket: number;
  nuclideEvals: NuclideEval[];
  datasets: { nuclide: string; dataset: string; revised: string | null; recid: number }[];
  reactions: { code: string; papers: number }[];
  totalPapers: number;
  literature: { top: LitPaper[]; recent: LitPaper[] };
  nuclides: { el: string; z: number; n: number; ensdf?: number; xundl?: number; xundlSince?: number; revised?: string | null }[];
}

/** Bump when the structure JSON shape changes — /data/* is edge-cached for a day (+ a week SWR),
 *  so a shape change without a new URL serves stale files to everyone. */
export const STRUCTURE_DATA_V = "20260818b";

const fetchJson = async <T,>(path: string): Promise<T> => {
  const res = await fetch(`${path}?v=${STRUCTURE_DATA_V}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

export const useStructureIndex = () =>
  useQuery({
    queryKey: ["structure-index"],
    queryFn: () => fetchJson<StructureIndex>("/data/structure/index.json"),
    staleTime: Infinity,
  });

export const useMassChain = (a: number | null) =>
  useQuery({
    queryKey: ["structure-mass", a],
    queryFn: () => fetchJson<MassChain>(`/data/structure/${a}.json`),
    enabled: a !== null && a > 0,
    staleTime: Infinity,
  });

/** Years-since-cutoff ramp, ≤1yr green → ≥11yr deep red; 12 = never/unknown. */
export const AGE_COLORS = [
  "#15803d", "#22c55e", "#84cc16", "#bef264", "#fde047", "#facc15",
  "#f59e0b", "#f97316", "#ef4444", "#dc2626", "#991b1b", "#6b1212",
  "#71717a",
];
export const ageLabel = (b: number) => (b >= 12 ? "n/a" : b >= 11 ? "≥11y" : b <= 0 ? "≤1y" : `${b + 1}y`);

/** XUNDL-activity ramp: compilations waiting since the cutoff, ≤5 green → ≥30 deep red. */
export const XUNDL_COLORS = ["#15803d", "#4ade80", "#fde047", "#f97316", "#ef4444", "#7f1d1d"];
export const XUNDL_LABELS = ["≤5", "10", "15", "20", "25", "≥30"];
/** Nuclides with no XUNDL set since the cutoff — outside the ramp. */
export const XUNDL_NONE_COLOR = "#9ca3af";
export const xundlBucket = (count: number) =>
  count <= 5 ? 0 : count <= 10 ? 1 : count <= 15 ? 2 : count <= 20 ? 3 : count <= 25 ? 4 : 5;

/** Element symbols by Z (1-118). */
export const ELEMENTS = [
  "n", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al",
  "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe",
  "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y",
  "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te",
  "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb",
  "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt",
  "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa",
  "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf",
  "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts",
  "Og",
];

/** Parse "137", "137Cs", "Cs-137", "cs137" → mass number (or null). */
export function parseMassQuery(q: string): number | null {
  const s = q.trim();
  if (!s) return null;
  const num = s.match(/^\d{1,3}$/);
  if (num) return Number(s);
  const m = s.match(/^(\d{1,3})\s*-?\s*[A-Za-z]{1,2}$/) ?? s.match(/^[A-Za-z]{1,2}\s*-?\s*(\d{1,3})$/);
  if (m) return Number(m[1]);
  return null;
}
