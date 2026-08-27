export interface S2Author {
  name: string;
  hIndex: number | null;
  affiliations: string[];
}

export interface CorpusRecord {
  id: number;
  key_number: string;
  pub_year: number;
  reference: string | null;
  authors: string | null;
  title: string;
  doi: string | null;
  exfor_keys?: string | null;
  keywords?: string | null;
  /** Subject category, author-assigned at submission — 76 values across the two
   *  servers. Renders in the card's first chip group (was `nuclides`). */
  categories?: string[] | null;
  /** Derived chips: version, type, published/preprint, licence (was `reactions`). */
  status_tags?: string[] | null;
  server?: "biorxiv" | "medrxiv" | null;
  version?: number | null;
  type?: string | null;
  license?: string | null;
  posted_date?: string | null;
  published_doi?: string | null;
  published_journal?: string | null;
  published_date?: string | null;
  institution?: string | null;
  author_corresponding?: string | null;
  jatsxml_url?: string | null;
  pdf_url?: string | null;
  /** Version timeline, from /api/record only. */
  versions?: { version: number; posted_date: string; type: string | null; title: string | null; license: string | null }[];
  reference_type?: string | null;
  /** NSR-era facets with no preprint analog. The preprint API never returns these,
   *  so /search's Subjects and Topics widgets render empty until that page gets its
   *  own lane (LANE-RXIV-MAP.md BUILD addendum). Kept typed so the page compiles. */
  subjects?: string[] | null;
  topics?: string[] | null;
  similarity?: number;
  // S2 enrichment fields
  s2_paper_id?: string | null;
  citation_count?: number | null;
  influential_citation_count?: number | null;
  reference_count?: number | null;
  abstract?: string | null;
  tldr?: string | null;
  venue?: string | null;
  publication_date?: string | null;
  is_open_access?: boolean;
  open_access_pdf_url?: string | null;
  fields_of_study?: string[] | null;
  s2_authors?: S2Author[] | null;
  s2_lookup_status?: "pending" | "found" | "not_found" | "error" | null;
  s2_looked_up_at?: string | null;
}
