import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowUp, Copy, Check, FileText } from "lucide-react";
import type { CorpusRecord } from "@/types/record";
import { highlightText } from "@/lib/highlight";
import type { SearchMode } from "@/hooks/useRecordSearch";
import { useFeedEmitter } from "@/hooks/useFeedEmitter";
import { ARCHIVE_LABEL } from "@/hooks/useArchive";
import { subjectTitle } from "@/lib/subjects";

interface RecordCardProps {
  record: CorpusRecord;
  searchQuery?: string;
  searchMode?: SearchMode;
  onClick?: () => void;
}

export const RecordCard = memo(function RecordCard({ record, searchQuery, searchMode, onClick }: RecordCardProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const { emit } = useFeedEmitter();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = [
      `${record.key_number} (${record.pub_year})`,
      record.title,
      record.authors ?? "",
      record.reference ?? "",
      record.doi ? `DOI: ${record.doi}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSendToChat = (e: React.MouseEvent) => {
    e.stopPropagation();

    const prompt = `Tell me about "${record.title}"${
      record.authors ? ` by ${record.authors}` : ""
    }. What is the significance of this research?`;

    const context = [
      `Title: ${record.title}`,
      record.authors ? `Authors: ${record.authors}` : null,
      `Key Number: ${record.key_number}`,
      `Year: ${record.pub_year}`,
      record.reference ? `Reference: ${record.reference}` : null,
      record.doi ? `DOI: ${record.doi}` : null,
      record.categories?.length ? `Category: ${record.categories.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const url = record.doi ? `https://doi.org/${record.doi}` : "";

    const params = new URLSearchParams({ prompt, context });
    if (url) params.set("url", url);

    // The prompt and the record context ride the URL; Chat auto-submits them.
    navigate(`/?${params.toString()}`);

    emit({
      event_type: "record_inquiry",
      category: "chat",
      entity_type: "preprint",
      entity_value: record.key_number,
      display_text: `Inquired about ${record.key_number}: "${record.title.slice(0, 60)}"`,
      metadata: { doi: record.doi },
    });
  };

  return (
    <div
      onClick={onClick}
      className="group relative rounded-lg border border-border/40 bg-muted/40 p-4 pb-14 md:p-6 md:pb-16 min-h-[280px] transition-all hover:shadow-lg hover:border-border active:shadow-lg active:border-border cursor-pointer"
    >
      {/* Title leads the card; the key number lives in the footer link. */}
      {/* Match-percentage badge removed 2026-08-20 — see the note in Search.tsx: the
          hybrid list mixes cosine and lexical scores on one visual scale. */}
      <div className="flex items-start gap-2 mb-3">
        <p className="text-base font-bold text-foreground leading-snug line-clamp-2">
          {searchMode === "keyword" && searchQuery
            ? highlightText(record.title, searchQuery)
            : record.title}
        </p>
        <FileText className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" />
      </div>

      {record.abstract && (
        <p className="text-sm text-foreground leading-snug mb-3 line-clamp-3">
          {record.abstract}
        </p>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {/* Row 1, Col 1: Authors */}
        <div className="min-w-0">
          {record.authors && (
            <>
              <span className="text-muted-foreground">Authors</span>
              <p className="font-medium truncate">
                {(() => {
                  const names = record.authors.split(";").map((n) => n.trim());
                  const display = names.length <= 3
                    ? record.authors
                    : names.slice(0, 3).join("; ") + "; et al.";
                  return searchMode === "keyword" && searchQuery
                    ? highlightText(display, searchQuery)
                    : display;
                })()}
              </p>
            </>
          )}
        </div>

        {/* Row 1, Col 2: Subject */}
        <div className="min-w-0">
          {record.categories && record.categories.length > 0 && (
            <>
              <span className="text-muted-foreground">Subject</span>
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {record.categories.slice(0, 3).map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-foreground/80"
                  >
                    {subjectTitle(cat)}
                  </span>
                ))}
                {record.categories.length > 3 && (
                  <span className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    +{record.categories.length - 3}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Row 2, Col 1: Reference — the archive, plainly */}
        <div className="min-w-0">
          <span className="text-muted-foreground">Reference</span>
          <p className="font-medium truncate">
            {record.server
              ? ARCHIVE_LABEL[record.server]
              : (record.reference ?? "").replace(/\s*\(.*\)\s*$/, "") || "—"}
          </p>
        </div>

      </div>

      {/* Bottom bar: DOI left, action buttons right */}
      <div className="absolute bottom-3 left-4 md:bottom-4 md:left-6 right-4 flex items-center justify-between">
        {record.doi ? (
          <a
            href={`https://doi.org/${record.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-brand hover:underline truncate max-w-[60%]"
          >
            {record.key_number}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">{record.key_number}</span>
        )}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground shadow-lg transition-all hover:scale-110"
          title="Copy reference details"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          onClick={handleSendToChat}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-all hover:scale-110"
          title="Ask sam about this preprint"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        </div>
      </div>
    </div>
  );
});
