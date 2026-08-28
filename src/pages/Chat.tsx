import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useParams, useLocation } from "react-router-dom";
import { ChatInput } from "@/components/ChatInput";
import { DetailBody, type EntityType } from "@/components/EntityDetail";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Search, X } from "lucide-react";
import { useChat, type ChatRoom } from "@/hooks/useChat";
import { ARCHIVE_LABEL } from "@/hooks/useArchive";
import { subjectTitle } from "@/lib/subjects";
import type { DragEntity } from "@/lib/drag-entity";
import { buildFormInterview, formById } from "@/lib/programs";
import {
  answerCount,
  emptyAnswers,
  loadAnswers,
  mergeAnswers,
  parseAnswerBlocks,
  recallActiveForm,
  rememberActiveForm,
  saveAnswers,
  type FormAnswers,
} from "@/lib/form-answers";
import { FormProgress } from "@/components/FormProgress";
import { answersMessage } from "@/lib/form-fields";

// ChatMessage drags in react-markdown + KaTeX (~200 KB gz). A fresh landing
// renders zero messages, so that weight loads only once a conversation exists.
const ChatMessage = lazy(() =>
  import("@/components/ChatMessage").then((m) => ({ default: m.ChatMessage })),
);

/** The visible scope: a ribbon appended to the top of the input container —
 *  same construction as the Search page's SEARCH MODE banner. The X exits the
 *  agent, back to the archive's agent list. */
/** The form ribbon — same construction as the agent ribbon: appended to the top
 *  of the input container so the chat input reads as belonging to the form. */
function FormRibbon({ label, title, onExit }: { label: string; title?: string | null; onExit: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="-mb-2 flex items-center gap-1.5 rounded-t-2xl border border-b-0 border-border bg-muted/60 px-4 pb-4 pt-2 text-[11px] text-muted-foreground">
        <ClipboardList className="h-3 w-3 shrink-0" />
        <span className="shrink-0 uppercase tracking-wide">Filling</span>
        <span className="shrink-0 font-mono text-foreground">{label}</span>
        {title && <span className="truncate">— {title}</span>}
        <button
          onClick={onExit}
          aria-label="Stop filling this form"
          className="ml-auto shrink-0 rounded hover:text-foreground"
          title="Stop filling this form"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function AgentRibbon({ room, onExit }: { room: ChatRoom; onExit: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="-mb-2 flex items-center gap-1.5 rounded-t-2xl border border-b-0 border-border bg-muted/60 px-4 pb-4 pt-2 text-[11px] text-muted-foreground">
        <Search className="h-3 w-3 shrink-0" />
        <span className="truncate uppercase tracking-wide">
          {subjectTitle(room.category)} Agent
        </span>
        <button
          onClick={onExit}
          aria-label="Exit this agent"
          className="ml-auto shrink-0 rounded hover:text-foreground"
          title="Exit this agent"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * The chat's system context for a record-grounded question — the wording the
 * `?prompt=&context=` path has always sent. One definition now, because a paper
 * dropped on the input has to arrive with exactly the same framing as a paper
 * clicked through from a card.
 */
function buildSystemContext(context?: string | null, url?: string | null): string {
  let s =
    "You are livingston, an AI research assistant for the biomedical and life-science " +
    "preprint literature. You help researchers explore bioRxiv and medRxiv " +
    "preprints. Preprints have not been peer reviewed — say so " +
    "when it bears on how a finding should be read, and note when a preprint has since " +
    "been published in a journal.";
  if (context) {
    s += "\n\nThe user is asking about a specific preprint. Here is the record data:\n" + context;
  }
  if (url) {
    s += "\n\nThe paper is available at: " + url + "\nReference this DOI link in your response.";
  }
  // Task 1c: structure creates slots, and slots get filled. The old wording here
  // asked for "a thorough analysis of … significance" — an invitation to scaffold
  // sections and fabricate into them. Plain prose, grounded.
  s +=
    "\n\nOrganize the answer so it can be read: markdown headings for its two or " +
    "three real divisions, lists where items are parallel, bold for the term that " +
    "carries a sentence. Never open a section you cannot fill from the supplied " +
    "record or its retrieved full text. Report what they actually say, and when " +
    "they do not answer something, say so rather than completing plausibly.";
  return s;
}

export default function Chat() {
  const [searchParams] = useSearchParams();
  const { sessionId: routeSessionId, category: routeCategory } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // The SCOPE. Set by navigation (an agent or subject card click landed here),
  // never by a widget: /:archive/agents/:category mounts this same page with
  // the scope pre-applied, and it rides every request the conversation makes.
  // (/medrxiv/subjects/:category is the pre-subjects URL — still honored.)
  const room: ChatRoom | null = useMemo(() => {
    if (!routeCategory) return null;
    const m = location.pathname.match(/^\/(medrxiv|biorxiv)\/(?:agents|rooms)\//);
    return m
      ? { server: m[1] as ChatRoom["server"], category: decodeURIComponent(routeCategory).toLowerCase() }
      : null;
  }, [routeCategory, location.pathname]);

  const { messages, isLoading, sendMessage, stopGeneration, clearMessages, loadSession, sessionId } =
    useChat(room);
  // A paper dragged from the Papers panel onto the input. It stays attached —
  // and rides every message as context — until the chip's ✕ clears it.
  const [attached, setAttached] = useState<DragEntity | null>(null);
  // A dropped form replaces the assistant's job entirely: its interview text is
  // the whole system prompt and /api/chat skips corpus retrieval (mode "form").
  // Anything else attached is a record, and rides in as reading context.
  const filling = attached?.type === "form" ? attached : null;
  const [answers, setAnswers] = useState<FormAnswers | null>(null);

  // Answers survive the tab. A benefits interview is forty minutes and people
  // get interrupted; losing a refresh must never mean starting over.
  useEffect(() => {
    if (!filling) { setAnswers(null); return; }
    setAnswers(loadAnswers(filling.id, sessionId));
    rememberActiveForm(filling.id, sessionId);
  }, [filling?.id, sessionId]);

  // Coming back to a conversation that was filling something: re-attach the
  // form so the ribbon, the placeholder and form mode all return with it.
  // A programme handed over from the browse grid takes precedence — that is a
  // fresh intent, not a resumed one.
  useEffect(() => {
    if (attached) return;
    const handed = sessionStorage.getItem("livingston-open-form");
    if (handed) sessionStorage.removeItem("livingston-open-form");
    const id = handed ?? recallActiveForm(sessionId);
    if (!id) return;
    const f = formById(id);
    if (!f) return;
    setAttached({
      type: "form",
      id: f.id,
      label: f.code,
      title: f.title,
      sub: `${f.pages} pages`,
      context: buildFormInterview(f),
    });
  }, [sessionId, attached]);

  // Harvest the machine block out of each finished assistant turn.
  useEffect(() => {
    if (!filling || isLoading) return;
    const last = messages[messages.length - 1];
    if (!last?.content) return;
    const found = parseAnswerBlocks(last.content);
    if (!Object.keys(found.values).length && !found.done.length) return;
    setAnswers((prev) => {
      const next = mergeAnswers(prev ?? emptyAnswers(filling.id), found);
      saveAnswers(next, sessionId);
      return next;
    });
  }, [messages, isLoading, filling, sessionId]);
  const submit = (text: string, modelId: string) =>
    filling
      ? sendMessage(text, filling.context, undefined, modelId, "form")
      : sendMessage(text, attached?.context ? buildSystemContext(attached.context) : undefined, undefined, modelId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollPaneRef = useRef<HTMLDivElement>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [entity, setEntity] = useState<{ type: EntityType; id: string } | null>(null);
  const [entityDetail, setEntityDetail] = useState<Record<string, unknown> | null>(null);

  // Inline citations dispatch open-entity; the panel shows the record.
  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent).detail as { type: EntityType; id: string };
      setEntity(d);
      setEntityDetail(null);
      fetch(`/api/graph?op=node&type=${d.type}&id=${encodeURIComponent(d.id)}`)
        .then((r) => r.json())
        .then(setEntityDetail)
        .catch(() => setEntityDetail({ error: true }));
    }
    window.addEventListener("open-entity", onOpen);
    return () => window.removeEventListener("open-entity", onOpen);
  }, []);
  const loadedSessionRef = useRef<string | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Late-arriving footer content (the /api/similar follow-ups) grows the
  // transcript after that scroll has already run. Re-pin to the bottom, but
  // only when the reader is still there — never yank someone who has scrolled
  // up to re-read.
  useEffect(() => {
    function onFollowups() {
      const pane = scrollPaneRef.current;
      if (!pane) return;
      const distanceFromBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      if (distanceFromBottom < 240) {
        requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    }
    window.addEventListener("followups-rendered", onFollowups);
    return () => window.removeEventListener("followups-rendered", onFollowups);
  }, []);

  // Cmd+Shift+O → new chat
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        clearMessages();
        navigate("/new-chat");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clearMessages, navigate]);

  // Load existing session from route param, or clear for new chat
  useEffect(() => {
    if (routeSessionId && routeSessionId !== loadedSessionRef.current) {
      loadedSessionRef.current = routeSessionId;
      loadSession(routeSessionId);
    } else if (!routeSessionId && loadedSessionRef.current) {
      // Navigated to "/" or "/new-chat" from a session — start fresh
      loadedSessionRef.current = null;
      clearMessages();
    }
  }, [routeSessionId, loadSession, clearMessages]);

  // Update URL when session is created (without remounting). Skipped inside a
  // room: rewriting to /c/:id would drop the subject from the URL and a refresh
  // would silently land the user on an unscoped chat.
  useEffect(() => {
    if (sessionId && !routeSessionId && !room && messages.length > 0 && !isLoading) {
      window.history.replaceState(null, "", `/c/${sessionId}`);
    }
  }, [sessionId, routeSessionId, room, messages.length, isLoading]);

  // Listen for "new-chat" event from Sidebar (handles replaceState URL mismatch)
  useEffect(() => {
    function handler() {
      loadedSessionRef.current = null;
      setAutoSubmitted(false);
      clearMessages();
    }
    window.addEventListener("new-chat", handler);
    return () => window.removeEventListener("new-chat", handler);
  }, [clearMessages]);

  // Auto-submit from URL params (from reference card click)
  useEffect(() => {
    if (autoSubmitted || routeSessionId) return;

    const prompt = searchParams.get("prompt");
    const context = searchParams.get("context");
    const url = searchParams.get("url");

    if (prompt) {
      setAutoSubmitted(true);

      let systemContext = buildSystemContext(context, url);

      // Point the PDF viewer at /api/pdf, which resolves the canonical URL and the
      // Google-viewer wrapper. Prefer an explicit ?key= from the caller; fall back to the
      // DOI suffix, which is our business key. Deriving is the fallback rather than the
      // rule because only the caller knows the key for certain — a DOI link could be to
      // the published journal article, whose suffix is not ours.
      const keyParam = searchParams.get("key")?.trim();
      const keyFromDoi = url?.includes("/") ? url.split("/").pop()!.trim() : "";
      const pdfKey = keyParam || keyFromDoi;
      const viewerUrl = pdfKey ? `/api/pdf?key=${encodeURIComponent(pdfKey)}` : url || undefined;

      sendMessage(prompt, systemContext, viewerUrl);
      // Strip the params but KEEP the agent path — rewriting to "/" would drop
      // the scope from the URL mid-conversation.
      navigate(room ? location.pathname : "/", { replace: true });
    }
  }, [searchParams, autoSubmitted, routeSessionId, sendMessage, navigate, room, location.pathname]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full min-h-0">
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {hasMessages ? (
        <>
          {/* Messages — scrollable */}
          <div ref={scrollPaneRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[720px] px-2 md:px-4 py-4 md:py-8">
              {messages.map((msg, i) => (
                <Suspense key={msg.id} fallback={<div className="mb-6 h-16 animate-pulse rounded-lg bg-muted/40" />}>
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={msg.isStreaming}
                  sources={msg.sources}
                  pdfUrl={msg.pdfUrl}
                  // the question this answer replies to — the grounding check
                  // scores the answer against the papers FOR that question
                  query={
                    msg.role === "assistant"
                      ? messages.slice(0, i).reverse().find((m) => m.role === "user")?.content
                      : undefined
                  }
                  onFieldSubmit={
                    filling && i === messages.length - 1
                      ? (values) => {
                          // Record locally first — the answer is the user's, not
                          // the model's recollection of it.
                          setAnswers((prev) => {
                            const next = mergeAnswers(prev ?? emptyAnswers(filling.id), { values, done: [] });
                            saveAnswers(next, sessionId);
                            return next;
                          });
                          void sendMessage(answersMessage(values), filling.context, undefined, undefined, "form");
                        }
                      : undefined
                  }
                />
                </Suspense>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input pinned to bottom */}
          <div className="px-2 md:px-4 py-3 md:py-4 shrink-0 bg-background">
            {filling && answers && answerCount(answers) > 0 && (
              <FormProgress form={formById(filling.id)} answers={answers} />
            )}
            {filling && <FormRibbon label={filling.label} title={filling.title} onExit={() => { rememberActiveForm(null, sessionId); setAttached(null); }} />}
            {room && <AgentRibbon room={room} onExit={() => navigate("/new-chat")} />}
            <ChatInput
              onSubmit={submit}
              onStop={stopGeneration}
              isLoading={isLoading}
              searchToggle
              attached={filling ? null : attached}
              onAttach={setAttached}
              placeholder={filling ? `Answering ${filling.label}…` : room ? `Chat with the ${ARCHIVE_LABEL[room.server]} ${subjectTitle(room.category)} preprints…` : undefined}
            />
          </div>
        </>
      ) : (
        /* Empty state — input vertically centered */
        <div className="flex flex-1 flex-col items-center justify-center px-4">
          {filling && answers && answerCount(answers) > 0 && (
            <div className="w-full">
              <FormProgress form={formById(filling.id)} answers={answers} />
            </div>
          )}
          {filling && (
            <div className="w-full">
              <FormRibbon label={filling.label} title={filling.title} onExit={() => { rememberActiveForm(null, sessionId); setAttached(null); }} />
            </div>
          )}
          {room && (
            <div className="w-full">
              <AgentRibbon room={room} onExit={() => navigate("/new-chat")} />
            </div>
          )}
          <ChatInput
            onSubmit={submit}
            isLoading={isLoading}
            searchToggle
            attached={filling ? null : attached}
            onAttach={setAttached}
            placeholder={filling ? `Answering ${filling.label}…` : room ? `Chat with the ${ARCHIVE_LABEL[room.server]} ${subjectTitle(room.category)} preprints…` : undefined}
          />
        </div>
      )}
    </div>
    {entity && (
      <div className="hidden w-80 shrink-0 overflow-y-auto border-l bg-card p-4 md:block">
        <div className="mb-2 flex items-start justify-between">
          <Badge variant="secondary" className="text-[10px]">{entity.type}</Badge>
          <button onClick={() => setEntity(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <h2 className="font-mono text-sm font-semibold text-brand">{entity.id}</h2>
        {!entityDetail && <p className="mt-3 text-xs text-muted-foreground">Loading…</p>}
        {entityDetail && !entityDetail.error && (
          <DetailBody type={entity.type} detail={entityDetail} navigate={navigate} />
        )}
        {entityDetail?.error === true && <p className="mt-3 text-xs text-muted-foreground">Not found in the corpus.</p>}
      </div>
    )}
    </div>
  );
}
