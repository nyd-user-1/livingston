# OpenFEC — every GET endpoint and the fields it returns

Source: https://api.open.fec.gov/swagger/ (fetched 2026-08-28). Key: `api_key=` from https://api.data.gov/signup/ (1,000 requests/hour). Base `https://api.open.fec.gov/v1`.

Join to our People: `bioguide_id` → FEC candidate ids via https://unitedstates.github.io/congress-legislators/legislators-current.json (`id.fec`, 535 of 537 current members).


## audit

### `GET /v1/audit-case/`
This endpoint contains Final Audit Reports approved by the Commission since inception.

- filters: q, qq, primary_category_id, sub_category_id, audit_case_id, cycle, committee_id, committee_type, committee_designation, audit_id, candidate_id, min_election_cycle, max_election_cycle
- fields (13): audit_case_id, audit_id, candidate_id, candidate_name, committee_description, committee_designation, committee_id, committee_name, committee_type, cycle, far_release_date, link_to_report, primary_category_list

### `GET /v1/audit-category/`
This lists the options for the categories and subcategories available in the /audit-search/ endpoint.

- filters: primary_category_id, primary_category_name
- fields (3): primary_category_id, primary_category_name, sub_category_list

### `GET /v1/audit-primary-category/`
This lists the options for the primary categories available in the /audit-search/ endpoint.

- filters: primary_category_id, primary_category_name
- fields (2): primary_category_id, primary_category_name

### `GET /v1/names/audit_candidates/`
Search for candidates or committees by name. If you're looking for information on a

- filters: q
- fields (2): id, name

### `GET /v1/names/audit_committees/`
Search for candidates or committees by name. If you're looking for information on a

- filters: q
- fields (2): id, name


## candidate

### `GET /v1/candidate/{candidate_id}/`
This endpoint is useful for finding detailed information about a particular candidate. Use the

- filters: cycle, election_year, office, state, party, year, district, candidate_status, incumbent_challenge, federal_funds_flag, has_raised_funds, name
- fields (34): active_through, address_city, address_state, address_street_1, address_street_2, address_zip, candidate_first_name, candidate_id, candidate_inactive, candidate_last_name, candidate_middle_name, candidate_prefix, candidate_status, candidate_suffix, cycles, district, district_number, election_districts, election_years, federal_funds_flag, first_file_date, flags, has_raised_funds, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, state

### `GET /v1/candidate/{candidate_id}/history/`
Find out a candidate's characteristics over time. This is particularly useful if the

- filters: election_full
- fields (36): active_through, address_city, address_state, address_street_1, address_street_2, address_zip, candidate_election_year, candidate_first_name, candidate_id, candidate_inactive, candidate_last_name, candidate_middle_name, candidate_prefix, candidate_status, candidate_suffix, cycles, district, district_number, election_districts, election_years, fec_cycles_in_election, first_file_date, flags, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, rounded_election_years, state, two_year_period

### `GET /v1/candidate/{candidate_id}/history/{cycle}/`
Find out a candidate's characteristics over time. This is particularly useful if the

- filters: election_full
- fields (36): active_through, address_city, address_state, address_street_1, address_street_2, address_zip, candidate_election_year, candidate_first_name, candidate_id, candidate_inactive, candidate_last_name, candidate_middle_name, candidate_prefix, candidate_status, candidate_suffix, cycles, district, district_number, election_districts, election_years, fec_cycles_in_election, first_file_date, flags, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, rounded_election_years, state, two_year_period

### `GET /v1/candidate/{candidate_id}/totals/`
This endpoint provides information about a committee's Form 3, Form 3X, or Form 3P financial reports,

- filters: election_full, cycle
- fields (118): all_loans_received, all_other_loans, allocated_federal_election_levin_share, candidate_contribution, cash_on_hand_beginning_period, committee_designation, committee_designation_full, committee_id, committee_name, committee_state, committee_type, committee_type_full, contribution_refunds, contributions, contributions_ie_and_party_expenditures_made_percent, convention_exp, coordinated_expenditures_by_party_committee, coverage_end_date, coverage_start_date, cycle, disbursements, exempt_legal_accounting_disbursement, exp_prior_years_subject_limits, exp_subject_limits, fed_candidate_committee_contributions, fed_candidate_contribution_refunds, fed_disbursements, fed_election_activity, fed_operating_expenditures, fed_receipts, federal_funds, filing_frequency, filing_frequency_full, first_f1_date, first_file_date, fundraising_disbursements, independent_expenditures, individual_contributions, individual_contributions_percent, individual_itemized_contributions, individual_unitemized_contributions, itemized_convention_exp, itemized_other_disb, itemized_other_income, itemized_other_refunds, itemized_refunds_relating_convention_exp, last_beginning_image_number, last_cash_on_hand_end_period, last_debts_owed_by_committee, last_debts_owed_to_committee, last_report_type_full, last_report_year, loan_repayments, loan_repayments_candidate_loans, loan_repayments_made, loan_repayments_other_loans, loan_repayments_received, loans, loans_and_loan_repayments_made, loans_and_loan_repayments_received, loans_made, loans_made_by_candidate, loans_received, loans_received_from_candidate, net_contributions, net_operating_expenditures, non_allocated_fed_election_activity, offsets_to_fundraising_expenditures, offsets_to_legal_accounting, offsets_to_operating_expenditures, operating_expenditures, operating_expenditures_percent, organization_type, organization_type_full, other_disbursements, other_fed_operating_expenditures, other_fed_receipts, other_loans_received, other_political_committee_contributions, other_receipts, other_refunds, party_and_other_committee_contributions_percent, party_full, pdf_url, political_party_committee_contributions, receipts, refunded_individual_contributions, refunded_other_political_committee_contributions, refunded_political_party_committee_contributions, refunds_relating_convention_exp, repayments_loans_made_by_candidate, repayments_other_loans, report_form, shared_fed_activity, shared_fed_activity_nonfed, shared_fed_operating_expenditures, shared_nonfed_operating_expenditures, sponsor_candidate_ids, sponsor_candidate_list, total_exp_subject_limits, total_independent_contributions, total_independent_expenditures, total_offsets_to_operating_expenditures, total_transfers, transaction_coverage_date, transfers_from_affiliated_committee, transfers_from_affiliated_party, transfers_from_nonfed_account, transfers_from_nonfed_levin, transfers_from_other_authorized_committee, transfers_to_affiliated_committee, transfers_to_other_authorized_committee, treasurer_name, unitemized_convention_exp, unitemized_other_disb, unitemized_other_income, unitemized_other_refunds, unitemized_refunds_relating_convention_exp

### `GET /v1/candidates/`
Fetch basic information about candidates, and use parameters to filter results to the

- filters: q, candidate_id, min_first_file_date, max_first_file_date, is_active_candidate, cycle, election_year, office, state, party, year, district, candidate_status, incumbent_challenge, federal_funds_flag, has_raised_funds, name
- fields (24): active_through, candidate_id, candidate_inactive, candidate_status, cycles, district, district_number, election_districts, election_years, federal_funds_flag, first_file_date, has_raised_funds, inactive_election_years, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, state

### `GET /v1/candidates/search/`
Fetch basic information about candidates and their principal committees.

- filters: q, candidate_id, min_first_file_date, max_first_file_date, is_active_candidate, cycle, election_year, office, state, party, year, district, candidate_status, incumbent_challenge, federal_funds_flag, has_raised_funds, name
- fields (25): active_through, candidate_id, candidate_inactive, candidate_status, cycles, district, district_number, election_districts, election_years, federal_funds_flag, first_file_date, has_raised_funds, inactive_election_years, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, principal_committees, state

### `GET /v1/candidates/totals/`
Aggregated candidate receipts and disbursements grouped by cycle.

- filters: q, candidate_id, election_year, cycle, office, election_full, state, district, party, min_receipts, max_receipts, min_disbursements, max_disbursements, min_cash_on_hand_end_period, max_cash_on_hand_end_period, min_debts_owed_by_committee, max_debts_owed_by_committee, federal_funds_flag, has_raised_funds, is_active_candidate
- fields (51): active_through, address_city, address_state, address_street_1, address_street_2, address_zip, candidate_election_year, candidate_first_name, candidate_id, candidate_inactive, candidate_last_name, candidate_middle_name, candidate_prefix, candidate_status, candidate_suffix, cash_on_hand_end_period, coverage_end_date, coverage_start_date, cycle, cycles, debts_owed_by_committee, disbursements, district, district_number, election_districts, election_year, election_years, fec_cycles_in_election, federal_funds_flag, first_file_date, flags, has_raised_funds, incumbent_challenge, incumbent_challenge_full, individual_itemized_contributions, is_election, last_f2_date, last_file_date, load_date, name, office, office_full, other_political_committee_contributions, party, party_full, receipts, rounded_election_years, state, state_full, transfers_from_other_authorized_committee, two_year_period

### `GET /v1/candidates/totals/aggregates/`
Candidate total receipts and disbursements aggregated by `aggregate_by`.

- filters: election_year, office, is_active_candidate, election_full, min_election_cycle, max_election_cycle, state, district, party, aggregate_by
- fields (14): district, district_number, election_year, office, party, state, state_full, total_cash_on_hand_end_period, total_debts_owed_by_committee, total_disbursements, total_individual_itemized_contributions, total_other_political_committee_contributions, total_receipts, total_transfers_from_other_authorized_committee

### `GET /v1/committee/{committee_id}/candidates/`
This endpoint is useful for finding detailed information about a particular candidate. Use the

- filters: cycle, election_year, office, state, party, year, district, candidate_status, incumbent_challenge, federal_funds_flag, has_raised_funds, name
- fields (34): active_through, address_city, address_state, address_street_1, address_street_2, address_zip, candidate_first_name, candidate_id, candidate_inactive, candidate_last_name, candidate_middle_name, candidate_prefix, candidate_status, candidate_suffix, cycles, district, district_number, election_districts, election_years, federal_funds_flag, first_file_date, flags, has_raised_funds, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, state

### `GET /v1/committee/{committee_id}/candidates/history/`
Find out a candidate's characteristics over time. This is particularly useful if the

- filters: election_full
- fields (36): active_through, address_city, address_state, address_street_1, address_street_2, address_zip, candidate_election_year, candidate_first_name, candidate_id, candidate_inactive, candidate_last_name, candidate_middle_name, candidate_prefix, candidate_status, candidate_suffix, cycles, district, district_number, election_districts, election_years, fec_cycles_in_election, first_file_date, flags, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, rounded_election_years, state, two_year_period

### `GET /v1/committee/{committee_id}/candidates/history/{cycle}/`
Find out a candidate's characteristics over time. This is particularly useful if the

- filters: election_full
- fields (36): active_through, address_city, address_state, address_street_1, address_street_2, address_zip, candidate_election_year, candidate_first_name, candidate_id, candidate_inactive, candidate_last_name, candidate_middle_name, candidate_prefix, candidate_status, candidate_suffix, cycles, district, district_number, election_districts, election_years, fec_cycles_in_election, first_file_date, flags, incumbent_challenge, incumbent_challenge_full, last_f2_date, last_file_date, load_date, name, office, office_full, party, party_full, rounded_election_years, state, two_year_period


## committee

### `GET /v1/candidate/{candidate_id}/committees/`
This endpoint is useful for finding detailed information about a particular committee or

- filters: year, cycle, filing_frequency, designation, organization_type, committee_type
- fields (73): affiliated_committee_name, candidate_ids, city, committee_id, committee_type, committee_type_full, custodian_city, custodian_name_1, custodian_name_2, custodian_name_full, custodian_name_middle, custodian_name_prefix, custodian_name_suffix, custodian_name_title, custodian_phone, custodian_state, custodian_street_1, custodian_street_2, custodian_zip, cycles, designated_agent_city, designated_agent_first_name, designated_agent_last_name, designated_agent_middle_name, designated_agent_name, designated_agent_phone_number, designated_agent_prefix, designated_agent_state, designated_agent_street1, designated_agent_street2, designated_agent_suffix, designated_agent_title, designated_agent_zip, designation, designation_full, email, fax, filing_frequency, first_f1_date, first_file_date, form_type, jfc_committee, last_f1_date, last_file_date, leadership_pac, lobbyist_registrant_pac, name, organization_type, organization_type_full, party, party_full, party_type, party_type_full, sponsor_candidate_ids, state, state_full, street_1, street_2, treasurer_city, treasurer_name, treasurer_name_1, treasurer_name_2, treasurer_name_middle, treasurer_name_prefix, treasurer_name_suffix, treasurer_name_title, treasurer_phone, treasurer_state, treasurer_street_1, treasurer_street_2, treasurer_zip, website, zip

### `GET /v1/candidate/{candidate_id}/committees/history/`
Explore a filer's characteristics over time. This can be particularly useful if the committees change treasurers, designation, or `committee_type`.

- filters: election_full, designation
- fields (52): affiliated_committee_name, candidate_ids, city, committee_id, committee_label, committee_type, committee_type_full, convert_to_pac_flag, cycle, cycles, cycles_has_activity, cycles_has_financial, designated_agent_city, designated_agent_first_name, designated_agent_last_name, designated_agent_middle_name, designated_agent_name, designated_agent_phone_number, designated_agent_prefix, designated_agent_state, designated_agent_street1, designated_agent_street2, designated_agent_suffix, designated_agent_title, designated_agent_zip, designation, designation_full, filing_frequency, first_f1_date, first_file_date, former_candidate_election_year, former_candidate_id, former_candidate_name, former_committee_name, is_active, jfc_committee, last_cycle_has_activity, last_cycle_has_financial, last_f1_date, last_file_date, name, organization_type, organization_type_full, party, party_full, sponsor_candidate_ids, state, state_full, street_1, street_2, treasurer_name, zip

### `GET /v1/candidate/{candidate_id}/committees/history/{cycle}/`
Explore a filer's characteristics over time. This can be particularly useful if the committees change treasurers, designation, or `committee_type`.

- filters: election_full, designation
- fields (52): affiliated_committee_name, candidate_ids, city, committee_id, committee_label, committee_type, committee_type_full, convert_to_pac_flag, cycle, cycles, cycles_has_activity, cycles_has_financial, designated_agent_city, designated_agent_first_name, designated_agent_last_name, designated_agent_middle_name, designated_agent_name, designated_agent_phone_number, designated_agent_prefix, designated_agent_state, designated_agent_street1, designated_agent_street2, designated_agent_suffix, designated_agent_title, designated_agent_zip, designation, designation_full, filing_frequency, first_f1_date, first_file_date, former_candidate_election_year, former_candidate_id, former_candidate_name, former_committee_name, is_active, jfc_committee, last_cycle_has_activity, last_cycle_has_financial, last_f1_date, last_file_date, name, organization_type, organization_type_full, party, party_full, sponsor_candidate_ids, state, state_full, street_1, street_2, treasurer_name, zip

### `GET /v1/committee/{committee_id}/`
This endpoint is useful for finding detailed information about a particular committee or

- filters: year, cycle, filing_frequency, designation, organization_type, committee_type
- fields (73): affiliated_committee_name, candidate_ids, city, committee_id, committee_type, committee_type_full, custodian_city, custodian_name_1, custodian_name_2, custodian_name_full, custodian_name_middle, custodian_name_prefix, custodian_name_suffix, custodian_name_title, custodian_phone, custodian_state, custodian_street_1, custodian_street_2, custodian_zip, cycles, designated_agent_city, designated_agent_first_name, designated_agent_last_name, designated_agent_middle_name, designated_agent_name, designated_agent_phone_number, designated_agent_prefix, designated_agent_state, designated_agent_street1, designated_agent_street2, designated_agent_suffix, designated_agent_title, designated_agent_zip, designation, designation_full, email, fax, filing_frequency, first_f1_date, first_file_date, form_type, jfc_committee, last_f1_date, last_file_date, leadership_pac, lobbyist_registrant_pac, name, organization_type, organization_type_full, party, party_full, party_type, party_type_full, sponsor_candidate_ids, state, state_full, street_1, street_2, treasurer_city, treasurer_name, treasurer_name_1, treasurer_name_2, treasurer_name_middle, treasurer_name_prefix, treasurer_name_suffix, treasurer_name_title, treasurer_phone, treasurer_state, treasurer_street_1, treasurer_street_2, treasurer_zip, website, zip

### `GET /v1/committee/{committee_id}/history/`
Explore a filer's characteristics over time. This can be particularly useful if the committees change treasurers, designation, or `committee_type`.

- filters: election_full, designation
- fields (52): affiliated_committee_name, candidate_ids, city, committee_id, committee_label, committee_type, committee_type_full, convert_to_pac_flag, cycle, cycles, cycles_has_activity, cycles_has_financial, designated_agent_city, designated_agent_first_name, designated_agent_last_name, designated_agent_middle_name, designated_agent_name, designated_agent_phone_number, designated_agent_prefix, designated_agent_state, designated_agent_street1, designated_agent_street2, designated_agent_suffix, designated_agent_title, designated_agent_zip, designation, designation_full, filing_frequency, first_f1_date, first_file_date, former_candidate_election_year, former_candidate_id, former_candidate_name, former_committee_name, is_active, jfc_committee, last_cycle_has_activity, last_cycle_has_financial, last_f1_date, last_file_date, name, organization_type, organization_type_full, party, party_full, sponsor_candidate_ids, state, state_full, street_1, street_2, treasurer_name, zip

### `GET /v1/committee/{committee_id}/history/{cycle}/`
Explore a filer's characteristics over time. This can be particularly useful if the committees change treasurers, designation, or `committee_type`.

- filters: election_full, designation
- fields (52): affiliated_committee_name, candidate_ids, city, committee_id, committee_label, committee_type, committee_type_full, convert_to_pac_flag, cycle, cycles, cycles_has_activity, cycles_has_financial, designated_agent_city, designated_agent_first_name, designated_agent_last_name, designated_agent_middle_name, designated_agent_name, designated_agent_phone_number, designated_agent_prefix, designated_agent_state, designated_agent_street1, designated_agent_street2, designated_agent_suffix, designated_agent_title, designated_agent_zip, designation, designation_full, filing_frequency, first_f1_date, first_file_date, former_candidate_election_year, former_candidate_id, former_candidate_name, former_committee_name, is_active, jfc_committee, last_cycle_has_activity, last_cycle_has_financial, last_f1_date, last_file_date, name, organization_type, organization_type_full, party, party_full, sponsor_candidate_ids, state, state_full, street_1, street_2, treasurer_name, zip

### `GET /v1/committees/`
Fetch basic information about committees and filers. Use parameters to filter for

- filters: year, cycle, filing_frequency, designation, organization_type, committee_type, q, committee_id, candidate_id, state, party, min_first_file_date, max_first_file_date, min_last_file_date, max_last_file_date, min_first_f1_date, max_first_f1_date, min_last_f1_date, max_last_f1_date, treasurer_name, sponsor_candidate_id
- fields (35): affiliated_committee_name, candidate_ids, committee_id, committee_type, committee_type_full, cycles, designated_agent_city, designated_agent_first_name, designated_agent_last_name, designated_agent_middle_name, designated_agent_name, designated_agent_phone_number, designated_agent_prefix, designated_agent_state, designated_agent_street1, designated_agent_street2, designated_agent_suffix, designated_agent_title, designated_agent_zip, designation, designation_full, filing_frequency, first_f1_date, first_file_date, last_f1_date, last_file_date, name, organization_type, organization_type_full, party, party_full, sponsor_candidate_ids, sponsor_candidate_list, state, treasurer_name


## communication cost

### `GET /v1/communication_costs/`
52 U.S.C. 30118 allows "communications by a corporation to its stockholders and executive or administrative personnel and their families or by a labor organization to its members and their families on any subject," including the express advocacy of the election or defeat of any Federal candidate.  The costs of such communications must be reported to the Federal Election Commission under certain circumstances.

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, committee_id, candidate_id, support_oppose_indicator
- fields (36): action_code, action_code_full, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, committee_id, committee_name, communication_class, communication_type, communication_type_full, cycle, file_number, form_type_code, image_number, original_sub_id, pdf_url, primary_general_indicator, primary_general_indicator_description, purpose, report_type, report_year, schedule_type, schedule_type_full, state_full, sub_id, support_oppose_indicator, tran_id, transaction_amount, transaction_date, transaction_type

### `GET /v1/communication_costs/aggregates/`
Communication cost aggregated by candidate ID and committee ID.

- filters: cycle, candidate_id, committee_id, support_oppose_indicator
- fields (10): candidate, candidate_id, candidate_name, committee, committee_id, committee_name, count, cycle, support_oppose_indicator, total

### `GET /v1/communication_costs/by_candidate/`
Communication cost aggregated by candidate ID and committee ID.

- filters: state, district, cycle, office, election_full, candidate_id, support_oppose
- fields (8): candidate_id, candidate_name, committee_id, committee_name, count, cycle, support_oppose_indicator, total

### `GET /v1/communication_costs/totals/by_candidate/`
Total communications costs aggregated across committees on supported or opposed candidates by cycle or candidate election year.

- filters: cycle, candidate_id, election_full
- fields (4): candidate_id, cycle, support_oppose_indicator, total


## dates

### `GET /v1/calendar-dates/`
Combines the election and reporting dates with Commission meetings, conferences, outreach, Advisory Opinions, rules, litigation dates and other

- filters: calendar_category_id, description, summary, min_start_date, min_end_date, max_start_date, max_end_date, event_id
- fields (11): all_day, calendar_category_id, category, description, end_date, event_id, location, start_date, state, summary, url

### `GET /v1/calendar-dates/export/`
Returns CSV or ICS for downloading directly into calendar applications like Google, Outlook or other applications.

- filters: renderer, calendar_category_id, description, summary, min_start_date, min_end_date, max_start_date, max_end_date, event_id
- fields (11): all_day, calendar_category_id, category, description, end_date, event_id, location, start_date, state, summary, url

### `GET /v1/election-dates/`
FEC election dates since 1995.

- filters: election_state, election_district, election_party, office_sought, min_election_date, max_election_date, election_type_id, min_create_date, max_create_date, min_update_date, max_update_date, election_year, min_primary_general_date, max_primary_general_date
- fields (13): active_election, create_date, election_date, election_district, election_notes, election_party, election_state, election_type_full, election_type_id, election_year, office_sought, primary_general_date, update_date

### `GET /v1/reporting-dates/`
FEC election dates since 1995.

- filters: min_due_date, max_due_date, report_year, report_type, min_create_date, max_create_date, min_update_date, max_update_date
- fields (6): create_date, due_date, report_type, report_type_full, report_year, update_date


## debts

### `GET /v1/schedules/schedule_d/`
Schedule D, it shows debts and obligations owed to or by the committee that are

- filters: image_number, min_image_number, max_image_number, min_payment_period, max_payment_period, min_amount_incurred, max_amount_incurred, min_amount_outstanding_beginning, max_amount_outstanding_beginning, min_amount_outstanding_close, max_amount_outstanding_close, creditor_debtor_name, nature_of_debt, committee_id, min_coverage_end_date, max_coverage_end_date, min_coverage_start_date, max_coverage_start_date, report_year, report_type, form_line_number, committee_type, filing_form
- fields (39): action_code, action_code_full, amount_incurred_period, committee, committee_id, committee_name, committee_type, coverage_end_date, coverage_start_date, creditor_debtor_city, creditor_debtor_first_name, creditor_debtor_last_name, creditor_debtor_middle_name, creditor_debtor_name, creditor_debtor_prefix, creditor_debtor_state, creditor_debtor_street1, creditor_debtor_street2, creditor_debtor_suffix, election_cycle, entity_type, file_number, filing_form, form_line_number, image_number, line_number, link_id, nature_of_debt, original_sub_id, outstanding_balance_beginning_of_period, outstanding_balance_close_of_period, payment_period, pdf_url, report_type, report_year, schedule_type, schedule_type_full, sub_id, transaction_id

### `GET /v1/schedules/schedule_d/{sub_id}/`
Schedule D, it shows debts and obligations owed to or by the committee that are

- filters: —
- fields (39): action_code, action_code_full, amount_incurred_period, committee, committee_id, committee_name, committee_type, coverage_end_date, coverage_start_date, creditor_debtor_city, creditor_debtor_first_name, creditor_debtor_last_name, creditor_debtor_middle_name, creditor_debtor_name, creditor_debtor_prefix, creditor_debtor_state, creditor_debtor_street1, creditor_debtor_street2, creditor_debtor_suffix, election_cycle, entity_type, file_number, filing_form, form_line_number, image_number, line_number, link_id, nature_of_debt, original_sub_id, outstanding_balance_beginning_of_period, outstanding_balance_close_of_period, payment_period, pdf_url, report_type, report_year, schedule_type, schedule_type_full, sub_id, transaction_id


## disbursements

### `GET /v1/schedules/schedule_b/`
Schedule B filings describe itemized disbursements. This data

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, committee_id, disbursement_description, disbursement_purpose_category, last_disbursement_amount, last_disbursement_date, line_number, recipient_city, recipient_committee_id, recipient_name, recipient_state, spender_committee_designation, spender_committee_org_type, spender_committee_type, two_year_transaction_period, last_index
- fields (80): amendment_indicator, amendment_indicator_desc, back_reference_schedule_id, back_reference_transaction_id, beneficiary_committee_name, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_description, candidate_office_district, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, category_code, category_code_full, comm_dt, committee, committee_id, conduit_committee_city, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, disbursement_amount, disbursement_date, disbursement_description, disbursement_purpose_category, disbursement_type, disbursement_type_description, election_type, election_type_full, entity_type, entity_type_desc, fec_election_type_desc, fec_election_year, file_number, filing_form, image_number, line_number, line_number_label, link_id, load_date, memo_code, memo_code_full, memo_text, memoed_subtotal, national_committee_nonfederal_account, original_sub_id, payee_employer, payee_first_name, payee_last_name, payee_middle_name, payee_occupation, payee_prefix, payee_suffix, pdf_url, recipient_city, recipient_committee, recipient_committee_id, recipient_name, recipient_state, recipient_zip, ref_disp_excess_flg, report_type, report_year, schedule_type, schedule_type_full, semi_annual_bundled_refund, spender_committee_designation, spender_committee_org_type, spender_committee_type, sub_id, transaction_id, two_year_transaction_period, unused_recipient_committee_id

### `GET /v1/schedules/schedule_b/by_purpose/`
Schedule B disbursements aggregated by disbursement purpose category. To avoid double counting,

- filters: cycle, purpose, committee_id
- fields (7): committee_id, count, cycle, memo_count, memo_total, purpose, total

### `GET /v1/schedules/schedule_b/by_recipient/`
Schedule B disbursements aggregated by recipient name. To avoid double counting,

- filters: cycle, recipient_name, committee_id
- fields (9): committee_id, committee_total_disbursements, count, cycle, memo_count, memo_total, recipient_disbursement_percent, recipient_name, total

### `GET /v1/schedules/schedule_b/by_recipient_id/`
Schedule B disbursements aggregated by recipient committee ID, if applicable.

- filters: cycle, recipient_id, committee_id
- fields (9): committee_id, committee_name, count, cycle, memo_count, memo_total, recipient_id, recipient_name, total

### `GET /v1/schedules/schedule_b/efile/`
Efiling endpoints provide real-time campaign finance data received from electronic filers. Efiling endpoints only contain the most recent four months of data and don't contain the processed and coded data that you can find on other endpoints.

- filters: committee_id, disbursement_description, image_number, recipient_city, recipient_state, max_date, min_date, min_amount, max_amount
- fields (36): amendment_indicator, back_reference_schedule_name, back_reference_transaction_id, beginning_image_number, beneficiary_committee_name, candidate_office, candidate_office_district, committee, committee_id, csv_url, disbursement_amount, disbursement_date, disbursement_description, disbursement_type, entity_type, fec_url, file_number, filing, image_number, is_notice, line_number, load_timestamp, memo_code, memo_text, payee_name, pdf_url, recipient_city, recipient_name, recipient_prefix, recipient_state, recipient_suffix, recipient_zip, related_line_number, report_type, semi_annual_bundled_refund, transaction_id

### `GET /v1/schedules/schedule_b/{sub_id}/`
Schedule B filings describe itemized disbursements. This data

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, committee_id, disbursement_description, disbursement_purpose_category, last_disbursement_amount, last_disbursement_date, line_number, recipient_city, recipient_committee_id, recipient_name, recipient_state, spender_committee_designation, spender_committee_org_type, spender_committee_type, two_year_transaction_period, last_index
- fields (80): amendment_indicator, amendment_indicator_desc, back_reference_schedule_id, back_reference_transaction_id, beneficiary_committee_name, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_description, candidate_office_district, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, category_code, category_code_full, comm_dt, committee, committee_id, conduit_committee_city, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, disbursement_amount, disbursement_date, disbursement_description, disbursement_purpose_category, disbursement_type, disbursement_type_description, election_type, election_type_full, entity_type, entity_type_desc, fec_election_type_desc, fec_election_year, file_number, filing_form, image_number, line_number, line_number_label, link_id, load_date, memo_code, memo_code_full, memo_text, memoed_subtotal, national_committee_nonfederal_account, original_sub_id, payee_employer, payee_first_name, payee_last_name, payee_middle_name, payee_occupation, payee_prefix, payee_suffix, pdf_url, recipient_city, recipient_committee, recipient_committee_id, recipient_name, recipient_state, recipient_zip, ref_disp_excess_flg, report_type, report_year, schedule_type, schedule_type_full, semi_annual_bundled_refund, spender_committee_designation, spender_committee_org_type, spender_committee_type, sub_id, transaction_id, two_year_transaction_period, unused_recipient_committee_id

### `GET /v1/schedules/schedule_h4/`
Schedule H4 filings describe disbursements for allocated federal/nonfederal activity. This data

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, report_year, report_type, activity_or_event, q_payee_name, payee_city, payee_zip, payee_state, q_disbursement_purpose, cycle, committee_id, last_payee_name, last_disbursement_purpose, last_event_purpose_date, last_spender_committee_name, last_disbursement_amount, administrative_voter_drive_activity_indicator, fundraising_activity_indicator, exempt_activity_indicator, direct_candidate_support_activity_indicator, administrative_activity_indicator, general_voter_drive_activity_indicator, public_comm_indicator, spender_committee_name, spender_committee_type, spender_committee_designation, form_line_number, last_index
- fields (42): activity_or_event, administrative_activity_indicator, administrative_voter_drive_activity_indicator, committee, committee_id, cycle, direct_candidate_support_activity_indicator, disbursement_amount, disbursement_purpose, event_amount_year_to_date, event_purpose_date, exempt_activity_indicator, federal_share, file_number, filing_form, form_line_number, fundraising_activity_indicator, general_voter_drive_activity_indicator, image_number, line_number, link_id, memo_code, memo_text, nonfederal_share, original_sub_id, payee_city, payee_name, payee_state, payee_street_1, payee_street_2, payee_zip, pdf_url, public_comm_indicator, report_type, report_year, schedule_type, schedule_type_full, spender_committee_designation, spender_committee_name, spender_committee_type, sub_id, transaction_id

### `GET /v1/schedules/schedule_h4/efile/`
Efiling endpoints provide real-time campaign finance data received from electronic filers. Efiling endpoints only contain the most recent four months of data and don't contain the processed and coded data that you can find on other endpoints.

- filters: image_number, min_image_number, max_image_number, payee_city, payee_zip, payee_state, committee_id, last_disbursement_purpose, last_event_purpose_date, min_date, max_date, last_disbursement_amount, min_amount, max_amount
- fields (37): activity_or_event, administrative_voter_drive_activity_indicator, amendment_indicator, back_reference_schedule_name, back_reference_transaction_id, beginning_image_number, committee, committee_id, csv_url, direct_candidate_support_activity_indicator, disbursement_amount, disbursement_purpose, entity_type, event_amount_year_to_date, event_purpose_date, exempt_activity_indicator, fec_url, fed_share, file_number, filing, fundraising_activity_indicator, general_voter_drive_activity_indicator, image_number, is_notice, load_timestamp, memo_code, memo_text, nonfed_share, payee_city, payee_name, payee_state, payee_zip, pdf_url, public_comm_indicator, related_line_number, report_type, transaction_id


## efiling

### `GET /v1/efile/filings/`
Basic information about electronic files coming into the FEC, posted as they are received.

- filters: file_number, committee_id, min_receipt_date, max_receipt_date, q_filer, form_type
- fields (24): amended_by, amendment_chain, amendment_number, amends_file, beginning_image_number, committee_id, committee_name, coverage_end_date, coverage_start_date, csv_url, document_description, ending_image_number, fec_file_id, fec_url, file_number, filed_date, form_type, html_url, is_amended, load_timestamp, most_recent, most_recent_filing, pdf_url, receipt_date

### `GET /v1/efile/form1/`
Basic information about electronic files coming into the FEC, posted as they are received.

- filters: file_number, committee_id, candidate_id, election_state, candidate_office, candidate_district, candidate_party, image_number, min_load_timestamp, max_load_timestamp, committee_type, organization_type
- fields (46): affiliated_candidate_id, affiliated_committee_city, affiliated_committee_id, affiliated_committee_name, affiliated_committee_state, affiliated_committee_str1, affiliated_committee_str2, affiliated_committee_zip, affiliated_relationship_code, candidate_district, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_party, city, committee_city, committee_id, committee_name, committee_state, committee_str1, committee_str2, committee_type, committee_zip, derived_committee_type, election_state, email, file_number, image_number, load_timestamp, organization_type, pdf_url, state, street_1, street_2, treasurer_city, treasurer_first_name, treasurer_last_name, treasurer_middle_name, treasurer_state, treasurer_str1, treasurer_str2, treasurer_zip, zip

### `GET /v1/efile/form2/`
Basic information about electronic files coming into the FEC, posted as they are received.

- filters: file_number, committee_id, candidate_id, election_state, candidate_office, candidate_district, candidate_party, image_number, min_load_timestamp, max_load_timestamp
- fields (25): address_city, address_state, address_str1, address_str2, address_zip, candidate_district, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_party, committee_address_city, committee_address_str1, committee_address_str2, committee_address_zip, committee_id, committee_name, election_state, election_year, file_number, image_number, load_timestamp, pdf_url

### `GET /v1/efile/reports/house-senate/`
Key financial data reported periodically by committees as they are reported. This feed includes summary

- filters: file_number, committee_id, min_receipt_date, max_receipt_date, q_filer, form_type
- fields (52): amended_address, amended_by, amendment, amendment_chain, beginning_image_number, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_prefix, candidate_suffix, cash_on_hand_beginning_period, city, committee_id, committee_name, coverage_end_date, coverage_start_date, csv_url, district, document_description, election_date, election_state, f3z1, fec_file_id, fec_url, file_number, general_election, is_amended, most_recent, most_recent_filing, pdf_url, prefix, primary_election, receipt_date, report, report_type, report_year, rpt_pgi, runoff_election, sign_date, special_election, state, street_1, street_2, suffix, summary_lines, treasurer_first_name, treasurer_last_name, treasurer_middle_name, treasurer_name, zip

### `GET /v1/efile/reports/pac-party/`
Key financial data reported periodically by committees as they are reported. This feed includes summary

- filters: file_number, committee_id, min_receipt_date, max_receipt_date, q_filer, form_type
- fields (33): amend_address, amended_by, amendment, amendment_chain, beginning_image_number, city, committee_id, committee_name, coverage_end_date, coverage_start_date, csv_url, document_description, election_date, election_state, fec_file_id, fec_url, file_number, is_amended, most_recent, most_recent_filing, pdf_url, qualified_multicandidate_committee, receipt_date, report, report_type, report_year, rpt_pgi, sign_date, state, street_1, street_2, summary_lines, zip

### `GET /v1/efile/reports/presidential/`
Key financial data reported periodically by committees as they are reported. This feed includes summary

- filters: file_number, committee_id, min_receipt_date, max_receipt_date, q_filer, form_type
- fields (47): amended_by, amendment, amendment_chain, beginning_image_number, cash_on_hand_beginning_period, cash_on_hand_end_period, city, committee_id, committee_name, coverage_end_date, coverage_start_date, csv_url, debts_owed_by_committee, debts_owed_to_committee, document_description, election_date, election_state, expenditure_subject_to_limits, fec_file_id, fec_url, file_number, general_election, is_amended, most_recent, most_recent_filing, net_contributions_cycle_to_date, net_operating_expenditures_cycle_to_date, pdf_url, prefix, primary_election, receipt_date, report, report_type, report_year, rpt_pgi, sign_date, state, street_1, street_2, subtotal_summary_period, suffix, summary_lines, treasurer_first_name, treasurer_last_name, treasurer_middle_name, treasurer_name, zip


## electioneering

### `GET /v1/electioneering/`
An electioneering communication is any broadcast, cable or satellite communication that fulfills each of the following conditions:

- filters: committee_id, candidate_id, report_year, min_amount, max_amount, min_date, max_date, disbursement_description, last_index
- fields (27): amendment_indicator, beginning_image_number, calculated_candidate_share, candidate_district, candidate_id, candidate_name, candidate_office, candidate_state, committee_id, committee_name, communication_date, disbursement_amount, disbursement_date, election_type, file_number, link_id, number_of_candidates, payee_name, payee_state, pdf_url, public_distribution_date, purpose_description, receipt_date, report_year, sb_image_num, sb_link_id, sub_id

### `GET /v1/electioneering/aggregates/`
Electioneering communications costs aggregates

- filters: cycle, candidate_id, committee_id
- fields (9): candidate, candidate_id, candidate_name, committee, committee_id, committee_name, count, cycle, total

### `GET /v1/electioneering/by_candidate/`
Electioneering costs aggregated by candidate

- filters: state, district, cycle, office, election_full, candidate_id
- fields (7): candidate_id, candidate_name, committee_id, committee_name, count, cycle, total

### `GET /v1/electioneering/totals/by_candidate/`
Total electioneering communications spent on candidates by cycle

- filters: cycle, candidate_id, election_full
- fields (3): candidate_id, cycle, total


## filer resources

### `GET /v1/rad-analyst/`
Use this endpoint to look up the RAD Analyst for a committee.

- filters: committee_id, analyst_id, analyst_short_id, telephone_ext, name, email, title, min_assignment_update_date, max_assignment_update_date
- fields (11): analyst_id, analyst_short_id, assignment_update_date, committee_id, committee_name, email, first_name, last_name, rad_branch, telephone_ext, title

### `GET /v1/state-election-office/`
State laws and procedures govern elections for state or local offices as well as

- filters: state
- fields (19): address_line1, address_line2, city, email, fax_number, mailing_address1, mailing_address2, mailing_city, mailing_state, mailing_zipcode, office_name, office_type, primary_phone_number, secondary_phone_number, state, state_full_name, website_url1, website_url2, zip_code


## filings

### `GET /v1/candidate/{candidate_id}/filings/`
All official records and reports filed by or delivered to the FEC.

- filters: committee_type, cycle, is_amended, most_recent, report_type, request_type, document_type, beginning_image_number, report_year, min_receipt_date, max_receipt_date, form_type, state, district, office, party, filer_type, file_number, primary_general_indicator, amendment_indicator, form_category, q_filer
- fields (63): additional_bank_names, amendment_chain, amendment_indicator, amendment_version, bank_depository_city, bank_depository_name, bank_depository_state, bank_depository_street_1, bank_depository_street_2, bank_depository_zip, beginning_image_number, candidate_id, candidate_name, cash_on_hand_beginning_period, cash_on_hand_end_period, committee_id, committee_name, committee_type, coverage_end_date, coverage_start_date, csv_url, cycle, debts_owed_by_committee, debts_owed_to_committee, document_description, document_type, document_type_full, election_year, ending_image_number, fec_file_id, fec_url, file_number, form_category, form_type, house_personal_funds, html_url, is_amended, means_filed, most_recent, most_recent_file_number, net_donations, office, opposition_personal_funds, pages, party, pdf_url, previous_file_number, primary_general_indicator, receipt_date, report_type, report_type_full, report_year, request_type, senate_personal_funds, state, sub_id, total_communication_cost, total_disbursements, total_independent_expenditures, total_individual_contributions, total_receipts, treasurer_name, update_date

### `GET /v1/committee/{committee_id}/filings/`
All official records and reports filed by or delivered to the FEC.

- filters: committee_type, cycle, is_amended, most_recent, report_type, request_type, document_type, beginning_image_number, report_year, min_receipt_date, max_receipt_date, form_type, state, district, office, party, filer_type, file_number, primary_general_indicator, amendment_indicator, form_category, q_filer
- fields (63): additional_bank_names, amendment_chain, amendment_indicator, amendment_version, bank_depository_city, bank_depository_name, bank_depository_state, bank_depository_street_1, bank_depository_street_2, bank_depository_zip, beginning_image_number, candidate_id, candidate_name, cash_on_hand_beginning_period, cash_on_hand_end_period, committee_id, committee_name, committee_type, coverage_end_date, coverage_start_date, csv_url, cycle, debts_owed_by_committee, debts_owed_to_committee, document_description, document_type, document_type_full, election_year, ending_image_number, fec_file_id, fec_url, file_number, form_category, form_type, house_personal_funds, html_url, is_amended, means_filed, most_recent, most_recent_file_number, net_donations, office, opposition_personal_funds, pages, party, pdf_url, previous_file_number, primary_general_indicator, receipt_date, report_type, report_type_full, report_year, request_type, senate_personal_funds, state, sub_id, total_communication_cost, total_disbursements, total_independent_expenditures, total_individual_contributions, total_receipts, treasurer_name, update_date

### `GET /v1/filings/`
All official records and reports filed by or delivered to the FEC.

- filters: committee_type, cycle, is_amended, most_recent, report_type, request_type, document_type, beginning_image_number, report_year, min_receipt_date, max_receipt_date, form_type, state, district, office, party, filer_type, file_number, primary_general_indicator, amendment_indicator, form_category, q_filer, committee_id, candidate_id
- fields (63): additional_bank_names, amendment_chain, amendment_indicator, amendment_version, bank_depository_city, bank_depository_name, bank_depository_state, bank_depository_street_1, bank_depository_street_2, bank_depository_zip, beginning_image_number, candidate_id, candidate_name, cash_on_hand_beginning_period, cash_on_hand_end_period, committee_id, committee_name, committee_type, coverage_end_date, coverage_start_date, csv_url, cycle, debts_owed_by_committee, debts_owed_to_committee, document_description, document_type, document_type_full, election_year, ending_image_number, fec_file_id, fec_url, file_number, form_category, form_type, house_personal_funds, html_url, is_amended, means_filed, most_recent, most_recent_file_number, net_donations, office, opposition_personal_funds, pages, party, pdf_url, previous_file_number, primary_general_indicator, receipt_date, report_type, report_type_full, report_year, request_type, senate_personal_funds, state, sub_id, total_communication_cost, total_disbursements, total_independent_expenditures, total_individual_contributions, total_receipts, treasurer_name, update_date

### `GET /v1/operations-log/`
The Operations log contains details of each report loaded into the database. It is primarily

- filters: candidate_committee_id, report_type, beginning_image_number, report_year, form_type, amendment_indicator, status_num, min_receipt_date, max_receipt_date, min_coverage_end_date, max_coverage_end_date, min_transaction_data_complete_date, max_transaction_data_complete_date
- fields (15): amendment_indicator, beginning_image_number, candidate_committee_id, coverage_end_date, coverage_start_date, ending_image_number, form_type, receipt_date, report_type, report_year, status_num, sub_id, summary_data_complete_date, summary_data_verification_date, transaction_data_complete_date


## financial

### `GET /v1/committee/{committee_id}/reports/`
Each report represents the summary information from Form 3, Form 3X and Form 3P.

- filters: year, cycle, beginning_image_number, report_type, is_amended, min_disbursements_amount, max_disbursements_amount, min_receipts_amount, max_receipts_amount, min_cash_on_hand_end_period_amount, max_cash_on_hand_end_period_amount, min_debts_owed_amount, max_debts_owed_expenditures, min_independent_expenditures, max_independent_expenditures, min_party_coordinated_expenditures, max_party_coordinated_expenditures, min_total_contributions, max_total_contributions, type
- fields (182): aggregate_amount_personal_contributions_general, aggregate_contributions_personal_funds_primary, all_loans_received_period, all_loans_received_ytd, all_other_loans_period, all_other_loans_ytd, allocated_federal_election_levin_share_period, amendment_chain, amendment_indicator, amendment_indicator_full, beginning_image_number, calendar_ytd, candidate_contribution_period, candidate_contribution_ytd, cash_on_hand_beginning_calendar_ytd, cash_on_hand_beginning_period, cash_on_hand_close_ytd, cash_on_hand_end_period, committee_id, committee_name, committee_type, coordinated_expenditures_by_party_committee_period, coordinated_expenditures_by_party_committee_ytd, coverage_end_date, coverage_start_date, csv_url, cycle, debts_owed_by_committee, debts_owed_to_committee, document_description, end_image_number, exempt_legal_accounting_disbursement_period, exempt_legal_accounting_disbursement_ytd, expenditure_subject_to_limits, fec_file_id, fec_url, fed_candidate_committee_contribution_refunds_ytd, fed_candidate_committee_contributions_period, fed_candidate_committee_contributions_ytd, fed_candidate_contribution_refunds_period, federal_funds_period, federal_funds_ytd, file_number, fundraising_disbursements_period, fundraising_disbursements_ytd, gross_receipt_authorized_committee_general, gross_receipt_authorized_committee_primary, gross_receipt_minus_personal_contribution_general, gross_receipt_minus_personal_contributions_primary, html_url, independent_contributions_period, independent_expenditures_period, independent_expenditures_ytd, individual_itemized_contributions_period, individual_itemized_contributions_ytd, individual_unitemized_contributions_period, individual_unitemized_contributions_ytd, is_amended, items_on_hand_liquidated, loan_repayments_candidate_loans_period, loan_repayments_candidate_loans_ytd, loan_repayments_made_period, loan_repayments_made_ytd, loan_repayments_other_loans_period, loan_repayments_other_loans_ytd, loan_repayments_received_period, loan_repayments_received_ytd, loans_made_by_candidate_period, loans_made_by_candidate_ytd, loans_made_period, loans_made_ytd, loans_received_from_candidate_period, loans_received_from_candidate_ytd, means_filed, most_recent, most_recent_file_number, net_contributions_cycle_to_date, net_contributions_period, net_contributions_ytd, net_operating_expenditures_cycle_to_date, net_operating_expenditures_period, net_operating_expenditures_ytd, non_allocated_fed_election_activity_period, non_allocated_fed_election_activity_ytd, nonfed_share_allocated_disbursements_period, offsets_to_fundraising_expenditures_period, offsets_to_fundraising_expenditures_ytd, offsets_to_legal_accounting_period, offsets_to_legal_accounting_ytd, offsets_to_operating_expenditures_period, offsets_to_operating_expenditures_ytd, operating_expenditures_period, operating_expenditures_ytd, other_disbursements_period, other_disbursements_ytd, other_fed_operating_expenditures_period, other_fed_operating_expenditures_ytd, other_fed_receipts_period, other_fed_receipts_ytd, other_loans_received_period, other_loans_received_ytd, other_political_committee_contributions_period, other_political_committee_contributions_ytd, other_receipts_period, other_receipts_ytd, pdf_url, political_party_committee_contributions_period, political_party_committee_contributions_ytd, previous_file_number, receipt_date, refunded_individual_contributions_period, refunded_individual_contributions_ytd, refunded_other_political_committee_contributions_period, refunded_other_political_committee_contributions_ytd, refunded_political_party_committee_contributions_period, refunded_political_party_committee_contributions_ytd, refunds_total_contributions_col_total_ytd, repayments_loans_made_by_candidate_period, repayments_loans_made_candidate_ytd, repayments_other_loans_period, repayments_other_loans_ytd, report_form, report_type, report_type_full, report_year, shared_fed_activity_nonfed_ytd, shared_fed_activity_period, shared_fed_activity_ytd, shared_fed_operating_expenditures_period, shared_fed_operating_expenditures_ytd, shared_nonfed_operating_expenditures_period, shared_nonfed_operating_expenditures_ytd, subtotal_period, subtotal_summary_page_period, subtotal_summary_period, subtotal_summary_ytd, total_contribution_refunds_col_total_period, total_contribution_refunds_period, total_contribution_refunds_ytd, total_contributions_column_total_period, total_contributions_period, total_contributions_ytd, total_disbursements_period, total_disbursements_ytd, total_fed_disbursements_period, total_fed_disbursements_ytd, total_fed_election_activity_period, total_fed_election_activity_ytd, total_fed_operating_expenditures_period, total_fed_operating_expenditures_ytd, total_fed_receipts_period, total_fed_receipts_ytd, total_individual_contributions_period, total_individual_contributions_ytd, total_loan_repayments_made_period, total_loan_repayments_made_ytd, total_loans_received_period, total_loans_received_ytd, total_nonfed_transfers_period, total_nonfed_transfers_ytd, total_offsets_to_operating_expenditures_period, total_offsets_to_operating_expenditures_ytd, total_operating_expenditures_period, total_operating_expenditures_ytd, total_period, total_receipts_period, total_receipts_ytd, total_ytd, transfers_from_affiliated_committee_period, transfers_from_affiliated_committee_ytd, transfers_from_affiliated_party_period, transfers_from_affiliated_party_ytd, transfers_from_nonfed_account_period, transfers_from_nonfed_account_ytd, transfers_from_nonfed_levin_period, transfers_from_nonfed_levin_ytd, transfers_from_other_authorized_committee_period, transfers_from_other_authorized_committee_ytd, transfers_to_affiliated_committee_period, transfers_to_affilitated_committees_ytd, transfers_to_other_authorized_committee_period, transfers_to_other_authorized_committee_ytd

### `GET /v1/committee/{committee_id}/totals/`
This endpoint provides information about a committee's Form 3, Form 3X, or Form 3P financial reports,

- filters: cycle
- fields (118): all_loans_received, all_other_loans, allocated_federal_election_levin_share, candidate_contribution, cash_on_hand_beginning_period, committee_designation, committee_designation_full, committee_id, committee_name, committee_state, committee_type, committee_type_full, contribution_refunds, contributions, contributions_ie_and_party_expenditures_made_percent, convention_exp, coordinated_expenditures_by_party_committee, coverage_end_date, coverage_start_date, cycle, disbursements, exempt_legal_accounting_disbursement, exp_prior_years_subject_limits, exp_subject_limits, fed_candidate_committee_contributions, fed_candidate_contribution_refunds, fed_disbursements, fed_election_activity, fed_operating_expenditures, fed_receipts, federal_funds, filing_frequency, filing_frequency_full, first_f1_date, first_file_date, fundraising_disbursements, independent_expenditures, individual_contributions, individual_contributions_percent, individual_itemized_contributions, individual_unitemized_contributions, itemized_convention_exp, itemized_other_disb, itemized_other_income, itemized_other_refunds, itemized_refunds_relating_convention_exp, last_beginning_image_number, last_cash_on_hand_end_period, last_debts_owed_by_committee, last_debts_owed_to_committee, last_report_type_full, last_report_year, loan_repayments, loan_repayments_candidate_loans, loan_repayments_made, loan_repayments_other_loans, loan_repayments_received, loans, loans_and_loan_repayments_made, loans_and_loan_repayments_received, loans_made, loans_made_by_candidate, loans_received, loans_received_from_candidate, net_contributions, net_operating_expenditures, non_allocated_fed_election_activity, offsets_to_fundraising_expenditures, offsets_to_legal_accounting, offsets_to_operating_expenditures, operating_expenditures, operating_expenditures_percent, organization_type, organization_type_full, other_disbursements, other_fed_operating_expenditures, other_fed_receipts, other_loans_received, other_political_committee_contributions, other_receipts, other_refunds, party_and_other_committee_contributions_percent, party_full, pdf_url, political_party_committee_contributions, receipts, refunded_individual_contributions, refunded_other_political_committee_contributions, refunded_political_party_committee_contributions, refunds_relating_convention_exp, repayments_loans_made_by_candidate, repayments_other_loans, report_form, shared_fed_activity, shared_fed_activity_nonfed, shared_fed_operating_expenditures, shared_nonfed_operating_expenditures, sponsor_candidate_ids, sponsor_candidate_list, total_exp_subject_limits, total_independent_contributions, total_independent_expenditures, total_offsets_to_operating_expenditures, total_transfers, transaction_coverage_date, transfers_from_affiliated_committee, transfers_from_affiliated_party, transfers_from_nonfed_account, transfers_from_nonfed_levin, transfers_from_other_authorized_committee, transfers_to_affiliated_committee, transfers_to_other_authorized_committee, treasurer_name, unitemized_convention_exp, unitemized_other_disb, unitemized_other_income, unitemized_other_refunds, unitemized_refunds_relating_convention_exp

### `GET /v1/elections/`
Look at the top-level financial information for all candidates running for the same

- filters: state, district, cycle, office, election_full
- fields (12): candidate_election_year, candidate_id, candidate_name, candidate_pcc_id, candidate_pcc_name, cash_on_hand_end_period, committee_ids, coverage_end_date, incumbent_challenge_full, party_full, total_disbursements, total_receipts

### `GET /v1/elections/search/`
List elections by cycle, office, state, and district.

- filters: state, district, cycle, zip, office
- fields (4): cycle, district, office, state

### `GET /v1/elections/summary/`
List elections by cycle, office, state, and district.

- filters: state, district, cycle, office, election_full
- fields (0): —

### `GET /v1/reports/{entity_type}/`
Each report represents the summary information from Form 3, Form 3X and Form 3P.

- filters: year, cycle, beginning_image_number, report_type, is_amended, most_recent, filer_type, min_disbursements_amount, max_disbursements_amount, min_receipts_amount, max_receipts_amount, max_receipt_date, min_receipt_date, min_cash_on_hand_end_period_amount, max_cash_on_hand_end_period_amount, min_debts_owed_amount, max_debts_owed_expenditures, min_independent_expenditures, max_independent_expenditures, min_party_coordinated_expenditures, max_party_coordinated_expenditures, min_total_contributions, max_total_contributions, committee_type, candidate_id, committee_id, amendment_indicator, q_filer, q_spender
- fields (182): aggregate_amount_personal_contributions_general, aggregate_contributions_personal_funds_primary, all_loans_received_period, all_loans_received_ytd, all_other_loans_period, all_other_loans_ytd, allocated_federal_election_levin_share_period, amendment_chain, amendment_indicator, amendment_indicator_full, beginning_image_number, calendar_ytd, candidate_contribution_period, candidate_contribution_ytd, cash_on_hand_beginning_calendar_ytd, cash_on_hand_beginning_period, cash_on_hand_close_ytd, cash_on_hand_end_period, committee_id, committee_name, committee_type, coordinated_expenditures_by_party_committee_period, coordinated_expenditures_by_party_committee_ytd, coverage_end_date, coverage_start_date, csv_url, cycle, debts_owed_by_committee, debts_owed_to_committee, document_description, end_image_number, exempt_legal_accounting_disbursement_period, exempt_legal_accounting_disbursement_ytd, expenditure_subject_to_limits, fec_file_id, fec_url, fed_candidate_committee_contribution_refunds_ytd, fed_candidate_committee_contributions_period, fed_candidate_committee_contributions_ytd, fed_candidate_contribution_refunds_period, federal_funds_period, federal_funds_ytd, file_number, fundraising_disbursements_period, fundraising_disbursements_ytd, gross_receipt_authorized_committee_general, gross_receipt_authorized_committee_primary, gross_receipt_minus_personal_contribution_general, gross_receipt_minus_personal_contributions_primary, html_url, independent_contributions_period, independent_expenditures_period, independent_expenditures_ytd, individual_itemized_contributions_period, individual_itemized_contributions_ytd, individual_unitemized_contributions_period, individual_unitemized_contributions_ytd, is_amended, items_on_hand_liquidated, loan_repayments_candidate_loans_period, loan_repayments_candidate_loans_ytd, loan_repayments_made_period, loan_repayments_made_ytd, loan_repayments_other_loans_period, loan_repayments_other_loans_ytd, loan_repayments_received_period, loan_repayments_received_ytd, loans_made_by_candidate_period, loans_made_by_candidate_ytd, loans_made_period, loans_made_ytd, loans_received_from_candidate_period, loans_received_from_candidate_ytd, means_filed, most_recent, most_recent_file_number, net_contributions_cycle_to_date, net_contributions_period, net_contributions_ytd, net_operating_expenditures_cycle_to_date, net_operating_expenditures_period, net_operating_expenditures_ytd, non_allocated_fed_election_activity_period, non_allocated_fed_election_activity_ytd, nonfed_share_allocated_disbursements_period, offsets_to_fundraising_expenditures_period, offsets_to_fundraising_expenditures_ytd, offsets_to_legal_accounting_period, offsets_to_legal_accounting_ytd, offsets_to_operating_expenditures_period, offsets_to_operating_expenditures_ytd, operating_expenditures_period, operating_expenditures_ytd, other_disbursements_period, other_disbursements_ytd, other_fed_operating_expenditures_period, other_fed_operating_expenditures_ytd, other_fed_receipts_period, other_fed_receipts_ytd, other_loans_received_period, other_loans_received_ytd, other_political_committee_contributions_period, other_political_committee_contributions_ytd, other_receipts_period, other_receipts_ytd, pdf_url, political_party_committee_contributions_period, political_party_committee_contributions_ytd, previous_file_number, receipt_date, refunded_individual_contributions_period, refunded_individual_contributions_ytd, refunded_other_political_committee_contributions_period, refunded_other_political_committee_contributions_ytd, refunded_political_party_committee_contributions_period, refunded_political_party_committee_contributions_ytd, refunds_total_contributions_col_total_ytd, repayments_loans_made_by_candidate_period, repayments_loans_made_candidate_ytd, repayments_other_loans_period, repayments_other_loans_ytd, report_form, report_type, report_type_full, report_year, shared_fed_activity_nonfed_ytd, shared_fed_activity_period, shared_fed_activity_ytd, shared_fed_operating_expenditures_period, shared_fed_operating_expenditures_ytd, shared_nonfed_operating_expenditures_period, shared_nonfed_operating_expenditures_ytd, subtotal_period, subtotal_summary_page_period, subtotal_summary_period, subtotal_summary_ytd, total_contribution_refunds_col_total_period, total_contribution_refunds_period, total_contribution_refunds_ytd, total_contributions_column_total_period, total_contributions_period, total_contributions_ytd, total_disbursements_period, total_disbursements_ytd, total_fed_disbursements_period, total_fed_disbursements_ytd, total_fed_election_activity_period, total_fed_election_activity_ytd, total_fed_operating_expenditures_period, total_fed_operating_expenditures_ytd, total_fed_receipts_period, total_fed_receipts_ytd, total_individual_contributions_period, total_individual_contributions_ytd, total_loan_repayments_made_period, total_loan_repayments_made_ytd, total_loans_received_period, total_loans_received_ytd, total_nonfed_transfers_period, total_nonfed_transfers_ytd, total_offsets_to_operating_expenditures_period, total_offsets_to_operating_expenditures_ytd, total_operating_expenditures_period, total_operating_expenditures_ytd, total_period, total_receipts_period, total_receipts_ytd, total_ytd, transfers_from_affiliated_committee_period, transfers_from_affiliated_committee_ytd, transfers_from_affiliated_party_period, transfers_from_affiliated_party_ytd, transfers_from_nonfed_account_period, transfers_from_nonfed_account_ytd, transfers_from_nonfed_levin_period, transfers_from_nonfed_levin_ytd, transfers_from_other_authorized_committee_period, transfers_from_other_authorized_committee_ytd, transfers_to_affiliated_committee_period, transfers_to_affilitated_committees_ytd, transfers_to_other_authorized_committee_period, transfers_to_other_authorized_committee_ytd

### `GET /v1/totals/by_entity/`
Provides cumulative receipt totals by entity type, over a two year cycle. Totals are adjusted to avoid double counting.

- filters: cycle
- fields (8): cumulative_candidate_disbursements, cumulative_candidate_receipts, cumulative_pac_disbursements, cumulative_pac_receipts, cumulative_party_disbursements, cumulative_party_receipts, cycle, end_date

### `GET /v1/totals/inaugural_committees/by_contributor/`
This endpoint provides information about an inaugural committee's Form 13 report of donations accepted.

- filters: committee_id, contributor_name, cycle
- fields (4): committee_id, contributor_name, cycle, total_donation

### `GET /v1/totals/{entity_type}/`
This endpoint provides information about a committee's Form 3, Form 3X, or Form 3P financial reports,

- filters: cycle, committee_designation, committee_id, committee_type, committee_state, filing_frequency, treasurer_name, min_disbursements, max_disbursements, min_receipts, max_receipts, min_last_cash_on_hand_end_period, max_last_cash_on_hand_end_period, min_last_debts_owed_by_committee, max_last_debts_owed_by_committee, sponsor_candidate_id, organization_type, min_first_f1_date, max_first_f1_date
- fields (118): all_loans_received, all_other_loans, allocated_federal_election_levin_share, candidate_contribution, cash_on_hand_beginning_period, committee_designation, committee_designation_full, committee_id, committee_name, committee_state, committee_type, committee_type_full, contribution_refunds, contributions, contributions_ie_and_party_expenditures_made_percent, convention_exp, coordinated_expenditures_by_party_committee, coverage_end_date, coverage_start_date, cycle, disbursements, exempt_legal_accounting_disbursement, exp_prior_years_subject_limits, exp_subject_limits, fed_candidate_committee_contributions, fed_candidate_contribution_refunds, fed_disbursements, fed_election_activity, fed_operating_expenditures, fed_receipts, federal_funds, filing_frequency, filing_frequency_full, first_f1_date, first_file_date, fundraising_disbursements, independent_expenditures, individual_contributions, individual_contributions_percent, individual_itemized_contributions, individual_unitemized_contributions, itemized_convention_exp, itemized_other_disb, itemized_other_income, itemized_other_refunds, itemized_refunds_relating_convention_exp, last_beginning_image_number, last_cash_on_hand_end_period, last_debts_owed_by_committee, last_debts_owed_to_committee, last_report_type_full, last_report_year, loan_repayments, loan_repayments_candidate_loans, loan_repayments_made, loan_repayments_other_loans, loan_repayments_received, loans, loans_and_loan_repayments_made, loans_and_loan_repayments_received, loans_made, loans_made_by_candidate, loans_received, loans_received_from_candidate, net_contributions, net_operating_expenditures, non_allocated_fed_election_activity, offsets_to_fundraising_expenditures, offsets_to_legal_accounting, offsets_to_operating_expenditures, operating_expenditures, operating_expenditures_percent, organization_type, organization_type_full, other_disbursements, other_fed_operating_expenditures, other_fed_receipts, other_loans_received, other_political_committee_contributions, other_receipts, other_refunds, party_and_other_committee_contributions_percent, party_full, pdf_url, political_party_committee_contributions, receipts, refunded_individual_contributions, refunded_other_political_committee_contributions, refunded_political_party_committee_contributions, refunds_relating_convention_exp, repayments_loans_made_by_candidate, repayments_other_loans, report_form, shared_fed_activity, shared_fed_activity_nonfed, shared_fed_operating_expenditures, shared_nonfed_operating_expenditures, sponsor_candidate_ids, sponsor_candidate_list, total_exp_subject_limits, total_independent_contributions, total_independent_expenditures, total_offsets_to_operating_expenditures, total_transfers, transaction_coverage_date, transfers_from_affiliated_committee, transfers_from_affiliated_party, transfers_from_nonfed_account, transfers_from_nonfed_levin, transfers_from_other_authorized_committee, transfers_to_affiliated_committee, transfers_to_other_authorized_committee, treasurer_name, unitemized_convention_exp, unitemized_other_disb, unitemized_other_income, unitemized_other_refunds, unitemized_refunds_relating_convention_exp


## independent expenditures

### `GET /v1/schedules/schedule_e/`
Schedule E covers the line item expenditures for independent expenditures. For example, if a super PAC

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, candidate_office, candidate_party, candidate_office_state, candidate_office_district, cycle, committee_id, candidate_id, filing_form, last_expenditure_date, last_expenditure_amount, last_office_total_ytd, payee_name, support_oppose_indicator, last_support_oppose_indicator, is_notice, min_dissemination_date, max_dissemination_date, min_filing_date, max_filing_date, most_recent, q_spender, form_line_number, last_index
- fields (81): action_code, action_code_full, amendment_indicator, amendment_number, back_reference_schedule_name, back_reference_transaction_id, candidate, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_state, candidate_party, candidate_prefix, candidate_suffix, category_code, category_code_full, committee, committee_id, conduit_committee_city, conduit_committee_id, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, disbursement_dt, dissemination_date, election_type, election_type_full, expenditure_amount, expenditure_date, expenditure_description, file_number, filer_first_name, filer_last_name, filer_middle_name, filer_prefix, filer_suffix, filing_date, filing_form, form_line_number, image_number, independent_sign_date, independent_sign_name, is_notice, line_number, link_id, memo_code, memo_code_full, memo_text, memoed_subtotal, most_recent, notary_commission_expiration_date, notary_sign_date, notary_sign_name, office_total_ytd, original_sub_id, payee_city, payee_first_name, payee_last_name, payee_middle_name, payee_name, payee_prefix, payee_state, payee_street_1, payee_street_2, payee_suffix, payee_zip, pdf_url, previous_file_number, report_type, report_year, schedule_type, schedule_type_full, sub_id, support_oppose_indicator, transaction_id

### `GET /v1/schedules/schedule_e/by_candidate/`
Schedule E receipts aggregated by recipient candidate. To avoid double

- filters: state, district, cycle, office, election_full, candidate_id, committee_id, support_oppose
- fields (8): candidate_id, candidate_name, committee_id, committee_name, count, cycle, support_oppose_indicator, total

### `GET /v1/schedules/schedule_e/efile/`
Efiling endpoints provide real-time campaign finance data received from electronic filers. Efiling endpoints only contain the most recent four months of data and don't contain the processed and coded data that you can find on other endpoints.

- filters: candidate_search, committee_id, candidate_id, payee_name, image_number, support_oppose_indicator, min_expenditure_date, max_expenditure_date, min_dissemination_date, max_dissemination_date, min_expenditure_amount, max_expenditure_amount, spender_name, candidate_party, candidate_office, candidate_office_state, candidate_office_district, most_recent, min_filed_date, max_filed_date, filing_form, is_notice
- fields (57): amendment_indicator, back_reference_schedule_name, back_reference_transaction_id, beginning_image_number, candidate_first_name, candidate_id, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_state, candidate_party, candidate_prefix, candidate_suffix, category_code, committee, committee_id, csv_url, dissemination_date, entity_type, expenditure_amount, expenditure_date, expenditure_description, fec_url, file_number, filer_first_name, filer_last_name, filer_middle_name, filer_prefix, filer_suffix, filing, filing_form, image_number, is_notice, line_number, load_timestamp, memo_code, memo_text, most_recent, notary_sign_date, office_total_ytd, payee_city, payee_first_name, payee_last_name, payee_middle_name, payee_name, payee_prefix, payee_state, payee_street_1, payee_street_2, payee_suffix, payee_zip, pdf_url, related_line_number, report_type, support_oppose_indicator, transaction_id

### `GET /v1/schedules/schedule_e/totals/by_candidate/`
Total independent expenditure on supported or opposed candidates by cycle or candidate election year.

- filters: cycle, candidate_id, election_full
- fields (4): candidate_id, cycle, support_oppose_indicator, total


## legal

### `GET /v1/legal/docs/{doc_type}/{no}`
Search legal documents by type and number

- filters: —
- fields (0): —

### `GET /v1/legal/search/`
Search legal documents by document type, or across all document types using keywords, parameter values and ranges.

- filters: q, from_hit, hits_returned, type, ao_no, ao_year, ao_name, ao_min_issue_date, ao_max_issue_date, ao_min_request_date, ao_max_request_date, ao_min_document_date, ao_max_document_date, ao_doc_category_id, ao_is_pending, ao_status, ao_requestor, ao_requestor_type, ao_regulatory_citation, ao_statutory_citation, ao_citation_require_all, ao_commenter, ao_representative, case_no, case_respondents, case_election_cycles, case_min_open_date, primary_subject_id, secondary_subject_id, case_max_open_date, case_min_close_date, case_max_close_date, case_min_document_date, case_max_document_date, case_regulatory_citation, case_statutory_citation, case_citation_require_all, q_exclude, case_doc_category_id, mur_type, mur_disposition_category_id, af_name, af_committee_id, af_report_year, af_min_rtb_date, af_max_rtb_date, af_rtb_fine_amount, af_min_fd_date, af_max_fd_date, af_fd_fine_amount, case_min_penalty_amount, case_max_penalty_amount, q_proximity, max_gaps, proximity_preserve_order, proximity_filter, proximity_filter_term, filename
- fields (0): —

### `GET /v1/rulemaking/search/`
The Searchable Electronic Rulemaking System (SERS) lets you search all public documents associated

- filters: q, q_exclude, from_hit, hits_returned, rm_no, rm_name, rm_year, doc_category_id, doc_id, min_federal_registry_publish_date, max_federal_registry_publish_date, min_hearing_date, max_hearing_date, min_vote_date, max_vote_date, is_key_document, is_open_for_comment, entity_name, entity_role_type, filename, q_proximity, max_gaps, proximity_preserve_order, proximity_filter, proximity_filter_term
- fields (0): —


## loans

### `GET /v1/schedules/schedule_c/`
Schedule C shows all loans, endorsements and loan guarantees a committee

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, committee_id, candidate_name, loan_source_name, min_payment_to_date, max_payment_to_date, min_incurred_date, max_incurred_date, form_line_number, last_index
- fields (61): action_code, action_code_full, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, committee, committee_id, cycle, due_date_terms, election_type, election_type_full, entity_type, entity_type_full, fec_committee_id, fec_election_type_full, fec_election_type_year, file_number, filing_form, form_line_number, image_number, incurred_date, interest_rate_terms, line_number, link_id, load_date, loan_balance, loan_source_city, loan_source_first_name, loan_source_last_name, loan_source_middle_name, loan_source_name, loan_source_prefix, loan_source_state, loan_source_street_1, loan_source_street_2, loan_source_suffix, loan_source_zip, memo_code, memo_text, original_loan_amount, original_sub_id, payment_to_date, pdf_url, personally_funded, report_type, report_year, schedule_a_line_number, schedule_type, schedule_type_full, secured_ind, sub_id, transaction_id

### `GET /v1/schedules/schedule_c/{sub_id}/`
Schedule C shows all loans, endorsements and loan guarantees a committee

- filters: —
- fields (61): action_code, action_code_full, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, committee, committee_id, cycle, due_date_terms, election_type, election_type_full, entity_type, entity_type_full, fec_committee_id, fec_election_type_full, fec_election_type_year, file_number, filing_form, form_line_number, image_number, incurred_date, interest_rate_terms, line_number, link_id, load_date, loan_balance, loan_source_city, loan_source_first_name, loan_source_last_name, loan_source_middle_name, loan_source_name, loan_source_prefix, loan_source_state, loan_source_street_1, loan_source_street_2, loan_source_suffix, loan_source_zip, memo_code, memo_text, original_loan_amount, original_sub_id, payment_to_date, pdf_url, personally_funded, report_type, report_year, schedule_a_line_number, schedule_type, schedule_type_full, secured_ind, sub_id, transaction_id


## national party accounts

### `GET /v1/national_party/schedule_a/`
This endpoint includes national party committee account receipts for presidential nominating conventions,

- filters: committee_id, contributor_id, two_year_transaction_period, contributor_name, contributor_city, contributor_state, contributor_zip, contributor_occupation, contributor_employer, image_number, min_contribution_receipt_date, max_contribution_receipt_date, is_individual, contributor_type, contributor_committee_type, contributor_committee_designation, min_contribution_receipt_amount, max_contribution_receipt_amount, party_account_type, receipt_type
- fields (91): amendment_indicator, amendment_indicator_desc, back_reference_schedule_name, back_reference_transaction_id, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, committee_designation, committee_id, committee_name, contribution_receipt_amount, contribution_receipt_date, contributor_aggregate_ytd, contributor_city, contributor_committee_designation, contributor_committee_designation_full, contributor_committee_name, contributor_committee_organization, contributor_committee_organization_full, contributor_committee_party, contributor_committee_party_full, contributor_committee_state, contributor_committee_state_full, contributor_committee_type, contributor_committee_type_full, contributor_employer, contributor_first_name, contributor_id, contributor_last_name, contributor_middle_name, contributor_name, contributor_occupation, contributor_prefix, contributor_state, contributor_street_1, contributor_street_2, contributor_suffix, contributor_zip, donor_committee_name, election_type, election_type_desc, entity_type, entity_type_desc, fec_election_type_desc, fec_election_year, file_number, filing_form, filing_frequency, image_number, increased_limit, is_active, is_individual, line_num, line_number_label, link_id, memo_cd, memo_cd_desc, memo_text, national_cmte_nonfed_acct, orig_sub_id, original_sub_id, party, party_account_type, party_full, pdf_url, receipt_desc, receipt_type, receipt_type_desc, recipient_committee_designation, recipient_committee_designation_full, recipient_committee_type, recipient_committee_type_full, report_type, report_year, schedule_type, schedule_type_desc, state, state_full, sub_id, tran_id, treasurer_name, two_year_transaction_period

### `GET /v1/national_party/schedule_b/`
This endpoint includes national party committee account disbursements for presidential nominating conventions,

- filters: committee_id, disbursement_type, disbursement_description, disbursement_purpose_category, image_number, line_number, min_disbursement_amount, max_disbursement_amount, min_disbursement_date, max_disbursement_date, recipient_city, recipient_committee_id, recipient_name, recipient_state, recipient_zip, recipient_committee_designation, recipient_committee_type, two_year_transaction_period, party_account_type
- fields (92): amendment_indicator, amendment_indicator_desc, back_reference_schedule_id, back_reference_transaction_id, benef_committee_name, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, category_code, category_code_desc, committee_id, committee_name, disbursement_amount, disbursement_date, disbursement_description, disbursement_purpose_category, disbursement_type, disbursement_type_desc, election_type, election_type_desc, entity_type, entity_type_desc, fec_election_type_desc, fec_election_type_year, file_number, filing_form, filing_frequency, image_number, is_active, line_number, line_number_label, link_id, memo_cd, memo_cd_desc, memo_text, national_cmte_nonfed_acct, orig_sub_id, original_sub_id, party, party_account, party_full, payee_employer, payee_first_name, payee_last_name, payee_middle_name, payee_occupation, payee_prefix, payee_suffix, pdf_url, recipient_city, recipient_committee_designation, recipient_committee_designation_full, recipient_committee_id, recipient_committee_name, recipient_committee_org, recipient_committee_org_full, recipient_committee_party, recipient_committee_party_full, recipient_committee_state, recipient_committee_state_full, recipient_committee_type, recipient_committee_type_full, recipient_name, recipient_state, recipient_street1, recipient_street2, recipient_zip, ref_disp_excess_flg, report_type, report_year, schedule_type, schedule_type_desc, semi_an_bundled_refund, spender_committee_designation, spender_committee_designation_full, spender_committee_type, spender_committee_type_full, state, state_full, sub_id, tran_id, treasurer_name, two_year_transaction_period

### `GET /v1/national_party/totals/`
This endpoint includes national party committee account total receipts and total disbursements for 

- filters: committee_id, two_year_transaction_period
- fields (5): committee_id, committee_name, total_disbursements, total_receipts, two_year_transaction_period


## party-coordinated expenditures

### `GET /v1/schedules/schedule_f/`
Schedule F, it shows all special expenditures a national or state party committee

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, candidate_id, payee_name, committee_id, cycle, form_line_number
- fields (66): action_code, action_code_full, aggregate_general_election_expenditure, back_reference_schedule_name, back_reference_transaction_id, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, catolog_code, catolog_code_full, committee, committee_designated_coordinated_expenditure_indicator, committee_id, committee_name, conduit_committee_city, conduit_committee_id, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, designated_committee_id, designated_committee_name, election_cycle, entity_type, entity_type_desc, expenditure_amount, expenditure_date, expenditure_purpose_full, expenditure_type, expenditure_type_full, file_number, filing_form, form_line_number, image_number, line_number, link_id, load_date, memo_code, memo_code_full, memo_text, original_sub_id, payee_first_name, payee_last_name, payee_middle_name, payee_name, pdf_url, report_type, report_year, schedule_type, schedule_type_full, sub_id, subordinate_committee, subordinate_committee_id, transaction_id, unlimited_spending_flag, unlimited_spending_flag_full

### `GET /v1/schedules/schedule_f/{sub_id}/`
Schedule F, it shows all special expenditures a national or state party committee

- filters: —
- fields (66): action_code, action_code_full, aggregate_general_election_expenditure, back_reference_schedule_name, back_reference_transaction_id, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, catolog_code, catolog_code_full, committee, committee_designated_coordinated_expenditure_indicator, committee_id, committee_name, conduit_committee_city, conduit_committee_id, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, designated_committee_id, designated_committee_name, election_cycle, entity_type, entity_type_desc, expenditure_amount, expenditure_date, expenditure_purpose_full, expenditure_type, expenditure_type_full, file_number, filing_form, form_line_number, image_number, line_number, link_id, load_date, memo_code, memo_code_full, memo_text, original_sub_id, payee_first_name, payee_last_name, payee_middle_name, payee_name, pdf_url, report_type, report_year, schedule_type, schedule_type_full, sub_id, subordinate_committee, subordinate_committee_id, transaction_id, unlimited_spending_flag, unlimited_spending_flag_full


## presidential

### `GET /v1/presidential/contributions/by_candidate/`
Net receipts per candidate.

- filters: election_year, contributor_state
- fields (7): candidate_id, candidate_last_name, candidate_party_affiliation, contributor_state, election_year, net_receipts, rounded_net_receipts

### `GET /v1/presidential/contributions/by_size/`
Contribution receipts by size per candidate.

- filters: election_year, candidate_id, size
- fields (5): candidate_id, contribution_receipt_amount, election_year, size, size_range_id

### `GET /v1/presidential/contributions/by_state/`
Contribution receipts by state per candidate.

- filters: election_year, candidate_id
- fields (4): candidate_id, contribution_receipt_amount, contribution_state, election_year

### `GET /v1/presidential/coverage_end_date/`
Coverage end date per candidate.

- filters: election_year, candidate_id
- fields (3): candidate_id, coverage_end_date, election_year

### `GET /v1/presidential/financial_summary/`
Financial summary per candidate.

- filters: election_year, candidate_id
- fields (30): candidate_contributions_less_repayments, candidate_id, candidate_last_name, candidate_name, candidate_party_affiliation, cash_on_hand_end, committee_designation, committee_id, committee_name, committee_type, debts_owed_by_committee, disbursements_less_offsets, election_year, exempt_legal_accounting_disbursement, federal_funds, fundraising_disbursements, individual_contributions_less_refunds, net_receipts, offsets_to_operating_expenditures, operating_expenditures, other_disbursements, pac_contributions_less_refunds, party_contributions_less_refunds, repayments_loans_made_by_candidate, repayments_other_loans, rounded_net_receipts, total_contribution_refunds, total_loan_repayments_made, transfers_from_affiliated_committees, transfers_to_other_authorized_committees


## receipts

### `GET /v1/schedules/schedule_a/`
This description is for both ​`/schedules​/schedule_a​/` and ​ `/schedules​/schedule_a​/{sub_id}​/`.

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, committee_id, contributor_id, contributor_name, contributor_city, contributor_state, contributor_zip, contributor_employer, contributor_occupation, last_contribution_receipt_date, last_contribution_receipt_amount, line_number, is_individual, contributor_type, two_year_transaction_period, recipient_committee_type, recipient_committee_org_type, recipient_committee_designation, min_load_date, max_load_date, last_index
- fields (81): amendment_indicator, amendment_indicator_desc, back_reference_schedule_name, back_reference_transaction_id, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, committee, committee_id, committee_name, conduit_committee_city, conduit_committee_id, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, contribution_receipt_amount, contribution_receipt_date, contributor, contributor_aggregate_ytd, contributor_city, contributor_employer, contributor_first_name, contributor_id, contributor_last_name, contributor_middle_name, contributor_name, contributor_occupation, contributor_prefix, contributor_state, contributor_street_1, contributor_street_2, contributor_suffix, contributor_zip, donor_committee_name, election_type, election_type_full, entity_type, entity_type_desc, fec_election_type_desc, fec_election_year, file_number, filing_form, image_number, increased_limit, is_individual, line_number, line_number_label, link_id, load_date, memo_code, memo_code_full, memo_text, memoed_subtotal, national_committee_nonfederal_account, original_sub_id, pdf_url, receipt_type, receipt_type_desc, receipt_type_full, recipient_committee_designation, recipient_committee_org_type, recipient_committee_type, report_type, report_year, schedule_type, schedule_type_full, sub_id, transaction_id, two_year_transaction_period, unused_contbr_id

### `GET /v1/schedules/schedule_a/by_employer/`
This endpoint provides itemized individual contributions received by a committee, aggregated by the contributor’s employer name. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: cycle, employer, committee_id
- fields (5): committee_id, count, cycle, employer, total

### `GET /v1/schedules/schedule_a/by_occupation/`
This endpoint provides itemized individual contributions received by a committee, aggregated by the contributor’s occupation. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: cycle, occupation, committee_id
- fields (5): committee_id, count, cycle, occupation, total

### `GET /v1/schedules/schedule_a/by_size/`
This endpoint provides individual contributions received by a committee, aggregated by size:

- filters: cycle, size, committee_id
- fields (5): committee_id, count, cycle, size, total

### `GET /v1/schedules/schedule_a/by_size/by_candidate/`
This endpoint provides itemized individual contributions received by a committee, aggregated by size of contribution and candidate. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: candidate_id, cycle, election_full
- fields (5): candidate_id, count, cycle, size, total

### `GET /v1/schedules/schedule_a/by_state/`
This endpoint provides itemized individual contributions received by a committee, aggregated by the contributor’s state. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: cycle, state, committee_id, hide_null
- fields (6): committee_id, count, cycle, state, state_full, total

### `GET /v1/schedules/schedule_a/by_state/by_candidate/`
This endpoint provides itemized individual contributions received by a committee, aggregated by contributor’s state and candidate. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: candidate_id, cycle, election_full
- fields (6): candidate_id, count, cycle, state, state_full, total

### `GET /v1/schedules/schedule_a/by_state/by_candidate/totals/`
Itemized individual contributions aggregated by contributor’s state, candidate, committee type and cycle. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: candidate_id, cycle, election_full
- fields (6): candidate_id, count, cycle, state, state_full, total

### `GET /v1/schedules/schedule_a/by_state/totals/`
This endpoint provides itemized individual contributions received by a committee, aggregated by contributor’s state, committee type and cycle. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: cycle, state, committee_type
- fields (7): committee_type, committee_type_full, count, cycle, state, state_full, total

### `GET /v1/schedules/schedule_a/by_zip/`
This endpoint provides itemized individual contributions received by a committee, aggregated by the contributor’s ZIP code. If you are interested in our “is_individual” methodology, review the [methodology page](https://www.fec.gov/campaign-finance-data/about-campaign-finance-data/methodology). Unitemized individual contributions are not included.

- filters: cycle, zip, state, committee_id
- fields (7): committee_id, count, cycle, state, state_full, total, zip

### `GET /v1/schedules/schedule_a/efile/`
Efiling endpoints provide real-time campaign finance data received from electronic filers. Efiling endpoints only contain the most recent four months of data and don't contain the processed and coded data that you can find on other endpoints.

- filters: committee_id, contributor_name, contributor_city, contributor_state, contributor_employer, contributor_occupation, image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date
- fields (44): amendment_indicator, back_reference_schedule_name, back_reference_transaction_id, beginning_image_number, committee, committee_id, conduit_committee_city, conduit_committee_id, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, contribution_receipt_amount, contribution_receipt_date, contributor_aggregate_ytd, contributor_city, contributor_employer, contributor_first_name, contributor_last_name, contributor_middle_name, contributor_name, contributor_occupation, contributor_prefix, contributor_state, contributor_suffix, contributor_zip, csv_url, cycle, entity_type, fec_election_type_desc, fec_url, file_number, filing, image_number, line_number, load_timestamp, memo_code, memo_text, pdf_url, pgo, related_line_number, report_type, transaction_id

### `GET /v1/schedules/schedule_a/{sub_id}/`
This description is for both ​`/schedules​/schedule_a​/` and ​ `/schedules​/schedule_a​/{sub_id}​/`.

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, committee_id, contributor_id, contributor_name, contributor_city, contributor_state, contributor_zip, contributor_employer, contributor_occupation, last_contribution_receipt_date, last_contribution_receipt_amount, line_number, is_individual, contributor_type, two_year_transaction_period, recipient_committee_type, recipient_committee_org_type, recipient_committee_designation, min_load_date, max_load_date, last_index
- fields (81): amendment_indicator, amendment_indicator_desc, back_reference_schedule_name, back_reference_transaction_id, candidate_first_name, candidate_id, candidate_last_name, candidate_middle_name, candidate_name, candidate_office, candidate_office_district, candidate_office_full, candidate_office_state, candidate_office_state_full, candidate_prefix, candidate_suffix, committee, committee_id, committee_name, conduit_committee_city, conduit_committee_id, conduit_committee_name, conduit_committee_state, conduit_committee_street1, conduit_committee_street2, conduit_committee_zip, contribution_receipt_amount, contribution_receipt_date, contributor, contributor_aggregate_ytd, contributor_city, contributor_employer, contributor_first_name, contributor_id, contributor_last_name, contributor_middle_name, contributor_name, contributor_occupation, contributor_prefix, contributor_state, contributor_street_1, contributor_street_2, contributor_suffix, contributor_zip, donor_committee_name, election_type, election_type_full, entity_type, entity_type_desc, fec_election_type_desc, fec_election_year, file_number, filing_form, image_number, increased_limit, is_individual, line_number, line_number_label, link_id, load_date, memo_code, memo_code_full, memo_text, memoed_subtotal, national_committee_nonfederal_account, original_sub_id, pdf_url, receipt_type, receipt_type_desc, receipt_type_full, recipient_committee_designation, recipient_committee_org_type, recipient_committee_type, report_type, report_year, schedule_type, schedule_type_full, sub_id, transaction_id, two_year_transaction_period, unused_contbr_id

### `GET /v1/schedules/schedule_a_form5/`
FEC FORM 5 Receipts

- filters: image_number, min_image_number, max_image_number, min_amount, max_amount, min_date, max_date, contributor_name, contributor_city, contributor_state, contributor_zip, contributor_employer, contributor_occupation, last_contribution_receipt_date, last_contribution_amount, report_year, report_type, contributor_type, two_year_transaction_period, last_index
- fields (27): amendment_indicator, contribution_amount, contribution_receipt_date, contributor_city, contributor_employer, contributor_name, contributor_occupation, contributor_state, contributor_street_1, contributor_street_2, contributor_type, contributor_type_full, contributor_zip, file_number, filer_name, filing_form, image_number, link_id, load_date, original_sub_id, report_type, report_year, schedule_type, schedule_type_full, sub_id, transaction_id, two_year_transaction_period


## search

### `GET /v1/names/candidates/`
Search for candidates or committees by name. If you're looking for information on a

- filters: q
- fields (3): id, name, office_sought

### `GET /v1/names/committees/`
Search for candidates or committees by name. If you're looking for information on a

- filters: q
- fields (3): id, is_active, name

