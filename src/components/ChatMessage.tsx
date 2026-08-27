import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { parseAnswerBlocks, stripAnswerBlocks } from "@/lib/form-answers";
import { parseFieldBlock, stripFieldBlock } from "@/lib/form-fields";
import { ChatFormFields } from "@/components/ChatFormFields";
import { ChatResponseFooter } from "./ChatResponseFooter";

// Inline citations: preprint key numbers in the response become live chips that
// open the entity panel (a scientific corpus answers with receipts).
// Preprint keys are the bare DOI suffix, e.g. 2022.01.16.476506. The 68,139 legacy
// keys that are bare 6-digit numbers (e.g. 549931) are deliberately NOT matched:
// an unanchored 6-digit number in prose is far more often a quantity than a key,
// and a wrong chip is worse than a missing one.
const KEY_RE = /\b((?:19|20)\d{2}\.\d{2}\.\d{2}\.\d{5,})\b(?!\]|\))/g;
const citeMarkdown = (md: string) =>
  md.replace(KEY_RE, (m) => `[${m}](#cite:paper:${m})`);

import type { MessageSources } from "@/hooks/useChat";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  sources?: MessageSources;
  pdfUrl?: string;
  /** the question this answer replies to — the grounding check needs it */
  query?: string;
  /** Set while a form is driving; submitting the inline fields answers the turn. */
  onFieldSubmit?: (values: Record<string, string>) => void;
}

export function ChatMessage({
  role,
  content: rawContent,
  isStreaming,
  sources,
  query,
  pdfUrl,
  onFieldSubmit,
}: ChatMessageProps) {
  // Both blocks are machinery, not conversation.
  const content = stripFieldBlock(stripAnswerBlocks(rawContent));
  const fields = onFieldSubmit && !isStreaming ? parseFieldBlock(rawContent) : null;
  if (role === "user") {
    // Submitting the inline fields sends an answers block as the user's turn.
    // Show what was sent, not an empty bubble.
    const sent = !content.trim() ? parseAnswerBlocks(rawContent).values : null;
    return (
      <div className="flex justify-end mb-6">
        <div className="bg-muted/40 rounded-lg p-3 md:p-4 border-0 max-w-[90%] md:max-w-[70%]">
          {sent && Object.keys(sent).length ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {Object.entries(sent).map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px]"
                  title={k}
                >
                  <span className="text-muted-foreground">{k.split(".").pop()?.replace(/\[\d+\]/, "")}</span>
                  <span className="font-medium text-foreground">{v}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-base leading-relaxed">{content}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 max-w-[720px]">
      <div className="space-y-3 text-base">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => (
              <p className="mb-3 leading-relaxed text-foreground">{children}</p>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">
                {children}
              </strong>
            ),
            // Headings carry top margin so sections separate visually — the
            // difference between the NSR answer and a wall of text.
            h1: ({ children }) => (
              <h1 className="text-xl font-semibold mb-3 mt-6 first:mt-0 text-foreground">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-lg font-semibold mb-2 mt-6 first:mt-0 text-foreground">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-base font-semibold mb-2 mt-5 first:mt-0 text-foreground">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="text-sm font-semibold mb-1 mt-4 first:mt-0 text-foreground">
                {children}
              </h4>
            ),
            hr: () => <hr className="my-5 border-border" />,
            ul: ({ children }) => (
              <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal pl-6 space-y-1 my-2">{children}</ol>
            ),
            li: ({ children }) => (
              <li className="text-foreground text-base leading-relaxed">{children}</li>
            ),
            a: ({ href, children }) => {
              if (href?.startsWith("#cite:")) {
                const [, type, id] = href.slice(1).split(":");
                return (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent("open-entity", { detail: { type, id } }))}
                    className="mx-0.5 inline-flex items-center rounded border bg-muted/40 px-1 font-mono text-[0.85em] font-semibold text-brand transition-colors hover:bg-muted"
                    title={`Open ${id}`}
                  >
                    {children}
                  </button>
                );
              }
              return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="link-wipe break-all text-blue-500"
              >
                {children}
              </a>
              );
            },
          }}
        >
          {citeMarkdown(content)}
          {fields && onFieldSubmit && <ChatFormFields fields={fields} onSubmit={onFieldSubmit} />}
        </ReactMarkdown>
        {isStreaming && !content && (
          <span className="inline-block w-1.5 h-4 bg-foreground animate-pulse" />
        )}
      </div>
      <ChatResponseFooter content={content} isStreaming={isStreaming} sources={sources} pdfUrl={pdfUrl} query={query} />
    </div>
  );
}
