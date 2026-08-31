# Lane DV — what we can derive from what we already hold (no fetching)

**Kick-off (paste into an Opus window in `~/Code/livingston`):**
`Read prompts/2026-08-30-derivations.md and do it. Report into that file under ## Report as you go.`

---

## Why

Brendan, 2026-08-30: "committee roll calls name the members … I think we should do this next. Take another look. What else can we derive?" The policy database now holds, for 52 jurisdictions since 2009: 2.13M bills · 89M votes on 1.72M roll calls · 12M sponsorships · 18M history actions · 8.3M progress rows · 2.95M committee referrals · 1.45M calendar entries · 1.0M same-as links · 3.0M subject tags · 22.7k people with external ids (VoteSmart, OpenSecrets, FollowTheMoney, Ballotpedia, KnowWho, FEC candidate ids, bioguide) · 3.27M bill texts (36 billion characters) · 392k forms · 357k lobbying filings with 562k bill mentions · FEC committee/candidate/contribution tables (API) and 738 GB of FEC bulk on S3. Almost none of the relationships between these have been materialised. Every table below is built from rows we hold; nothing in this lane touches a website or an API.

Standing orders apply (`~/Code/scripts/FLEET-DOCTRINE.md` §0) — in particular #2: build these in parallel, in SQL that runs on the box or on a big EC2 with DuckDB over Parquet exports if Neon compute is the ceiling (it was, all weekend). Measure before you port; the doctrine's §2 is about this database.

## Derivations, in priority order

**1. Committee memberships, every jurisdiction, every session.** From `"Roll Call"` × `"Votes"`: a roll call taken in committee names the committee (chamber + description — write the per-state description patterns down; NY, US and the big states first), and every person on it was a member that session. Add `"Referrals"` (the committee list per session) and committee-sponsor rows in `"Sponsors"`. Output `derived.committee_memberships(state, session_id, chamber, committee_id, committee_name, people_id, evidence, first_seen, last_seen, n_votes)` and `derived.committees(state, session_id, chamber, committee_id, name, n_bills_referred, n_roll_calls)`. Validate against NY's real rosters (we hold them from the NY Senate API): report recall and precision per session; then say how far short the derivation falls where a state's committee votes are not recorded as roll calls (and which states those are — that residue is the fetch list for the parked lane `PARKED-committee-rosters.md`).

**2. Legislator service history.** From sponsorships and votes: for every person, the sessions, chamber, district and party in which they acted — a seat timeline (`derived.people_sessions`), chamber moves, party switches, first/last session, and the "who held this seat when" table per district. People's external ids give the crosswalk to FEC candidates (`People.fec_candidate_ids`), OpenSecrets and FollowTheMoney.

**3. Money → legislator → vote.** FEC committees and candidates are already in `FecCommittees`/`FecContributions`/`FecTotals` (API) and in bulk on S3 (`cn`, `cm`, `ccl`, `pas2`, `indiv` per cycle). Join FEC candidate ids to `People`, then to `Sponsors` and `Votes`: for Congress first (bioguide is exact), then states via FollowTheMoney ids where present. Deliver `derived.legislator_money(people_id, cycle, receipts_total, top_employers, top_pacs)` and the question the product wants answered: for a bill, who voted, who sponsored, and who funded them. Say plainly where the state-level join is weak.

**4. Lobbying → bill → sponsor.** `LobbyingBills` already names bills; join to sponsors and to committee memberships from #1: which lobbying clients touch which committees' members. `derived.bill_lobbying(bill_id, n_filings, clients, registrants, spend_estimate)`.

**5. Voting behaviour.** Per session and chamber: party-line rate per roll call, per-legislator party loyalty, agreement matrix (person × person), absences, the "decisive" votes (margin ≤ 2). `derived.vote_stats_*`. Cheap in SQL over 89M rows if done per session; do it in parallel by state.

**6. Bill lifecycle.** From `History Table` + `Progress` + `Calendar`: days in committee, committee where bills die (kill rate by committee — depends on #1), days from introduction to passage, pass rates by chamber/party of prime sponsor, veto counts, effective dates from the enacted text (regex on the last text version). `derived.bill_lifecycle`.

**7. Co-sponsorship graph.** Person × person co-sponsorship counts per session, bipartisan share, centrality. Cheap; feeds the legislator pages.

**8. Companion and model legislation.** `SameAs` gives within-state companions. Across states: near-duplicate detection over the 3.27M texts (MinHash/SimHash over normalised text, or `search_tsv` similarity first as a cheap filter) to find model bills and their lineage — which state introduced the language first, who sponsored it everywhere. `ModelBills` (1,137 rows) is the seed to validate against.

**9. Statute and agency references from text.** Extract "amends § …", agency and program names, dollar amounts, effective-date clauses from bill texts; link agencies to the **forms library** (a bill that amends a program → the forms that program uses) and to the lobbying registrants. `derived.bill_citations`, `derived.bill_agencies`.

**10. A normalised subject taxonomy.** `Subjects` (3.0M tags, each state's own vocabulary) → one cross-state taxonomy with a mapping table, so "housing" means the same thing in 52 places.

**11. Text-version lineage.** For each bill, its `Documents` versions in order (introduced → amended → engrossed → enrolled) with diff size between versions; where did the text change most, in which committee (ties to #1 and #6).

**12. FEC bulk → structured.** Not a derivation of our tables but the same spirit: the per-cycle bulk files (`cn`, `cm`, `ccl`, `pas2`, `oth`, `indiv`, `oppexp`) are the canonical relational form of the FEC world and load straight into Parquet on S3 (DuckDB reads the pipe-delimited zips directly). Do this before #3 needs it; do not load 3 billion rows into Neon — put Parquet on S3 and query it in place, load only the joined summaries.

## How to work

- Schema `derived` in the policy Neon (create it), one materialised table per derivation, each with a `built_at` and a one-line `_why` comment; rebuildable by a script under `scripts/derive/` with a manifest in `ops/box/jobs.d/` (weekly, disabled until Brendan enables it).
- If a derivation needs more than a few minutes of Neon compute, export the inputs to Parquet on S3 (`s3://livingston-bill-pdfs-638175140432/parquet/<table>/`) and compute with DuckDB on a box; write results back. Say which path you took and why.
- For each derivation report: rows produced · coverage (states × sessions) · a validation (against NY or Congress where we hold ground truth) · three example queries the product will run against it.
- Parallel by default: the per-state work fans out.

## Report

*(lane writes here)*
