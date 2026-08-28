import { useResearchFeed } from "@/hooks/useResearchFeed";
import { FeedHeader } from "./FeedHeader";
import { FeedItem } from "./FeedItem";
import { PapersList } from "./PapersList";
import { FormsList } from "./FormsList";

/** What the panel is showing. Same shell, same width, same open/close. */
export type FeedMode = "activity" | "papers" | "forms";

interface ResearchFeedProps {
  isOpen: boolean;
  /** `activity` is the live feed; `papers` is the newest preprints, draggable. */
  mode?: FeedMode;
  onClose?: () => void;
}

export function ResearchFeed({ isOpen, mode = "activity" }: ResearchFeedProps) {
  const { events } = useResearchFeed();
  const papers = mode === "papers";
  const forms = mode === "forms";

  return (
    <aside
      className={`${
        isOpen ? "w-[300px]" : "w-0"
      } flex-shrink-0 transition-all duration-200 ease-in-out fixed inset-y-0 right-0 z-50 md:relative md:inset-auto md:z-auto ${
        isOpen ? "overflow-visible" : "overflow-hidden"
      }`}
    >
      <div className="w-[300px] h-full flex flex-col bg-background">
        <FeedHeader label={forms ? "Grants & Benefits" : papers ? "Bills" : "Live Feed"} />

        <div className="flex-1 overflow-y-auto">
          {forms ? (
            <FormsList />
          ) : papers ? (
            // Mounts instantly: AppLayout warms the same react-query key on app
            // mount, so this reads from cache and never shows a spinner. The
            // rows are not kept in the DOM while the feed is showing — the
            // prefetch, not a hidden render, is what makes opening feel free.
            <PapersList />
          ) : events.length === 0 ? (
            <p className="px-4 py-8 text-xs text-muted-foreground text-center">
              Activity will appear here as you explore
            </p>
          ) : (
            events.map((event) => <FeedItem key={event.id} event={event} />)
          )}
        </div>
      </div>
    </aside>
  );
}
