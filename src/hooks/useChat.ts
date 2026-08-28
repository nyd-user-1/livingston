import { useState, useCallback, useRef } from "react";
import { useChatPersistence } from "./useChatPersistence";
import type { PersistedMessage } from "@/types/chat";

export interface MessageSources {
  nsr: Array<{
    key_number: string;
    title: string;
    doi?: string | null;
    similarity: number;
    categories?: string[] | null;
    server?: string | null;
    /** true when the body was fetched and read, not just the abstract */
    fulltext?: boolean;
  }>;
  s2: Array<{
    title: string;
    url: string;
    authors: string;
    citations: number;
  }>;
  /** which records the generator read in full, and from where */
  fulltext?: Array<{ key_number: string; source: string; chars: number }>;
  /** the subject this turn was scoped to, and whether retrieval widened past it */
  room?: { server: string; category: string; widened: boolean };
}

/** A room: the scope set by navigation. Rides every request when present. */
export interface ChatRoom {
  server: "biorxiv" | "medrxiv";
  category: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  sources?: MessageSources;
  pdfUrl?: string;
  /** When it was said. Set once, at creation; the user bubble shows the date. */
  timestamp?: string;
  /** `form-pdf`: a turn the app made, not the model — the filled form. */
  kind?: "form-pdf";
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

/** The words a `form-pdf` turn carries in the saved session (the PDF itself is rebuilt). */
export const FORM_PDF_PLACEHOLDER = "(The filled form was shown here.)";

function toPersistedMessages(msgs: Message[]): PersistedMessage[] {
  return msgs
    .filter((m) => m.content && !m.isStreaming)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      // Keep the original time. This used to stamp "now" on every save, so
      // every message in a session carried the time of the last one.
      timestamp: m.timestamp ?? new Date().toISOString(),
      ...(m.pdfUrl ? { pdfUrl: m.pdfUrl } : {}),
      ...(m.sources ? { sources: m.sources } : {}),
      ...(m.kind ? { kind: m.kind } : {}),
    }));
}

export function useChat(room?: ChatRoom | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const persistence = useChatPersistence();

  const sendMessage = useCallback(
    async (userText: string, systemContext?: string, pdfUrl?: string, modelId?: string, mode?: "form") => {
      const now = new Date().toISOString();
      const userMsg: Message = {
        id: makeId(),
        role: "user",
        content: userText,
        timestamp: now,
      };

      const assistantMsg: Message = {
        id: makeId(),
        role: "assistant",
        content: "",
        isStreaming: true,
        timestamp: now,
        ...(pdfUrl ? { pdfUrl } : {}),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      // Create session on first message
      let sessionId = persistence.currentSessionId;
      if (!sessionId) {
        const title = userText.slice(0, 80);
        try {
          sessionId = await persistence.createSession(title, [
            {
              id: userMsg.id,
              role: "user",
              content: userText,
              timestamp: new Date().toISOString(),
            },
          ]);

          // Fire-and-forget feed event
          fetch("/api/feed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_type: "chat_started", category: "chat", display_text: `Started chat: "${title}"`, metadata: { session_id: sessionId } }),
            keepalive: true,
          }).catch(() => {});
        } catch {
          // continue without persistence
        }
      }

      // Build conversation history for the Edge Function. The app's own turns
      // (the filled form) are not conversation and never reach the model.
      const historyMessages = messagesRef.current
        .filter((m) => !m.kind)
        .slice(-10)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      try {
        abortRef.current = new AbortController();

        const res = await fetch(
          // Our own API route (Neon retrieval + Bedrock generation) — the
          // Supabase edge function is retired.
          `/api/chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messages: historyMessages,
              userMessage: userText,
              systemContext: systemContext || undefined,
              mode,
              // The picker's choice. Omitted → the function falls back to its
              // own default, so an older client keeps working.
              modelId: modelId || undefined,
              // The room set by navigation — scope rides every request.
              room: room ?? undefined,
            }),
            signal: abortRef.current.signal,
          }
        );

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Chat error ${res.status}: ${err}`);
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let parsedSources: MessageSources | undefined;
        let isFirstDataLine = true;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6);
              if (data === "[DONE]") break;

              try {
                const parsed = JSON.parse(data);

                // First data event contains sources metadata
                if (isFirstDataLine && parsed.sources) {
                  isFirstDataLine = false;
                  parsedSources = parsed.sources as MessageSources;
                  continue;
                }
                isFirstDataLine = false;

                // Remaining events are OpenAI streaming deltas
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  accumulated += delta;
                  const current = accumulated;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, content: current, isStreaming: true }
                        : m
                    )
                  );
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
        }

        // Mark streaming complete
        const finalContent = accumulated;
        const finalSources = parsedSources;
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: finalContent,
                  isStreaming: false,
                  sources: finalSources,
                }
              : m
          );

          // Persist completed messages
          if (sessionId) {
            persistence.updateMessages(sessionId, toPersistedMessages(updated));
          }

          return updated;
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: `Error: ${message}`,
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [persistence, room]
  );

  const loadSession = useCallback(
    async (sessionId: string) => {
      const session = await persistence.loadSession(sessionId);
      if (session) {
        persistence.setCurrentSessionId(session.id);
        setMessages(
          session.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            ...(m.timestamp ? { timestamp: m.timestamp } : {}),
            ...(m.pdfUrl ? { pdfUrl: m.pdfUrl } : {}),
            ...(m.sources ? { sources: m.sources as MessageSources } : {}),
            ...(m.kind ? { kind: m.kind } : {}),
          }))
        );
        return session;
      }
      return null;
    },
    [persistence]
  );

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
    // Mark any streaming messages as complete
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
  }, []);

  const clearMessages = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setMessages([]);
    setIsLoading(false);
    persistence.setCurrentSessionId(null);
  }, [persistence]);

  /**
   * Rewrite one message in place — in state and in the saved session. No
   * branch, no regeneration: this app has no branching, and in a form
   * interview "retry" would mean re-asking the question. The transcript
   * stays put; only the words (or the chips) change.
   */
  const editMessage = useCallback(
    (id: string, content: string) => {
      const updated = messagesRef.current.map((m) => (m.id === id ? { ...m, content } : m));
      messagesRef.current = updated;
      setMessages(updated);
      const sessionId = persistence.currentSessionId;
      if (sessionId) void persistence.updateMessages(sessionId, toPersistedMessages(updated));
    },
    [persistence],
  );

  /**
   * A turn the app makes itself — the filled form — appended after whatever
   * is there (including a reply still streaming) and saved with the session.
   * Returns its id so the page can attach the built document to it.
   */
  const appendMessage = useCallback(
    (kind: NonNullable<Message["kind"]>, content = FORM_PDF_PLACEHOLDER) => {
      const msg: Message = { id: makeId(), role: "assistant", content, kind, timestamp: new Date().toISOString() };
      const updated = [...messagesRef.current, msg];
      messagesRef.current = updated;
      setMessages((prev) => [...prev, msg]);
      const sessionId = persistence.currentSessionId;
      if (sessionId) void persistence.updateMessages(sessionId, toPersistedMessages(updated));
      return msg.id;
    },
    [persistence],
  );

  return {
    messages,
    isLoading,
    sendMessage,
    editMessage,
    appendMessage,
    stopGeneration,
    clearMessages,
    loadSession,
    sessionId: persistence.currentSessionId,
  };
}
