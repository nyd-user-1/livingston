#!/usr/bin/env node
// scripts/lake/domains.mjs — which lake domain each Neon relation belongs to,
// and which relations are not policy facts at all.
//
// This is an explicit list, not a set of clever patterns, because §2 makes the
// layout a contract: a table quietly landing in a different domain next month
// because its name changed is exactly what the contract exists to prevent. A
// relation that is not named here is refused by the exporter and flagged.
//
// Domains: legislative · money · reference · text (§2) plus derived (§7.C).

/** Relations that are policy facts, by lake domain. Keys are the Neon names. */
export const DOMAIN = {
  // ---------------------------------------------------------- legislative ---
  Bills: "legislative",
  Votes: "legislative",
  "History Table": "legislative",
  Sponsors: "legislative",
  Documents: "legislative",
  Progress: "legislative",
  "Roll Call": "legislative",
  Subjects: "legislative",
  Calendar: "legislative",
  Referrals: "legislative", // committee referrals, keyed bill_id/seq
  SameAs: "legislative", // same-as / companion bill pairing (sast_*)
  People: "legislative",
  SessionPeople: "legislative",
  Committees: "legislative",
  ModelBills: "legislative",
  ModelBillMatches: "legislative",
  LobbyingBills: "legislative", // the lobbying→bill join, not the money itself
  member_vote_tallies: "legislative",
  resource_documents: "legislative",
  FecCommittees: "legislative",

  // ---------------------------------------------------------------- money ---
  // "money" is public money in both directions: what is raised and spent to
  // win office, and what the state raises and spends once in it.
  FecContributions: "money",
  FecTotals: "money",
  FecReceiptsByEmployer: "money",
  FecReceiptsByState: "money",
  FecReceiptsBySize: "money",
  FecIndependentExpenditures: "money",
  Finance: "money",
  FinanceContributors: "money",
  FinanceSectors: "money",
  LobbyingActivities: "money",
  LobbyingFilings: "money",
  LobbyingSync: "money",
  lobbyists: "money",
  lobbyists_clients: "money",
  lobbyist_compensation: "money",
  lobbying_spend: "money",
  Individual_Lobbyists: "money",
  "2025_lobbyist_dataset": "money",
  Contracts: "money",
  Discretionary: "money",
  Revenue: "money",
  school_funding: "money",
  school_funding_totals: "money",
  budget_2027_spending: "money",
  budget_2027_capital_aprops: "money",
  "budget_2027-aprops": "money",

  // ------------------------------------------------------------ reference ---
  Forms: "reference", // §7.C
  LegiscanDatasets: "reference",

  // ----------------------------------------------------------------- text ---
  BillTexts: "text", // the bill full-text corpus itself
  bill_chunks: "text", // §7.C

  // -------------------------------------------------------------- derived ---
  mv_stream_latest: "derived", // §7.C
  mv_newsroom_latest: "derived",
}

/**
 * App state, user content and product seed content. Listed in the inventory,
 * never exported (§6.1). The reason is carried so the report can say why.
 */
export const OUT_OF_SCOPE = {
  chat_sessions: "app state — chat",
  chat_notes: "app state — chat",
  chat_excerpts: "app state — chat",
  submitted_prompts: "app state — user submissions",
  prompt_chat_counts: "app state — usage counters",
  visitor_counts: "app state — usage counters",
  feedback: "app state — user submissions",
  subscribers: "app state — mailing list (PII)",
  profiles: "app state — user profiles (PII)",
  user_favorites: "app state — per-user",
  user_bill_reviews: "app state — per-user",
  user_committee_favorites: "app state — per-user",
  user_member_favorites: "app state — per-user",
  assets: "product content",
  Persona: "product content",
  blog_posts: "product content",
  "Top 50 Public Policy Problems": "product content — curated editorial list",
  "Sample Problems": "product content — curated editorial list",
  people_photo_backup: "backup copy of People.photo",
}

/** openstates.* is legislative wholesale (§7.C). */
export const domainFor = (schema, name) =>
  schema === "openstates" ? "legislative" : (DOMAIN[name] ?? null)

export const outOfScopeReason = (schema, name) =>
  schema === "openstates" ? null : (OUT_OF_SCOPE[name] ?? null)
