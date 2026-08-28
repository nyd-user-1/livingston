# livingston

Benefits assistance, and AI search over the **medRxiv** preprint corpus.

Drag an application from the Grants & Benefits rail onto the chat and the
conversation fills it in with you, then hands you the PDF — see
**[BENEFITS.md](BENEFITS.md)**.

React 19 + Vite + TypeScript SPA, with Vercel serverless functions in `api/`
talking to Neon Postgres (pgvector + pg_trgm) and Amazon Bedrock.

## What's in it

| Route | What it is |
| --- | --- |
| `/`, `/new-chat`, `/c/:id` | Chat — Bedrock streaming, grounded in corpus retrieval, history in the sidebar |
| `/new-search` | Search — Hybrid / Semantic / Keyword, with chart widgets |
| `/medrxiv/papers` | Papers — the medRxiv browser: filters, search, pagination, result cards |
| `/features` | Capability list, reached from the account menu |

The right rail carries three panels: **Grants & Benefits** (applications you can
fill in by conversation), recent papers, and a live activity feed.

Everything else redirects to `/`.

Cards in any rail can be dragged onto the chat input — a paper attaches as
reading context, an application starts filling itself in.

## Running it

```sh
npm install
npm run dev        # vite on :3000
```

`api/*` are Vercel functions and do not run under vite. In dev, `/api/*` is
proxied to livingston's production deployment (see `vite.config.ts`), so every
page works against real data locally. Point it at a preview instead with:

```sh
LIVINGSTON_API_ORIGIN=https://your-deployment.vercel.app npm run dev
```

Build:

```sh
npx vite build     # bundle only
npm run build      # tsc -b + vite build (memory-hungry; prefer the remote build)
```

## Configuration

Copy `.env.example` to `.env.local`. `DATABASE_URL` and
`AWS_BEARER_TOKEN_BEDROCK` are the two that must be set for the app to work;
everything else is optional or encoder-specific. Env files are gitignored.

## Rules that bite

- **Vercel functions use the classic `(req, res)` signature.** Web-standard
  handlers hang on this project. Functions are unbundled ESM, so local imports
  need the `.js` extension (`import … from "./_lib/embed.js"`).
- **DB access** is `@neondatabase/serverless` in `api/*`. Vector queries must
  pass the probe as a bound `$1::vector` parameter — a join-sourced probe
  defeats the HNSW index — and `SET LOCAL hnsw.ef_search` needs
  `sql.transaction([...])`.
- **livingston does not own the database.** It reads a corpus it shares with another
  app and must never run migrations or schema changes against it. See
  `REPORT.md` for what is shared and where the coupling is.

## Where things are

- `src/pages/` — the four pages
- `src/components/ResearchFeed/` — the right rail (live feed + papers)
- `src/layouts/AppLayout.tsx` — shell: sidebar, top bar, rail, panel portal
- `api/` — serverless functions; `api/_lib/` their shared helpers
- `REPORT.md` — provenance: what was copied, what was stripped, what is shared
