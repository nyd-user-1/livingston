import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Renders a plain string that may contain inline TeX in titles
 * (e.g. `$\alpha$-synuclein aggregation`). Non-math text
 * passes through untouched; malformed TeX falls back to raw text
 * rather than throwing mid-render.
 */
export function TexText({ text }: { text: string }) {
  if (!text || !text.includes("$")) return <>{text}</>;
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith("$") && part.endsWith("$") ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(part.slice(1, -1), {
                throwOnError: false,
              }),
            }}
          />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
