# FORMS RAIL — standardise Brendan's dev-tools mock

Worker: Opus. Lead: Fable (session "livingston"). **Run after lanes 1 and 2**
(`prompts/2026-08-27-form-chat-ui.md`, `…-ui-2.md`) — this touches
`programs.ts`, which both of them edit. Report by appending `## Report` to
THIS file. Do not commit, push, or deploy. Lane 1's Setup rules apply.

**The spec is one screenshot: `.research/ui-refs/r3-01-forms-rail-mock.png`.**
Brendan edited the live rail in dev tools to show what he wants; nothing of
it is in code. Match it, and where the note below says "better way", do the
better way.

## What's in the mock, against what the code does today
Files: `src/components/ResearchFeed/FormsList.tsx`, `src/components/FormCard.tsx`,
`src/components/ResearchFeed/ResearchFeed.tsx` (header label),
`src/lib/programs.ts` (the data), `src/components/ProgramGridCard.tsx`
(the `/programs` grid reads the same data — it picks up name/minutes/blurb
changes for free; leave its layout alone).

| Mock | Today | Change |
| --- | --- | --- |
| Panel header `OFFICIAL FORMS` with the green live dot | `Grants & Benefits` | Label → `Official forms` (the header component uppercases). Dot stays. |
| Intro: *Drag one onto the chat. Penny fills the applications in with you, and talks the rest through.* | same sentence with "livingston" | Penny. |
| One list under `LET'S FILL IT IN TOGETHER` | two lists: `Fill it in together` / `Other help you may qualify for` | One heading, one list — Brendan folded them together. |
| Card title is a **name**: `Public Assistance`, `Childcare Assistance`, `Earned Income Tax Credit`, `HEAP` | `form.code` (`LDSS-2921`, `OCFS-6025`, `EITC`, `HEAP`) | Add `name: string` to `ProgramForm` — the short human name for cards. `code` stays for the ribbon, the PDF, the detail panel, citations. Names for the rest: use `code` where it already is a name (`SNAP`, `WIC`, `HEAP`, `WAP`, `EPIC`, `HIICAP`, `Medicaid`, `Head Start`, `Veterans`, `NY Connects`), and plain names elsewhere (`Medicare Savings`, `SSI / SSP`, `School Meals`, `Senior Meals`, `SNAP-Ed`, `Victim Services`, `Uninsured Care`). |
| Header right: minutes on **every** card (`30 min`, `15 min`, `15 min`, `10 min`) | `how to apply` on guide cards | Minutes everywhere. Data: LDSS-2921 **30** (was 40), OCFS-6025 15, EITC **15** (was 10), HEAP **10** (was 15). Leave the others. |
| Body: blurb + doc icon, then chips. Nothing else. | blurb, chips, pages/sections line, "Drag onto the chat…" line, phone number | Delete the pages/sections line, the drag hint, and the phone from the card (the detail panel keeps them). |
| EITC blurb `Money back at tax time.` | `Money back at tax time if you worked — federal, state and city credits.` | Shorten as shown. Other blurbs unchanged. |
| Chips: at most **two lines**, then `+N` | `slice(0, 4)` + `+N` | Measure, don't slice: render all chips, then with a `ResizeObserver`/layout effect hide every chip whose `offsetTop` puts it past line 2 and show `+N` for the hidden count (the `+N` chip itself must fit on line 2 — re-check after inserting it). |
| Order: Public Assistance, Childcare Assistance, Earned Income Tax Credit, HEAP, then the rest | fillable first, then guides in `GUIDES` order | Add a `RAIL_ORDER` (ids) in `programs.ts`: `ldss-2921, ocfs-6025, eitc, heap`, then the remaining ids in their current order. Export `railForms()` that applies it; `FormsList` uses it. The `/programs` grid keeps its own ordering. |
| Uniform card height (Brendan added 48px above the chips) | content-height cards | **Better way:** make the card body a fixed-height column — `flex flex-col` with a fixed `h-[…]` sized to hold a 3-line blurb, a 48px gap, and two chip rows (measure against the mock: body ≈ 5.0× the header strip's height); blurb `line-clamp-3`; chips `mt-auto` pinned to the bottom. Every card is then the same height by construction, and the 48px becomes the *minimum* gap, not a magic number. Report the height you settled on. |
| — | — | **Hover tilt:** `hover:-rotate-6 hover:scale-[1.02] hover:shadow-lg hover:z-10 transition-transform duration-200 ease-out` (counter-clockwise is negative rotate in CSS; 6° is inside Brendan's 5–15° range and reads as "pick me up" without knocking into neighbours). `transform-origin: center`. `motion-reduce:transform-none`. Keep the tilt while grabbing (`active:` no reset) — it reads as lifting. Check the drag image still looks right with the transform applied at drag start; if Chrome snapshots the rotated card badly, reset the rotate on `active:` and say so. |

Chip style, header strip, grip, and the doc icon stay as they are.

## Verify
- `npx vite build` clean; eslint clean on touched files.
- Open the rail in dev: header reads Official forms with the dot; one list;
  first four cards in the mock's order with the mock's names, minutes and
  blurbs; every card the same height; the 6-cover card shows chips on two
  lines with `+N` and none clipped; hover tilts and lifts; drag onto the
  chat still enters form mode with the ribbon reading `LDSS-2921` (the
  code, not the name); the `/programs` grid still renders.

## Report
- Files changed:
- Body height chosen and how it was derived:
- Chip measurement approach; the `+N` re-fit case:
- Names given to every card (list):
- Drag image with the tilt — fine, or reset on active?
- Build result:
- What you verified visually vs. in the built output:
- Open items:

Worker: Fable (lead session), 2026-08-28 ~03:30. Done directly on Brendan's instruction. Not verified in a browser.

- Files changed: `src/lib/programs.ts` (`name`, minutes, EITC blurb, `railForms()`), `src/lib/form-entity.ts` (new — `formEntity` moved out of the component file for the fast-refresh lint rule), `src/components/FormCard.tsx` (rewritten), `src/components/ResearchFeed/FormsList.tsx`, `src/components/ResearchFeed/ResearchFeed.tsx`, `src/layouts/AppLayout.tsx` (hint label), `src/components/ProgramGridCard.tsx` (title shows `name`, imports `formEntity` from lib).
- Body height chosen and how it was derived: `h-[174px]` — 12px padding + three lines of 13px/snug blurb (≈54) + a 48px minimum gap (`min-h-12 flex-1`) + two chip rows (2×22 + 4 gap) + 12px padding. The mock's body reads ≈170px at 1×. Blurb `line-clamp-3`, chips pinned with the flex spacer.
- Chip measurement approach; the `+N` re-fit case: every chip is rendered plus a hidden `+N` span; a layout effect hides chips from the end until nothing — the `+N` included — sits on a third row (row = offsetTop step). Pure DOM, no state, so no render loop; re-run only when the container's WIDTH changes (a ResizeObserver that ignores height changes, which the hiding itself causes).
- Names given to every card: Public Assistance (LDSS-2921), Childcare Assistance (OCFS-6025), Earned Income Tax Credit (EITC), Uninsured Care (ADAP), SSI / SSP; every other guide's code already reads as a name (SNAP, HEAP, WAP, WIC, School Meals, Medicaid, EPIC, NY Connects, Veterans, Medicare Savings, HIICAP, Senior Meals, SNAP-Ed, Victim Services, Head Start) and is used as-is. Minutes: LDSS-2921 30, EITC 15, HEAP 10. EITC blurb `Money back at tax time.` Header `Official forms`; intro says Penny; one list under `Let's fill it in together`; minutes on every card; pages/sections line, drag hint and phone number removed from the card.
- Drag image with the tilt — fine, or reset on active? Not observed (no browser run). The tilt is kept on `active:`; if Chrome's snapshot of the rotated card looks wrong, add `active:rotate-0`.
- Build result: `npx vite build` clean; eslint clean.
- What you verified visually vs. in the built output: `railForms()` order checked in node: Public Assistance, Childcare Assistance, Earned Income Tax Credit, HEAP, SNAP, …
- Open items: the tilt is `-rotate-6` (6°, inside 5–15°).
