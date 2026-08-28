# FORM CHAT UI, lane 2 — what a full 21-section run surfaced

Worker: Opus. Lead: Fable (session "livingston"). **Run this AFTER lane 1
(`prompts/2026-08-27-form-chat-ui.md`) has reported** — both lanes edit
`ChatFormFields`, `ChatMessage`, `programs.ts`, `Chat.tsx`. If lane 1 has not
run yet, do lane 1 first in this same session, report it, then do this file.
Report by appending `## Report` to THIS file. Do not commit, push, or deploy.

Everything in lane 1's Setup section applies (build with `npx vite build`
only, no whole-project tsc, dev against `LIVINGSTON_API_ORIGIN=https://livingston-nysgpt.vercel.app`,
no UA spoofing, no subagents, plain copy).

**Screenshots for this lane: `.research/ui-refs/r2-*.png`** (numbered, named).
Look at all of them first. `r2-19`…`r2-21` are the NSR app's inline PDF
viewer — the pattern to reuse for item 11.

## Facts established by the run (don't rediscover)
- A full LDSS-2921 interview was completed in production with a test persona
  (peter parker, Islip Terrace). 72 answers recorded. The model's closing
  recap (`r2-16`, `r2-17`) described **Maria Rodriguez, 450 Amsterdam Ave,
  Miguel, Sofia** — none of it was entered. That is not a hard-coded sample
  in the code: it is the model fabricating after the real answers scrolled
  out of the 16-message history, seeded by the `applicant.firstName: Maria`
  example in `buildFormInterview`. Lane 1 item 12 (record in the prompt) is
  the root fix; items 10 and 11 below stop the model from ever writing a
  recap from memory again.
- The recap's `$800 biweekly … $1,200` rendered as KaTeX (`r2-16`):
  `remark-math` treats `$…$` as inline math. A benefits form is full of
  dollar amounts.
- Prose answers work: typing `No, no, no.` in the chat box for three
  yes/no fields was transcribed by the model into a `livingston-answers`
  block and harvested (`r2-05`). Only key/value pairs for known keys are
  recorded; anything else the user typed stays in the transcript. The
  weakness is that the extraction is invisible — the user cannot see or
  fix what was taken from their words.
- `shelter.type` has options `rent, mortgage, room, shelter, none`; the user
  typed `Staying with a relative.` (`r2-07`). What got recorded is unknown
  from the transcript — that is the problem.
- The model asked Section 23 as two separate questions, both headed
  `Section 23 — Other information` (`r2-10`), and the progress strip read
  `19 of 21 sections` at that moment. The catalogue has 21 non-consent
  sections numbered 1…23 with `2–5` merged and `9`, `notices`, `withdraw`
  consent-only, so "23" and "21" will never line up by number — and `done`
  lags because `#done` is only emitted when the model remembers.
- Section 9 (Certification) is `consent: true` and printed on page 5, so the
  model read it out after Section 23 as "READ-ONLY", with no control
  (`r2-10`, `r2-11`). The model itself invented `certification.agree: yes`
  in a later turn (`r2-29`) — adopt that key.
- On "yes, fill it out" the model replied that it *cannot fill the official
  form* (`r2-18`). It can't — the app does, via `fillForm` in
  `src/lib/fill-form.ts`, triggered today only by the "Put it on the form"
  button in `FormProgress`. The model must never be the thing that answers
  that request.
- `ChatMessage` has no `table/thead/tr/th/td` components; `remark-gfm` is
  loaded so tables parse but render unstyled.
- `ChatResponseFooter` already has an inline PDF panel (iframe, header row
  with "Open in new tab") used for preprints — same shape as `r2-21`.

## Work

### 1. The recap line: `Section 11: …` with a green check
Prompt: change "restate what you recorded in one short line" to: *Start that
line with `Section N:` (the number, a colon), then the summary. Not
"recorded".* Client: in `ChatMessage`'s `p` override, when a paragraph's text
starts with `/^Section\s+[\w–-]+:\s/` (colon, not an em dash — the em dash
form is a question heading), append lucide `<Check className="ml-1 inline h-4
w-4 text-green-600 dark:text-green-500" />` after the text. Nothing else about
the paragraph changes.

### 2. Send is "Send"
Drop the count from the button in `ChatFormFields` (`r2-01`). Keep the arrow.

### 3. Our own select, and Enter sends
No native `<select>` (`r2-03` is the OS menu). Add `@radix-ui/react-select`
(same family as our dialog/popover) and build `src/components/ui/select.tsx`:
trigger = today's input styling with a lucide `ChevronDown` that has **8px
right margin** (`r2-02` is flush); content = `rounded-md`, surface `background`
light / `#20201f` dark, 1px border, shadow `0 8px 24px rgba(0,0,0,.18)`
(`.45` dark), items `rounded-sm` with lucide `Check` on the selected one,
hover `muted`. Use it for every `kind: "select"`. Keyboard works for free.
**Enter submits**: in `ChatFormFields`, an Enter keydown in any text-like
input (not textarea, not while a select is open) submits when the Send button
is enabled. Tab order stays native (`r2-04` — the user liked Tab).

### 4. What we took from your words — derived chips under prose answers
When a user turn is prose (no answers block) and the **next** assistant turn
carries a `livingston-answers` block, render those pairs as chips **under
the user's bubble**, right-aligned, smaller, with a muted lead-in
`Recorded:` and a lucide `Check` — so the extraction is visible. Same chip
component as answers bubbles (labels via `labelFor`), and **editable through
the same pencil path** from lane 1 item 6: Save merges into the record and
(since there is no user answers block to rewrite) rewrites nothing in the
transcript; the RECORDED block (lane 1 item 12) carries the corrected value
to the model. Compute the chips in `Chat.tsx` from `messages[i+1]`, pass them
to `ChatMessage` as `derived`. Do not render them while the assistant turn
is still streaming.

### 5. Free text against a fixed list: `other` + detail, never coercion
Every enumerated key from lane 1 item 2 gets an `other` option, and a
companion free-text key `<key>Detail` (e.g. `shelter.typeDetail`). Prompt
rule under RECORDING: *When the user's words do not match one of a key's
fixed values, record `other` and put their words in `<key>Detail`. Never
pick the nearest value for them.* Then **align the enumerations with the
printed form**: read `.research/2921-text.json` pages 15–16 for Section 21
(and page 8 for income kinds, page 13 for resources, page 10–11 for
employment) and make the option lists match what is printed, in the printed
order, `value|Label` with the label in plain words. Report what
`shelter.type`'s options became. The adapter (`fill-form.ts`) already sends
unmapped keys to the appendix, so `Detail` values land there — confirm the
appendix `GROUPS` regexes still catch them.

### 6. Formatting: `$`, phone, email — display vs. storage
- `kind: "money"`: a `$` adornment inside the input on the left (not a
  placeholder — it stays when typing; `r2-09`), thousands separators as
  typed; **stored** as plain digits with optional `.dd`.
- `kind: "tel"`: mask to `(555) 555-5555` as typed; stored as 10 digits.
- `kind: "email"`: trim, lowercase the domain, show the invalid state (red
  hairline) only after blur; stored as typed.
- Add `displayValue(key, value)` beside `labelFor` in `programs.ts`: phone →
  `(555) 555-5555`, money → `$1,200`, ISO date → `mm/dd/yyyy`, everything
  else unchanged. Use it in chips, derived chips, the `FormProgress` record
  list, and the prefills when a collapsed question reopens (the input masks
  accept the formatted value). Storage stays as it is — `fill-form.ts`
  depends on digits and ISO.

### 7. Section numbering that a person can follow
- Prompt, under HOW TO RUN IT: *The first question of a section is headed
  `Section 17 — Employment.` Any further question in the same section is
  headed `Section 17, continued.` Never repeat the full heading.*
- Lane 1's collapsed row and square-menu enumerate questions within a
  section: `Section 23 · 1 of 2`, `Section 23 · 2 of 2` (count known
  questions for that section so far).
- Progress strip: compute `done` as `#done` **or** "every key that
  `KEY_SECTION` maps to this section has a value" — whichever is more — so
  it never lags the interview. Show it as `19 of 21 sections done` and, when
  a section is open, prefix with the printed number: `Section 23 · 19 of 21
  done`. The 21 vs 23 gap is real (merged 2–5, consent-only 9/notices/
  withdraw); the square-menu is where the user sees why. Also count the
  `vote` section the same way as the rest.

### 8. Certification is an attestation, asked last, in a caution box
- `programs.ts`: keep Section 9's `pages: [5]` but move it to the **end of
  the LDSS-2921 `sections` array**, after `vote`, and drop `consent: true`
  from it — it collects one answer. Give it `asks: ["Whether you agree to
  the certification — that what you told us is true and complete, that the
  district may verify it, and that you assign child-support rights while on
  assistance"]`. The catalogue comment about printed order gets one line
  saying why this section is the exception.
- New field kind `attest`: renders as its own box — 1px border
  `amber-400/60`, background `amber-50` (dark: `amber-950/30`, border
  `amber-500/40`), title `Attestation` (small caps, muted), the statement in
  body text, **Yes / No** as a radio, and a lucide `Info` button in the
  **top-right** that opens `href` in a new tab (`/forms/LDSS-2921.pdf#page=5`
  for the certification; the notices start at page 19). Add `href?: string`
  and `tone?: "caution" | "info"` to `ChatField`. Key `certification.agree`
  with options `yes|I agree` / `no|Not yet`. FORM_KEYS gets it.
- Prompt: the statement copy the model puts in `help` — give it this and
  tell it to use it verbatim: *By agreeing, you are saying that what you
  told us is true and complete as far as you know; that the district can
  check it with employers, banks, and agencies; that giving false
  information can mean losing benefits or being prosecuted; and that while
  you get assistance, child support owed to you is paid to the district.*
  Then *Do you agree?* — no "if you lie on this form".
- A "no" is allowed: the model says what happens (the application can be
  filed without the certification, but the district will need it before a
  decision) and moves on.

### 9. Voter registration: an info box, and an honest acknowledgment
- `tone: "info"` renders the same box shape in blue (`r2-13`: border
  `blue-500/50`, background `blue-50` / dark `blue-950/30`), title `Voter
  registration` with a lucide `Vote` icon — no emoji. The model sets
  `tone: "info"` on `voter.register`. Options stay as they are.
- On `yes`, the model must say — and the prompt must give it these facts,
  because they are the truth of how this works — that the NYS voter
  registration form is **pages 27–28 of this application**, that it is
  filed together with the application, and that the Board of Elections
  mails a confirmation notice once it is processed. Then continue to the
  next step. **It must not say we emailed anyone or that they are now
  registered** — we do neither. (Filling pages 27–28 themselves is in the
  round-3 field-mapping work; say in the report whether those pages have
  detectable boxes in `2921-checkboxes.json`.)

### 10. The review is rendered from the record, not remembered by the model
- Form mode drops `remarkMath`/`rehypeKatex` from `ChatMessage` (a prop, or
  a check on the form context) so `$800` is money. Keep them for the corpus
  chat.
- Add `table/thead/tbody/tr/th/td` components to `ChatMessage`: hairline
  rules, muted uppercase 11px header, cell padding `8px 12px`, full width,
  `overflow-x-auto` wrapper, row hover `muted/40`. A **copy icon appears
  top-right on hover** of the table (`Copy` → `Check` for 2s) and copies the
  table as tab-separated text.
- New block ```livingston-review``` (empty body). Prompt: *When every
  section is done, write one sentence, then a ```livingston-review``` block,
  then the closing question from item 11. Do not list the answers yourself.*
  Client: `ChatMessage` renders the block as a table built from the record
  — one row per section in interview order: `Section` · `What you told us`
  (values joined with ` · `, `displayValue`-formatted, `labelFor` labels,
  `skip`/`unknown` shown as `—`). Uses the same table components and copy
  icon. Chips in this table are read-only for now (editing here is parked).
- Change the prompt's example block from `Maria` / `2016-04-02` to
  placeholders that cannot be mistaken for data: `applicant.firstName:
  <first name>` / `household[1].dob: <YYYY-MM-DD>`.

### 11. "If you like, I will fill out LDSS-2921 for you" — and then actually do it
- Prompt: the closing question, verbatim: *If you like, I will now fill out
  the correct form (LDSS-2921) on your behalf.* asked as a fields block with
  key `form.fill`, `kind: "radio"`, options `yes|Yes, fill it out` /
  `no|Not yet`. FORM_KEYS gets `form.fill` with the note *this is an action,
  not an answer — the app fills the form when it is yes*. Also under HOW TO
  RUN IT: *You never fill, print, or submit anything yourself and you never
  say you cannot — the application fills the PDF the moment they say yes.
  If they ask you to fill it out, ask the `form.fill` question.*
- Client: when a submitted or harvested value is `form.fill: yes`,
  `Chat.tsx` runs `fillForm` (dynamic import as `FormProgress` does) with a
  spinner state, then appends a **client-rendered message** (a new message
  kind, not sent to the model: `role: "assistant", kind: "form-pdf"`,
  persisted like any other) that shows the inline PDF panel from
  `ChatResponseFooter` — header `LDSS-2921 · draft`, `Open in new tab`, an
  iframe on the blob URL — followed by `FormDelivery` underneath (same
  props `FormProgress` gives it). Spinner: a lucide `Loader2` row `Putting it
  on the form…` where the PDF will appear. Keep "Put it on the form" in the
  progress strip; both paths call the same code. Rebuilding replaces the
  panel's blob, not the message.
- Persisting a blob is not possible; on reload the `form-pdf` message
  rebuilds from the record on mount (cheap — it's client-side pdf-lib).

### 12. Markdown tables in the corpus chat
Item 10's table components apply everywhere `ChatMessage` renders; make sure
the corpus chat gets the same styling (it had none).

## Verify
- `npx vite build` clean; eslint clean on touched files.
- Fresh LDSS-2921 run in dev against production functions, through at least
  Sections 1, 3, 15, 21, 23, certification, vote, and the closing: recap
  lines carry the green check; Send says Send; selects are ours with the
  chevron inset and Enter sends; a prose answer shows `Recorded:` chips
  under the bubble; `Staying with a relative` lands as `other` + detail;
  money shows `$`, phone masks; a second question in a section says
  `continued`; the progress count does not lag; the certification box is
  amber with Yes/No and the ⓘ opens page 5; the voter box is blue and the
  acknowledgment says pages 27–28 / Board of Elections and nothing about
  email; the review is a table with the real persona and a working copy
  icon; `$800` is not math; answering Yes to the fill question shows the
  spinner then the inline PDF with the three delivery buttons; reload and
  the PDF panel comes back.
- Do not test email delivery — the Resend sender is the sandbox domain and
  the 403 is known (parked).

## Report
(Append below. Facts, no adjectives.)

- Files changed:
- Item 1 — prompt wording; regex; where the check renders:
- Item 3 — dependency; Enter-to-send rule as implemented:
- Item 4 — how derived chips are computed; edit path verified:
- Item 5 — final `shelter.type` options; other enumerations changed:
- Item 6 — masks; `displayValue` cases; any storage change (should be none):
- Item 7 — progress formula; what the strip reads mid-form:
- Item 8 — section order change; attestation copy used:
- Item 9 — acknowledgment text the model produced; are pages 27–28 boxes detectable:
- Item 10 — review table source; math plugins scoped how:
- Item 11 — `form-pdf` message shape; reload behaviour:
- Build result:
- What you verified visually vs. in the built output:
- Open items / disagreements:
