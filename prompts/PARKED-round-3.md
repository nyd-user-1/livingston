# Parked for round 3 — Brendan's "SAVE THIS ENTIRE SECTION FOR THE NEXT ROUND"

Not in lane 1 or lane 2. Do not work these until Brendan opens the round.
Screenshots: `.research/ui-refs/r2-22` … `r2-29`.

1. **The filled PDF is the bare minimum** (`r2-24`). "Put it on the form"
   ticks Section 1 boxes, page-2 triage flags, language, the Section 3
   applicant block and the Section 6 roster; everything else goes to the
   appended answers page. The 1,599 write-in cells are located
   (`.research/2921-field-map.json`, `2921-fillable.pdf`) but not mapped to
   vocabulary. Page 4 is over-detected. Also visible in `r2-24`: the phone
   was written twice over itself in the PHONE NUMBER cell (`555` and
   `555-5555` overlap the printed AREA CODE label) — a coordinate bug in
   `APPLICANT.phoneArea/phoneRest`.
2. **"Email it to me" → `Email provider refused it (403)`** (`r2-25`). Cause,
   already documented in BENEFITS.md: the sender is Resend's sandbox
   `onboarding@resend.dev`, which only delivers to the Resend account
   owner's verified address; `brendan.stanton@gmail.com` is not it. Fix is
   in Resend (add and verify a domain, set `RESEND_FROM_EMAIL`), not code.
3. **Signing.** "Send it for me" says a signed original is still required
   (`r2-26`). An e-signature step is wanted. Brendan: the preferred prior
   solution is in **leuk** (`~/Code/leuk/lib/signnow.ts` — SignNow, not
   DocuSeal); tariffs has its own (`src/components/sign/SignForm.tsx`,
   `src/lib/sign/db.ts`). Deferred entirely — do not scope.
4. **The record table** (`r2-27`…`r2-29`, the expandable list in
   `FormProgress`): "these should be editable fields, or maybe not" — to
   discuss. Related: the review table from lane 2 item 10 is read-only for
   the same reason.
