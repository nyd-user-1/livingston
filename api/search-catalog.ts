// /api/search-catalog — everything in the policy database that could be a search result.
//
// One JSON: every entity (table or category) with its live row count, grouped, and marked
// with whether the Typesense index covers it yet; plus the 52 jurisdictions with bill and
// bill-text counts. Counts on the big tables are the planner's estimates (exact counts over
// 89M votes are not free); small tables are counted exactly. Cached an hour at the edge.
//
//   Env: POLICY_DATABASE_URL

import { neon } from "@neondatabase/serverless";

export const config = { maxDuration: 30 };

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Entity {
  key: string; label: string; group: string; table: string; what: string;
  /** exact = count(*) (small tables); est = planner estimate (big tables) */
  count: "exact" | "est";
  /** Is this entity in the Typesense index today? "ny" = New York only. */
  indexed?: "ny" | "all";
  fields?: string;
}

const ENTITIES: Entity[] = [
  // Legislation
  { key: "bills", label: "Bills", group: "Legislation", table: "Bills", what: "Every bill and resolution: number, title, description, status, committee, last action.", count: "est", indexed: "ny", fields: "number · title · description · status · committee · sponsor" },
  { key: "texts", label: "Bill texts", group: "Legislation", table: "BillTexts", what: "The text of each version of a bill, as the legislature published it.", count: "est", indexed: "ny", fields: "first 8,000 characters (NY)" },
  { key: "memos", label: "Sponsor memos", group: "Legislation", table: "BillTexts", what: "New York's sponsor memo — the plain-English purpose and justification of a bill.", count: "est", indexed: "ny" },
  { key: "crs", label: "CRS summaries", group: "Legislation", table: "BillTexts", what: "Congressional Research Service summaries of federal bills.", count: "est" },
  { key: "history", label: "Actions", group: "Legislation", table: "History Table", what: "Every recorded action on a bill — introduced, referred, reported, passed, signed.", count: "est" },
  { key: "progress", label: "Progress events", group: "Legislation", table: "Progress", what: "The milestone line of each bill (introduced → engrossed → enrolled → passed → chaptered).", count: "est" },
  { key: "referrals", label: "Committee referrals", group: "Legislation", table: "Referrals", what: "Which committee a bill went to, and when.", count: "est" },
  { key: "calendar", label: "Calendar events", group: "Legislation", table: "Calendar", what: "Hearings, floor calendars, and committee meetings a bill appeared on.", count: "est" },
  { key: "subjects", label: "Subjects", group: "Legislation", table: "Subjects", what: "Subject tags attached to bills by the legislature.", count: "est" },
  { key: "sameas", label: "Companion bills", group: "Legislation", table: "SameAs", what: "Same-as links — the Senate and Assembly versions of one bill, and re-introductions.", count: "est" },
  { key: "documents", label: "Document links", group: "Legislation", table: "Documents", what: "Links to every text, amendment, and supplement (fiscal notes, analyses) on the legislature's site.", count: "est" },
  { key: "datasets", label: "Sessions", group: "Legislation", table: "LegiscanDatasets", what: "Every legislative session we hold, with the archive hash that keeps it current.", count: "exact" },
  // People and votes
  { key: "people", label: "Legislators", group: "People & votes", table: "People", what: "Every legislator: name, party, chamber, district, committees, external ids.", count: "exact", indexed: "ny", fields: "primary sponsor only" },
  { key: "sponsors", label: "Sponsorships", group: "People & votes", table: "Sponsors", what: "Who sponsored and co-sponsored each bill, in order.", count: "est" },
  { key: "rollcalls", label: "Roll calls", group: "People & votes", table: "Roll Call", what: "Every recorded vote on a bill: date, chamber, motion, tally.", count: "est" },
  { key: "votes", label: "Member votes", group: "People & votes", table: "Votes", what: "How each legislator voted on each roll call.", count: "est" },
  { key: "committees", label: "Committees", group: "People & votes", table: "Committees", what: "Standing committees and their chairs.", count: "exact" },
  // Money and influence
  { key: "lobbyfilings", label: "Federal lobbying filings", group: "Money & influence", table: "LobbyingFilings", what: "Senate LDA registrations and quarterly reports: client, registrant, income.", count: "est" },
  { key: "lobbyacts", label: "Lobbying activities", group: "Money & influence", table: "LobbyingActivities", what: "Each filing's issues, lobbyists, agencies contacted, and description.", count: "est" },
  { key: "lobbybills", label: "Bills lobbied", group: "Money & influence", table: "LobbyingBills", what: "The bill numbers named in lobbying descriptions, linked to our bills.", count: "est" },
  { key: "fectotals", label: "Campaign finance totals", group: "Money & influence", table: "FecTotals", what: "OpenFEC receipts, disbursements, cash on hand — per member of Congress, per cycle.", count: "exact" },
  { key: "feccontrib", label: "Largest contributions", group: "Money & influence", table: "FecContributions", what: "The 100 largest itemized receipts per campaign per cycle: contributor, employer, amount.", count: "exact" },
  { key: "fecemployer", label: "Receipts by employer", group: "Money & influence", table: "FecReceiptsByEmployer", what: "Where a member's money came from, by the contributor's employer.", count: "exact" },
  { key: "fecie", label: "Independent expenditures", group: "Money & influence", table: "FecIndependentExpenditures", what: "Outside spending for or against each member.", count: "exact" },
  { key: "modelbills", label: "Model bills", group: "Money & influence", table: "ModelBills", what: "ALEC model policies, with their full text.", count: "exact" },
  { key: "modelmatches", label: "Copycat matches", group: "Money & influence", table: "ModelBillMatches", what: "State bills identified as copies of model legislation (Copy, Paste, Legislate).", count: "exact" },
  // New York state government (policy's own tables)
  { key: "contracts", label: "NYS contracts", group: "New York State", table: "Contracts", what: "New York State contracts: vendor, agency, amount, term.", count: "exact" },
  { key: "nylobbyists", label: "NY lobbyists", group: "New York State", table: "lobbyists", what: "Lobbyists registered with New York State.", count: "exact" },
  { key: "nylobbyclients", label: "NY lobbyist–client pairs", group: "New York State", table: "lobbyists_clients", what: "Who lobbies for whom in Albany.", count: "exact" },
  { key: "nylobbyspend", label: "NY lobbying spend", group: "New York State", table: "lobbying_spend", what: "Reported lobbying expenditure by client.", count: "exact" },
  { key: "nylobbycomp", label: "NY lobbyist compensation", group: "New York State", table: "lobbyist_compensation", what: "What lobbyists were paid, by client.", count: "exact" },
  { key: "nyindlobby", label: "Individual lobbyists", group: "New York State", table: "Individual_Lobbyists", what: "Individual lobbyist registrations.", count: "exact" },
  { key: "schoolfunding", label: "School funding", group: "New York State", table: "school_funding", what: "State aid by school district.", count: "exact" },
  { key: "discretionary", label: "Discretionary spending", group: "New York State", table: "Discretionary", what: "Member items and discretionary grants.", count: "exact" },
  { key: "budget", label: "Budget appropriations", group: "New York State", table: "budget_2027-aprops", what: "FY2027 appropriations, capital appropriations, and spending lines.", count: "exact" },
  { key: "revenue", label: "Revenue", group: "New York State", table: "Revenue", what: "State revenue lines.", count: "exact" },
  // Research and reference
  { key: "chunks", label: "Bill text chunks", group: "Reference", table: "bill_chunks", what: "Chunked NY bill text used by the chat's retrieval.", count: "exact" },
  { key: "problems", label: "Policy problems", group: "Reference", table: "Top 50 Public Policy Problems", what: "A curated list of public-policy problems.", count: "exact" },
  { key: "personas", label: "Personas", group: "Reference", table: "Persona", what: "Reader personas the chat can adopt.", count: "exact" },
  { key: "blog", label: "Blog posts", group: "Reference", table: "blog_posts", what: "Published posts.", count: "exact" },
];

const ident = (t: string) => `"${t.replace(/"/g, "")}"`;

export default async function handler(req: any, res: any) {
  const dbUrl = process.env.POLICY_DATABASE_URL;
  if (!dbUrl) return res.status(503).json({ error: "POLICY_DATABASE_URL is not set" });
  const sql = neon(dbUrl);
  const t0 = Date.now();

  // One planner pass for every table, then exact counts for the small ones.
  const est = new Map<string, number>();
  for (const r of (await sql.query(`SELECT c.relname AS t, greatest(c.reltuples, 0)::bigint AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'r' AND ns.nspname = 'public'`)) as any[])
    est.set(r.t, Number(r.n));

  const counts: Record<string, number | null> = {};
  for (const e of ENTITIES) {
    if (!est.has(e.table)) { counts[e.key] = null; continue; }
    if (e.key === "texts") { const [r] = (await sql.query(`SELECT count(*)::bigint AS n FROM "BillTexts" WHERE text IS NOT NULL AND version NOT ILIKE '%memo%' AND version NOT ILIKE 'crs%'`)) as any[]; counts[e.key] = Number(r.n); continue; }
    if (e.key === "memos") { const [r] = (await sql.query(`SELECT count(*)::bigint AS n FROM "BillTexts" WHERE text IS NOT NULL AND version ILIKE '%memo%'`)) as any[]; counts[e.key] = Number(r.n); continue; }
    if (e.key === "crs") { const [r] = (await sql.query(`SELECT count(*)::bigint AS n FROM "BillTexts" WHERE text IS NOT NULL AND version ILIKE 'crs%'`)) as any[]; counts[e.key] = Number(r.n); continue; }
    if (e.key === "budget") { let n = 0; for (const t of ["budget_2027-aprops", "budget_2027_capital_aprops", "budget_2027_spending"]) n += est.get(t) ?? 0; counts[e.key] = n; continue; }
    if (e.count === "exact" && (est.get(e.table) ?? 0) < 250_000) {
      const [r] = (await sql.query(`SELECT count(*)::bigint AS n FROM ${ident(e.table)}`)) as any[];
      counts[e.key] = Number(r.n);
    } else counts[e.key] = est.get(e.table) ?? 0;
  }

  const jurisdictions = (await sql.query(
    `SELECT b.state, count(*)::int AS bills, min(b.session_id)::int AS first_session, max(b.session_id)::int AS last_session,
            count(*) FILTER (WHERE b.text_fetched_at IS NOT NULL)::int AS bills_with_text
       FROM "Bills" b GROUP BY b.state ORDER BY count(*) DESC`,
  )) as any[];
  const totals = {
    bills: jurisdictions.reduce((a, j) => a + j.bills, 0),
    bills_with_text: jurisdictions.reduce((a, j) => a + j.bills_with_text, 0),
    jurisdictions: jurisdictions.length,
    indexed_bills: jurisdictions.find((j) => j.state === "NY")?.bills ?? 0,
  };

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({
    generated_at: new Date().toISOString(), ms: Date.now() - t0, totals,
    groups: [...new Set(ENTITIES.map((e) => e.group))].map((g) => ({ group: g, entities: ENTITIES.filter((e) => e.group === g).map((e) => ({ key: e.key, label: e.label, what: e.what, count: counts[e.key], estimate: e.count === "est", indexed: e.indexed ?? null, fields: e.fields ?? null })) })),
    jurisdictions,
  });
}
