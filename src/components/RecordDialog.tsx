import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TexText } from "@/components/TexText";
import type { CorpusRecord } from "@/types/record";

/** Record detail in a dialog — the stand-in until a /record/:key page exists. */
export function RecordDialog({ record, open, onOpenChange }: { record: CorpusRecord | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!record) return null;
  const rows: [string, React.ReactNode][] = [];
  if (record.authors) rows.push(["Authors", record.authors]);
  if (record.reference) rows.push(["Reference", record.reference]);
  if (record.pub_year) rows.push(["Year", String(record.pub_year)]);
  if (record.reference_type) rows.push(["Type", record.reference_type]);
  if (record.doi) rows.push(["DOI", <a key="doi" href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline"><ExternalLink className="h-3 w-3" />{record.doi}</a>]);
  if (record.categories?.length) rows.push(["Category", record.categories.join(", ")]);
  if (record.status_tags?.length) rows.push(["Status", record.status_tags.join(", ")]);
  if (record.published_journal) rows.push(["Published in", record.published_journal]);
  if (record.institution) rows.push(["Institution", record.institution]);
  if (record.citation_count != null) rows.push(["Citations", String(record.citation_count)]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm text-muted-foreground">{record.key_number}</DialogTitle>
          <DialogDescription className="text-base text-foreground leading-snug"><TexText text={record.title ?? ""} /></DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">
          <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-2.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground pt-0.5">{k}</dt>
                <dd className="min-w-0 break-words text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          {record.keywords && (
            <section className="text-sm">
              <h3 className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Keyword abstract</h3>
              <p className="leading-relaxed text-foreground"><TexText text={record.keywords} /></p>
            </section>
          )}
          {record.abstract && (
            <section className="text-sm">
              <h3 className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Abstract</h3>
              <p className="leading-relaxed text-foreground"><TexText text={record.abstract} /></p>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
