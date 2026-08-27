/**
 * One drag payload for the whole workspace: canvas cards, rail rows, search
 * hits and detail-panel headers all set `application/x-corpus-entity`; the canvas
 * (add at drop point) and the chat dock (attach as context) both read it.
 */

import { buildFormInterview, formById } from "@/lib/programs";

export const ENTITY_MIME = "application/x-corpus-entity";

export interface DragEntity {
  type: "paper" | "author" | "form" | "prompt" | "file" | "more";
  id: string;
  label: string;
  sub?: string;
  title?: string | null;
  /**
   * A prebuilt record blob for the chat's system context. When the dragged card
   * already holds the record — the search results and the Papers panel do — it
   * travels with the drag and `describeEntity` needs no network call at all.
   */
  context?: string;
}

export function setDragEntity(dt: DataTransfer, g: DragEntity) {
  const payload: DragEntity = { type: g.type, id: g.id, label: g.label, sub: g.sub, title: g.title, context: g.context };
  dt.setData(ENTITY_MIME, JSON.stringify(payload));
  dt.setData("text/plain", `${g.type} ${g.label}`);
  dt.effectAllowed = "copy";
}

export function readDragEntity(dt: DataTransfer | null): DragEntity | null {
  if (!dt) return null;
  try {
    const raw = dt.getData(ENTITY_MIME);
    if (!raw) return null;
    const g = JSON.parse(raw);
    return g && typeof g.type === "string" && typeof g.id === "string" ? (g as DragEntity) : null;
  } catch {
    return null;
  }
}

/** The record behind an entity, as a system-context paragraph for /api/chat. */
export async function describeEntity(g: DragEntity | null): Promise<string> {
  if (!g) return "";
  const head = "ACTIVE CONTEXT — the user attached this entity to the conversation:";
  // The card carried the record with it — nothing to fetch.
  if (g.context) return `${head}\n${g.context}`;
  if (g.type === "form") {
    const f = formById(g.id);
    return f ? buildFormInterview(f) : `${head}
FORM ${g.label}`;
  }
  if (g.type === "paper") {
    try {
      const d = await fetch(`/api/graph?op=node&type=paper&id=${encodeURIComponent(g.id)}`).then((r) => r.json());
      const n = d.node ?? {};
      return `${head}\nPAPER ${g.id}: "${n.title ?? g.title ?? ""}" (${n.pub_year ?? ""})${n.authors ? `\nAuthors: ${String(n.authors).slice(0, 300)}` : ""}${n.reference ? `\nReference: ${n.reference}` : ""}${n.abstract ? `\nAbstract: ${String(n.abstract).slice(0, 1200)}` : ""}`;
    } catch {
      return `${head}\nPAPER ${g.id}: ${g.title ?? ""}`;
    }
  }
  return `${head}\n${g.type.toUpperCase()} ${g.label}${g.sub ? ` (${g.sub})` : ""}${g.title ? ` — ${g.title}` : ""}`;
}

/* ------------------------------------------------------------------ */
/*  Papers                                                             */
/* ------------------------------------------------------------------ */

/** The fields a paper card carries. Structural, so any row shape satisfies it. */
export interface PaperLike {
  key_number: string;
  title: string;
  pub_year?: number | null;
  authors?: string | null;
  reference?: string | null;
  doi?: string | null;
  categories?: string[] | null;
  abstract?: string | null;
}

/** The record as the chat's context blob — the shape `/chat?context=` already sends. */
export function paperContext(r: PaperLike): string {
  return [
    `Title: ${r.title}`,
    r.authors ? `Authors: ${r.authors}` : null,
    `Key Number: ${r.key_number}`,
    r.pub_year ? `Year: ${r.pub_year}` : null,
    r.reference ? `Reference: ${r.reference}` : null,
    r.doi ? `DOI: ${r.doi}` : null,
    r.categories?.length ? `Category: ${r.categories.join(", ")}` : null,
    r.abstract ? `Abstract: ${r.abstract.slice(0, 1500)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A paper as a drag payload, record blob included. */
export function paperEntity(r: PaperLike): DragEntity {
  return {
    type: "paper",
    id: r.key_number,
    label: r.key_number,
    title: r.title,
    sub: [r.pub_year, r.authors?.split(";")[0]?.trim()].filter(Boolean).join(" · ") || undefined,
    context: paperContext(r),
  };
}
