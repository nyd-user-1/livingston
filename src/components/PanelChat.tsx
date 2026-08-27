import { lazy, Suspense, useRef, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { ChatInput } from "@/components/ChatInput";
import type { CorpusRecord } from "@/types/record";

const ChatMessage = lazy(() => import("./ChatMessage").then((m) => ({ default: m.ChatMessage })));

interface Msg { role: "user" | "assistant"; content: string }

/** The record, as system context for the model — same recipe as the graph's chat dock. */
function describeRecord(r: CorpusRecord): string {
  const lines = [
    `## Attached preprint record`,
    `key_number: ${r.key_number}`,
    r.title ? `title: ${r.title}` : "",
    r.authors ? `authors: ${r.authors}` : "",
    r.reference ? `reference: ${r.reference}` : "",
    r.pub_year ? `year: ${r.pub_year}` : "",
    r.doi ? `doi: ${r.doi}` : "",
    r.categories?.length ? `category: ${r.categories.join(", ")}` : "",
    r.status_tags?.length ? `status: ${r.status_tags.join(", ")}` : "",
    r.published_journal ? `published in: ${r.published_journal}` : "",
    r.abstract ? `abstract: ${r.abstract}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Chat about one record, inside the app-shell push panel. Streams from
 * /api/chat with the record prepended as system context; the same citation
 * chips as /chat.
 */
export function PanelChat({ record }: { record: CorpusRecord }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = async (text: string, modelId: string) => {
    if (!text || busy) return;
    const history = msgs;
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, userMessage: text, modelId, systemContext: describeRecord(record) }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`chat ${res.status}`);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ") || line.includes('"sources"')) continue;
          try {
            const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setMsgs((m) => { const n = [...m]; n[n.length - 1] = { role: "assistant", content: acc }; return n; });
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
            }
          } catch { /* [DONE] and keepalives */ }
        }
      }
      if (!acc) setMsgs((m) => { const n = [...m]; n[n.length - 1] = { role: "assistant", content: "(no answer came back — try again)" }; return n; });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMsgs((m) => { const n = [...m]; n[n.length - 1] = { role: "assistant", content: `Error: ${(e as Error).message}` }; return n; });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {msgs.length === 0 && (
          <p className="text-xs text-muted-foreground px-1 py-2">
            Ask about this paper — its title, authors, keywords, nuclides, reactions and abstract are already in context.
          </p>
        )}
        <Suspense fallback={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}>
          {msgs.map((m, i) => (
            <ChatMessage key={i} role={m.role} content={m.content} isStreaming={busy && i === msgs.length - 1 && m.role === "assistant"} />
          ))}
        </Suspense>
      </div>
      <div className="px-2 pb-2">
        {/* the attached-record ribbon, tucked behind the input container (same recipe as the graph dock) */}
        <div className="-mb-2 flex min-w-0 items-center gap-1.5 rounded-t-2xl border border-b-0 bg-muted/60 px-4 pb-4 pt-2 text-[11px] text-muted-foreground">
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="shrink-0 uppercase tracking-wide">paper</span>
          <span className="shrink-0 font-mono text-foreground">{record.key_number}</span>
          <span className="min-w-0 truncate">— {record.title}</span>
        </div>
        <div className="relative [&_.rounded-2xl]:p-2.5 [&_textarea]:text-sm">
          <ChatInput onSubmit={send} isLoading={busy} onStop={() => abortRef.current?.abort()} />
        </div>
      </div>
    </div>
  );
}
