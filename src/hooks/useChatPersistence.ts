import { useCallback, useState } from "react";
import type { PersistedMessage } from "@/types/chat";

const api = (path: string, init?: RequestInit) => fetch(`/api/chat-sessions${path}`, { headers: { "Content-Type": "application/json" }, ...init });

export interface ChatSessionData {
  id: string;
  title: string;
  messages: PersistedMessage[];
}

export function useChatPersistence() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const createSession = useCallback(
    async (title: string, initialMessages: PersistedMessage[] = []) => {
      setIsSaving(true);
      try {
        const res = await api("", { method: "POST", body: JSON.stringify({ title, messages: initialMessages }) });
        if (!res.ok) throw new Error(`create ${res.status}`);
        const data = (await res.json()) as { id: string };
        setCurrentSessionId(data.id);
        return data.id;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const updateMessages = useCallback(
    async (sessionId: string, messages: PersistedMessage[]) => {
      setIsSaving(true);
      try {
        const res = await api(`?id=${sessionId}`, { method: "PATCH", body: JSON.stringify({ messages }) });
        if (!res.ok) throw new Error(`update ${res.status}`);
        return true;
      } catch {
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const loadSession = useCallback(
    async (sessionId: string): Promise<ChatSessionData | null> => {
      const res = await api(`?id=${sessionId}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { id: string; title: string; messages: PersistedMessage[] | null };
      return { id: data.id, title: data.title, messages: data.messages ?? [] };
    },
    []
  );

  const deleteSession = useCallback(async (sessionId: string) => {
    await api(`?id=${sessionId}`, { method: "DELETE" });
  }, []);

  return {
    currentSessionId,
    setCurrentSessionId,
    isSaving,
    createSession,
    updateMessages,
    loadSession,
    deleteSession,
  };
}
