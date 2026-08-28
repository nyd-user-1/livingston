import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TexText } from "@/components/TexText";

/** Entity detail body for a chat citation.
 *
 *  Inherited plumbing: a `#cite:type:id` link in an answer opens this panel,
 *  which asks `/api/graph` for the node. That endpoint does not exist in this
 *  repo (nor did it upstream), so the panel reports "Not found in the
 *  corpus" until one is added. Kept because the citation affordance is wired
 *  through the markdown renderer — see REPORT.md. */

export type EntityType = "paper" | "author" | "prompt" | "file";

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="mt-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
      <p className="text-xs text-foreground">{v}</p>
    </div>
  );
}

export function DetailBody({ type, detail, navigate }: {
  type: EntityType;
  detail: Record<string, unknown>;
  navigate: (p: string) => void;
}) {
  const node = (detail.node ?? {}) as Record<string, unknown>;
  const counts = (detail.counts ?? {}) as Record<string, unknown>;
  if (type === "paper") {
    return (
      <div>
        {node.title != null && <p className="mt-2 text-sm font-medium leading-snug text-foreground"><TexText text={String(node.title)} /></p>}
        <Field k="Authors" v={node.authors as string} />
        <Field k="Year" v={node.pub_year as number} />
        <Field k="Reference" v={node.reference as string} />
        {node.abstract != null && <Field k="Abstract" v={<span className="line-clamp-6">{String(node.abstract)}</span>} />}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {node.pdf_stored != null && <Badge variant="secondary" className="text-[10px]">PDF held</Badge>}
          {node.oa_status != null && <Badge variant="outline" className="text-[10px]">{String(node.oa_status)}</Badge>}
        </div>
        <div className="mt-3 rounded-md border bg-muted/30 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Provenance</p>
          <Field k="Source" v={(node.ingest_source as string) ?? "preprint feed"} />
          <Field k="Ingested" v={node.created_at ? String(node.created_at).slice(0, 10) : null} />
          <Field k="S2 enriched" v={node.s2_looked_up_at ? String(node.s2_looked_up_at).slice(0, 10) : node.s2_lookup_status as string} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/?prompt=${encodeURIComponent(`Tell me about ${node.key_number}: ${node.title ?? ""}`)}&key=${encodeURIComponent(String(node.key_number))}`)}>
            Ask livingston
          </Button>
          {node.doi != null && (
            <a href={`https://doi.org/${node.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center rounded-md border px-2 text-xs text-brand hover:bg-muted">
              DOI
            </a>
          )}
        </div>
      </div>
    );
  }
  if (type === "author") {
    return <Field k="Papers in corpus" v={Number(counts.papers ?? 0).toLocaleString()} />;
  }
  return (
    <div>
      {node.title != null && <p className="mt-2 text-sm leading-snug text-foreground">{String(node.title)}</p>}
      <Field k="Year" v={node.year as number} />
      <Field k="Authors" v={node.authors as string} />
    </div>
  );
}
