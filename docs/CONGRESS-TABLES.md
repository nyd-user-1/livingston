# The congress.gov tables in Aurora

What `scripts/pipeline/congress/harvest.mjs`, `billstatus.mjs`, `bill-delta.mjs`,
`house-votes.mjs` and `hearing-texts.mjs` write, and what a page can read from
each. Written 2026-09-06, the night the harvest grew to every family the API
has. Every table has `key text primary key`, `congress int`, `payload jsonb`
(the API's record, verbatim) and `updated_at`. A table with a detail pass also
has `detail_fetched_at` and `list_payload`. A child table has `parent_key`,
indexed. Typed columns are `text` unless said otherwise.

## Committees

**congress_committees** — one row per committee and subcommittee, keyed on
`systemCode` (`hsju00`, `ssju00`, `jhje00`). `system_code, name, chamber,
committee_type, parent`, and from the detail: `is_current` ("true"/"false"),
`website_url`, `history` (json: every name it has had, with dates and the
establishing authority), `subcommittees` (json: name, systemCode, url),
`bills_count, reports_count, nominations_count, communications_count`.

**congress_committee_nominations** — a nomination referred to a committee.
`parent_key` = the committee's systemCode; `key` = `{congress}-{number}-{part}`,
the same key as `congress_nominations`, so the join is `key = key`. `citation,
description, received_date, latest_action, latest_action_date`. Reaches back to
the 114th; filter on `congress`.

**congress_committee_communications** — an executive communication, petition
or memorial referred to a committee. `parent_key` = systemCode; `key` =
`{congress}-{H|S}-{typecode}-{number}`, the same as `congress_communications`.
`chamber, communication_type, type_code, number, referral_date`. Back to the
114th; filter on `congress`.

**congress_committee_members** — from the unitedstates project, not the API;
unchanged.

## Hearings

**congress_hearings** — keyed on `jacket_number`. `chamber, number`, and from
the detail: `title, citation` (`S.Hrg.119-347`), `hearing_date` (first date),
`dates` (json), `committee_code, committee_name, committees` (json),
`formats` (json), `text_url` (congress.gov's formatted .htm), `pdf_url`,
`loc_id`.

**congress_hearing_texts** — the transcript, keyed the same as
`congress_hearings`. `jacket_number, congress, chamber, title, hearing_date,
committee_code, url, html` (as published), `text` (tags stripped, entities
resolved), `chars int, fetched_at`. This is what the GitHub-style view reads.

**congress_committee_meetings** — `event_id, chamber`, and from the detail
(recent ones): `meeting_date, title, location` (json), `meeting_status`.

## Nominations and treaties

**congress_nominations** — keyed `{congress}-{number}-{part}`. `number,
part_number, citation, description, organization, received_date,
latest_action`, and from the detail: `nominees` (json: position, organization,
ordinal), `is_privileged, authority_date, latest_action_date, actions_count,
committees_count, hearings_count`.

**congress_nomination_actions** — `parent_key` = the nomination's key.
`action_date, text, action_type, committees` (json).

**congress_nomination_committees** — `system_code, name, chamber, activities`
(json: Referred To, Hearings Held, Reported…, each with a date).

**congress_nomination_hearings** — `jacket_number, hearing_date, citation,
number, part_number`; joins to `congress_hearings` on jacket_number.

**congress_treaties** — keyed `{congress}-{number}-{suffix}`. `number, suffix,
topic, transmitted_date`, and from the detail: `title, titles` (json), `parts`
(json), `countries_parties` (json), `index_terms` (json), `resolution_text,
in_force_date, actions_count, old_number`.

**congress_treaty_actions**, **congress_treaty_committees** — as the
nomination children.

## Bills, amendments, reports, prints

**congress_bills, congress_bill_actions, congress_bill_committees,
congress_bill_subjects, congress_cosponsors, congress_summaries,
congress_titles, congress_related_bills, congress_cbo_estimates,
congress_text_formats** — unchanged shapes, filled by `billstatus.mjs` from
govinfo overnight and, since 2026-09-06, by `bill-delta.mjs` from the API for
the bills that moved in the last two days, under the same keys. A row's
`payload.source = "api"` says the API wrote it last.

**congress_amendments** — keyed `{congress}-{type}-{number}`. Gained
`actions_count, cosponsors_count, text_versions_count, amended_bill` (json),
`chamber`.

**congress_amendment_actions** — `parent_key` = the amendment's key.
`action_date, action_time, text, action_type, recorded_votes` (json),
`source_system`.

**congress_amendment_cosponsors** — `bioguide_id, name, party, state,
sponsorship_date, is_original`.

**congress_amendment_texts** — `version_type, version_date, formats` (json),
`text_url, pdf_url`.

**congress_committee_reports** — gained `text_count, associated_bill` (json).
**congress_report_texts** — `parent_key` = the report's key; `formats` (json),
`text_url, pdf_url, part`.

**congress_committee_prints** — from the detail: `title, citation, committees`
(json), `committee_code, associated_bills` (json), `text_count`.
**congress_print_texts** — `format_type, url, formats` (json).

## Votes, members, the Record, the rest

**congress_house_votes** — gained from the detail: `vote_question,
vote_party_total` (json: yea/nay/present/not voting by party), `amendment_author,
amendment_type, amendment_number, legislation_url`. Positions stay in
`congress_house_vote_positions`.

**congress_members** — gained `sponsored_count, cosponsored_count`.
**congress_member_sponsored**, **congress_member_cosponsored** — `parent_key`
= bioguide id; `bioguide_id, bill_type, number, title, introduced_date,
policy_area, latest_action, latest_action_date`, every congress the API holds.
For the 119th, `congress_bills.sponsor_bioguide` and `congress_cosponsors` are
the same facts and already joined to `people_id`; read these for history.

**congress_communications** — from the detail: `abstract, referred_to` (json),
`committee_code, committee_name, record_date, report_nature,
submitting_agency, submitting_official, legal_authority,
matching_requirements` (json), `is_rulemaking`.

**congress_record_daily** — an issue. `volume_number, issue_number,
issue_date, session_number, articles_count, entire_issue` (json).
**congress_record_articles** — `parent_key` = `{volume}-{issue}`; `section`
(Daily Digest, House, Senate, Extensions of Remarks), `title, start_page,
end_page, text` (json: formatted text and PDF URLs). The current congress by
default; the archive back to 1995 is `harvest.mjs --family record_daily
--record-since 1995-01-01`.

**congress_congresses** — keyed on the number. `number, name, start_year,
end_year, sessions` (json: chamber, number, startDate, endDate, type). The
only place the record says whether a chamber is sitting.

**congress_house_requirements** — `number`, and from the detail:
`parent_agency, submitting_agency, submitting_official, nature, frequency,
legal_authority, active, matching_count`.
**congress_requirement_communications** — `chamber, communication_type,
type_code, number`.

**congress_crs_reports** — unchanged.

## Cadence

`ops/box/jobs.d/dp-congress.json`, nightly on box 2: sync (text), billstatus
(govinfo), bill-delta (the API, two days back), harvest (every family; details
where the API's updateDate moved, children where the parent was re-read or the
list grows on its own), house-votes (positions), hearing-texts. The key's limit
is 20,000 requests an hour; a nightly in session is a few thousand.
