export interface FeedEvent {
  id: string;
  event_type: string;
  category: string;
  entity_type: string | null;
  entity_value: string | null;
  display_text: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface FeedEmitPayload {
  event_type: string;
  category?: string;
  entity_type?: string | null;
  entity_value?: string | null;
  display_text: string;
  metadata?: Record<string, unknown>;
}
