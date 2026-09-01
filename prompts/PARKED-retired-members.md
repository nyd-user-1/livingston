# PARKED — "(Ret.)" for former members, across every surface

**Brendan, 2026-09-01:** *"Add a '(Ret.)' after members who are not sitting
members of their respective body. Honestly that needs to be applied across all
sessions and all jurisdictions, which is a bigger request than I initially
anticipated."*

**Done already (lead, govblock `76757c0`):** search — the ⌘K menu and /search
render `(Ret.)` after any member not on a current roster. The definition used,
and the one to keep: `exists (select 1 from "SessionPeople" sp where
sp.people_id = p.people_id)` — `"SessionPeople"` holds only each
jurisdiction's current-session roster (roster-sync, livingston `c5c8806`), so
existence there is "sitting now" in any jurisdiction, and its absence is the
label.

**The remaining pass, when a UI lane reopens:** every surface that prints a
member's name states it — the directory (which already grey-dots `active`;
the dot stays, the label is added to the name), the member page header
(`/docs/directory/[id]`), sponsor and cosponsor lists on bill pages, the vote
boards' tooltips if they name members, top-sponsors cards, and anything lane P
built that renders `memberHref`. One definition, one helper (a
`memberDisplayName(name, active)` or a `<MemberName>` that every call site
uses), so the label cannot drift. Watch the two traps: `getMembers` already
computes `active` per (state, session) — for *historical* session views the
right label is still "not sitting **now**", not "not sitting then"; and
LegiScan committee-rows in `"People"` (`committee_id is not null`) must never
get the label because they are not people.
