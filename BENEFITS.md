# sam — benefits assistance

What sam is becoming: drag a benefits application into the chat and the
conversation fills it in with you, then hands you the PDF.

This is the design and the state of it. `REPORT.md` covers the fork from cshl;
`.research/FINDINGS.md` covers the NY screener walk and the PDF teardown.

---

## The shape

**One household profile, many forms.** New York asks the same forty-seven
things and then evaluates them against two dozen programmes. So the profile is
the spine, and each form is an *adapter* onto it — the pattern from the Jobright
teardown (`~/.claude/…/memory/project_tariffsgpt_jobright_extension.md`): a
stored profile mapped onto known form schemas, with the model used only for the
free text and the explaining. Adding a form is writing an adapter, not
rebuilding the interview.

```
  rail card ──drag──▶ chat input ──▶ form mode ──▶ interview
                                                      │
                                       inline fields ─┤─ chat box
                                                      ▼
                                              sam-answers block
                                                      │
                                              FormAnswers (localStorage)
                                                      │
                                           adapter ───┴──▶ filled PDF
                                                              │
                                          download · email me · send for me
```

## Files

| | |
| --- | --- |
| `src/lib/programs.ts` | The catalog. Every form's printed sections in printed order, the answer vocabulary (`FORM_KEYS`), and `buildFormInterview` — the system prompt that turns the chat into a given form. |
| `src/lib/form-fields.ts` | The `sam-fields` block: the assistant asking with real controls. |
| `src/lib/form-answers.ts` | The `sam-answers` block, the record, and persistence. |
| `src/lib/fill-form.ts` | The adapters. Vocabulary → each form's own field schema. |
| `src/components/ChatFormFields.tsx` | Those controls, rendered in the transcript. |
| `src/components/FormProgress.tsx` | What is recorded so far; builds the PDF. |
| `src/components/FormDelivery.tsx` | Download · email me · send it for me. |
| `src/components/FormCard.tsx` | The draggable card. |
| `src/components/ResearchFeed/FormsList.tsx` | The Grants & Benefits rail. |
| `api/chat.ts` | Form mode — skips corpus retrieval entirely. |
| `api/send-application.ts` | Resend delivery, `self` and `office` modes. |

## Two block formats, and why

The assistant asks with **`sam-fields`** — a JSON array rendered as real inputs
inside its own message. Whatever the user types there *is* the value; there is
no round trip through the model to transcribe it, so there is no transcription
drift on a Social Security number or a dollar figure.

Everything comes back as **`sam-answers`** — `key: value` lines. The assistant
emits it when it learns something in conversation; the inline form's submit
button sends the same block as the user's turn. One parser harvests both
directions. Neither block is ever rendered as prose.

Answering in the chat box always works and is offered every time. Some things
are easier to just say.

## The two forms

**LDSS-2921** (28pp) ships **no AcroForm layer at all** — `/AcroForm` present,
zero `/Widget` annotations. It is not a scan though: 31 embedded fonts and 2,671
positioned text items, so coordinates come from the text layer and no OCR is
needed. Each checkbox is a single dingbat glyph, which makes all 176 of them
locatable exactly.

Currently written: the Section 1 programme boxes, the page 2 triage flags
(eviction, shutoff, no food, no income, domestic violence, and twelve more), and
the language boxes — all at coordinates read off the printed glyphs. Everything
else is appended as an ordered answer record.

**That appendix is deliberate.** Until every one of the 1,775 field positions is
confirmed by hand, a caseworker holding a complete ordered list of answers is
better off than one holding a form with values guessed into boxes — and nothing
is ever silently written into the wrong box, which is the failure that would
actually cost someone their benefits.

**OCFS-6025** (5pp) arrives with 429 semantically named fields, so it is filled
properly: name, address, phone split across three boxes, language, the
eight-person household roster, and each kind of income onto its own
yes/who/amount row.

## Sending it

Three doors: download, email it to yourself, or have sam email the county.

The third acts for someone else, so it requires `confirm: true`, always copies
the applicant, and states in the body that most districts still require a signed
original. **It puts paperwork in front of a caseworker; it does not file an
application**, and the UI says so rather than implying otherwise.

## Verified

End to end, through the browser, against the real code path:

- Drag LDSS-2921 → ribbon appends above the input, placeholder becomes
  "Answering LDSS-2921…", form mode skips corpus retrieval.
- First turn renders the eight programme chips as controls; submitting records
  the answer and chip-renders it in the transcript.
- Next turn asks language as two selects and a yes/no.
- Progress strip counts answers and sections; "Put it on the form" builds the
  PDF; all three delivery doors appear.
- A reload re-attaches the form and restores the progress strip.
- Filled PDF: 8 boxes ticked on page 2 from a test household, Section 3
  applicant block written, Section 6 roster written across 8 rows × 5 columns,
  answers appended as page 29. A box implied twice is ticked once.

## What is not done

- **The LDSS-2921 text fields.** 1,599 write-in cells located and named
  positionally (`p07_r420_c056`), none mapped to vocabulary. This is the biggest
  remaining piece. `.research/2921-fillable.pdf` has the generated field layer;
  `-check.pdf` tints them so placement can be eyeballed. Page 4 (268 fields) is
  over-detected from nested grid paths and is the worst case.
- **Server-side answers.** localStorage only. Needs a database that is *not* the
  shared cshl one — see `REPORT.md` §5; sam must never migrate that schema.
- **More forms.** `otda.ny.gov` resets connections from here and
  `health.ny.gov` returns 403, so the PDFs have to be supplied by hand.
  LDSS-4826 (SNAP), LDSS-3421 (HEAP), DOH-4220 (Medicaid) are the next three.
- **Susie** — an agent that emails the office and keeps asking until the
  applicant gets an answer. Parked deliberately.
- **`RESEND_API_KEY` is not set**, so the two email doors return "Email isn't
  configured yet". Download works. Set the key and the from-address and both
  light up.

## Bedrock

sam has its own IAM user, **`sam-bedrock-invoke`**, with a service-specific
Bedrock credential. Its own identity on purpose: the policy allows
`CallWithBearerToken` plus Invoke/Converse on anthropic foundation models and
this account's `us.anthropic.*` inference profiles, and nothing else, so a leak
here cannot reach the rest of the account.

**Vercel reserves every `AWS_*` name**, so `AWS_BEARER_TOKEN_BEDROCK` can never
be set there. The variable to set is **`BEDROCK_API_KEY`** (plus
`BEDROCK_REGION`); `api/chat.ts` copies it into the SDK's bearer variable
in-process at call time. Same pattern as tariffs, leuk and cshl.

Verified in production: `/programs` → hand LDSS-2921 into chat → it answers from
Bedrock, renders the eight programme chips as controls, records the answer, and
carries no corpus footer.

## Working on the NY sites

They reset automated clients. Two rules make it work, both learned the hard way:

1. **Never override the User-Agent on a real browser.** A spoofed UA contradicts
   Chrome's client hints and TLS fingerprint and the connection is reset. With
   `channel: "chrome"` and no override, all of {chromium, chrome} ×
   {headless, headed} return 200.
2. **Pace it.** ~6–11s between actions. Restarting a wizard six times in two
   minutes trips a rate limit that takes hours to clear.

Cloud egress does not help — Vercel and AWS ranges are refused outright. There
is an allowlisted, key-gated proxy at `.research/egress/` for the hosts that do
permit it; it is not needed for mybenefits.
