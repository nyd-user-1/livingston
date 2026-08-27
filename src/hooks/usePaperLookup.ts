import { useQuery } from "@tanstack/react-query";

export interface PaperData {
  title: string | null;
  abstract: string | null;
  authors: string[];
  year: number | null;
  citationCount: number | null;
  venue: string | null;
  openAccessPdfUrl: string | null;
  doi: string;
}

/** Extract a DOI from a `https://doi.org/...` URL. Returns null for non-DOI URLs. */
export function extractDoi(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "doi.org" && parsed.pathname.length > 1) {
      // pathname starts with "/", strip it
      return decodeURIComponent(parsed.pathname.slice(1));
    }
  } catch {
    // not a valid URL
  }
  return null;
}

export function usePaperLookup(pdfUrl: string | undefined) {
  const doi = extractDoi(pdfUrl);

  return useQuery({
    queryKey: ["paper-lookup", doi],
    queryFn: async () => {
      const res = await fetch(`/api/paper?doi=${encodeURIComponent(doi!)}`);
      if (!res.ok) throw new Error(`paper ${res.status}`);
      return (await res.json()) as PaperData;
    },
    enabled: doi != null,
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: false,
  });
}
