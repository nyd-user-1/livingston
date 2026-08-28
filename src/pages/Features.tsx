import { CheckCircle2, ArrowRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  What livingston does                                                       */
/*                                                                      */
/*  The upstream page here was a comparison table inherited from an       */
/*  earlier app, with claims that no longer described it. Same layout,    */
/*  describing what livingston actually ships. Keep it honest: every line below  */
/*  is a capability in the code, not a roadmap item.                      */
/* ------------------------------------------------------------------ */

interface FeatureRow {
  feature: string;
  items: string[];
}

const CATEGORIES: { name: string; rows: FeatureRow[] }[] = [
  {
    name: "Search",
    rows: [
      {
        feature: "Corpus search",
        items: [
          "Hybrid, Semantic, and Keyword modes, switchable in the UI",
          "Hybrid fuses a dense encoder with Postgres full-text search (RRF)",
          "Semantic runs the encoder alone over pgvector embeddings",
          "Keyword runs weighted Postgres full-text search",
          "A #KEY prefix looks a preprint up by key number in any mode",
          "Debounced queries with an in-memory result cache",
        ],
      },
    ],
  },
  {
    name: "Papers",
    rows: [
      {
        feature: "Browsing medRxiv",
        items: [
          "The full medRxiv preprint corpus, newest first",
          "Filter by author, key number, year, category, and journal",
          "Paginated result grid of paper cards",
          "Each card carries title, abstract, authors, subject chips, reference, and a dated DOI link",
          "Copy a formatted reference from any card",
        ],
      },
    ],
  },
  {
    name: "Chat",
    rows: [
      {
        feature: "Grounded conversation",
        items: [
          "Streaming answers from Amazon Bedrock, model selectable per message",
          "Retrieval-augmented: the question is embedded and matched against the corpus before the model answers",
          "Parallel retrieval arms — dense vectors, full-text, subject categories, author, and explicit key/DOI lookup",
          "Answers cite preprints by key number and DOI",
          "Full text is retrieved beyond the abstract where it is available",
          "Publication status rides every record, so a published preprint is not described as unreviewed",
          "Chat history persists and is listed in the sidebar; rename or delete any conversation",
        ],
      },
    ],
  },
  {
    name: "Workspace",
    rows: [
      {
        feature: "Reading alongside",
        items: [
          "A live feed of your own activity as you search and browse",
          "A recent-papers rail you can search, dismiss from, and open",
          "Drag a paper from the rail onto the chat input to attach it as context",
          "Open a paper's detail panel, or start a chat scoped to that one paper",
          "Light and dark themes",
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Components                                                          */
/* ------------------------------------------------------------------ */

function CategorySection({ category }: { category: (typeof CATEGORIES)[number] }) {
  return (
    <div>
      {category.rows.map((row) => (
        <div key={row.feature} className="grid grid-cols-1 md:grid-cols-[180px_1fr] border-b border-border">
          <div className="bg-foreground/5 px-4 py-3 md:py-4 flex items-start">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              {category.name}
            </span>
          </div>

          <div className="px-4 py-3 md:px-5 md:py-4 md:border-l border-border">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              {row.feature}
            </p>
            <ul className="space-y-1.5">
              {row.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-brand" />
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function Features() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1100px] mx-auto px-4 py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
            livingston — Features
          </h1>
          <p className="mt-2 text-sm md:text-base text-muted-foreground max-w-[600px] mx-auto">
            Search, browse, and ask questions of the medRxiv preprint corpus.
          </p>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="hidden md:grid md:grid-cols-[180px_1fr] bg-foreground text-background">
            <div className="px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wider">Area</span>
            </div>
            <div className="px-5 py-3 border-l border-background/20">
              <span className="text-xs font-bold uppercase tracking-wider">What livingston does</span>
            </div>
          </div>

          {CATEGORIES.map((cat) => (
            <CategorySection key={cat.name} category={cat} />
          ))}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-8 max-w-[600px] mx-auto leading-relaxed">
          livingston is an independent project and is not affiliated with, endorsed by, or
          sponsored by medRxiv. Preprint metadata is publicly available from the
          medRxiv API. Preprints are not peer reviewed.
        </p>

        {/* CTA */}
        <div className="mt-8 flex justify-center">
          <a
            href="/new-search"
            className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-medium hover:bg-foreground/85 transition-colors"
          >
            Try livingston Search
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
