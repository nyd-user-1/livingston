import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/hooks/useTheme";
import { AppLayout } from "@/layouts/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level code splitting: each page (and its heavy deps — KaTeX, Recharts)
// loads on demand. The Sidebar prefetches chunks on hover, so by the time a
// click lands the code is usually already here.
const Chat = lazy(() => import("@/pages/Chat"));
const Search = lazy(() => import("@/pages/Search"));
const BillSearch = lazy(() => import("@/pages/BillSearch"));
const Features = lazy(() => import("@/pages/Features"));
const Programs = lazy(() => import("@/pages/Programs"));

const queryClient = new QueryClient();

function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 md:px-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Chat />} />
                <Route path="/new-chat" element={<Chat />} />
                <Route path="/c/:sessionId" element={<Chat />} />
                <Route path="/new-search" element={<Search />} />
                {/* /search was the pre-livingston name for the same page */}
                <Route path="/search" element={<BillSearch />} />
                {/* Grants & benefits — the shelf of things you can apply for. */}
                <Route path="/programs" element={<Programs />} />
                <Route path="/medrxiv" element={<Navigate to="/programs" replace />} />
                <Route path="/medrxiv/papers" element={<Navigate to="/programs" replace />} />
                {/* Reached from the account menu. */}
                <Route path="/features" element={<Features />} />
                {/* Everything else — the Papers browser dropped with the corpus
                    (2026-08-28), the bioRxiv section, and any stale bookmark —
                    goes home. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
