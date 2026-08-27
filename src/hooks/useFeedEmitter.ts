import { useCallback, useRef } from "react";
import type { FeedEmitPayload } from "@/types/feed";

const RATE_LIMIT_MS = 30_000;

export function useFeedEmitter() {
  const lastEmitRef = useRef<Record<string, number>>({});

  const emit = useCallback((payload: FeedEmitPayload) => {
    const now = Date.now();
    const key = payload.event_type;
    if (now - (lastEmitRef.current[key] ?? 0) < RATE_LIMIT_MS) return;
    lastEmitRef.current[key] = now;

    fetch("/api/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: payload.event_type,
        category: payload.category ?? "activity",
        entity_type: payload.entity_type ?? null,
        entity_value: payload.entity_value ?? null,
        display_text: payload.display_text,
        metadata: payload.metadata ?? {},
      }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  return { emit };
}
