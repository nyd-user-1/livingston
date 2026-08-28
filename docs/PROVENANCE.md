# PROVENANCE — where every row in our database actually comes from

**Built:** 2026-08-28, lane IN (`prompts/2026-08-28-independence.md`), step 1.
**Question it answers:** *"Assume LegiScan just decided not to exist. Where are they getting all this data from?"*

## The short answer

**From the legislatures themselves.** LegiScan is an aggregator, and it does not hide its sources: every
one of our 3,443,370 `"Documents"` rows carries a `state_link` pointing at the page or file it came from.
Rolled up, **every single one of the 52 jurisdictions resolves to that jurisdiction's own official
legislature site** — `assembly.state.ny.us`, `leginfo.legislature.ca.gov`, `capitol.texas.gov`,
`www.congress.gov`, and so on. There is no hidden third party, no private feed, no mystery.

There is exactly **one exception**, and it is worth knowing: **Missouri**. 3,007 Missouri documents
(4.6% of the state's total) point at `reflect.legiscan.com` and `proxy2.legiscan.com` — LegiScan's own
mirror. Those documents have no state-side URL at all. If LegiScan goes away, those 3,007 links die with it;
everything else in the table below survives, because it points at a government server.

## How this table was built, and what each column can be trusted to mean

Three independent sources, deliberately, because a single one proves only that it agrees with itself:

1. **`state_link` hosts** — what *LegiScan* fetched, from our own database.
2. **Open States scraper hosts** — what *a second, unrelated aggregator* fetches, read out of
   `openstates-scrapers` (mirrored 2026-08-28 at `2ef7e5d`). Where columns 1 and 2 name the same host,
   two organisations that have never coordinated arrived at the same origin.
3. **A live fetch** of the jurisdiction's own structured feed or bulk download, performed by
   `scripts/independence/verify-feeds.ts` through `api/_lib/polite-fetch.ts` — robots.txt obeyed,
   1.5 s between requests to a host, one artifact each. **A row that could not be verified says so,
   and says why.** Nothing in the "structured feed" column is asserted from memory.

> ⚠ **The `state_link` host must be read off the document's *own* LegiScan URL, not off the bill it is
> attached to.** `"Documents".bill_id` is wrong for **631,689 rows (18.4%)** — see *The 18% problem* below.
> Every host figure in this file is derived from each document's own
> `legiscan.com/{STATE}/{type}/…` URL, which is the field that survived.

## The map

`docs` = documents we hold for that jurisdiction. `top host` = the origin, with its share.
`mime` = HTML/PDF split. `bills` and `sessions` come from `"Bills"`.

| | jurisdiction | docs | top host (share) | other hosts | mime | bills | sessions | span |
|---|---|---:|---|---|---|---:|---:|---|
| AK | **Alaska** | 9,800 | `www.akleg.gov` (57.2%) | `www.legis.state.ak.us` | 0% HTML / 100% PDF | 7,083 | 9 | 2009–2025 |
| AL | **Alabama** | 30,399 | `alisondb.legislature.state.al.us` (68.8%) | `alison.legislature.state.al.us`, `www.legislature.state.al.us` | 1% HTML / 99% PDF | 28,660 | 17 | 2010–2026 |
| AR | **Arkansas** | 31,273 | `www.arkleg.state.ar.us` (88.4%) | `arkleg.state.ar.us` | 0% HTML / 100% PDF | 19,677 | 17 | 2010–2026 |
| AZ | **Arizona** | 41,822 | `www.azleg.gov` (90.5%) | `apps.azleg.gov` | 92% HTML / 8% PDF | 26,409 | 17 | 2010–2026 |
| CA | **California** | 133,033 | `leginfo.legislature.ca.gov` (70.7%) | `www.leginfo.ca.gov` | 99% HTML / 1% PDF | 46,734 | 9 | 2009–2025 |
| CO | **Colorado** | 52,982 | `leg.colorado.gov` (66.6%) | `www.leg.state.co.us`, `s3-us-west-2.amazonaws.com` | 2% HTML / 98% PDF | 12,453 | 17 | 2010–2026 |
| CT | **Connecticut** | 52,472 | `www.cga.ct.gov` (100.0%) | `www.cga.ct.gov2010sb-00360-r01-sb.htm` | 39% HTML / 61% PDF | 38,663 | 17 | 2010–2026 |
| DC | **District of Columbia** | 30,065 | `lims.dccouncil.us` (59.2%) | `lims.dccouncil.gov`, `dcclims1.dccouncil.us` | 0% HTML / 100% PDF | 16,973 | 7 | 2013–2025 |
| DE | **Delaware** | 9,391 | `legis.delaware.gov` (100.0%) | — | 95% HTML / 4% PDF | 9,270 | 9 | 2009–2025 |
| FL | **Florida** | 61,708 | `www.flsenate.gov` (100.0%) | — | 40% HTML / 60% PDF | 42,090 | 17 | 2010–2026 |
| GA | **Georgia** | 64,429 | `www.legis.ga.gov` (78.4%) | `www1.legis.ga.gov` | 3% HTML / 97% PDF | 45,544 | 12 | 2009–2026 |
| HI | **Hawaii** | 137,332 | `www.capitol.hawaii.gov` (100.0%) | — | 91% HTML / 9% PDF | 84,665 | 17 | 2010–2026 |
| IA | **Iowa** | 29,033 | `www.legis.iowa.gov` (70.0%) | `coolice.legis.iowa.gov`, `coolice.legis.state.ia.us` | 96% HTML / 4% PDF | 28,820 | 9 | 2009–2025 |
| ID | **Idaho** | 11,327 | `legislature.idaho.gov` (75.9%) | `www.legislature.idaho.gov` | 5% HTML / 95% PDF | 11,151 | 17 | 2010–2026 |
| IL | **Illinois** | 119,904 | `www.ilga.gov` (100.0%) | — | 92% HTML / 8% PDF | 117,721 | 9 | 2009–2025 |
| IN | **Indiana** | 49,000 | `iga.in.gov` (95.1%) | `www.in.gov` | 9% HTML / 91% PDF | 21,710 | 17 | 2010–2026 |
| KS | **Kansas** | 20,078 | `kslegislature.org` (55.2%) | `www.kslegislature.org`, `kslegislature.gov` | 7% HTML / 93% PDF | 13,313 | 12 | 2009–2025 |
| KY | **Kentucky** | 31,638 | `apps.legislature.ky.gov` (59.5%) | `www.lrc.ky.gov` | 7% HTML / 77% PDF | 22,547 | 17 | 2010–2026 |
| LA | **Louisiana** | 127,308 | `www.legis.la.gov` (94.8%) | `www.legis.state.la.us` | 26% HTML / 74% PDF | 37,096 | 17 | 2010–2026 |
| MA | **Massachusetts** | 58,529 | `malegislature.gov` (83.6%) | `www.malegislature.gov`, `www.mass.gov` | 1% HTML / 99% PDF | 69,304 | 9 | 2009–2025 |
| MD | **Maryland** | 109,471 | `mgaleg.maryland.gov` (96.9%) | `mlis.state.md.us` | 28% HTML / 72% PDF | 44,616 | 17 | 2010–2026 |
| ME | **Maine** | 29,665 | `legislature.maine.gov` (84.7%) | `www.mainelegislature.org` | 6% HTML / 93% PDF | 19,068 | 9 | 2009–2025 |
| MI | **Michigan** | 67,936 | `www.legislature.mi.gov` (72.5%) | `legislature.mi.gov` | 85% HTML / 15% PDF | 39,068 | 9 | 2009–2025 |
| MN | **Minnesota** | 82,033 | `www.revisor.mn.gov` (97.6%) | `wdoc.house.leg.state.mn.us` | 11% HTML / 89% PDF | 78,589 | 11 | 2009–2025 |
| MO | **Missouri** | 65,213 | `www.house.mo.gov` (44.0%) | `www.senate.mo.gov`, `documents.house.mo.gov`, `reflect.legiscan.com` | 17% HTML / 82% PDF | 37,729 | 17 | 2010–2026 |
| MS | **Mississippi** | 78,292 | `billstatus.ls.state.ms.us` (100.0%) | — | 90% HTML / 10% PDF | 56,746 | 17 | 2010–2026 |
| MT | **Montana** | 22,180 | `leg.mt.gov` (79.7%) | `docs.legmt.gov` | 3% HTML / 97% PDF | 12,178 | 9 | 2009–2025 |
| NC | **North Carolina** | 49,793 | `www.ncleg.gov` (46.4%) | `www.ncga.state.nc.us`, `dashboard.ncleg.gov`, `webservices.ncleg.gov` | 42% HTML / 58% PDF | 20,634 | 12 | 2009–2025 |
| ND | **North Dakota** | 20,680 | `www.legis.nd.gov` (66.6%) | `ndlegis.gov`, `www.ndlegis.gov` | 1% HTML / 99% PDF | 8,771 | 10 | 2009–2026 |
| NE | **Nebraska** | 29,320 | `nebraskalegislature.gov` (100.0%) | — | 10% HTML / 89% PDF | 15,519 | 10 | 2009–2025 |
| NH | **New Hampshire** | 25,149 | `gencourt.state.nh.us` (57.2%) | `www.gencourt.state.nh.us`, `gc.nh.gov` | 95% HTML / 5% PDF | 17,564 | 17 | 2010–2026 |
| NJ | **New Jersey** | 118,101 | `pub.njleg.gov` (72.7%) | `www.njleg.state.nj.us` | 95% HTML / 5% PDF | 92,319 | 9 | 2010–2026 |
| NM | **New Mexico** | 29,444 | `www.nmlegis.gov` (100.0%) | — | 2% HTML / 98% PDF | 19,936 | 17 | 2010–2026 |
| NV | **Nevada** | 21,099 | `www.leg.state.nv.us` (100.0%) | — | 1% HTML / 99% PDF | 10,105 | 13 | 2009–2025 |
| NY | **New York** | 178,455 | `assembly.state.ny.us` (100.0%) | — | 100% HTML / 0% PDF | 188,674 | 9 | 2009–2025 |
| OH | **Ohio** | 40,310 | `search-prod.lis.state.oh.us` (69.1%) | `www.legislature.ohio.gov`, `archives.legislature.state.oh.us` | 17% HTML / 83% PDF | 21,088 | 11 | 2007–2025 |
| OK | **Oklahoma** | 173,031 | `webserver1.lsb.state.ok.us` (78.6%) | `www.oklegislature.gov`, `www3.oklegislature.gov` | 8% HTML / 86% PDF | 67,680 | 17 | 2010–2026 |
| OR | **Oregon** | 90,188 | `olis.oregonlegislature.gov` (90.6%) | `www.leg.state.or.us` | 30% HTML / 68% PDF | 25,576 | 18 | 2009–2026 |
| PA | **Pennsylvania** | 55,903 | `www.legis.state.pa.us` (88.8%) | `www.palegis.us` | 6% HTML / 94% PDF | 53,961 | 10 | 2007–2025 |
| RI | **Rhode Island** | 43,941 | `webserver.rilegislature.gov` (91.4%) | `www.rilin.state.ri.us` | 1% HTML / 99% PDF | 40,860 | 17 | 2010–2026 |
| SC | **South Carolina** | 49,075 | `www.scstatehouse.gov` (100.0%) | — | 90% HTML / 10% PDF | 33,913 | 9 | 2009–2025 |
| SD | **South Dakota** | 19,140 | `mylrc.sdlegislature.gov` (47.5%) | `legis.state.sd.us`, `legis.sd.gov`, `sdlegislature.gov` | 2% HTML / 98% PDF | 9,823 | 17 | 2010–2026 |
| TN | **Tennessee** | 134,454 | `www.capitol.tn.gov` (91.7%) | `publications.tnsosfiles.com` | 12% HTML / 87% PDF | 84,005 | 9 | 2009–2025 |
| TX | **Texas** | 202,922 | `capitol.texas.gov` (61.2%) | `www.legis.state.tx.us` | 86% HTML / 14% PDF | 104,032 | 9 | 2009–2025 |
| US | **U.S. Congress** | 127,326 | `www.congress.gov` (100.0%) | — | 0% HTML / 100% PDF | 131,658 | 9 | 2009–2025 |
| UT | **Utah** | 61,305 | `le.utah.gov` (92.0%) | `pf.utleg.gov` | 20% HTML / 78% PDF | 15,419 | 17 | 2010–2026 |
| VA | **Virginia** | 150,059 | `lis.virginia.gov` (93.0%) | `lis.blob.core.windows.net`, `committees.lis.virginia.gov`, `budget.lis.virginia.gov` | 79% HTML / 21% PDF | 60,812 | 18 | 2008–2026 |
| VT | **Vermont** | 26,020 | `legislature.vermont.gov` (68.5%) | `www.leg.state.vt.us`, `ljfo.vermont.gov` | 4% HTML / 96% PDF | 14,472 | 10 | 2009–2025 |
| WA | **Washington** | 110,199 | `lawfilesext.leg.wa.gov` (72.4%) | `apps.leg.wa.gov`, `fnspublic.ofm.wa.gov`, `` | 20% HTML / 78% PDF | 32,029 | 9 | 2009–2025 |
| WI | **Wisconsin** | 46,259 | `docs.legis.wisconsin.gov` (100.0%) | — | 18% HTML / 81% PDF | 19,969 | 13 | 2009–2026 |
| WV | **West Virginia** | 63,959 | `www.wvlegislature.gov` (63.5%) | `www.legis.state.wv.us` | 83% HTML / 17% PDF | 45,538 | 19 | 2008–2026 |
| WY | **Wyoming** | 20,925 | `www.wyoleg.gov` (47.0%) | `legisweb.state.wy.us`, `wyoleg.gov` | 18% HTML / 81% PDF | 6,572 | 17 | 2010–2026 |

## The jurisdiction's own structured feed or bulk download

One fetch per jurisdiction, made 2026-08-28. `verified` means the server returned 2xx **and** the body
actually sniffed as JSON / XML / ZIP / CSV — a 200 carrying an HTML error page does not count.

| | jurisdiction | candidate feed | format | verified | evidence |
|---|---|---|---|---|---|
| AK | **Alaska** | `https://www.akleg.gov/publicservice/basis/bills?session=34` | XML | **YES** | xml-ish, 218,598 B |
| AL | **Alabama** | `https://alison.legislature.state.al.us/aldn/graphql` | GraphQL | **NOT VERIFIED** | candidate returned HTML, not a feed |
| AR | **Arkansas** | `https://www.arkleg.state.ar.us/Bills/SearchByRange?ddBienniumSession=2025%2F20` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| AZ | **Arizona** | `https://apps.azleg.gov/api/Bill/?billNumber=HB2001&sessionId=127` | JSON | **BLOCKED** | robots.txt disallows this path |
| CA | **California** | `https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip` | ZIP (MySQL dump) | **YES (headers)** | application/zip, 1,218,704,297 B — body over fetch cap, not downloaded |
| CO | **Colorado** | `https://leg.colorado.gov/bill-search` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| CT | **Connecticut** | `https://www.cga.ct.gov/asp/menu/BulkData.asp` | HTML index | **NOT VERIFIED** | fetch failed |
| DC | **District of Columbia** | `https://lims.dccouncil.gov/api/v2/PublicData/Search?filter=%7B%7D` | JSON | **BLOCKED** | robots.txt disallows this path |
| DE | **Delaware** | `https://legis.delaware.gov/json/BillDetail/GetRecentReportsByLegislationId` | JSON (POST) | **NOT VERIFIED** | candidate returned HTML, not a feed |
| FL | **Florida** | `https://www.flsenate.gov/Session/Bills/2026?format=xml` | XML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| GA | **Georgia** | `http://webservices.legis.ga.gov/GGAServices/Legislation/Service.svc?wsdl` | WSDL | **YES** | xml, 65,240 B |
| HI | **Hawaii** | `https://data.capitol.hawaii.gov/session/archives/main.aspx` | HTML index of ZIP | **NOT VERIFIED** | candidate returned HTML, not a feed |
| IA | **Iowa** | `https://www.legis.iowa.gov/legislation/billTracking/billPacket` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| ID | **Idaho** | `https://legislature.idaho.gov/sessioninfo/2025/legislation/` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| IL | **Illinois** | `https://ilga.gov/API/Legislation/GetGeneralAssemblies` | JSON | **YES** | json-ish, 4,367 B |
| IN | **Indiana** | `https://api.iga.in.gov/2025/bills` | JSON (key) | **BLOCKED** | HTTP 429 after three tries |
| KS | **Kansas** | `http://www.kslegislature.org/li/api/v11/rev-1/bill_status/` | JSON | **NOT VERIFIED** | The operation was aborted due to timeout |
| KY | **Kentucky** | `https://apps.legislature.ky.gov/record/25rs/bills.html` | HTML | **NOT VERIFIED** | HTTP 404 |
| LA | **Louisiana** | `https://www.legis.la.gov/legis/BillSearch.aspx?sid=25rs` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| MA | **Massachusetts** | `https://malegislature.gov/api/GeneralCourts/194/Documents` | JSON | **YES** | json-ish, 12,323,498 B |
| MD | **Maryland** | `https://mgaleg.maryland.gov/mgawebsite/Search/BillDataFiles` | HTML index | **NOT VERIFIED** | candidate returned HTML, not a feed |
| ME | **Maine** | `https://legislature.maine.gov/LawMakerWeb/search.asp` | HTML | **BLOCKED** | robots.txt disallows this path |
| MI | **Michigan** | `https://www.legislature.mi.gov/Bills` | HTML | **NOT VERIFIED** | fetch failed |
| MN | **Minnesota** | `https://www.senate.mn/api/schedule/upcoming` | JSON | **YES** | json-ish, 19,710 B |
| MO | **Missouri** | `https://www.house.mo.gov/BillList.aspx?year=2026&code=R` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| MS | **Mississippi** | `http://billstatus.ls.state.ms.us/2025/pdf/all_measures/allmsrs.xml` | XML | **NOT VERIFIED** | fetch failed |
| MT | **Montana** | `https://api.legmt.gov/archive/v1/sessions` | JSON | **YES** | json-ish, 2,232 B |
| NC | **North Carolina** | `https://webservices.ncleg.gov/sessionselectlist/false` | JSON | **YES** | xml-ish, 3,501 B |
| ND | **North Dakota** | `https://ndlegis.gov/assembly/69-2025/regular/bill-index.html` | HTML | **NOT VERIFIED** | HTTP 300 |
| NE | **Nebraska** | `https://nebraskalegislature.gov/bills/search_by_date.php` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| NH | **New Hampshire** | `http://gencourt.state.nh.us/dynamicdatafiles/` | HTML index of TXT/ZIP | **NOT VERIFIED** | HTTP 404 |
| NJ | **New Jersey** | `https://pub.njleg.gov/Bills/2026/A0001.HTM` | HTML | **NOT VERIFIED** | HTTP 404 |
| NM | **New Mexico** | `https://www.nmlegis.gov/Sessions/25%20Regular/other/LegInfo25.zip` | ZIP (MS Access) | **YES** | zip, 5,241,026 B |
| NV | **Nevada** | `https://www.leg.state.nv.us/App/NELIS/REL/83rd2025/Bills/List` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| NY | **New York** | `https://legislation.nysenate.gov/api/3/bills/2025?limit=1&key=KEY_NYS` | JSON | **YES** | json-ish, 8,825 B |
| OH | **Ohio** | `https://search-prod.lis.state.oh.us/api/v2/general_assembly_136/legislation?pa` | JSON | **YES** | json-ish, 4,005,814 B |
| OK | **Oklahoma** | `https://webapps.oklegislature.gov/WebApplication3/WebForm1.aspx` | HTML | **BLOCKED** | robots.txt disallows this path |
| OR | **Oregon** | `https://api.oregonlegislature.gov/odata/odataservice.svc/` | OData XML | **YES** | xml, 2,115 B |
| PA | **Pennsylvania** | `https://www.palegis.us/legislation/bills` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| RI | **Rhode Island** | `https://status.rilegislature.gov/` | HTML | **BLOCKED** | robots.txt disallows this path |
| SC | **South Carolina** | `https://www.scstatehouse.gov/sessphp/sess126_2025-2026.php` | HTML | **NOT VERIFIED** | HTTP 404 |
| SD | **South Dakota** | `https://sdlegislature.gov/api/Sessions` | JSON | **YES** | json-ish, 14,197 B |
| TN | **Tennessee** | `https://wapp.capitol.tn.gov/apps/indexes/BillsByIndex/?year=114` | HTML | **BLOCKED** | robots.txt disallows this path |
| TX | **Texas** | `https://capitol.texas.gov/MnuBillSearch.aspx` | HTML | **NOT VERIFIED** | HTTP 404 |
| US | **U.S. Congress** | `https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr1.xml` | XML | **YES** | xml, 1,979,603 B |
| UT | **Utah** | `https://le.utah.gov/data/legislators.json` | JSON | **YES** | json-ish, 262,408 B |
| VA | **Virginia** | `https://lis.virginia.gov/SiteInformation/csv.html` | CSV index | **BLOCKED** | HTTP 429 after three tries |
| VT | **Vermont** | `https://legislature.vermont.gov/bill/loadBillsReleased/2026/` | JSON | **NOT VERIFIED** | fetch failed |
| WA | **Washington** | `https://wslwebservices.leg.wa.gov/LegislationService.asmx?WSDL` | WSDL/SOAP | **YES** | xml, 196,890 B |
| WI | **Wisconsin** | `https://docs.legis.wisconsin.gov/2025/proposals/reg/asm/bill/ab1` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| WV | **West Virginia** | `https://www.wvlegislature.gov/Bill_Status/bill_status.cfm` | HTML | **NOT VERIFIED** | candidate returned HTML, not a feed |
| WY | **Wyoming** | `https://lsoservice.wyoleg.gov/api/BillInformation?year=2025&billNum=HB0001` | JSON | **YES** | json-ish, 13,964,019 B |

**17 of 52 jurisdictions have a structured feed or bulk download that we verified by fetching it.**
The remainder split into two very different groups, and the difference matters:

- **Blocked, politely** — the site's `robots.txt` disallows the path, or it returned 429 three times.
  These are *not* "no feed exists"; they are "we did not take it." Notably, several of these paths are
  ones **Open States' own scrapers fetch anyway** (AZ `/api/Bill/`, DC `/api/v2/PublicData/`,
  TX `/BillLookup/History.aspx`, TN `/apps/indexes/`, ME, OK, RI).
- **Not verified** — my candidate URL returned HTML or a 404. That is a gap in *this survey*, not proof
  that the jurisdiction publishes nothing. Anyone extending this file should take the next candidate from
  the jurisdiction's Open States scraper, which is how the verified rows above were found.

## Where LegiScan and Open States disagree about the source

Both aggregators read the same legislatures, but not always the same *service*. Every difference below
is a fact about which door each one knocks on:

| jurisdiction | LegiScan reads | Open States reads | what it means |
|---|---|---|---|
| **NY** | `assembly.state.ny.us` — **100%** of our NY docs | `legislation.nysenate.gov` — the Senate's **API v3** | LegiScan scrapes the Assembly's HTML; the open route uses New York's documented JSON API. **The open source is the better one here.** |
| **NJ** | `pub.njleg.gov` (72.7%) | `pub.njleg.state.nj.us` — one **bulk ZIP per session** | different door, better door: the whole 2026 session in one file (measured: 10,691 bills in 35 s). |
| **PA** | `www.legis.state.pa.us` (88.9%) | `www.palegis.us` | PA migrated; Open States is on the new site, our archive on the old. |
| **KS** | `kslegislature.org` | `www.kslegislature.gov` | KS moved to `.gov`; we hold the `.org` era. |
| **RI** | `webserver.rilegislature.gov` | `status.rilegislature.gov` | different services of the same legislature. |
| **MO** | **`reflect.legiscan.com`** for 3,007 docs | `www.senate.mo.gov`, `documents.house.mo.gov` | the one place LegiScan serves its own mirror instead of the state. |
| **MT** | `leg.mt.gov` | `api.legmt.gov` — 20 distinct endpoints | Montana has a full REST API; our archive holds the web pages. |
| **WA** | `lawfilesext.leg.wa.gov` | `wslwebservices.leg.wa.gov` — SOAP | ditto. |

## The 18% problem — a defect this survey found in our own data

**`api/legiscan-sync.ts:170–188` writes three different LegiScan id spaces into one primary-key column.**
`text.doc_id`, `amendment.amendment_id` and `supplement.supplement_id` are each numbered from 1 within
their own space; all three are written to `"Documents".document_id`, which is the table's PK. They collide.

The upsert at `:431` is:

```sql
ON CONFLICT (document_id) DO UPDATE SET
  document_size = EXCLUDED.document_size, document_desc = EXCLUDED.document_desc,
  url = EXCLUDED.url, state_link = EXCLUDED.state_link
```

`bill_id` and `document_type` are **not** in that list. So a collision produces a chimera: the *first*
importer's `bill_id` and `document_type`, the *last* importer's `url`, `state_link` and size — and the
loser's real `state_link` is **destroyed**, not shadowed.

Measured by parsing each row's own `legiscan.com/{STATE}/{type}/…/id/{n}` URL and comparing to the joined bill:

| | rows | of 3,434,752 joined |
|---|---:|---:|
| document's URL names a **different state** than its bill | **631,689** | **18.39%** |
| document's URL names a **different type** than `document_type` | **646,524** | **18.82%** |
| URL unparseable | 0 | — |

One row, verbatim: `document_id = 273853`, `document_type = 'text'`, `bill_id` → **NY A00124**,
`url` = `https://legiscan.com/LA/supplement/HB762/id/273853`, `state_link` → `legis.la.gov`.

**Why it matters beyond this file:** anything that walks `"Documents"` by `bill_id` — lane BT's
`state_link` text walker included — will follow ~18% of rows to the wrong legislature, and will attribute
the text it finds to the wrong bill. **The fix is a composite key** (`document_type, document_id`) or a
namespaced id, plus a re-import; it is not a `state` column repair. Two further counts for whoever takes it:
**8,618** `"Documents"` rows have a `bill_id` with no `"Bills"` row, and **3,750** have a malformed
`state_link` (values such as the literal string `/legiscan`) that came that way from the source.

## Coverage

Our 52 jurisdictions are **50 states + DC + U.S. Congress**. Open States covers **56**: the same 52 plus
**Guam, the Northern Marianas, Puerto Rico and the U.S. Virgin Islands** — and, contrary to what is often
said, it *does* carry Congress (`scrapers/usa/`, 119th marked `"active": True`, sourced from govinfo
BILLSTATUS bulk XML). Its own authors recommend `github.com/unitedstates/congress` instead for federal
work, at `scrapers/usa/bills.py:17`, because that project has more back-data.

## Open States' bulk-data catalogue, and how its coverage compares to ours

*(Added per the 14:05 amendment: record each bulk file's date, take what exists, diff it against ours.)*

**The download links are gated.** `openstates.org/data/session-csv/` redirects to
`open.pluralpolicy.com/data/session-csv/`, which says *"Please log in to access download links."*
`data.openstates.org` returns **403**. No account was created and nothing was worked around, so what
"exists" to take anonymously is the **catalogue**, not the files. The catalogue is still complete and
public: **683 sessions across 53 jurisdictions** (our 52 plus Puerto Rico), each with its file's
*updated* date.

**They are not abandoned.** The worry that prompted this amendment is not borne out by the dates:

| file's "updated" year | 2021 | 2022 | 2023 | 2024 | 2025 | **2026** |
|---|---:|---:|---:|---:|---:|---:|
| sessions | 346 | 95 | 50 | 65 | 56 | **71** |

**All 53 jurisdictions have at least one 2026 snapshot.** The stalest *newest* file is New Mexico's
(2026-05-06 — days after NM's session ended); the freshest are same-week (Alaska 2026-08-27, California
2026-08-27, DC 2026-08-27). The 346 files still dated 2021 are closed historical sessions that will
never change again. This catalogue is actively maintained. It is *login-gated*, which is a different
problem and a worse one for us: a cold standby cannot be refreshed by `wget`.

### Coverage diff — their catalogue vs our `"Bills"`

Matched at **(state, year, regular|special)**, because the two systems name sessions differently
("2011-2012 Regular Session" vs "Alaska 31st Legislature (2019-2020)"). **Six jurisdictions — AZ, IL,
NE, NY, OH, US — name sessions by legislature number with no year at all**, so the matcher is blind
there by construction and they are excluded rather than reported as false gaps. That leaves
**46 comparable jurisdictions**:

| | count |
|---|---:|
| (state, year, kind) in **both** | **582** |
| **ours only** | **407** — of which **380 are pre-2017** |
| **theirs only** | **87** |

Three things fall out, and all three matter to the memo:

1. **Their bulk files effectively begin in 2017.** 380 of our 407 "ours only" entries are pre-2017 —
   that is not a gap in their data, it is the start of their bulk-export era. Our LegiScan archive
   reaches back to **2007**.
2. **They reach back further than us where they reach at all.** Their catalogue's oldest entries are
   **North Carolina 1985** and **California 1989** — deep history we simply do not hold. 87 of 87
   "theirs only" entries are CA and NC back-sessions plus a handful of specials.
3. **⚠ The 27 "ours only" entries from 2017 onward are almost all *special sessions*** — TX 2017,
   2021, 2023 and 2025 specials; HI 2017–2019; AL 2023 and 2026; ND 2023 and 2026; NV 2025; KS 2024;
   OK 2018; MO 2019; WI 2020; NC 2018; MT 2017. **Switching to the bulk files would cost us special
   sessions**, and special sessions are disproportionately where consequential legislation moves.
   Running the scrapers ourselves does not have this problem — it is a property of their *published
   exports*, not of their scrapers.

**What could not be done, and why:** the amendment also asks for **per-(state, session) bill counts on
both sides**. Their counts are inside the gated files. The comparison above is therefore
*session-presence*, not *row-count* — an honest half of the ask. The bill-count comparison exists for
the three step-3 sessions, where we ran the scrapers ourselves; it is in `docs/INDEPENDENCE.md`.

## Reproducing this

```bash
# the host rollup (note: keyed on the document's own URL, not on its bill)
psql "$POLICY_DATABASE_URL" -c "select substring(url from '^https?://legiscan\.com/([A-Z]{2})/') st,
  lower(substring(state_link from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]+)')) host, count(*)
  from \"Documents\" group by 1,2 order by 1, 3 desc;"

# the feed verification
node --experimental-strip-types scripts/independence/verify-feeds.ts feeds.json out.json
```

---

*Counts as of 2026-08-28 (ORCHESTRATION §3: a completeness claim is a claim with a timestamp).
`"Documents"` = 3,443,370 rows; `"Bills"` = 2,128,806 rows across 52 jurisdictions.*
