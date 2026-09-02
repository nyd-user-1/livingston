# Open primaries in the states and Congress — the terrain, from the record

**Research report · 2026-09-02 · govblock lead (Fable) · every number below is a query over Aurora `policy`, run this morning; the queries are in §7 and the full tables are in `docs/research/data/open-primaries/`.**

Brendan's test: *"every bill on this subject in twenty years across 51 jurisdictions, where each died, who sponsored it, who chaired the committee that killed it, how the floor votes split, and which of those people still sit."* This is the first pass, exhaustive over what the record holds, honest about what it does not.

## 1. The universe

- **290 bills** whose title or description names the subject in one of its dialects (open, nonpartisan, top-two, blanket, jungle, semi-open, semi-closed, unaffiliated / independent / unenrolled voters, and *closed* primary — the opposition's bills belong in the set), across **41 jurisdictions** (10 federal), **2007–2026**.
- **702 more bills in 42 states** carry the same phrases in their full text but not in their title — omnibus election bills, local-provision bills, and noise (a Georgia motor-vehicle bill). They are the candidates for the second, human-confirmed pass; the two live ones visible at a glance are Delaware HB188 (2026, engrossed, "relating to primary elections") and Louisiana HB906 (2026, Senate floor calendar, nominating petitions and party primaries).
- Direction, by heuristic on the title (a human confirms this once): **212 open**, **64 close or repeal**, 13 unclear, 1 study. The whip table below does not yet carry direction — that is the first thing the curated pass adds, because a sponsor of a closing bill and a sponsor of an opening bill both count as "sponsored" today.

**By jurisdiction:** MS 49, IL 23, AZ 22, NY 22, SC 16, NM 14, ME 13, HI 12, MO 11, MD 10, US 10, VA 10, MA 8, AK 6, OK 6, TX 6, CT 4, LA 4, MT 4, TN 4, AL 3, ID 3, KY 3, WV 3, AR 2, IN 2, NC 2, NE 2, RI 2, SD 2, WY 2, CA 1, CO 1, DC 1, FL 1, GA 1, MI 1, OH 1, UT 1, VT 1, WA 1.

**By year:** 2007 1, 2009 8, 2010 14, 2011 19, 2012 14, 2013 16, 2014 11, 2015 24, 2016 14, 2017 22, 2018 11, 2019 20, 2020 11, 2021 14, 2022 8, 2023 28, 2024 8, 2025 25, 2026 20. The pace since 2023 is the highest in the record.

## 2. Where they died

- **244 of 290 (84%) never reached a floor vote**: 91 stopped at introduction, 77 in a House committee, 61 in a Senate committee, 15 in an Assembly committee.
- **21 failed** on a recorded vote or report; **5 passed**, **5 signed**, 4 adopted (resolutions), 1 vetoed, 1 engrossed and live, 7 on a floor calendar, 2 stricken.
- **The committees that hold the bodies** (bills that died there, all sessions): MS (none recorded) — 49; SC Judiciary — 16; IL Rules — 12; NY Election Law — 11; VA Privileges and Elections — 9; MA (none recorded) — 8; AZ (none recorded) — 7; NM (none recorded) — 6; TX Elections — 6; AK State Affairs — 5; HI (none recorded) — 5; AZ Government Institutions — 4; CT Government Administration and Elections — 4; NY Judiciary — 4; NY Elections — 4; AZ Judiciary — 3; AZ Municipal Oversight & Elections — 3; IL Assignments — 3.
- **Who chaired them: not derivable today.** The `Committees` table holds 82 committees with chairs and members, all New York. For the other 40 jurisdictions the committee *name* is on the bill and the chair is not anywhere we hold. LegiScan does not publish membership; every legislature's website does. That is the parked committee-rosters lane, and it is the browser fleet's first job for this campaign.
- Data gaps worth naming: Mississippi's 49 bills carry no committee at all in LegiScan; Massachusetts, Arizona, New Mexico and Hawaii are partly blank; Louisiana's roll calls are dated `0000-00-00` at the source.

## 3. How the floor votes split

- **67 roll calls on 31 bills in 16 states.** The roll-call headers total **2,311 yea, 856 nay**; the member-level vote rows we hold cover 2,230 yea, 824 nay, 138 absent, 58 not voting (a few roll calls carry totals without member rows at the source). Pooled across opening and closing bills — the direction-aware split is the curated pass's second deliverable.
- The defeats on the record: Illinois SB1666 (2009) lost on Senate third reading 15–35; Maine rejected open-primary bills on the House floor in 2017 (LD78, 99–42 ought-not-to-pass) and 2019 (LD114, 111–24), then failed LD1959 (2024) and LD1422 (2025) after passing LD231 in 2022; Colorado SB058 died in committee on 24 Feb 2026, 3–2 to postpone.
- The wins: California SCA4 (2009, 27–12 Senate, 54–20 Assembly, signed — the measure that became the top-two primary); Louisiana HB292 (2010, 71–27 House, 31–5 Senate, open primaries for congressional offices); Utah HB0262 (2013, unaffiliated-voter amendments); Maine LD231 (2022); Maryland SB99 (2024, adopted) and **Maryland HB156 (2026, engrossed, House third reading 110–26 on 11 March)** — the live front.
- Every roll call, with chamber, question, yea and nay, is Appendix B.

## 4. Who sponsored, who voted, who still sits

- **511 distinct sponsors** (293 D, 206 R, 8 I) and **1624 distinct voters**; **2062 legislators with any record** on these bills.
- **774 of them sit today**, in the roster of their state's current session (rosters are 2025–2026). By state: MD 143, KY 115, NY 103, ME 101, SC 50, MT 43, TN 31, UT 21, VA 16, AZ 16, IL 14, MS 13, US 10, LA 9, WV 8.
- The federal champion is Brian Fitzpatrick (R, PA-1): eight of the ten federal bills. All ten died in House committee — Open Our Democracy Act (2014, 2015), the CLEAN Elections Act (2017, 2019, 2021, 2023), and the Let America Vote Act (2024, 2025); on 17 September 2025 the Rules Committee received H.Res. 731, a rule providing for consideration of H.R. 155, the furthest a federal open-primary bill has travelled in this record.
- **Caution on reading the sponsor counts.** South Carolina's and Mississippi's heavy sponsors are on bills the heuristic classes as *closing* primaries (both states hold open primaries today); New York's and Maryland's are on opening bills. Direction is the missing column, and it is a title-and-text classification a human confirms once per bill.
- The 60 sitting legislators with the most record are Appendix C; all 2,062 are `whip.csv`.

## 5. Transcripts and testimony

- The Congress.gov API offers hearing transcripts; we hold the list of 932 for the 119th and none mentions primaries. The federal bills never got a hearing in this record.
- No state hearing transcript or witness list is in LegiScan. They are on the legislature websites — the browser fleet, again.

## 6. What this proves, and what it needs

1. **The query is real.** From a cold start, in one morning, the record yields the set, the graveyard, the floor votes and 774 sitting legislators with a history on the subject. No advocacy shop has this table for one state, let alone 41.
2. **The curated pass is the product.** Three columns are missing and all three are one human confirmation per bill on top of what the machine proposes: direction (opens / closes / study / noise), the 702 full-text candidates in or out, and the chair of the committee that held it. That is *Curated Bill Sets*: a named set, machine-proposed, human-confirmed once, tracked forever.
3. **Two harvests unlock the rest:** committee rosters and chairs for 50 legislatures (parked lane, browser fleet), and hearing witness lists and testimony (browser fleet). Both are on the web and nowhere else.
4. **The surface:** this document is a *Research Report* — a question, the tables, the queries, the gaps, dated. Every table here is one `/api/policy` resource away from a page.

## 7. Queries

```sql
-- the set
select … from "Bills" b where b.title ilike any(array['%open primar%','%nonpartisan primar%','%non-partisan primar%','%top two primar%','%top-two primar%','%blanket primar%','%jungle primar%','%semi-open%','%semi-closed%','%unaffiliated voter%','%independent voter%','%unenrolled voter%','%closed primar%']) or b.description ilike any(…same…);
-- full-text supplement (psql on box 2; the Data API times out)
select count(distinct bill_id) from "BillTexts" where search_tsv @@ to_tsquery('english','(open <-> primary) | (nonpartisan <-> primary) | (unaffiliated <-> voters)') and bill_id <> all(:set);
-- roll calls
select rc.*, b.bill_number from "Roll Call" rc join "Bills" b using(bill_id) where rc.bill_id in (:set);
-- whip
with sp as (select people_id, count(*) sponsored from "Sponsors" where bill_id in (:set) group by 1),
     vt as (select v.people_id, count(*) filter (where vote_desc='Yea') yea, count(*) filter (where vote_desc='Nay') nay from "Votes" v join "Roll Call" rc using(roll_call_id) where rc.bill_id in (:set) group by 1)
select p.*, sp.sponsored, vt.yea, vt.nay from "People" p left join sp using(people_id) left join vt using(people_id) where sp.people_id is not null or vt.people_id is not null;
-- still sitting
with mx as (select state, max(year) y from "SessionPeople" group by 1) select distinct sp.people_id from "SessionPeople" sp join mx on mx.state=sp.state and mx.y=sp.year;
```

## Appendix A — the 290 bills

| State | Bill | Year | Status | Committee | Dir. | Title |
|---|---|---|---|---|---|---|
| AK | [HB77](https://legiscan.com/AK/bill/HB77/2011) | 2011 | Introduced | State Affairs | opens | Nonpartisan Blanket Primary Election |
| AK | [HB225](https://legiscan.com/AK/bill/HB225/2011) | 2011 | In Senate Committee | State Affairs | opens | Nonpartisan Blanket Primary Election |
| AK | [HB13](https://legiscan.com/AK/bill/HB13/2013) | 2013 | Introduced | State Affairs | opens | Nonpartisan Blanket Primary Election |
| AK | [HB17](https://legiscan.com/AK/bill/HB17/2015) | 2015 | In House Committee | State Affairs | closes | Nonpartisan Primary Elections |
| AK | [HB200](https://legiscan.com/AK/bill/HB200/2017) | 2017 | Introduced | State Affairs | closes | Nonpartisan Open Primary Elections |
| AK | [HB4](https://legiscan.com/AK/bill/HB4/2023) | 2023 | Introduced | Finance | closes | Elections:repeal Rank Choice/open Primary |
| AL | [HB193](https://legiscan.com/AL/bill/HB193/2018) | 2018 | In House Committee | Constitution, Campaigns and Elections | opens | Open Primary elections, system created, qualifications to participate in general election, |
| AL | [SB164](https://legiscan.com/AL/bill/SB164/2018) | 2018 | In Senate Committee | Constitution, Ethics and Elections | opens | Open Primary elections, system created, qualifications to participate in general election, |
| AL | [HB214](https://legiscan.com/AL/bill/HB214/2018) | 2018 | In House Committee | Constitution, Campaigns and Elections | opens | Open primary elections, system created, qualifications to participate in general elections |
| AR | [HB1743](https://legiscan.com/AR/bill/HB1743/2013) | 2013 | In House Committee |  | opens | To Establish An Open Blanket Primary To Ensure The Election Of The Most Qualified Candidat |
| AR | [HB1766](https://legiscan.com/AR/bill/HB1766/2017) | 2017 | In House Committee |  | opens | To Create "the Nonpartisan Blanket Primary Act"; To Institute The Nonpartisan Blanket Prim |
| AZ | [HB2638](https://legiscan.com/AZ/bill/HB2638/2010) | 2010 | In Senate Committee | Judiciary | opens | Presidential preference election; independent voters |
| AZ | [HCR2050](https://legiscan.com/AZ/bill/HCR2050/2012) | 2012 | In Senate Committee | Judiciary | opens | Open top two primary elections |
| AZ | [SB1186](https://legiscan.com/AZ/bill/SB1186/2013) | 2013 | In Senate Committee | Elections | opens | Presidential preference election; independent voters |
| AZ | [SB1427](https://legiscan.com/AZ/bill/SB1427/2014) | 2014 | In Senate Committee | Elections | opens | Presidential preference election; independent voters |
| AZ | [SB1366](https://legiscan.com/AZ/bill/SB1366/2015) | 2015 | In Senate Committee | Government Institutions | opens | Presidential preference election; independent voters |
| AZ | [SB1027](https://legiscan.com/AZ/bill/SB1027/2016) | 2016 | In Senate Committee | Government Institutions | opens | Presidential preference election; independent voters |
| AZ | [HB2350](https://legiscan.com/AZ/bill/HB2350/2017) | 2017 | Introduced |  | opens | Presidential preference election; independent voters |
| AZ | [SB1393](https://legiscan.com/AZ/bill/SB1393/2017) | 2017 | Introduced |  | opens | Presidential preference election; independent voters |
| AZ | [HB2051](https://legiscan.com/AZ/bill/HB2051/2018) | 2018 | Introduced |  | opens | Presidential preference election; independent voters |
| AZ | [SB1126](https://legiscan.com/AZ/bill/SB1126/2018) | 2018 | Introduced |  | opens | Presidential preference election; independent voters. |
| AZ | [HCR2014](https://legiscan.com/AZ/bill/HCR2014/2018) | 2018 | Introduced |  | closes | Closed primary elections |
| AZ | [SB1057](https://legiscan.com/AZ/bill/SB1057/2019) | 2019 | Introduced |  | opens | Presidential preference election; independent voters |
| AZ | [SB1532](https://legiscan.com/AZ/bill/SB1532/2020) | 2020 | Introduced | Judiciary | opens | Presidential preference election; independent voters |
| AZ | [HB2736](https://legiscan.com/AZ/bill/HB2736/2021) | 2021 | Introduced | Government & Elections | opens | Presidential preference election; independent voters. |
| AZ | [SB1668](https://legiscan.com/AZ/bill/SB1668/2021) | 2021 | Introduced | Government Institutions | opens | Presidential preference caucuses; independent voters |
| AZ | [SB1456](https://legiscan.com/AZ/bill/SB1456/2022) | 2022 | Introduced | Government Institutions | opens | Presidential preference caucuses; independent voters |
| AZ | [HB2076](https://legiscan.com/AZ/bill/HB2076/2022) | 2022 | Introduced |  | opens | Presidential preference election; independent voters |
| AZ | [HB2153](https://legiscan.com/AZ/bill/HB2153/2023) | 2023 | Introduced | Municipal Oversight & Elections | opens | Presidential preference election; independent voters |
| AZ | [HB2799](https://legiscan.com/AZ/bill/HB2799/2023) | 2023 | Introduced | Municipal Oversight & Elections | opens | Open primary election |
| AZ | [HB2464](https://legiscan.com/AZ/bill/HB2464/2024) | 2024 | Introduced | Municipal Oversight & Elections | opens | Presidential preference election; independent voters |
| AZ | [HCR2060](https://legiscan.com/AZ/bill/HCR2060/2025) | 2025 | Introduced | Federalism, Military Affairs & Elections | closes | Open primaries; repeal |
| AZ | [HB4059](https://legiscan.com/AZ/bill/HB4059/2026) | 2026 | In House Committee | Rules | opens | Open primary election |
| CA | [SCA4](https://legiscan.com/CA/bill/SCA4/2009) | 2009 | Signed by Governor |  | opens | Elections: open primaries. |
| CO | [SB058](https://legiscan.com/CO/bill/SB058/2026) | 2026 | In Senate Committee |  | opens | Modifications to Voter Registration |
| CT | [HB05730](https://legiscan.com/CT/bill/HB05730/2011) | 2011 | In Senate Committee | Government Administration and Elections | opens | An Act Concerning Unaffiliated Voters In Primaries. |
| CT | [HB05694](https://legiscan.com/CT/bill/HB05694/2023) | 2023 | In House Committee | Government Administration and Elections | opens | An Act Concerning Primaries. |
| CT | [HB06248](https://legiscan.com/CT/bill/HB06248/2023) | 2023 | In House Committee | Government Administration and Elections | opens | An Act Concerning Open Primaries. |
| CT | [HJ00005](https://legiscan.com/CT/bill/HJ00005/2025) | 2025 | In House Committee | Government Administration and Elections | opens | Resolution Proposing A State Constitutional Amendment To Require Political Parties To Cond |
| DC | [B20-0717](https://legiscan.com/DC/bill/B20-0717/2013) | 2014 | Introduced |  | opens | Open Primary Elections Amendment  Act Of 2014 |
| FL | [H0405](https://legiscan.com/FL/bill/H0405/2023) | 2023 | In House Committee |  | closes | Prohibition on Open Primaries and Nonpartisan Elections |
| GA | [SB370](https://legiscan.com/GA/bill/SB370/2025) | 2025 | Introduced | Ethics | closes | Elections and Primaries; closed primaries; provide |
| HI | [HB2245](https://legiscan.com/HI/bill/HB2245/2010) | 2010 | In Senate Committee | Hawaiian Affairs | opens | Office of Hawaiian Affairs; Trustees; Election |
| HI | [SB2306](https://legiscan.com/HI/bill/SB2306/2010) | 2010 | In Senate Committee |  | unclear | Instant Runoff Voting; Elections |
| HI | [SB2378](https://legiscan.com/HI/bill/SB2378/2010) | 2010 | In Senate Committee |  | opens | Office of Hawaiian Affairs; Trustees; Election |
| HI | [SB1404](https://legiscan.com/HI/bill/SB1404/2011) | 2011 | In Senate Committee | Hawaiian Affairs | opens | Office of Hawaiian Affairs; Trustees; Election |
| HI | [SB1404](https://legiscan.com/HI/bill/SB1404/2012) | 2011 | Introduced |  | opens | Office of Hawaiian Affairs; Trustees; Election |
| HI | [HR116](https://legiscan.com/HI/bill/HR116/2011) | 2011 | Adopted |  | closes | Requesting a study of the types of closed primaries and their effect on voter turnout. |
| HI | [HCR136](https://legiscan.com/HI/bill/HCR136/2011) | 2011 | Adopted |  | closes | Requesting a study of the types of closed primaries and their effect on voter turnout. |
| HI | [HB1087](https://legiscan.com/HI/bill/HB1087/2013) | 2013 | In House Committee |  | opens | Office of Hawaiian Affairs; Trustees; Election |
| HI | [HB1087](https://legiscan.com/HI/bill/HB1087/2014) | 2013 | Introduced |  | opens | Office of Hawaiian Affairs; Trustees; Election |
| HI | [SB3](https://legiscan.com/HI/bill/SB3/2013) | 2013 | Passed |  | opens | Office of Hawaiian Affairs; Trustees; Election |
| HI | [HB338](https://legiscan.com/HI/bill/HB338/2015) | 2015 | In House Committee | Judiciary | closes | Closed Primary Elections; Declaration of Political Party Registration or Nonpartisanship |
| HI | [HB338](https://legiscan.com/HI/bill/HB338/2016) | 2015 | Introduced | Judiciary | closes | Closed Primary Elections; Declaration of Political Party Registration or Nonpartisanship |
| ID | [S1202](https://legiscan.com/ID/bill/S1202/2011) | 2011 | Signed by Governor |  | unclear | Appropriates an additional $100,000 to the Secretary of State for fiscal year 2011 to pay  |
| ID | [H0059](https://legiscan.com/ID/bill/H0059/2013) | 2013 | In House Committee |  | closes | Adds to existing law relating to ballots to provide requirements relating to the payment o |
| ID | [S1230](https://legiscan.com/ID/bill/S1230/2022) | 2022 | In Senate Committee | State Affairs | closes | Amends, adds to, and repeals existing law to provide for nonpartisan primary elections and |
| IL | [HB0825](https://legiscan.com/IL/bill/HB0825/2009) | 2009 | Introduced | Rules | opens | ELEC CD-OPEN PRIMARY |
| IL | [HB0888](https://legiscan.com/IL/bill/HB0888/2009) | 2009 | In Senate Committee | Rules | opens | ELEC CD-OPEN PRIMARY |
| IL | [SB1666](https://legiscan.com/IL/bill/SB1666/2009) | 2009 | Senate Floor Calendar |  | opens | ELEC CD-OPEN PRIMARY |
| IL | [HB5192](https://legiscan.com/IL/bill/HB5192/2009) | 2010 | In Senate Committee | Rules | opens | ELEC CD-OPEN PRIMARY |
| IL | [HB5277](https://legiscan.com/IL/bill/HB5277/2009) | 2010 | In Senate Committee | Rules | opens | MUNI CD-PRIMARY ELECTIONS |
| IL | [HB6217](https://legiscan.com/IL/bill/HB6217/2009) | 2010 | In Senate Committee | Rules | opens | MUNI CD-PRIMARY ELECTION |
| IL | [HB5913](https://legiscan.com/IL/bill/HB5913/2013) | 2014 | Failed |  | opens | ELEC CD-TOP TWO PRIMARY |
| IL | [HB2948](https://legiscan.com/IL/bill/HB2948/2013) | 2014 | Failed |  | opens | ELEC CD-OPEN PRIMARY |
| IL | [HB3292](https://legiscan.com/IL/bill/HB3292/2013) | 2014 | Failed |  | opens | ELEC CD-OPEN PRIMARY |
| IL | [HB0194](https://legiscan.com/IL/bill/HB0194/2015) | 2015 | In House Committee | Rules | opens | ELEC CD-OPEN PRIMARY |
| IL | [SB0759](https://legiscan.com/IL/bill/SB0759/2015) | 2015 | In Senate Committee | Assignments | opens | ELEC CD-OPEN PRIMARY |
| IL | [HB2719](https://legiscan.com/IL/bill/HB2719/2015) | 2015 | In House Committee | Rules | opens | ELEC CD-TOP TWO PRIMARY |
| IL | [HB5923](https://legiscan.com/IL/bill/HB5923/2015) | 2016 | Introduced | Rules | opens | ELEC CD-TOP TWO PRIMARY |
| IL | [HB0330](https://legiscan.com/IL/bill/HB0330/2017) | 2019 | Failed |  | opens | ELEC CD-OPEN PRIMARY |
| IL | [HB0285](https://legiscan.com/IL/bill/HB0285/2017) | 2019 | Failed |  | opens | ELEC CD-TOP TWO PRIMARY |
| IL | [HB3655](https://legiscan.com/IL/bill/HB3655/2017) | 2019 | Failed |  | opens | ELEC CD-TOP TWO PRIMARY |
| IL | [SB3210](https://legiscan.com/IL/bill/SB3210/2019) | 2021 | Failed |  | opens | MUNI CD-NONPARTISAN PRIMARIES |
| IL | [HB3488](https://legiscan.com/IL/bill/HB3488/2021) | 2021 | In House Committee | Rules | opens | MUNI CD-NONPARTISAN PRIMARIES |
| IL | [SB1630](https://legiscan.com/IL/bill/SB1630/2021) | 2021 | In Senate Committee | Assignments | opens | MUNI CD-NONPARTISAN PRIMARIES |
| IL | [HB4352](https://legiscan.com/IL/bill/HB4352/2021) | 2022 | In House Committee | Rules | opens | MUNI NONPARTISAN LIST/DEFENSE |
| IL | [HB3749](https://legiscan.com/IL/bill/HB3749/2023) | 2023 | Introduced | Rules | unclear | ELECTION-RCV/MUNICIPAL PRIMARY |
| IL | [HB1708](https://legiscan.com/IL/bill/HB1708/2025) | 2025 | In House Committee | Rules | unclear | ELEC CD-RCV/MUNICIPAL PRIMARY |
| IL | [SB2158](https://legiscan.com/IL/bill/SB2158/2025) | 2025 | In Senate Committee | Assignments | opens | ELEC CD-OPEN PRIMARY ELECTIONS |
| IN | [SB0201](https://legiscan.com/IN/bill/SB0201/2025) | 2025 | Introduced |  | closes | Closed primary elections. |
| IN | [HB1029](https://legiscan.com/IN/bill/HB1029/2025) | 2025 | Introduced | Elections and Apportionment | closes | Closed primaries. |
| KY | [HB469](https://legiscan.com/KY/bill/HB469/2011) | 2011 | Introduced | Appropriations and Revenue | unclear | AN ACT relating to elections. |
| KY | [HB150](https://legiscan.com/KY/bill/HB150/2015) | 2015 | Signed by Governor |  | unclear | AN ACT relating to elections. |
| KY | [SB190](https://legiscan.com/KY/bill/SB190/2023) | 2023 | Signed by Governor |  | unclear | AN ACT relating to actions of government officials. |
| LA | [HB220](https://legiscan.com/LA/bill/HB220/2010) |  | Senate Floor Calendar |  | opens | Provides for an open primary system of elections for congressional offices |
| LA | [SB690](https://legiscan.com/LA/bill/SB690/2010) | 2010 | Adopted |  | opens | Allows an independent voter to vote in either the Democratic or Republican congressional p |
| LA | [SB796](https://legiscan.com/LA/bill/SB796/2010) | 2010 | Senate Floor Calendar |  | opens | Provides for an open primary system of elections for congressional offices. (1/1/11) (RE S |
| LA | [HB292](https://legiscan.com/LA/bill/HB292/2010) | 2010 | Passed |  | opens | Provides for an open primary system of elections for congressional offices (EGF SEE FISC N |
| MA | [H662](https://legiscan.com/MA/bill/H662/2009) | 2009 | Introduced |  | opens | Relative to unaffiliated voters. |
| MA | [H554](https://legiscan.com/MA/bill/H554/2009) | 2009 | Introduced |  | opens | To change the definition of unenrolled voter to no party affiliation on official massachus |
| MA | [H1102](https://legiscan.com/MA/bill/H1102/2011) | 2011 | Introduced |  | opens | To change the definition of unenrolled voter to no party affiliation on official massachus |
| MA | [H1982](https://legiscan.com/MA/bill/H1982/2011) | 2011 | Introduced |  | opens | Relative to unaffiliated voters |
| MA | [H2729](https://legiscan.com/MA/bill/H2729/2011) | 2011 | Introduced |  | opens | Relative to state ballots |
| MA | [H605](https://legiscan.com/MA/bill/H605/2013) | 2013 | Introduced |  | opens | Relative to party representation of election officers |
| MA | [H624](https://legiscan.com/MA/bill/H624/2013) | 2013 | Introduced |  | opens | Relative to unaffiliated voters |
| MA | [H593](https://legiscan.com/MA/bill/H593/2015) | 2015 | Introduced |  | opens | Relative to unaffiliated voters |
| MD | [HB26](https://legiscan.com/MD/bill/HB26/2019) | 2019 | Introduced |  | opens | Baltimore City - Ranked Choice Voting and Open Primaries |
| MD | [SB385](https://legiscan.com/MD/bill/SB385/2019) | 2019 | Introduced |  | opens | Election Law - Primary Elections - Voting by Unaffiliated Voters |
| MD | [SB39](https://legiscan.com/MD/bill/SB39/2023) | 2023 | Introduced | Education, Energy, and the Environment | opens | Ballot Access - Affiliating With a Party - Unaffiliated Voters |
| MD | [HB114](https://legiscan.com/MD/bill/HB114/2023) | 2023 | Introduced | Ways and Means | opens | Ballot Access - Affiliating With a Party - Unaffiliated Voters |
| MD | [SB99](https://legiscan.com/MD/bill/SB99/2024) | 2024 | Adopted |  | opens | Election Law - Affiliating with a Party and Voting - Unaffiliated Voters |
| MD | [HB257](https://legiscan.com/MD/bill/HB257/2024) | 2024 | Introduced | Ways and Means | opens | Election Law - Affiliating With a Party and Voting - Unaffiliated Voters |
| MD | [HB1280](https://legiscan.com/MD/bill/HB1280/2025) | 2025 | Introduced | Ways and Means | opens | Election Law - Affiliating With a Party and Voting - Unaffiliated Voters |
| MD | [SB132](https://legiscan.com/MD/bill/SB132/2026) | 2026 | Introduced | Education, Energy, and the Environment | opens | Election Law - Affiliating With a Party and Voting - Unaffiliated Voters |
| MD | [HB496](https://legiscan.com/MD/bill/HB496/2026) | 2026 | Introduced | Government, Labor, and Elections | closes | Election Law - Unaffiliated Voters - Open Primary Elections |
| MD | [HB156](https://legiscan.com/MD/bill/HB156/2026) | 2026 | Engrossed | Education, Energy, and the Environment | opens | Election Law - Affiliating With a Party and Voting - Unaffiliated Voters |
| ME | [LD3](https://legiscan.com/ME/bill/LD3/2009) | 2009 | Failed |  | opens | An Act To Designate Registered Voters Not Enrolled in a Political Party as Independent Vot |
| ME | [LD1422](https://legiscan.com/ME/bill/LD1422/2013) | 2013 | Failed |  | opens | An Act To Establish a Nonpartisan Primary and a Presidential Primary Election System and I |
| ME | [LD744](https://legiscan.com/ME/bill/LD744/2015) | 2015 | Failed |  | opens | An Act To Permit Unenrolled Voters To Cast Ballots in Primary Elections |
| ME | [LD720](https://legiscan.com/ME/bill/LD720/2015) | 2015 | Failed |  | opens | An Act To Establish an Open Primary System in the State |
| ME | [LD78](https://legiscan.com/ME/bill/LD78/2017) | 2017 | Failed |  | opens | An Act To Permit Unenrolled Voters To Cast Ballots in Primary Elections |
| ME | [LD1086](https://legiscan.com/ME/bill/LD1086/2017) | 2017 | Failed |  | opens | An Act To Amend the Laws on the Conduct of Elections and To Establish a Nonpartisan Primar |
| ME | [LD211](https://legiscan.com/ME/bill/LD211/2019) | 2019 | Failed |  | opens | An Act To Open Maine's Primaries and Permit Unenrolled Voters To Cast Ballots in Primary E |
| ME | [LD114](https://legiscan.com/ME/bill/LD114/2019) | 2019 | Failed |  | opens | An Act To Establish Open Primaries for Certain Federal and State Offices |
| ME | [LD303](https://legiscan.com/ME/bill/LD303/2021) | 2021 | Failed |  | opens | An Act To Establish Semi-open Primary Elections To Allow Unenrolled Voters To Participate |
| ME | [LD231](https://legiscan.com/ME/bill/LD231/2021) | 2022 | Passed |  | opens | An Act To Establish Open Primaries |
| ME | [LD1320](https://legiscan.com/ME/bill/LD1320/2023) | 2023 | Failed |  | opens | An Act to Improve Signature Requirements for Candidates by Allowing Unenrolled Voters to S |
| ME | [LD1959](https://legiscan.com/ME/bill/LD1959/2023) | 2024 | Failed |  | opens | An Act Regarding Open Primary Elections and Ranked-choice Voting |
| ME | [LD1422](https://legiscan.com/ME/bill/LD1422/2025) | 2025 | Failed |  | opens | An Act Regarding Open Primary Elections and Ranked-choice Voting |
| MI | [HB5956](https://legiscan.com/MI/bill/HB5956/2013) | 2014 | Introduced | Elections And Ethics | closes | Elections; primary; closed primaries; require. Amends secs. 495, 500a, 509q, 509gg, 523, 5 |
| MO | [HB1052](https://legiscan.com/MO/bill/HB1052/2012) | 2012 | Introduced | Elections | closes | Establishes a closed primary election system |
| MO | [SB832](https://legiscan.com/MO/bill/SB832/2012) | 2012 | In Senate Committee | Financial And Governmental Organizations And Elections | closes | Establishes a closed primary |
| MO | [HB1963](https://legiscan.com/MO/bill/HB1963/2012) | 2012 | Introduced | Elections | closes | Establishes a closed primary election system |
| MO | [HB2761](https://legiscan.com/MO/bill/HB2761/2016) | 2016 | Introduced | Elections | closes | Allows the governing body of any established political party to choose to adopt a closed p |
| MO | [HB27](https://legiscan.com/MO/bill/HB27/2017) | 2017 | In House Committee | Select Committee on Local, State, Federal Relations and Miscellaneous Business | closes | Allows the governing body of any established political party to choose to adopt a closed p |
| MO | [HB1938](https://legiscan.com/MO/bill/HB1938/2020) | 2020 | Introduced | Elections and Elected Officials | opens | Creates open primaries. |
| MO | [HB885](https://legiscan.com/MO/bill/HB885/2021) | 2021 | Introduced | Elections and Elected Officials | opens | Creates open primaries |
| MO | [HB1793](https://legiscan.com/MO/bill/HB1793/2022) | 2022 | Introduced | Elections and Elected Officials | opens | Creates open primaries |
| MO | [SB392](https://legiscan.com/MO/bill/SB392/2023) | 2023 | In Senate Committee | Local Government and Elections | closes | Requires closed primary elections |
| MO | [SB240](https://legiscan.com/MO/bill/SB240/2023) | 2023 | In Senate Committee | Local Government and Elections | closes | Requires closed primary elections |
| MO | [SB1140](https://legiscan.com/MO/bill/SB1140/2024) | 2024 | In Senate Committee | Local Government and Elections | closes | Requires closed primary elections |
| MS | [HB98](https://legiscan.com/MS/bill/HB98/2010) | 2010 | In Senate Committee |  | opens | Open primaries; establish and abolish partisan primaries. |
| MS | [HB1276](https://legiscan.com/MS/bill/HB1276/2011) | 2011 | In Senate Committee |  | opens | Open Primaries; establish. |
| MS | [HB220](https://legiscan.com/MS/bill/HB220/2011) | 2011 | In Senate Committee |  | opens | Open primaries; establish and abolish partisan primaries. |
| MS | [HB151](https://legiscan.com/MS/bill/HB151/2012) | 2012 | In Senate Committee |  | opens | Open primary election; authorize. |
| MS | [HB425](https://legiscan.com/MS/bill/HB425/2012) | 2012 | In Senate Committee |  | opens | Open primaries; authorize. |
| MS | [HB158](https://legiscan.com/MS/bill/HB158/2012) | 2012 | In Senate Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB589](https://legiscan.com/MS/bill/HB589/2012) | 2012 | In Senate Committee |  | opens | Open primary elections; authorize. |
| MS | [SB2340](https://legiscan.com/MS/bill/SB2340/2012) | 2012 | In Senate Committee |  | opens | Open primaries; establish. |
| MS | [HB1307](https://legiscan.com/MS/bill/HB1307/2012) | 2012 | In Senate Committee |  | opens | Open primaries; establish. |
| MS | [HB380](https://legiscan.com/MS/bill/HB380/2012) | 2012 | In Senate Committee |  | opens | Open primaries; establish and abolish partisan primaries. |
| MS | [SB2071](https://legiscan.com/MS/bill/SB2071/2012) | 2012 | In Senate Committee |  | opens | Open primaries; establish. |
| MS | [HB1253](https://legiscan.com/MS/bill/HB1253/2012) | 2012 | In Senate Committee |  | opens | Open primaries for county office; authorize. |
| MS | [HB235](https://legiscan.com/MS/bill/HB235/2013) | 2013 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB962](https://legiscan.com/MS/bill/HB962/2013) | 2013 | In House Committee |  | opens | Open primaries for county office; authorize. |
| MS | [HB572](https://legiscan.com/MS/bill/HB572/2014) | 2014 | In House Committee |  | opens | Open primary; authorize a nonbinding referendum on the question of. |
| MS | [HB55](https://legiscan.com/MS/bill/HB55/2014) | 2014 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [SB2613](https://legiscan.com/MS/bill/SB2613/2015) | 2015 | In Senate Committee |  | closes | Elections; establish closed primary system. |
| MS | [HB934](https://legiscan.com/MS/bill/HB934/2015) | 2015 | In House Committee |  | opens | Open primaries; authorize. |
| MS | [HB83](https://legiscan.com/MS/bill/HB83/2015) | 2015 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB228](https://legiscan.com/MS/bill/HB228/2015) | 2015 | In House Committee |  | opens | Open primaries; authorize. |
| MS | [SB2594](https://legiscan.com/MS/bill/SB2594/2015) | 2015 | In Senate Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB64](https://legiscan.com/MS/bill/HB64/2015) | 2015 | In House Committee |  | opens | Open primaries; authorize. |
| MS | [SB2593](https://legiscan.com/MS/bill/SB2593/2015) | 2015 | In Senate Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB935](https://legiscan.com/MS/bill/HB935/2015) | 2015 | In House Committee |  | opens | Open primaries; authorize statewide. |
| MS | [HB28](https://legiscan.com/MS/bill/HB28/2016) | 2016 | In House Committee |  | opens | Open primaries; authorize. |
| MS | [HB31](https://legiscan.com/MS/bill/HB31/2016) | 2016 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [SB2221](https://legiscan.com/MS/bill/SB2221/2016) | 2016 | In Senate Committee |  | opens | Open primary elections; authorize for state, county and municipal offices. |
| MS | [HC47](https://legiscan.com/MS/bill/HC47/2016) | 2016 | In House Committee |  | opens | Constitution; amend to require open primaries. |
| MS | [SB2671](https://legiscan.com/MS/bill/SB2671/2016) | 2016 | In Senate Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB858](https://legiscan.com/MS/bill/HB858/2016) | 2016 | In House Committee |  | opens | Open primaries; authorize. |
| MS | [SB2012](https://legiscan.com/MS/bill/SB2012/2016) | 2016 | In Senate Committee |  | opens | Open primary elections; authorize for state, county and municipal offices. |
| MS | [HB66](https://legiscan.com/MS/bill/HB66/2016) | 2016 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB302](https://legiscan.com/MS/bill/HB302/2017) | 2017 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HB305](https://legiscan.com/MS/bill/HB305/2017) | 2017 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [SB2224](https://legiscan.com/MS/bill/SB2224/2017) | 2017 | In Senate Committee |  | opens | Open primary elections; authorize for state, county and municipal offices. |
| MS | [HB367](https://legiscan.com/MS/bill/HB367/2017) | 2017 | In House Committee |  | opens | Open primaries; authorize. |
| MS | [SB2125](https://legiscan.com/MS/bill/SB2125/2018) | 2018 | In Senate Committee |  | opens | Open primary elections; authorize for state, county and municipal offices. |
| MS | [HB921](https://legiscan.com/MS/bill/HB921/2018) | 2018 | In House Committee |  | opens | Open primaries elections; authorize. |
| MS | [HB336](https://legiscan.com/MS/bill/HB336/2018) | 2018 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [SB2073](https://legiscan.com/MS/bill/SB2073/2019) | 2019 | In Senate Committee |  | opens | Open primary elections; authorize for state, county and municipal offices. |
| MS | [HB1003](https://legiscan.com/MS/bill/HB1003/2019) | 2019 | In House Committee |  | opens | Open primaries elections; authorize. |
| MS | [SB2085](https://legiscan.com/MS/bill/SB2085/2019) | 2019 | In Senate Committee |  | opens | Open primary elections; authorize for state, county and municipal offices. |
| MS | [HB1002](https://legiscan.com/MS/bill/HB1002/2019) | 2019 | In House Committee |  | opens | Open primaries; authorize. |
| MS | [HB995](https://legiscan.com/MS/bill/HB995/2020) | 2020 | In House Committee |  | opens | Open primaries elections; authorize for state, county and municipal offices. |
| MS | [HC46](https://legiscan.com/MS/bill/HC46/2020) | 2020 | In House Committee |  | opens | Constitution; amend to provide that there will be open primaries for the election of count |
| MS | [HB1400](https://legiscan.com/MS/bill/HB1400/2020) | 2020 | In House Committee |  | opens | Partisan primary elections; abolish and establish open primary elections. |
| MS | [HB723](https://legiscan.com/MS/bill/HB723/2021) | 2021 | In House Committee |  | opens | Partisan primary elections; abolish and establish open primary elections. |
| MS | [HB243](https://legiscan.com/MS/bill/HB243/2022) | 2022 | In House Committee |  | opens | Partisan primary elections; abolish and establish open primary elections. |
| MS | [SB2592](https://legiscan.com/MS/bill/SB2592/2026) | 2026 | In Senate Committee |  | closes | Statewide Primary Elections; provide for closed primaries beginning in 2027. |
| MT | [SB408](https://legiscan.com/MT/bill/SB408/2013) | 2013 | Passed |  | opens | Referendum to provide top two primary in certain elections |
| MT | [HB436](https://legiscan.com/MT/bill/HB436/2013) | 2013 | In House Committee |  | opens | Providing top two primary in certain elections |
| MT | [SB566](https://legiscan.com/MT/bill/SB566/2023) | 2023 | In House Committee |  | opens | Require top two primary for U.S. Senate races |
| MT | [SB562](https://legiscan.com/MT/bill/SB562/2025) | 2025 | Failed |  | opens | Require top two primary for certain offices |
| NC | [H737](https://legiscan.com/NC/bill/H737/2017) | 2017 | House Floor Calendar | Rules, Calendar, and Operations of the House | opens | Open Primary Act |
| NC | [H994](https://legiscan.com/NC/bill/H994/2019) | 2019 | House Floor Calendar | Elections and Ethics Law | opens | Top Four Open Primary/Elections |
| NE | [LB773](https://legiscan.com/NE/bill/LB773/2013) | 2014 | Introduced |  | opens | Provide for partisan ballots for unaffiliated voters at primary elections |
| NE | [LB202](https://legiscan.com/NE/bill/LB202/2015) | 2015 | Introduced |  | opens | Provide for partisan ballots for unaffiliated voters at primary elections |
| NM | [HJR19](https://legiscan.com/NM/bill/HJR19/2012) | 2012 | Introduced |  | opens | Unaffiliated voters in primary election, ca |
| NM | [SB650](https://legiscan.com/NM/bill/SB650/2015) | 2015 | Introduced |  | opens | Allow open primary elections |
| NM | [HJR12](https://legiscan.com/NM/bill/HJR12/2016) | 2016 | Introduced |  | opens | Open Primary Elections, Ca |
| NM | [HJR6](https://legiscan.com/NM/bill/HJR6/2017) | 2017 | Introduced | Local Government, Elections, Land Grants & Cultural Affairs | opens | Top Two Candidates Open Primary Elections, Ca |
| NM | [HB206](https://legiscan.com/NM/bill/HB206/2017) | 2017 | In House Committee | Judiciary | opens | Unaffiliated Voters In Primary Elections |
| NM | [SB205](https://legiscan.com/NM/bill/SB205/2017) | 2017 | In Senate Committee | Judiciary | opens | Unaffiliated Voters In Primary Elections |
| NM | [SM12](https://legiscan.com/NM/bill/SM12/2020) | 2020 | Introduced |  | opens | Recommendations For Open Primary Elections |
| NM | [HJR3](https://legiscan.com/NM/bill/HJR3/2020) | 2020 | Introduced |  | opens | Open Primaries For Unaffiliated Voters Ca |
| NM | [SJR1](https://legiscan.com/NM/bill/SJR1/2022) | 2022 | Introduced |  | opens | Nonpartisan Open Primary Elections, Ca |
| NM | [HB54](https://legiscan.com/NM/bill/HB54/2023) | 2023 | In House Committee | Judiciary | opens | Ballot Requests For Open Primary Elections |
| NM | [SB175](https://legiscan.com/NM/bill/SB175/2023) | 2023 | Introduced | Rules | opens | Open Primary Elections |
| NM | [SJR7](https://legiscan.com/NM/bill/SJR7/2023) | 2023 | Introduced | Rules | opens | Open Primaries & Ranked Choice Voting, Ca |
| NM | [HJR12](https://legiscan.com/NM/bill/HJR12/2023) | 2023 | Introduced | Government, Elections & Indian Affairs | opens | Open Primary Elections, Ca |
| NM | [SJR13](https://legiscan.com/NM/bill/SJR13/2025) | 2025 | Introduced | Rules | opens | Open Primary Elections, Ca |
| NY | [A08985](https://legiscan.com/NY/bill/A08985/2013) | 2014 | In Assembly Committee | Judiciary | opens | Establishes an open primary system for all state and congressional elections. |
| NY | [A07379](https://legiscan.com/NY/bill/A07379/2015) | 2015 | In Assembly Committee | Judiciary | opens | Establishes an open primary system for all state and congressional elections. |
| NY | [A10008](https://legiscan.com/NY/bill/A10008/2015) | 2016 | In Assembly Committee | Election Law | closes | Relates to providing timely written notice of closed primary party rules to newly register |
| NY | [A00590](https://legiscan.com/NY/bill/A00590/2017) | 2017 | In Assembly Committee | Election Law | closes | Relates to providing timely written notice of closed primary party rules to newly register |
| NY | [S04780](https://legiscan.com/NY/bill/S04780/2017) | 2017 | Introduced | Elections | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A07309](https://legiscan.com/NY/bill/A07309/2017) | 2017 | In Assembly Committee | Judiciary | opens | Establishes an open primary system for all state and congressional elections. |
| NY | [A05735](https://legiscan.com/NY/bill/A05735/2017) | 2017 | Assembly Floor Calendar |  | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [S07014](https://legiscan.com/NY/bill/S07014/2017) | 2018 | In Senate Committee | Elections | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A00554](https://legiscan.com/NY/bill/A00554/2019) | 2019 | In Assembly Committee | Election Law | closes | Relates to providing timely written notice of closed primary party rules to newly register |
| NY | [A03504](https://legiscan.com/NY/bill/A03504/2019) | 2019 | In Assembly Committee | Election Law | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A07934](https://legiscan.com/NY/bill/A07934/2019) | 2019 | In Assembly Committee | Judiciary | opens | Establishes an open primary system for all state and congressional elections. |
| NY | [S00496](https://legiscan.com/NY/bill/S00496/2019) | 2019 | Stricken |  | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A00908](https://legiscan.com/NY/bill/A00908/2021) | 2021 | In Assembly Committee | Election Law | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A04162](https://legiscan.com/NY/bill/A04162/2021) | 2021 | In Assembly Committee | Election Law | closes | Relates to providing timely written notice of closed primary party rules to newly register |
| NY | [A08512](https://legiscan.com/NY/bill/A08512/2021) | 2021 | In Assembly Committee | Election Law | opens | Establishes a ranked choice voting method for nonpartisan primary elections. |
| NY | [A00479](https://legiscan.com/NY/bill/A00479/2023) | 2023 | In Assembly Committee | Election Law | opens | Establishes a ranked choice voting method for nonpartisan primary elections. |
| NY | [S03465](https://legiscan.com/NY/bill/S03465/2023) | 2023 | In Senate Committee | Elections | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A00090](https://legiscan.com/NY/bill/A00090/2025) | 2025 | In Assembly Committee | Election Law | opens | Establishes a ranked choice voting method for nonpartisan primary elections. |
| NY | [S03596](https://legiscan.com/NY/bill/S03596/2025) | 2025 | In Senate Committee | Elections | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A08126](https://legiscan.com/NY/bill/A08126/2025) | 2025 | Stricken | Assembly Election Law | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| NY | [A90](https://legislation.nysenate.gov/api/3/bills/2025/A90) | 2026 | In Assembly Committee | Election Law | opens | Establishes a ranked choice voting method for nonpartisan primary elections |
| NY | [A11288](https://legiscan.com/NY/bill/A11288/2025) | 2026 | In Assembly Committee | Election Law | closes | Provides voters with a warning about New York's closed primary system on voter registratio |
| OH | [SB382](https://legiscan.com/OH/bill/SB382/2025) | 2026 | In Senate Committee | General Government | opens | Implement a top-two primary election system |
| OK | [HB1013](https://legiscan.com/OK/bill/HB1013/2011) | 2011 | In Senate Committee | Rules | opens | Elections; opening primaries to voters of other parties and Independent voters; effective  |
| OK | [HB1013](https://legiscan.com/OK/bill/HB1013/2012) | 2011 | In Senate Committee | Rules | opens | Elections; opening primaries to voters of other parties and Independent voters; effective  |
| OK | [HB1712](https://legiscan.com/OK/bill/HB1712/2026) | 2025 | In House Committee | Elections and Ethics | closes | Elections; closed primaries; political party; paying cost; open primaries; effective date. |
| OK | [SB834](https://legiscan.com/OK/bill/SB834/2025) | 2025 | Introduced | Judiciary | closes | Elections; prohibiting the use of open primaries; declaring certain ordinances and electio |
| OK | [SB834](https://legiscan.com/OK/bill/SB834/2026) | 2025 | Introduced | Judiciary | closes | Elections; prohibiting the use of open primaries; declaring certain ordinances and electio |
| OK | [HB1712](https://legiscan.com/OK/bill/HB1712/2025) | 2025 | In House Committee | Elections and Ethics | closes | Elections; closed primaries; political party; paying cost; open primaries; effective date. |
| RI | [H7913](https://legiscan.com/RI/bill/H7913/2020) | 2020 | In House Committee | Judiciary | unclear | House Resolution Respectfully Requesting The Secretary Of State To Evaluate The Feasibilit |
| RI | [S2701](https://legiscan.com/RI/bill/S2701/2020) | 2020 | In Senate Committee | Judiciary | study | Joint Resolution Creating A Special Legislative Commission To Evaluate And Provide Recomme |
| SC | [H3161](https://legiscan.com/SC/bill/H3161/2023) | 2023 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H3685](https://legiscan.com/SC/bill/H3685/2023) | 2023 | Introduced | Judiciary | closes | Closed primaries |
| SC | [S0767](https://legiscan.com/SC/bill/S0767/2023) | 2023 | In Senate Committee | Judiciary | closes | Closed primaries |
| SC | [H3310](https://legiscan.com/SC/bill/H3310/2025) | 2025 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H3640](https://legiscan.com/SC/bill/H3640/2025) | 2025 | In House Committee | Judiciary | opens | Blanket primaries |
| SC | [H4520](https://legiscan.com/SC/bill/H4520/2025) | 2025 | In House Committee | Judiciary | closes | Closed primaries |
| SC | [H5183](https://legiscan.com/SC/bill/H5183/2025) | 2026 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H5317](https://legiscan.com/SC/bill/H5317/2025) | 2026 | In House Committee | Judiciary | closes | Closed primaries |
| SC | [H5330](https://legiscan.com/SC/bill/H5330/2025) | 2026 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H5327](https://legiscan.com/SC/bill/H5327/2025) | 2026 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H5359](https://legiscan.com/SC/bill/H5359/2025) | 2026 | In House Committee | Judiciary | closes | Closed primaries |
| SC | [H5361](https://legiscan.com/SC/bill/H5361/2025) | 2026 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H5358](https://legiscan.com/SC/bill/H5358/2025) | 2026 | In House Committee | Judiciary | closes | Closed primaries |
| SC | [H5355](https://legiscan.com/SC/bill/H5355/2025) | 2026 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H5356](https://legiscan.com/SC/bill/H5356/2025) | 2026 | Introduced | Judiciary | closes | Closed primaries |
| SC | [H5447](https://legiscan.com/SC/bill/H5447/2025) | 2026 | In House Committee | Judiciary | closes | Closed primaries |
| SD | [HB1054](https://legiscan.com/SD/bill/HB1054/2010) | 2010 | Signed by Governor |  | opens | Provide independent voters voting absentee the appropriate ballot during a primary electio |
| SD | [SB175](https://legiscan.com/SD/bill/SB175/2011) | 2011 | Senate Floor Calendar |  | opens | Provide for the participation of independent voters in primary elections. |
| TN | [SB1144](https://legiscan.com/TN/bill/SB1144/2023) | 2023 | In Senate Committee | State and Local Government | opens | AN ACT to amend Tennessee Code Annotated, Title 2, relative to political party registratio |
| TN | [HB1045](https://legiscan.com/TN/bill/HB1045/2023) | 2023 | Failed |  | opens | AN ACT to amend Tennessee Code Annotated, Title 2, relative to political party registratio |
| TN | [HB1616](https://legiscan.com/TN/bill/HB1616/2023) | 2023 | In House Committee |  | unclear | AN ACT to amend Tennessee Code Annotated, Title 2, relative to elections. |
| TN | [SB2631](https://legiscan.com/TN/bill/SB2631/2023) | 2024 | In Senate Committee |  | unclear | AN ACT to amend Tennessee Code Annotated, Title 2, relative to elections. |
| TX | [HB2506](https://legiscan.com/TX/bill/HB2506/2013) | 2013 | In House Committee | Elections | opens | Relating to nonpartisan primary elections; authorizing a fee. |
| TX | [HB3080](https://legiscan.com/TX/bill/HB3080/2015) | 2015 | In House Committee | Elections | opens | Relating to nonpartisan primary elections; authorizing a fee. |
| TX | [HB1996](https://legiscan.com/TX/bill/HB1996/2017) | 2017 | In House Committee | Elections | opens | Relating to nonpartisan primary elections; authorizing a fee. |
| TX | [HB1204](https://legiscan.com/TX/bill/HB1204/2019) | 2019 | In House Committee | Elections | opens | Relating to nonpartisan primary elections; authorizing a fee. |
| TX | [HB2873](https://legiscan.com/TX/bill/HB2873/2021) | 2021 | In House Committee | Elections | opens | Relating to nonpartisan primary elections; authorizing a fee. |
| TX | [HB4453](https://legiscan.com/TX/bill/HB4453/2025) | 2025 | In House Committee | Elections | opens | Relating to nonpartisan primary elections; authorizing a fee. |
| US | [HB5334](https://legiscan.com/US/bill/HB5334/2013) | 2014 | In House Committee | Subcommittee on the Constitution And Civil Justice | opens | Open Our Democracy Act of 2014 |
| US | [HB2655](https://legiscan.com/US/bill/HB2655/2015) | 2015 | In House Committee | Subcommittee on the Constitution And Civil Justice | opens | Open Our Democracy Act of 2015 |
| US | [HB145](https://legiscan.com/US/bill/HB145/2017) | 2017 | In House Committee | Subcommittee on the Constitution And Civil Justice | unclear | CLEAN Act Citizen Legislature Anti-Corruption Reform Act |
| US | [HB163](https://legiscan.com/US/bill/HB163/2019) | 2019 | In House Committee | Subcommittee on the Constitution, Civil Rights, and Civil Liberties | opens | CLEAN Elections Act Citizen Legislature Anti-Corruption Reform of Elections Act |
| US | [HB1612](https://legiscan.com/US/bill/HB1612/2019) | 2019 | In House Committee | Subcommittee on the Constitution, Civil Rights, and Civil Liberties | unclear | To ensure election security, enhance Americans' access to the ballot box, reduce the influ |
| US | [HB100](https://legiscan.com/US/bill/HB100/2021) | 2021 | In House Committee | Subcommittee on the Constitution, Civil Rights, and Civil Liberties | opens | CLEAN Elections Act Citizen Legislature Anti-Corruption Reform of Elections Act |
| US | [HB157](https://legiscan.com/US/bill/HB157/2023) | 2023 | In House Committee | Administration | opens | CLEAN Elections Act Citizen Legislature Anti-Corruption Reform of Elections Act |
| US | [HB9144](https://legiscan.com/US/bill/HB9144/2023) | 2024 | In House Committee | Administration | opens | Let America Vote Act |
| US | [HB155](https://legiscan.com/US/bill/HB155/2025) | 2025 | In House Committee | Administration | opens | Let America Vote Act |
| US | [HR731](https://legiscan.com/US/bill/HR731/2025) | 2025 | In House Committee | Rules | opens | Providing for consideration of the bill (H.R. 155) to require States to permit unaffiliate |
| UT | [HB0262](https://legiscan.com/UT/bill/HB0262/2013) | 2013 | Passed |  | opens | Unaffiliated Voter Amendments |
| VA | [HB88](https://legiscan.com/VA/bill/HB88/2008) | 2007 | Introduced |  | unclear | Voter registration; adds party affiliation to information applicant to provide. |
| VA | [HJR541](https://legiscan.com/VA/bill/HJR541/2017) | 2016 | Introduced | Privileges and Elections | opens | Constitutional amendment; top two open primary election (first reference). |
| VA | [HJR635](https://legiscan.com/VA/bill/HJR635/2017) | 2017 | Introduced | Privileges and Elections | opens | Constitutional amendment (first resolution); top two primary election. |
| VA | [HB1129](https://legiscan.com/VA/bill/HB1129/2018) | 2018 | Introduced | Privileges and Elections | opens | Elections; establishes voter-nominated open primary elections. |
| VA | [HB360](https://legiscan.com/VA/bill/HB360/2021) | 2020 | Introduced | Privileges and Elections | opens | Elections; voter-nominated open primary elections, ranked choice voting for certain electi |
| VA | [HB360](https://legiscan.com/VA/bill/HB360/2020) | 2020 | Introduced | Privileges and Elections | opens | Elections; voter-nominated open primary elections, ranked choice voting for certain electi |
| VA | [HB2278](https://legiscan.com/VA/bill/HB2278/2021) | 2021 | Introduced | Privileges and Elections | closes | Voter registration; political party affiliation, closed primary elections. |
| VA | [HB56](https://legiscan.com/VA/bill/HB56/2024) | 2023 | Introduced | Privileges and Elections | closes | Voter registration by political party affiliation; partially closed primary elections. |
| VA | [HB1439](https://legiscan.com/VA/bill/HB1439/2024) | 2024 | Introduced | Privileges and Elections | closes | Voter registration by political party affiliation; partially closed primary elections. |
| VA | [HB1056](https://legiscan.com/VA/bill/HB1056/2026) | 2026 | In House Committee | Privileges and Elections | closes | Voter registration by political party affiliation; partially closed primary elections. |
| VT | [H0314](https://legiscan.com/VT/bill/H0314/2025) | 2025 | In House Committee | Government Operations and Military Affairs | opens | An act relating to a top-four nonpartisan primary election system |
| WA | [SB5681](https://legiscan.com/WA/bill/SB5681/2009) | 2009 | Introduced |  | opens | Updating election laws regarding the top two primary election system. |
| WV | [HB4632](https://legiscan.com/WV/bill/HB4632/2010) | 2010 | Introduced | Judiciary | opens | Bringing older contradicting language still remaining in the code into conformity with Â§3 |
| WV | [SB685](https://legiscan.com/WV/bill/SB685/2010) | 2010 | Introduced | Judiciary | opens | Updating election code language |
| WV | [HB2438](https://legiscan.com/WV/bill/HB2438/2011) | 2011 | Vetoed |  | opens | Bringing older contradicting language still remaining in the code into conformity with Â§3 |
| WY | [SF0077](https://legiscan.com/WY/bill/SF0077/2014) |  | Introduced |  | opens | Open primary elections. |
| WY | [SF0096](https://legiscan.com/WY/bill/SF0096/2011) | 2011 | In Senate Committee |  | opens | Open primaries. |

## Appendix B — the 67 roll calls

| State | Bill | Date | Chamber | Question | Yea | Nay |
|---|---|---|---|---|---|---|
| CA | SCA4 | 2009-02-19 | Senate | W/O REF. TO FILE SCA4 Maldonado | 27 | 12 |
| CA | SCA4 | 2009-02-19 | Assembly | SCA4 Maldonado  Senate Third Reading  By CALDERON | 54 | 20 |
| CO | SB058 | 2026-02-24 | Senate | Senate State, Veterans, &amp; Military Affairs: Postpone Sen | 3 | 2 |
| CO | SB058 | 2026-02-24 | Senate | Senate State, Veterans, &amp; Military Affairs: Refer Senate | 2 | 3 |
| ID | S1202 | 2011-04-04 | Senate | Senate Third Reading | 25 | 10 |
| ID | S1202 | 2011-04-06 | House | House Third Reading | 44 | 22 |
| IL | SB1666 | 2009-04-01 | Senate | Third Reading in Senate | 15 | 35 |
| KY | SB190 | 2023-03-07 | Senate | Senate: Third Reading RSN# 2552 | 35 | 0 |
| KY | SB190 | 2023-03-16 | House | House: Third Reading RCS# 305 | 96 | 1 |
| KY | SB190 | 2023-03-16 | Senate | Senate: Third Reading RSN# 2708 | 37 | 0 |
| LA | HB292 | 0000-00-00 | Senate | Senate Vote on HB 292, ADOPT (#1731) | 35 | 0 |
| LA | HB292 | 0000-00-00 | House | House Vote on HB 292, MOTION TO ADOPT (#1442) | 76 | 16 |
| LA | HB292 | 0000-00-00 | House | House Vote on HB 292, REJECT SENATE AMENDMENTS (#1006) | 89 | 2 |
| LA | SB796 | 0000-00-00 | Senate | Senate Vote on SB 796, FINAL PASSAGE (#670) | 29 | 5 |
| LA | HB292 | 0000-00-00 | Senate | Senate Vote on HB 292, FINAL PASSAGE (#680) | 31 | 5 |
| LA | HB292 | 0000-00-00 | Senate | Senate Vote on HB 292, AMENDMENT # 3107 BY AMEDEE (#679) | 23 | 14 |
| LA | HB292 | 0000-00-00 | House | House Vote on HB 292, FINAL PASSAGE (#149) | 71 | 27 |
| MD | HB156 | 2026-03-11 | House | Third Reading Passed | 110 | 26 |
| ME | LD78 | 2017-05-16 | House | Acc Maj Ought Not To Pass Rep RC #104 | 99 | 42 |
| ME | LD114 | 2019-05-23 | House | Acc Maj Ought Not To Pass Rep RC #124 | 111 | 24 |
| ME | LD211 | 2019-05-23 | House | Acc Maj Ought Not To Pass Rep RC #126 | 89 | 45 |
| ME | LD211 | 2019-05-23 | House | Table Until Later RC #125 | 22 | 113 |
| ME | LD211 | 2019-05-28 | Senate | Accept Maj Ontp Rpt RC #139 | 18 | 16 |
| ME | LD231 | 2021-06-08 | Senate | Accept Maj Otp-a Rpt RC #253 | 27 | 7 |
| ME | LD231 | 2021-06-09 | House | Acc Maj Otp As Amended Rep RC #194 | 92 | 52 |
| ME | LD1320 | 2023-05-23 | Senate | Accept Majority Ought Not To Pass Report RC #161 | 20 | 13 |
| MT | SB408 | 2013-04-04 | Senate | (S) 2nd Reading Passed | 28 | 22 |
| MT | SB408 | 2013-04-05 | Senate | (S) 3rd Reading Passed | 28 | 0 |
| MT | SB408 | 2013-04-16 | House | (H) 2nd Reading Concurred as Amended | 58 | 42 |
| MT | SB408 | 2013-04-17 | House | (H) 3rd Reading Concurred | 57 | 43 |
| MT | SB408 | 2013-04-18 | Senate | (S) 2nd Reading House Amendments Concurred | 30 | 20 |
| MT | SB408 | 2013-04-19 | Senate | (S) 3rd Reading Passed as Amended by House | 29 | 20 |
| MT | SB566 | 2023-04-03 | Senate | (S) 2nd Reading Motion to Amend Carried | 34 | 16 |
| MT | SB566 | 2023-04-03 | Senate | (S) 2nd Reading Passed as Amended | 27 | 23 |
| MT | SB566 | 2023-04-03 | Senate | (S) State Administration Committee Executive Action--Bill Pa | 6 | 4 |
| MT | SB566 | 2023-04-04 | Senate | (S) 3rd Reading Passed | 27 | 23 |
| MT | SB562 | 2025-04-02 | Senate | (S) State Administration--To Table | 9 | 0 |
| NY | A05735 | 2017-06-06 | Assembly | Assembly Election Law Committee: Favorable refer to committe | 13 | 3 |
| NY | A05735 | 2017-06-12 | Assembly | Assembly Rules Committee: Favorable | 27 | 0 |
| NY | A05735 | 2017-06-19 | Assembly | Assembly Floor Vote - Final Passage | 100 | 44 |
| NY | S00496 | 2019-06-03 | Senate | Senate Floor Vote - Final Passage | 43 | 19 |
| NY | S00496 | 2019-06-03 | Senate | Senate Rules Committee Vote | 15 | 4 |
| NY | S03596 | 2025-05-28 | Senate | COMMITTEE | 6 | 1 |
| NY | S03596 | 2025-05-28 | Senate | Senate Elections Committee Vote | 6 | 1 |
| SD | HB1054 | 0000-00-00 | Senate | Senate Local Government Do Pass | 6 | 0 |
| SD | HB1054 | 0000-00-00 | House | House of Representatives Do Pass | 67 | 2 |
| SD | HB1054 | 0000-00-00 | House | House Local Government Do Pass | 12 | 0 |
| SD | HB1054 | 0000-00-00 | Senate | Senate Do Pass | 34 | 0 |
| SD | SB175 | 0000-00-00 | Senate | Senate Local Government Do Pass | 3 | 2 |
| SD | SB175 | 0000-00-00 | Senate | Senate Local Government Report out of committee without reco | 4 | 1 |
| TN | HB1616 | 2024-02-20 | House | HOUSE LOCAL GOVERNMENT COMMITTEE: Rec. for pass; ref to Fina | 14 | 6 |
| TN | SB2631 | 2024-03-27 | Senate | SENATE STATE & LOCAL GOVERNMENT COMMITTEE: Failed in Senate  | 2 | 5 |
| UT | HB0262 | 2013-01-28 | House | House Comm - Favorable Recommendation | 7 | 0 |
| UT | HB0262 | 2013-02-01 | House | House/ passed 3rd reading | 63 | 0 |
| UT | HB0262 | 2013-02-06 | Senate | Senate Comm - Favorable Recommendation | 4 | 1 |
| UT | HB0262 | 2013-02-07 | Senate | Senate/ passed 2nd reading | 24 | 4 |
| UT | HB0262 | 2013-02-08 | Senate | Senate/ uncircled (Voice Vote) | 0 | 0 |
| UT | HB0262 | 2013-02-08 | Senate | Senate/ circled (Voice Vote) | 0 | 0 |
| UT | HB0262 | 2013-02-08 | Senate | Senate/ passed 3rd reading | 23 | 6 |
| VA | HJR541 | 2017-01-30 | House | House: Subcommittee recommends laying on the table (4-Y 3-N) | 4 | 3 |
| VA | HJR635 | 2017-01-30 | House | House: Subcommittee recommends laying on the table (4-Y 3-N) | 4 | 3 |
| VA | HB1129 | 2018-02-01 | House | House: Subcommittee recommends passing by indefinitely (5-Y  | 5 | 1 |
| VA | HB1056 | 2026-02-03 | House | Subcommittee recommends striking from the docket (8-Y 0-N) | 8 | 0 |
| WV | HB2438 | 2011-01-26 | House | Passage | 95 | 0 |
| WV | HB2438 | 2011-03-09 | House | Passage-senate Amended Hb | 99 | 0 |
| WY | SF0096 | 2011-01-25 | Senate | Motion to Do Pass Failed | 2 | 3 |
| WY | SF0077 | 2014-02-11 | Senate | S Failed Introduction | 8 | 22 |

## Appendix C — sitting legislators with the most record (60 of 774)

| State | Legislator | Party | Role | Sponsored | Yea | Nay |
|---|---|---|---|---|---|---|
| SC | Thomas Beach | R | Rep HD-010 | 10 | 0 | 0 |
| SC | Josiah Magnuson | R | Rep HD-038 | 9 | 0 | 0 |
| SC | Jay Kilmartin | R | Rep HD-085 | 8 | 0 | 0 |
| SC | James Burns | R | Rep HD-017 | 8 | 0 | 0 |
| US | Brian Fitzpatrick | R | Rep HD-PA-1 | 8 | 0 | 0 |
| SC | Rob Harris | R | Rep HD-036 | 8 | 0 | 0 |
| SC | Joe White | R | Rep HD-040 | 8 | 0 | 0 |
| NY | Robert Carroll | D | Rep HD-044 | 7 | 2 | 0 |
| SC | Dianne Mitchell | R | Rep HD-021 | 7 | 0 | 0 |
| MS | Stephen Horne | R | Rep HD-081 | 7 | 0 | 0 |
| SC | Jordan Pace | R | Rep HD-117 | 7 | 0 | 0 |
| SC | Sarita Edgerton | R | Rep HD-034 | 7 | 0 | 0 |
| NY | Albert Stirpe | D | Rep HD-127 | 6 | 1 | 0 |
| SC | Jackie Terribile | R | Rep HD-066 | 6 | 0 | 0 |
| SC | John Lastinger | R | Rep HD-088 | 6 | 0 | 0 |
| SC | Donald McCabe | R | Rep HD-096 | 5 | 0 | 0 |
| TX | Rafael Anchia | D | Rep HD-103 | 5 | 0 | 0 |
| SC | April Cromer | R | Rep HD-006 | 5 | 0 | 0 |
| SC | John Mccravy | R | Rep HD-013 | 5 | 0 | 0 |
| VA | Sam Rasoul | D | Rep HD-038 | 5 | 0 | 0 |
| SC | Chris Huff | R | Rep HD-028 | 5 | 0 | 0 |
| NY | Gustavo Rivera | D | Sen SD-033 | 4 | 1 | 0 |
| MD | Lily Qi | D | Rep HD-015 | 4 | 1 | 0 |
| SC | Alan Morgan | R | Rep HD-018 | 4 | 0 | 0 |
| NY | Jeffrey Dinowitz | D | Rep HD-081 | 3 | 3 | 0 |
| MA | Alice Peisch | D | Rep HD-14-NOR | 4 | 0 | 0 |
| SC | William Chumley | R | Rep HD-035 | 4 | 0 | 0 |
| AK | Scott Kawasaki | D | Rep SD-P | 4 | 0 | 0 |
| SC | Stephen Frank | R | Rep HD-020 | 4 | 0 | 0 |
| SC | Lee Gilreath | R | Rep HD-007 | 4 | 0 | 0 |
| NY | William Colton | D | Rep HD-047 | 3 | 2 | 0 |
| NY | Linda Rosenthal | D | Rep HD-067 | 3 | 1 | 0 |
| ME | William Pluecker | I | Rep HD-044 | 2 | 3 | 1 |
| NY | Jo Simon | D | Rep HD-052 | 3 | 1 | 0 |
| NY | Michael Benedetto | D | Rep HD-082 | 3 | 1 | 0 |
| LA | Francis Thompson | R | Rep HD-019 | 2 | 3 | 1 |
| NY | Harvey Epstein | D | Rep HD-074 | 3 | 0 | 0 |
| ME | Matthea Larsen Daughtry | D | Sen SD-023 | 1 | 2 | 4 |
| MS | Oscar Denton | D | Rep HD-055 | 3 | 0 | 0 |
| MD | Cheryl Kagan | D | Sen SD-017 | 3 | 0 | 0 |
| SC | Mark Willis | R | Rep HD-016 | 3 | 0 | 0 |
| VA | Bill Wiley | R | Rep HD-032 | 3 | 0 | 0 |
| HI | Chris Lee | D | Sen SD-025 | 3 | 0 | 0 |
| SC | James Teeple | R | Rep HD-116 | 3 | 0 | 0 |
| WV | Bill Hamilton | R | Sen SD-011 | 2 | 2 | 0 |
| MT | Greg Hertz | R | Sen SD-006 | 1 | 5 | 0 |
| ME | Nicole Grohoski | D | Sen SD-007 | 1 | 3 | 2 |
| ME | Joseph Baldacci | D | Sen SD-009 | 2 | 2 | 0 |
| MD | Chao Wu | D | Rep HD-009 | 2 | 1 | 0 |
| WY | Chris Rothfuss | D | Sen SD-009 | 2 | 1 | 0 |
| TN | Tim Rudd | R | Rep HD-034 | 2 | 1 | 0 |
| ME | Allison Hepler | D | Rep HD-049 | 1 | 2 | 2 |
| ME | Michele Meyer | D | Rep HD-150 | 1 | 2 | 2 |
| MD | Stuart Schmidt | R | Rep HD-033 | 2 | 1 | 0 |
| MD | Sheila Ruth | D | Rep HD-044 | 2 | 1 | 0 |
| SC | Adam Duncan | R | Rep HD-002 | 2 | 0 | 0 |
| SC | Phillip Bowers | R | Rep HD-003 | 2 | 0 | 0 |
| CT | Devin Carney | R | Rep HD-023 | 2 | 0 | 0 |
| SC | Greg Ford | R | Rep HD-098 | 2 | 0 | 0 |
| SC | Kathy Landing | R | Rep HD-080 | 2 | 0 | 0 |
