import { useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { List, Activity, FileText, ClipboardList, Info, X } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { ResearchFeed, type FeedMode } from "@/components/ResearchFeed";
import { Tooltip as Hint } from "@/components/ui/tooltip";
import { AppPanelProvider } from "@/hooks/useAppPanel";
import { useRecentPapers } from "@/hooks/useRecentPapers";

export function AppLayout() {
  // Warm the Papers panel's query as the app mounts, so the first open renders
  // from cache rather than a spinner. One request per session; the endpoint is
  // edge-cached for an hour behind that.
  useRecentPapers();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // One panel, two contents: the live feed and the newest papers. Holding the
  // mode rather than a boolean means the two buttons share the panel instead of
  // fighting over it — clicking the other one swaps the content, clicking the
  // same one closes it.
  const [panel, setPanel] = useState<FeedMode | null>(null);
  const feedOpen = panel !== null;
  const toggle = (m: FeedMode) => setPanel((p) => (p === m ? null : m));
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const panelRoot = useRef<HTMLDivElement | null>(null);

  return (
    <AppPanelProvider portalRoot={panelRoot}>
    <div className="flex h-dvh bg-background p-0 md:p-4">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile backdrop */}
      {(sidebarOpen || feedOpen) && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => { setSidebarOpen(false); setPanel(null); }}
        />
      )}

      {/* App wrapper — rounded border container */}
      <div
        id="app-shell-panel"
        className="relative flex flex-1 flex-col min-w-0 md:rounded-xl md:border bg-background overflow-hidden"
        onClick={() => {}}
      >
        {/* Top bar — inside the wrapper. Positioned + z-10 + opaque so a collapsed
            ExpandFrame (z-0, glued to its scrolled slot) passes UNDER it, not over. */}
        <div className="relative z-10 flex items-center justify-between border-b bg-background px-4 py-2 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="inline-flex items-center justify-center h-10 w-10 rounded-md text-foreground hover:bg-muted transition-colors"
          >
            <List className="h-5 w-5" />
          </button>

          {/* Search bar portal target — filled by page components */}
          <div id="header-search" className="flex-1 mx-2" />

          <div className="flex items-center gap-0.5">
            <Hint label="Forms you can fill" side="bottom">
              <button
                onClick={() => toggle("forms")}
                aria-label="Forms"
                aria-pressed={panel === "forms"}
                className={`inline-flex items-center justify-center h-10 w-10 rounded-md transition-colors hover:bg-muted ${panel === "forms" ? "bg-muted text-foreground" : "text-foreground"}`}
              >
                <ClipboardList className="h-5 w-5" />
              </button>
            </Hint>
            <Hint label="Recent papers" side="bottom">
              <button
                onClick={() => toggle("papers")}
                aria-label="Recent papers"
                aria-pressed={panel === "papers"}
                className={`inline-flex items-center justify-center h-10 w-10 rounded-md transition-colors hover:bg-muted ${panel === "papers" ? "bg-muted text-foreground" : "text-foreground"}`}
              >
                <FileText className="h-5 w-5" />
              </button>
            </Hint>
            <Hint label="Live feed" side="bottom">
              <button
                onClick={() => toggle("activity")}
                aria-label="Live feed"
                aria-pressed={panel === "activity"}
                className={`inline-flex items-center justify-center h-10 w-10 rounded-md transition-colors hover:bg-muted ${panel === "activity" ? "bg-muted text-foreground" : "text-foreground"}`}
              >
                <Activity className="h-5 w-5" />
              </button>
            </Hint>
          </div>
        </div>

        {/* Page content */}
        <main id="app-main" className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* App-shell push panel portal target — see components/AppPanel + hooks/useAppPanel */}
      <div id="app-panel-root" ref={panelRoot} className="flex shrink-0 h-full" />

      <ResearchFeed isOpen={feedOpen} mode={panel ?? "activity"} onClose={() => setPanel(null)} />

      {/* Pinned info button */}
      <button
        onClick={() => setDisclaimerOpen(true)}
        className="fixed bottom-5 right-[30px] z-50 inline-flex items-center justify-center h-10 w-10 rounded-md text-foreground hover:bg-muted transition-colors"
      >
        <Info className="h-5 w-5" />
      </button>

      {/* Disclaimer dialog */}
      {disclaimerOpen && (
        <>
          <div
            className="fixed inset-0 z-[200] bg-black/50 animate-in fade-in duration-150"
            onClick={() => setDisclaimerOpen(false)}
          />
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-md rounded-xl border bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-150 p-6">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-lg font-semibold">Disclaimer</h2>
                <button
                  onClick={() => setDisclaimerOpen(false)}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                sam is an independent project and is not affiliated with, endorsed by, or sponsored by medRxiv.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed mt-3">
                Preprint metadata is publicly available from the medRxiv API. Preprints are not peer reviewed. This application is provided as-is for research and educational purposes.
              </p>
              <button
                onClick={() => setDisclaimerOpen(false)}
                className="mt-5 w-full rounded-lg bg-foreground text-background py-2 text-sm font-medium hover:bg-foreground/85 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </>
      )}
    </div>
    </AppPanelProvider>
  );
}
