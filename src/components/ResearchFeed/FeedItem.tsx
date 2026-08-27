import { useNavigate } from "react-router-dom";
import {
  Search,
  MessageSquare,
  ArrowUp,
  FlaskConical,
  Layers,
  TrendingUp,
  Star,
} from "lucide-react";
import type { FeedEvent } from "@/types/feed";

const INSIGHT_TYPES = new Set([
  "new_in_field",
  "high_impact_paper",
]);

const CLICKABLE_TYPES = new Set([
  "chat_started",
  "record_inquiry",
  "semantic_search",
  "keyword_search",
  "category_filter",
  "journal_filter",
]);

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function cleanDisplayText(event: FeedEvent): string {
  const { event_type, display_text } = event;
  switch (event_type) {
    case "chat_started":
      // Remove "Started chat: " and/or "Tell me about" prefixes
      return display_text
        .replace(/^Started\s+chat:\s*/i, "")
        .replace(/^Tell\s+me\s+about:?\s*/i, "")
        .replace(/^["'\u201C\u201D]+/, "");
    case "record_inquiry":
      // Remove "Inquired about XXXX:" prefix — show the part after the colon
      return display_text.replace(/^Inquired about\s+\S+:\s*/i, "");
    case "category_filter":
      // "Filtered by category epidemiology" → "Category epidemiology"
      return display_text.replace(/^Filtered by\s+category/i, "Category");
    case "journal_filter":
      // "Filtered by journal BMJ" → "Journal BMJ"
      return display_text.replace(/^Filtered by\s+journal/i, "Journal");
    default:
      return display_text;
  }
}

function buildFeedItemPath(event: FeedEvent): string | null {
  const { event_type, entity_value, metadata } = event;

  switch (event_type) {
    case "chat_started": {
      const sid = metadata?.session_id as string | undefined;
      return sid ? `/c/${sid}` : null;
    }
    case "record_inquiry":
      return entity_value
        ? `/papers?q=${encodeURIComponent(entity_value)}&mode=keyword`
        : null;
    case "semantic_search":
      return entity_value
        ? `/papers?q=${encodeURIComponent(entity_value)}&mode=semantic`
        : null;
    case "keyword_search":
      return entity_value
        ? `/papers?q=${encodeURIComponent(entity_value)}&mode=keyword`
        : null;
    case "category_filter":
      return entity_value
        ? `/papers?category=${encodeURIComponent(entity_value)}`
        : null;
    case "journal_filter":
      return entity_value
        ? `/papers?journal=${encodeURIComponent(entity_value)}`
        : null;
    default:
      return null;
  }
}

const ICON_MAP: Record<string, typeof Search> = {
  semantic_search: Search,
  keyword_search: Search,
  chat_started: MessageSquare,
  record_inquiry: ArrowUp,
  category_filter: Layers,
  journal_filter: TrendingUp,
  // Insight types
  new_in_field: FlaskConical,
  high_impact_paper: Star,
  s2_citation_update: ArrowUp,
  paper_ingested: Layers,
};

interface FeedItemProps {
  event: FeedEvent;
}

export function FeedItem({ event }: FeedItemProps) {
  const navigate = useNavigate();
  const Icon = ICON_MAP[event.event_type] ?? Search;
  const isInsight = INSIGHT_TYPES.has(event.event_type);
  const isClickable = CLICKABLE_TYPES.has(event.event_type);
  const displayText = cleanDisplayText(event);

  const handleClick = () => {
    const path = buildFeedItemPath(event);
    if (path) navigate(path);
  };

  return (
    <div
      onClick={isClickable ? handleClick : undefined}
      className={
        isInsight
          ? "group flex items-start gap-2.5 px-4 py-2.5 cursor-pointer hover:bg-green-500/15 rounded-md transition-colors"
          : `group flex items-start gap-2.5 px-4 py-2.5${
              isClickable
                ? " cursor-pointer hover:bg-muted rounded-md transition-colors"
                : ""
            }`
      }
    >
      <Icon className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${isInsight ? "text-green-400" : "text-muted-foreground group-hover:text-foreground transition-colors"}`} />
      {isInsight ? (
        <>
          <span className="flex-1 text-xs font-semibold text-green-400 leading-snug truncate">
            {displayText.split("(")[0].trim()}
          </span>
          <span className="text-[10px] text-green-400/70 flex-shrink-0 mt-0.5">
            {timeAgo(event.created_at)}
          </span>
        </>
      ) : (
        <>
          <span className="flex-1 text-xs text-muted-foreground group-hover:text-foreground leading-snug truncate transition-colors">
            {displayText}
          </span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5 transition-colors">
            {timeAgo(event.created_at)}
          </span>
        </>
      )}
    </div>
  );
}
