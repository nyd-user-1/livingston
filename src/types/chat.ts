/** A chat message as persisted in chat_sessions.messages (Neon, sql/03). */
export interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  pdfUrl?: string;
  /** A turn the app made, not the model. `form-pdf` = the filled form was shown here. */
  kind?: "form-pdf";
  sources?: {
    // `nsr` is the NSR-era wire key for corpus records. It is persisted inside
    // saved chat sessions, so renaming it orphans every stored session's source
    // chips — keep the key, treat it as "records from our corpus".
    nsr: Array<{
      key_number: string; title: string; doi?: string | null; similarity: number;
      categories?: string[] | null; server?: string | null; fulltext?: boolean;
    }>;
    s2: Array<{ title: string; url: string; authors: string; citations: number }>;
    fulltext?: Array<{ key_number: string; source: string; chars: number }>;
    room?: { server: string; category: string; widened: boolean };
  };
}
