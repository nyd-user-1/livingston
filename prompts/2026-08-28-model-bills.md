# Lane MB — model bills: the labeled cross-state pairs

**Written:** 2026-08-28 16:30 ET, by the lead (Fable). **Runs in:** the worker-box window, on box 1, after BT's resume steps are launched (these are small; slot them between BT's steps rather than after).
**Why (Brendan):** "Curated by humans, like NSR's BNL citations — go get them now." These three sources are the benchmark and the training signal for "find this bill in other states." Two of the three are at risk of disappearing (the Center for Public Integrity closed in 2025; its site is preserved by POGO as an archive), so **fetch first, structure second.**

## Sources

1. **ALEC model-policy library** — `https://alec.org/model-policy/`: ~1,140 policies (57 pages × 20), each at `alec.org/model-policy/<slug>/`, with year (1995–2026), issue (40+ categories), type (Model Policy / Model Resolution / Policy Statement / Statement of Principle), status, tags. Fetch the index pages, then every policy page; store title, slug, year, issue, type, status, tags, and the **full text** of the model policy. Politeness: 1 req/s, one connection, our UA. ~20 minutes.
2. **"Copy, Paste, Legislate"** (Center for Public Integrity / USA Today / Arizona Republic, 2019) — the tool at `https://model-legislation.apps.publicintegrity.org/` lists each model bill and **the state bills matched to it** (their algorithm over ~1M bills; ~10,000 copied bills). It is an archived site now: crawl it whole (every model-bill page and every match list), keep the raw HTML in `~/cache/model-bills/cpi/` **and** the parsed rows. Also clone `https://github.com/PublicI/religious-freedom-bills-data` (a spreadsheet of 500+ copycat bills across 49 states) and any sibling `PublicI/*` data repos you find that carry bill matches. If the archive throttles or 403s, back off and retry later — do not hammer an archive.
3. **NCSL 50-state bill-tracking databases** — `https://www.ncsl.org/technology-and-communication/ncsl-50-state-searchable-bill-tracking-databases` lists ~50 topic databases (traffic safety, elections, energy, health, …), each a searchable table of bills by state/year/status, updated weekly, built on State Net. **Read their terms first and quote them in the report**; if the pages are plainly meant for public reading, fetch each topic database's full listing (all states, all years available) at 1 req/s and store topic, subtopic, state, session, bill number, title, status, and NCSL's summary. If the terms forbid it, stop and say so — NCSL is a membership body and "curated by humans" cuts both ways.

## Storage

- `"ModelBills"` (`model_id text PK` = `alec:<slug>` | `cpi:<id>`, source, title, year, issue, type, status, tags text[], text, url, fetched_at).
- `"ModelBillMatches"` (`model_id`, `state`, `session_id`, `bill_number`, `bill_id` bigint null — resolved against `"Bills"` by (state, session, bill_number), `match_score` numeric null, `source` (`cpi` | `ncsl:<topic>`), raw jsonb). Index on `bill_id` and on `model_id`.
- NCSL topic rows go in `"ModelBillMatches"` with `model_id = 'ncsl:<topic>/<subtopic>'` — a topic cluster is a weaker label than a model-bill match, and the `source` column keeps them apart.

## Proof

Counts per source; how many matches resolved to a `bill_id` (with the denominator); the ten largest clusters (model bill → number of states); three spot checks where a CPI match's state bill text is in `"BillTexts"` and visibly resembles the model text. Note what could not be resolved and why (older sessions we don't hold, bill-number formats).

## Hard rules

Politeness as above; archives get extra patience · quote the terms of any site before crawling it · no `src/` changes · two new tables only · **no push** · report under **Report** with heartbeats.

---

## Report

*(lane writes here)*
