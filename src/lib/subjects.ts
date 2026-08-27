// The subject taxonomy: each archive's categories enriched with their MeSH
// descriptor (unique ID, tree numbers, scope note), resolved offline against
// NLM by scripts/subjects/build-subjects.mts. Live paper counts come from
// /api/dict at runtime — the counts in this file are the build-time snapshot,
// used only until the live numbers arrive.
import raw from "@/data/subjects.json";
import type { ArchiveServer } from "@/hooks/useArchive";

export interface SubjectMesh {
  id: string;
  label: string;
  treeNumbers: string[];
  scopeNote: string | null;
  /** NLM's "See Also" cross-references — related MeSH headings. */
  seeAlso: { id: string; label: string }[];
}

export interface Subject {
  category: string;
  name: string;
  papers: number;
  mesh: SubjectMesh | null;
}

export const SUBJECTS = raw as Record<ArchiveServer, Subject[]>;

/** Archive categories are stored lowercase; display them as headings. */
export function subjectTitle(category: string): string {
  return category
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bAnd\b/g, "and")
    .replace(/\bHiv\b/g, "HIV")
    .replace(/\bAids\b/g, "AIDS");
}

export function findSubject(server: ArchiveServer, category: string): Subject | undefined {
  return SUBJECTS[server]?.find((s) => s.category === category.toLowerCase());
}

/** NLM's public MeSH browser page for a descriptor. */
export const meshUrl = (id: string) => `https://meshb.nlm.nih.gov/record/ui?ui=${id}`;
