import { useState, useEffect, useMemo } from "react";
import type { FeedEvent } from "@/types/feed";

const MAX_EVENTS = 50;
const TRENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TrendingItem {
  value: string;
  count: number;
}

export function useResearchFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/feed");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as FeedEvent[];
        if (alive) { setEvents(data.slice(0, MAX_EVENTS)); setIsConnected(true); }
      } catch { if (alive) setIsConnected(false); }
    };
    load();
    // Supabase realtime is gone; a light poll keeps the panel fresh.
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Trending: top 5 entity_values by frequency in last 24h
  const trending = useMemo<TrendingItem[]>(() => {
    const cutoff = Date.now() - TRENDING_WINDOW_MS;
    const counts: Record<string, number> = {};

    for (const e of events) {
      if (!e.entity_value) continue;
      if (new Date(e.created_at).getTime() < cutoff) continue;
      counts[e.entity_value] = (counts[e.entity_value] ?? 0) + 1;
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  }, [events]);

  return { events, isConnected, trending };
}
