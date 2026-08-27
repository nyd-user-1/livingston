import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface ChatSessionSummary {
  id: string;
  title: string;
  updated_at: string;
}

async function fetchSessions(): Promise<ChatSessionSummary[]> {
  const res = await fetch("/api/chat-sessions");
  if (!res.ok) throw new Error(`chat-sessions ${res.status}`);
  return (await res.json()) as ChatSessionSummary[];
}

/** Sidebar history — Neon via /api/chat-sessions (was Supabase). */
export function useChatSessions() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["chat-sessions"],
    queryFn: fetchSessions,
    staleTime: 1000 * 30,
  });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["chat-sessions"] }); };
  return { ...query, refresh };
}
