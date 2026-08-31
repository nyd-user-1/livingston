# PARKED — committee rosters for all 51 jurisdictions, every session since 2009 (Brendan, 2026-08-30)

**Premise correction.** "LegiScan has no committee memberships" was wrong thinking. A legislator who cast a vote on a bill *in committee* was a member of that committee for that session. LegiScan's `"Roll Call"` rows carry the chamber and a description (committee votes are labelled as such — e.g. "Committee Vote", "Do Pass", the committee's name) and `"Votes"` carries every person on each roll call: **committee × session × people is derivable today, from data we already hold (1.72M roll calls, 89M votes), with no fetch at all.** `"Referrals"` (2.95M) gives the committee list per session; `"Sponsors"` with `committee_sponsor`/`committee_id` adds committee-sponsored bills.

**Then the sources we never looked at.** We walked 51 legislatures for hundreds of thousands of PDFs; every one of those sites publishes committee pages with members, and any state with an API (NY Senate, VA LIS, MA, IN IGA, CA, TX, …) more likely than not exposes committee membership directly. Open States' `people` and `committees` repos (GitHub, free) hold current memberships for every state as a cross-check.

**Do (when this lane is opened):**
1. Derive: `committee_memberships(state, session_id, chamber, committee_id, committee_name, people_id, evidence = 'rollcall'|'referral-sponsor', first_seen, last_seen, n_votes)` from Roll Call × Votes (classify committee roll calls by description pattern per state — write the patterns down), verify against NY's known rosters (we hold them from the NY Senate API) to measure recall/precision.
2. Enrich: per-state committee pages / APIs for current memberships and chairs (rank, role); Open States as the tie-breaker.
3. Backfill history where a state site archives past-session committee pages (Wayback for the rest).
4. Report coverage per state per session; ship a `Committees`-shaped table for all states (NY's table today is NY-shaped; do not break it).

Standing orders apply (`~/Code/scripts/FLEET-DOCTRINE.md` §0). Parallel by default.
