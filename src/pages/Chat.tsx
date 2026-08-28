import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useParams, useLocation } from "react-router-dom";
import { ChatInput } from "@/components/ChatInput";
import { DetailBody, type EntityType } from "@/components/EntityDetail";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Search, X } from "lucide-react";
import { useChat, type ChatRoom, type Message } from "@/hooks/useChat";
import { ARCHIVE_LABEL } from "@/hooks/useArchive";
import { subjectTitle } from "@/lib/subjects";
import type { DragEntity } from "@/lib/drag-entity";
import {
  buildFormInterview,
  formById,
  formProgress,
  isActionKey,
  recordedSoFar,
  sectionForKey,
  sectionLabel,
  type ProgramForm,
} from "@/lib/programs";
import type { BuiltPdf } from "@/components/ChatMessage";
import {
  answerCount,
  emptyAnswers,
  loadAnswers,
  mergeAnswers,
  parseAnswerBlocks,
  recallActiveForm,
  rememberActiveForm,
  saveAnswers,
  stripAnswerBlocks,
  type FormAnswers,
} from "@/lib/form-answers";
import { FormProgress } from "@/components/FormProgress";
import { answersMessage, parseFieldBlock, stripFieldBlock } from "@/lib/form-fields";
import { EXPAND_QUESTION } from "@/components/ChatFormFields";
import type { FormNav, FormNavSection } from "@/components/ChatResponseFooter";

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

/**
 * A bill dropped on the input: Penny reads it with the user. The blob is what
 * the card carried (title, sponsor, status, summary, page) — she says what is
 * in it, cites the bill's page for anything she states, and does not pretend
 * to know the full text she was not given.
 */
function buildBillContext(context: string): string {
  return (
    "You are Penny, livingston's assistant. The user attached a New York State bill; here is what is on record for it:\n" +
    context +
    "\n\nTalk it through in plain words: what it would do, who it affects, where it stands and what happens next. " +
    "Say what the summary says, not more — if the full text is not above, say so rather than guessing. " +
    "A statement of fact about the bill ends with a citation to its page, written [[<the Page URL above>]]. " +
    "Never call it law unless the record says it was signed."
  );
}

/* ---- the interview's questions -------------------------------------- */

/** An assistant turn that asked with controls. */
interface Question {
  id: string;
  keys: string[];
  /** The printed section it belongs to, when it can be told. */
  section?: string;
  /** Where `section` came from — reported, so the fallback rate is known. */
  via: "prose" | "keys" | "none";
  answered: boolean;
  /** Its place among the questions of its section, so far: `1 of 2`. */
  ordinal: number;
  count: number;
}

// The prompt tells the model to say where it is ("Section 17 — Employment").
// A heading with the dash or "continued" is the surest sign; failing that the
// last bare "Section N" in the prose (a recap line names the section just
// finished, and the question comes after it); failing that, the keys.
const SECTION_HEAD = /Section\s+(\d+(?:–\d+)?)\s*(?:—|,\s*continued)/g;
const SECTION_ANY = /Section\s+(\d+(?:–\d+)?)/g;

function detectSection(prose: string, keys: string[]): Pick<Question, "section" | "via"> {
  const heads = [...prose.matchAll(SECTION_HEAD)];
  if (heads.length) return { section: heads[heads.length - 1][1], via: "prose" };
  const any = [...prose.matchAll(SECTION_ANY)];
  if (any.length) return { section: any[any.length - 1][1], via: "prose" };
  for (const k of keys) {
    const s = sectionForKey(k);
    if (s) return { section: s, via: "keys" };
  }
  return { via: "none" };
}

function questionsOf(messages: Message[], answers: FormAnswers | null): Question[] {
  const out: Question[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "assistant" || m.isStreaming || m.kind) return;
    const fields = parseFieldBlock(m.content);
    if (!fields) return;
    const keys = fields.map((f) => f.key);
    const next = messages[i + 1];
    const followedByAnswers =
      next?.role === "user" && Object.keys(parseAnswerBlocks(next.content).values).length > 0;
    const answered = keys.some((k) => (answers?.values[k] ?? "").trim() !== "") || followedByAnswers;
    out.push({ id: m.id, keys, answered, ordinal: 1, count: 1, ...detectSection(stripFieldBlock(stripAnswerBlocks(m.content)), keys) });
  });
  // "Section 23 · 1 of 2": number the questions within each section.
  const perSection = new Map<string, Question[]>();
  for (const q of out) {
    if (!q.section) continue;
    if (!perSection.has(q.section)) perSection.set(q.section, []);
    perSection.get(q.section)!.push(q);
  }
  for (const qs of perSection.values()) qs.forEach((q, i) => Object.assign(q, { ordinal: i + 1, count: qs.length }));
  return out;
}

/**
 * What the model recorded from a prose turn: the answers block of the reply
 * that followed it. Shown under the bubble as `Recorded:` chips.
 */
function derivedFrom(messages: Message[], i: number): Record<string, string> | undefined {
  const m = messages[i];
  if (m.role !== "user" || Object.keys(parseAnswerBlocks(m.content).values).length) return undefined;
  const next = messages[i + 1];
  if (!next || next.role !== "assistant" || next.isStreaming || next.kind) return undefined;
  const values = Object.fromEntries(Object.entries(parseAnswerBlocks(next.content).values).filter(([k]) => !isActionKey(k)));
  return Object.keys(values).length ? values : undefined;
}

/** Scroll a question into view and open its accordion. */
function jumpToQuestion(id: string) {
  const el = document.getElementById(`q-${id}`);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  window.dispatchEvent(new CustomEvent(EXPAND_QUESTION, { detail: id }));
}

/** The form's sections, in printed order, with what the interview has done to each. */
function sectionStates(form: ProgramForm, questions: Question[], answers: FormAnswers | null): FormNavSection[] {
  const lastId = questions[questions.length - 1]?.id;
  return form.sections
    .filter((s) => !s.consent)
    .map((s) => {
      const qs = questions.filter((q) => q.section === s.n);
      const allAnswered = qs.length > 0 && qs.every((q) => q.answered);
      const touched = qs.some((q) => q.answered || q.id === lastId);
      const state = answers?.done.includes(s.n) || allAnswered ? "done" : touched ? "progress" : "none";
      return { n: s.n, label: sectionLabel(form, s.n), state, firstId: qs[0]?.id };
    });
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

  const { messages, isLoading, sendMessage, editMessage, appendMessage, stopGeneration, clearMessages, loadSession, sessionId } =
    useChat(room);
  // A paper dragged from the Papers panel onto the input. It stays attached —
  // and rides every message as context — until the chip's ✕ clears it.
  const [attached, setAttached] = useState<DragEntity | null>(null);
  // A dropped form replaces the assistant's job entirely: its interview text is
  // the whole system prompt and /api/chat skips corpus retrieval (mode "form").
  // Anything else attached is a record, and rides in as reading context.
  const filling = attached?.type === "form" ? attached : null;
  const form = filling ? formById(filling.id) : undefined;
  const [answers, setAnswers] = useState<FormAnswers | null>(null);
  // The latest record, for handlers that fire between renders.
  const answersRef = useRef<FormAnswers | null>(null);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  /** Merge into the record, save it, and hand back the result. Action keys never enter it. */
  const record = useCallback(
    (values: Record<string, string>) => {
      if (!filling) return null;
      const kept = Object.fromEntries(Object.entries(values).filter(([k]) => !isActionKey(k)));
      const next = mergeAnswers(answersRef.current ?? emptyAnswers(filling.id), { values: kept, done: [] });
      answersRef.current = next;
      saveAnswers(next, sessionId);
      setAnswers(next);
      return next;
    },
    [filling, sessionId],
  );

  /* ---- the filled form, in the conversation ---------------------------- */
  // `form.fill: yes` is an action, not an answer: the app builds the PDF and
  // shows it as a turn of its own. The blob cannot be saved, so a `form-pdf`
  // turn that comes back from the session is rebuilt from the record.
  const [pdfs, setPdfs] = useState<Record<string, BuiltPdf>>({});
  const building = useRef(new Set<string>());
  const buildPdf = useCallback(
    async (messageId: string) => {
      if (!form || building.current.has(messageId)) return;
      building.current.add(messageId);
      setPdfs((p) => ({ ...p, [messageId]: { building: true } }));
      try {
        const { fillForm } = await import("@/lib/fill-form");
        const bytes = await fillForm(form, answersRef.current ?? emptyAnswers(form.id));
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        setPdfs((p) => {
          if (p[messageId]?.url) URL.revokeObjectURL(p[messageId].url!);
          return { ...p, [messageId]: { url, bytes, building: false } };
        });
      } catch (e) {
        setPdfs((p) => ({ ...p, [messageId]: { building: false, error: (e as Error).message } }));
      } finally {
        building.current.delete(messageId);
      }
    },
    [form],
  );
  /** Yes to the fill question, from the controls or from the model's block. */
  const fillIfAsked = useCallback(
    (values: Record<string, string>) => {
      if (!/^(y|yes|true)$/i.test((values["form.fill"] ?? "").trim())) return;
      const id = appendMessage("form-pdf");
      void buildPdf(id);
    },
    [appendMessage, buildPdf],
  );
  // A session that carries a form-pdf turn gets its document back.
  useEffect(() => {
    if (!form) return;
    for (const m of messages) {
      if (m.kind === "form-pdf" && !pdfs[m.id] && !building.current.has(m.id)) void buildPdf(m.id);
    }
  }, [messages, form, pdfs, buildPdf]);

  /**
   * The form's system prompt, plus the record. History is the last 16
   * turns, so early answers scroll out and a corrected chip never enters
   * it — the RECORDED block is how both reach the model.
   */
  const formContext = useCallback(
    (a: FormAnswers | null = answersRef.current) => {
      if (!filling) return undefined;
      const rec = form && a ? recordedSoFar(form, a) : "";
      return rec ? `${filling.context}\n\n${rec}` : filling.context;
    },
    [filling, form],
  );

  const questions = useMemo(() => (filling ? questionsOf(messages, answers) : []), [messages, answers, filling]);
  const sections = useMemo(() => (form ? sectionStates(form, questions, answers) : []), [form, questions, answers]);
  const lastQuestion = questions[questions.length - 1];
  const navFor = (id: string): FormNav | undefined => {
    const i = questions.findIndex((q) => q.id === id);
    if (i < 0) return undefined;
    return { prevId: questions[i - 1]?.id, nextId: questions[i + 1]?.id, sections, onJump: jumpToQuestion };
  };
  // Progress that does not lag the interview: the open question's section,
  // and every section before it, count as reached.
  const progress = useMemo(() => {
    if (!form || !answers) return undefined;
    const p = formProgress(form, answers, lastQuestion?.section);
    // Sections whose every question is answered are done too.
    const done = new Set(sections.filter((s) => s.state === "done").map((s) => s.n));
    return { ...p, done: Math.max(p.done, done.size) };
  }, [form, answers, lastQuestion, sections]);
  /** "Section 23 · 1 of 2" — a question's place, for its collapsed row. */
  const placeOf = (q: Question) => {
    if (!q.section) return undefined;
    const head = /^\d/.test(q.section) ? `Section ${q.section}` : sectionLabel(form, q.section);
    return q.count > 1 ? `${head} · ${q.ordinal} of ${q.count}` : head;
  };

  // Answers survive the tab. A benefits interview is forty minutes and people
  // get interrupted; losing a refresh must never mean starting over.
  useEffect(() => {
    if (!filling) { setAnswers(null); return; }
    setAnswers(loadAnswers(filling.id, sessionId));
    rememberActiveForm(filling.id, sessionId);
  }, [filling, sessionId]);

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
    const values = Object.fromEntries(Object.entries(found.values).filter(([k]) => !isActionKey(k)));
    setAnswers((prev) => {
      const next = mergeAnswers(prev ?? emptyAnswers(filling.id), { values, done: found.done });
      answersRef.current = next;
      saveAnswers(next, sessionId);
      return next;
    });
    // The model may record a spoken "yes, fill it out" itself.
    fillIfAsked(found.values);
  }, [messages, isLoading, filling, sessionId, fillIfAsked]);
  const submit = (text: string, modelId: string) =>
    filling
      ? sendMessage(text, formContext(), undefined, modelId, "form")
      : sendMessage(
          text,
          attached?.type === "bill" && attached.context
            ? buildBillContext(attached.context)
            : attached?.context
              ? buildSystemContext(attached.context)
              : undefined,
          undefined,
          modelId,
        );
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

      const systemContext = buildSystemContext(context, url);

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
    // The page bleeds up under the floating top bar (AppLayout pads #app-main
    // by --spacing-header; this pulls the scroll pane back up by the same),
    // so the transcript passes beneath the bar and fades, Claude-style.
    <div className="-mt-header flex h-[calc(100%+var(--spacing-header))] min-h-0">
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {hasMessages ? (
        <>
          {/* Messages — scrollable */}
          <div ref={scrollPaneRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[720px] px-2 md:px-4 pb-4 md:pb-8 pt-[calc(var(--spacing-header)+0.5rem)]">
              {messages.map((msg, i) => {
                const q = filling ? questions.find((x) => x.id === msg.id) : undefined;
                return (
                <Suspense key={msg.id} fallback={<div className="mb-6 h-16 animate-pulse rounded-lg bg-muted/40" />}>
                <ChatMessage
                  key={msg.id}
                  id={msg.id}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={msg.isStreaming}
                  sources={msg.sources}
                  pdfUrl={msg.pdfUrl}
                  timestamp={msg.timestamp}
                  form={form}
                  kind={msg.kind}
                  pdf={msg.kind ? pdfs[msg.id] : undefined}
                  record={filling ? answers?.values : undefined}
                  derived={filling ? derivedFrom(messages, i) : undefined}
                  // the question this answer replies to — the grounding check
                  // scores the answer against the papers FOR that question
                  query={
                    msg.role === "assistant"
                      ? messages.slice(0, i).reverse().find((m) => m.role === "user")?.content
                      : undefined
                  }
                  // Every question in form mode, not just the last: an earlier
                  // one renders collapsed and reopens to be corrected.
                  onFieldSubmit={
                    filling
                      ? (values) => {
                          // Record locally first — the answer is the user's, not
                          // the model's recollection of it. Then the model hears
                          // it as a turn, with the whole record riding along.
                          // A yes to the fill question also puts the form in
                          // the conversation, after the reply that is coming.
                          const next = record(values);
                          void sendMessage(answersMessage(values), formContext(next), undefined, undefined, "form");
                          fillIfAsked(values);
                        }
                      : undefined
                  }
                  valueFor={filling ? (key) => answers?.values[key] : undefined}
                  answered={q?.answered}
                  current={q ? q.id === lastQuestion?.id && !q.answered : undefined}
                  sectionLabel={q ? placeOf(q) : undefined}
                  disabled={isLoading}
                  nav={q ? navFor(q.id) : undefined}
                  // Editing a user turn rewrites it in place; chip edits also
                  // land in the record. Nothing is sent to the model.
                  onEdit={(content, changed) => {
                    if (content !== null) editMessage(msg.id, content);
                    if (changed && Object.keys(changed).length) record(changed);
                  }}
                />
                </Suspense>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input pinned to bottom */}
          <div className="px-2 md:px-4 py-3 md:py-4 shrink-0 bg-background">
            {filling && answers && answerCount(answers) > 0 && (
              <FormProgress form={formById(filling.id)} answers={answers} progress={progress} />
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
        <div className="flex flex-1 flex-col items-center justify-center px-4 pt-header">
          {filling && answers && answerCount(answers) > 0 && (
            <div className="w-full">
              <FormProgress form={formById(filling.id)} answers={answers} progress={progress} />
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
      <div className="hidden w-80 shrink-0 overflow-y-auto border-l bg-card p-4 pt-[calc(var(--spacing-header)+1rem)] md:block">
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
