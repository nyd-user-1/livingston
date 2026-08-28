import type { DragEntity } from "@/lib/drag-entity";
import { buildFormInterview, type ProgramForm } from "@/lib/programs";

/** A form as a drag payload. The interview rides with the drag, so the drop needs no fetch. */
export function formEntity(f: ProgramForm): DragEntity {
  return {
    type: "form",
    id: f.id,
    label: f.code,
    title: f.title,
    sub: `${f.pages} pages`,
    context: buildFormInterview(f),
  };
}
