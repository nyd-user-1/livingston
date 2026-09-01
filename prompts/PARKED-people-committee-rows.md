# PARKED — 511 committee rows wearing member names in "People"

**Found by lane S, 2026-09-01** (its heartbeat 8, prompts/2026-09-01-search-fulltext.md),
when a WY search page rendered "Members (28)" of which about twenty were
committees.

**The rows:** LegiScan files sponsor-committees in `"People"`. 487 rows carry a
committee's name with `committee_id` NULL and an empty `last_name`
(California's "Utilities and Energy", Kansas's "Agriculture", South Carolina's
"Judiciary" — 266 carry no committee-flavoured word at all, so no name pattern
finds them). A further 24 carry the committee name copied into BOTH name
fields (Maryland's "Health", "Ways", "Economic", "Mental"; New York's "Rules";
South Dakota's "Appropriations") — none has a party, district, photo, email,
bio, VoteSmart id or Ballotpedia entry, none is sitting, and "George DE" is
filed as both Rep and Sen. 511 of 22,193 rows in all.

**Fixed where it was found:** search requires both halves of a name
(govblock `a765520`); no sitting legislator is excluded.

**Still open — the upstream repair:** `getMembers` and `/docs/directory` still
list all 511. The honest fix is in the data, not in every reader: mark the rows
(a `committee_id` backfill or an `is_committee` flag decided from the
no-attributes signature above), then let the readers' existing
`committee_id is null` filters do their work. Belongs to whichever lane next
owns "People" hygiene or the ingestion cutover; the signature list is in lane
S's report.
