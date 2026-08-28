import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Check, ChevronLeft, ChevronRight, Copy, Info, Pencil } from "lucide-react";
import { parseAnswerBlocks, stripAnswerBlocks } from "@/lib/form-answers";
import { answersMessage, parseFieldBlock, stripFieldBlock } from "@/lib/form-fields";
import { labelFor, sectionLabel as sectionTitle, type ProgramForm } from "@/lib/programs";
import { loadFormPages, pageExcerpt } from "@/lib/form-pages";
import { ChatFormFields } from "@/components/ChatFormFields";
import { ChatResponseFooter, type FormNav } from "./ChatResponseFooter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import type { MessageSources } from "@/hooks/useChat";

// Inline citations: preprint key numbers in the response become live chips that
// open the entity panel (a scientific corpus answers with receipts).
// Preprint keys are the bare DOI suffix, e.g. 2022.01.16.476506. The 68,139 legacy
// keys that are bare 6-digit numbers (e.g. 549931) are deliberately NOT matched:
// an unanchored 6-digit number in prose is far more often a quantity than a key,
// and a wrong chip is worse than a missing one.
const KEY_RE = /\b((?:19|20)\d{2}\.\d{2}\.\d{2}\.\d{5,})\b(?!\]|\))/g;

// Penny cites the form: `[[p.8 §15]]` is a page and a section of the form in
// hand. A run of them — `[[p.2 §3]] [[p.3 §6]]` — becomes one chip with
// arrows, so a sentence never trails a row of pills.
const FORM_CITE = /\[\[p\.(\d+)(?:\s*§\s*([^\]]+?))?\s*\]\]/g;
const FORM_CITE_RUN = /\[\[p\.\d+(?:\s*§[^\]]*)?\]\](?:[ \t]*\[\[p\.\d+(?:\s*§[^\]]*)?\]\])*/g;

function citeMarkdown(md: string, form?: ProgramForm): string {
  let out = md.replace(KEY_RE, (m) => `[${m}](#cite:paper:${m})`);
  if (form) {
    out = out.replace(FORM_CITE_RUN, (run) => {
      const refs = [...run.matchAll(FORM_CITE)].map((m) => `${m[1]}:${encodeURIComponent((m[2] ?? "").trim())}`);
      return `[cite](#cite:form:${refs.join(",")})`;
    });
  }
  return out;
}

interface CiteRef {
  page: number;
  section: string;
}

/** The chip, in the policy repo's pill style, and the page it points at. */
function FormCitePill({ form, refs }: { form: ProgramForm; refs: CiteRef[] }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<string[] | null | undefined>(undefined);

  // The page text is not in the bundle and not in the prompt: it arrives on
  // the first click and stays cached in form-pages.ts.
  useEffect(() => {
    if (!open || pages !== undefined) return;
    let live = true;
    loadFormPages(form.id).then((p) => {
      if (live) setPages(p);
    });
    return () => {
      live = false;
    };
  }, [open, pages, form.id]);

  const r = refs[Math.min(i, refs.length - 1)];
  const first = refs[0];
  const label = `${form.code} · p.${first.page}${first.section ? ` §${first.section}` : ""}${refs.length > 1 ? ` +${refs.length - 1}` : ""}`;
  const title = r.section ? sectionTitle(form, r.section) : `Page ${r.page}`;
  const excerpt = pages === undefined ? "Loading…" : pages ? pageExcerpt(pages[r.page - 1]) || "No text on this page." : "Page text not available.";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 align-baseline text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground"
          title={`${form.code}, page ${first.page}`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</span>
          {refs.length > 1 && (
            <div className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
              <button
                type="button"
                aria-label="Previous citation"
                onClick={() => setI((v) => (v - 1 + refs.length) % refs.length)}
                className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="tabular-nums">
                {i + 1}/{refs.length}
              </span>
              <button
                type="button"
                aria-label="Next citation"
                onClick={() => setI((v) => (v + 1) % refs.length)}
                className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        <p className="line-clamp-6 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">{excerpt}</p>
        {form.pdf && (
          <a
            href={`${form.pdf}#page=${r.page}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block border-t border-border px-3 py-2 text-[12px] text-foreground transition-colors hover:bg-muted"
          >
            Open page {r.page} ↗
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}

const shortDate = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/**
 * The user's turn. A plain bubble, or chips when the turn was the inline
 * controls' answers block. Hover shows the date and two buttons: edit and
 * copy. No retry — in a form interview that would mean re-asking the
 * question, and this app does not branch.
 *
 * Saving an edit rewrites this message where it stands and, for chips, puts
 * the changed values in the record. Nothing is sent to the model.
 */
function UserTurn({
  rawContent,
  content,
  timestamp,
  onEdit,
}: {
  rawContent: string;
  content: string;
  timestamp?: string;
  onEdit?: (content: string, changed?: Record<string, string>) => void;
}) {
  const sent = !content.trim() ? parseAnswerBlocks(rawContent).values : null;
  const chips = sent && Object.keys(sent).length ? sent : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [chipDraft, setChipDraft] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !textarea.current) return;
    const el = textarea.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draft]);

  const start = () => {
    if (chips) setChipDraft({ ...chips });
    else setDraft(content);
    setEditing(true);
    requestAnimationFrame(() => textarea.current?.focus());
  };
  const cancel = () => setEditing(false);
  const dirty = chips
    ? Object.entries(chipDraft).some(([k, v]) => v.trim() !== chips[k])
    : draft.trim() !== "" && draft.trim() !== content.trim();
  const save = () => {
    if (!dirty || !onEdit) return;
    if (chips) {
      const all = Object.fromEntries(Object.entries(chipDraft).map(([k, v]) => [k, v.trim()]));
      const changed = Object.fromEntries(Object.entries(all).filter(([k, v]) => v !== chips[k]));
      onEdit(answersMessage(all), changed);
    } else {
      onEdit(draft.trim());
    }
    setEditing(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };
  const copy = async () => {
    const text = chips ? Object.entries(chips).map(([k, v]) => `${labelFor(k)}: ${v}`).join("\n") : content;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const bubble = "rounded-2xl bg-muted/40 px-4 py-3 dark:bg-muted";
  const date = shortDate(timestamp);

  if (editing) {
    return (
      <div className="group/user mb-6 flex flex-col items-end">
        <div className="w-full max-w-[90%] md:max-w-[85%]">
          {chips ? (
            <div className={`${bubble} flex flex-wrap justify-end gap-1.5`} onKeyDown={onKey}>
              {Object.entries(chipDraft).map(([k, v]) => (
                <label
                  key={k}
                  title={k}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25"
                >
                  <span className="text-muted-foreground">{labelFor(k)}:</span>
                  <input
                    value={v}
                    onChange={(e) => setChipDraft((p) => ({ ...p, [k]: e.target.value }))}
                    style={{ width: `${Math.max(v.length, 2) + 1}ch` }}
                    className="min-w-[2ch] bg-transparent font-medium text-foreground outline-none"
                  />
                </label>
              ))}
            </div>
          ) : (
            <textarea
              ref={textarea}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-base leading-relaxed text-foreground outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/25"
            />
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <Tooltip label="Saving updates your answer on the form. The conversation is not regenerated." wide>
              <button
                type="button"
                aria-label="What saving does"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <Info className="h-4 w-4" />
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg bg-secondary px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty}
              className="rounded-lg bg-foreground px-3 py-1.5 text-[13px] font-medium text-background transition-colors disabled:bg-neutral-500 disabled:text-neutral-100"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/user mb-6 flex flex-col items-end">
      <div className={`${bubble} max-w-[90%] md:max-w-[70%]`}>
        {chips ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {Object.entries(chips).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px]"
                title={k}
              >
                <span className="text-muted-foreground">{labelFor(k)}:</span>
                <span className="font-medium text-foreground">{v}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-base leading-relaxed">{content}</p>
        )}
      </div>
      {/* Below-right, on hover. Touch devices have no hover, so there it is
          always on at reduced opacity. */}
      <div className="mt-1 flex items-center gap-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/user:opacity-100 pointer-coarse:opacity-60">
        {date && <span className="mr-1.5">{date}</span>}
        {onEdit && (
          <button
            type="button"
            onClick={start}
            aria-label="Edit"
            title="Edit"
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy"
          title="Copy"
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

interface ChatMessageProps {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  sources?: MessageSources;
  pdfUrl?: string;
  timestamp?: string;
  /** the question this answer replies to — the grounding check needs it */
  query?: string;
  /** The form being filled, when one is. Citations and labels come from it. */
  form?: ProgramForm;
  /** Set while a form is driving: submitting the inline fields answers the turn,
   *  or — on an earlier question — corrects it. */
  onFieldSubmit?: (values: Record<string, string>) => void;
  /** The record, as a getter: what the controls prefill from. */
  valueFor?: (key: string) => string | undefined;
  answered?: boolean;
  current?: boolean;
  sectionLabel?: string;
  disabled?: boolean;
  nav?: FormNav;
  /** User turns only: rewrite this message in place. */
  onEdit?: (content: string, changed?: Record<string, string>) => void;
}

export function ChatMessage({
  id,
  role,
  content: rawContent,
  isStreaming,
  sources,
  query,
  pdfUrl,
  timestamp,
  form,
  onFieldSubmit,
  valueFor,
  answered,
  current,
  sectionLabel,
  disabled,
  nav,
  onEdit,
}: ChatMessageProps) {
  // Both blocks are machinery, not conversation.
  const content = stripFieldBlock(stripAnswerBlocks(rawContent));
  const fields = onFieldSubmit && !isStreaming ? parseFieldBlock(rawContent) : null;
  if (role === "user") {
    return <UserTurn rawContent={rawContent} content={content} timestamp={timestamp} onEdit={onEdit} />;
  }

  const isQuestion = Boolean(fields);

  return (
    // A question gets a stable DOM id so the footer chevrons and the section
    // menu can scroll to it; scroll-mt keeps it out from under the top bar.
    <div id={isQuestion ? `q-${id}` : undefined} className="mb-6 max-w-[720px] scroll-mt-header">
      <div className="space-y-3 text-base">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => (
              <p className="mb-3 leading-relaxed text-foreground last:mb-0">{children}</p>
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
              <ul className="list-disc pl-5 mb-3 space-y-1 last:mb-0">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal pl-6 space-y-1 my-2 last:mb-0">{children}</ol>
            ),
            li: ({ children }) => (
              <li className="text-foreground text-base leading-relaxed">{children}</li>
            ),
            a: ({ href, children }) => {
              if (href?.startsWith("#cite:form:") && form) {
                const refs: CiteRef[] = href
                  .slice("#cite:form:".length)
                  .split(",")
                  .map((r) => {
                    const [page, section = ""] = r.split(":");
                    return { page: Number(page), section: decodeURIComponent(section) };
                  })
                  .filter((r) => Number.isFinite(r.page) && r.page > 0);
                return refs.length ? <FormCitePill form={form} refs={refs} /> : null;
              }
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
                className="link-wipe break-all text-brand"
              >
                {children}
              </a>
              );
            },
          }}
        >
          {citeMarkdown(content, form)}
        </ReactMarkdown>
        {fields && onFieldSubmit && (
          <ChatFormFields
            fields={fields}
            onSubmit={onFieldSubmit}
            disabled={disabled}
            questionId={id}
            valueFor={valueFor}
            answered={answered}
            current={current}
            sectionLabel={sectionLabel}
          />
        )}
        {isStreaming && !content && (
          <span className="inline-block w-1.5 h-4 bg-foreground animate-pulse" />
        )}
      </div>
      <ChatResponseFooter
        content={content}
        isStreaming={isStreaming}
        sources={sources}
        pdfUrl={pdfUrl}
        query={query}
        formNav={isQuestion ? nav : undefined}
      />
    </div>
  );
}
