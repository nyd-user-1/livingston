import type { ReactNode } from "react";

/**
 * Wrap each case-insensitive occurrence of `query` in a tinted <mark>, so a
 * match is visible in the text rather than merely implied by the row being
 * present.
 *
 * Lifted out of RecordCard, where it was private, so the search results, the
 * reference cards and the Papers panel all mark hits the same way.
 *
 * ⚠ The test is the index, not `regex.test(part)`. A `g`-flagged regex carries
 * `lastIndex` between calls, so testing each part in turn skips every other
 * match — the original silently left half of them unmarked. `split` with a
 * capture group already puts the matches on the odd indices.
 */
export function highlightText(text: string, query: string | undefined | null): ReactNode {
  const q = query?.trim();
  if (!q || !text) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-brand/20 text-foreground rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
