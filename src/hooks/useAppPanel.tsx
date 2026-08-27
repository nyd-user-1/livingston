import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AppPanel } from "@/components/AppPanel";

/**
 * Global open/close for the app-shell push panel. Any page can call
 * `openPanel({ title, content })`; the panel itself lives in AppLayout and
 * outlives route changes.
 */
interface PanelSpec {
  title: React.ReactNode;
  content: React.ReactNode;
  footer?: React.ReactNode;
  detailHref?: string;
  defaultExpanded?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}
interface PanelCtx {
  open: boolean;
  openPanel: (spec: PanelSpec) => void;
  closePanel: () => void;
}
const Ctx = createContext<PanelCtx>({ open: false, openPanel: () => {}, closePanel: () => {} });

export function AppPanelProvider({ children, portalRoot }: { children: React.ReactNode; portalRoot: React.RefObject<HTMLDivElement | null> }) {
  const [spec, setSpec] = useState<PanelSpec | null>(null);
  const [gen, setGen] = useState(0);
  const openPanel = useCallback((s: PanelSpec) => { setSpec(s); setGen((g) => g + 1); }, []);
  const closePanel = useCallback(() => setSpec(null), []);
  const value = useMemo(() => ({ open: !!spec, openPanel, closePanel }), [spec, openPanel, closePanel]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <AppPanel
        resetKey={gen}
        root={portalRoot.current}
        open={!!spec}
        onClose={closePanel}
        title={spec?.title ?? ""}
        footer={spec?.footer}
        detailHref={spec?.detailHref}
        onPrev={spec?.onPrev}
        onNext={spec?.onNext}
        defaultExpanded={spec?.defaultExpanded}
        bodyClass="flex flex-col"
      >
        {spec?.content}
      </AppPanel>
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAppPanel = () => useContext(Ctx);
