// /api/pdf?key=<key_number> — resolves a preprint's canonical PDF URL. Returns JSON,
// and deliberately does NOT fetch the PDF.
//
// An earlier version of this file proxied the bytes: our function fetched the PDF and
// streamed it back. bioRxiv/medRxiv sit behind bot protection that answers non-browser
// clients with 429 regardless of rate, so that approach fails from any server, ours
// included. The established pattern in the sibling `policy` project is to hand the URL
// to Google's viewer (`docs.google.com/gview`), which renders it in a frameable page —
// Google does the fetching, we do none, and there is nothing to be blocked.
//
// Version matters: v1 404s for a paper now at v3, and only the database knows the
// current version, which is why this is an endpoint rather than a string built in the client.
import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 15 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const key = String(req.query?.key ?? "").trim();
  if (!key) return res.status(400).json({ error: "key required" });

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      SELECT server, doi, version, title FROM preprints WHERE key_number = ${key} LIMIT 1
    `) as Array<{ server: string; doi: string; version: number | null; title: string | null }>;
    if (!rows.length) return res.status(404).json({ error: "unknown key" });

    const { server, doi, title } = rows[0];
    const version = rows[0].version ?? 1;
    const host = server === "medrxiv" ? "www.medrxiv.org" : "www.biorxiv.org";
    const url = `https://${host}/content/${doi}v${version}.full.pdf`;

    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    return res.status(200).json({
      key,
      server,
      doi,
      version,
      title,
      url,
      viewerUrl: `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`,
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
