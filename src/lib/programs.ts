/**
 * The forms sam can walk you through.
 *
 * A program card is a form plus the interview that fills it. The card is the
 * drag unit: drop it on the chat input and the conversation becomes that form's
 * UI — one section at a time, plain questions, answers collected and then
 * written into the real PDF.
 *
 * Sections here mirror the printed form exactly, in printed order, so a user
 * who has the paper in front of them is never lost. `asks` is what the section
 * actually collects — it is the prompt for the interview, not a schema; the
 * field-level mapping lives in the form's field map.
 */

export interface FormSection {
  /** Section number as printed on the form ("1", "17"), or a slug for unnumbered parts. */
  n: string;
  title: string;
  /** Pages of the PDF this section covers. */
  pages: number[];
  /** What this section collects, in the order the form asks. */
  asks: string[];
  /** Sections that are consent text rather than questions — read, not filled. */
  consent?: boolean;
}

export interface ProgramForm {
  /** Stable id, used as the drag payload id. */
  id: string;
  /** Official form number. */
  code: string;
  title: string;
  /** One line a person understands. */
  blurb: string;
  /** The programs this one form applies for. */
  covers: string[];
  agency: string;
  revision: string;
  pages: number;
  /** Honest estimate, said the way a person would say it. */
  minutes: number;
  /** The blank form, served from public/. */
  pdf: string;
  sections: FormSection[];
}

/* ------------------------------------------------------------------ */
/*  LDSS-2921 — the Common Application                                 */
/* ------------------------------------------------------------------ */

const LDSS_2921: ProgramForm = {
  id: "ldss-2921",
  code: "LDSS-2921",
  title: "New York State Application for Certain Benefits and Services",
  blurb: "One application for food, cash, medical, heating and child care help.",
  covers: [
    "Public Assistance (PA)",
    "SNAP",
    "Medicaid",
    "Child Care Assistance",
    "Services incl. Foster Care",
    "Emergency Assistance",
  ],
  agency: "NYS Office of Temporary and Disability Assistance",
  revision: "07/23",
  pages: 28,
  minutes: 40,
  pdf: "/forms/LDSS-2921.pdf",
  sections: [
    { n: "1", title: "Programs you are applying for", pages: [2], asks: [
      "Which programs you want: Public Assistance, Child Care in lieu of PA, SNAP, Medicaid + SNAP, Medicaid + PA, Services including Foster Care, Child Care Assistance, Emergency Assistance only",
    ] },
    { n: "2–5", title: "Language, and anything urgent", pages: [2], asks: [
      "The language you read and speak, and whether you want an interpreter",
      "Whether any of these apply: pregnant, victim of domestic violence, need to establish parentage, need child support",
    ] },
    { n: "3", title: "About you", pages: [2], asks: [
      "Name, address, mailing address, phone, email, date of birth, Social Security number",
    ] },
    { n: "6", title: "Everyone in your home", pages: [3], asks: [
      "For each person: name, date of birth, sex, Social Security number, relationship to you",
      "Whether each person buys food or prepares meals with you",
    ] },
    { n: "7", title: "Race and ethnicity", pages: [4], asks: [
      "Optional, and it does not affect the decision — race and ethnicity for each person",
    ] },
    { n: "8", title: "Citizenship and immigration status", pages: [5], asks: [
      "Citizenship or immigration status for each person applying",
    ] },
    { n: "9", title: "Certification", pages: [5], asks: ["Your signature and the date"], consent: true },
    { n: "10", title: "Child support referral", pages: [6], asks: [
      "Whether a parent is absent from the home, and details for a child support referral",
    ] },
    { n: "11", title: "Tax filing and dependents", pages: [7], asks: [
      "Whether you file taxes, and who you claim as a dependent",
    ] },
    { n: "12", title: "Absent or deceased spouse", pages: [7], asks: ["Details if a spouse is absent or has died"] },
    { n: "13", title: "Absent child", pages: [7], asks: ["Details if a child lives elsewhere"] },
    { n: "14", title: "Teen parent", pages: [7], asks: ["Details if a parent in the home is a teenager"] },
    { n: "15", title: "Income", pages: [8], asks: [
      "Every kind of money coming in, per person: job, self-employment, Social Security, SSI, pensions, child support, unemployment, workers' comp, veterans' benefits, rental income, interest, alimony, student aid, help from friends or relatives, roomers or boarders",
    ] },
    { n: "16", title: "Stepparent / sponsor income", pages: [9], asks: [
      "Income of a stepparent or an immigration sponsor, if that applies",
    ] },
    { n: "17", title: "Employment", pages: [10, 11], asks: [
      "Whether you are employed, and where; if not, when you last worked and why it ended",
      "Whether you are looking for work, in training, or unable to work",
    ] },
    { n: "18", title: "Education and training", pages: [12], asks: [
      "Highest grade completed, and any school or training you are in now",
    ] },
    { n: "19", title: "Resources", pages: [13], asks: [
      "Savings and checking, cash, stocks and bonds, CDs, trust funds, 401k, life insurance cash value, vehicles, property other than your home, burial funds",
    ] },
    { n: "20", title: "Medical", pages: [14, 15], asks: [
      "Health insurance you have now, medical bills, and anyone who is pregnant, disabled or needs long-term care",
      "Medical expenses in the last three months, if you want retroactive Medicaid",
    ] },
    { n: "21", title: "Where you live and what it costs", pages: [15, 16], asks: [
      "Rent or mortgage, who you pay it to, and whether heat is included",
      "Heating and utility costs, and whether you have had a shut-off notice",
    ] },
    { n: "22", title: "Other expenses", pages: [16], asks: [
      "Child care or dependent care you pay for, child support you pay, and other regular bills",
    ] },
    { n: "23", title: "Other information", pages: [17, 18], asks: [
      "Anything bought or sold recently, strikes, prior benefits or disqualifications, veteran status, and whether you have applied in another county",
    ] },
    { n: "notices", title: "Notices, rights and consents", pages: [19, 20, 21, 22, 23, 24], consent: true, asks: [
      "Nothing to fill in. Seven pages of legal notices — how your Social Security number is used, consent to investigation, the penalties for lying, assignment of support rights, and the Early Intervention release. sam can explain any of it in plain language.",
    ] },
    { n: "withdraw", title: "Withdrawing an application", pages: [25], consent: true, asks: [
      "Only if you want to withdraw an application for one or more programs",
    ] },
    { n: "vote", title: "Voter registration", pages: [27, 28], asks: [
      "Optional — a voter registration form that rides along with the application",
    ] },
  ],
};


/* ------------------------------------------------------------------ */
/*  OCFS-6025 — Child Care Assistance                                  */
/* ------------------------------------------------------------------ */

const OCFS_6025: ProgramForm = {
  id: "ocfs-6025",
  code: "OCFS-6025",
  title: "New York State Application for Child Care Assistance",
  blurb: "Help paying for child care while you work, study or look for work.",
  covers: ["Child Care Assistance Program (CCAP)"],
  agency: "NYS Office of Children and Family Services",
  revision: "current",
  pages: 5,
  minutes: 15,
  pdf: "/forms/OCFS-6025.pdf",
  sections: [
    { n: "1", title: "About you", pages: [1], asks: [
      "Name, address, phone, email, and how you would rather be contacted",
      "The language you read and speak",
    ] },
    { n: "2", title: "Everyone in your home", pages: [1, 2], asks: [
      "For each person: name, date of birth, sex, Social Security number, relationship to you",
      "Which children need care, and whether any has special needs",
    ] },
    { n: "3", title: "Why you need care", pages: [2, 3], asks: [
      "Whether you are working, looking for work, in training, or in college — and your schedule",
      "Other reasons care is needed: homelessness, domestic violence, disability, a treatment programme",
    ] },
    { n: "4", title: "Income", pages: [3, 4], asks: [
      "Every kind of money coming in: work, child support, disability, pensions, alimony, public assistance, interest",
    ] },
    { n: "5", title: "Other benefits", pages: [4], asks: [
      "Whether anyone gets SNAP, Medicaid, TANF, HEAP, WIC, Head Start or housing help",
    ] },
    { n: "6", title: "Signing it", pages: [5], consent: true, asks: [
      "What you are attesting to, and your signature",
    ] },
  ],
};

export const FORMS: ProgramForm[] = [LDSS_2921, OCFS_6025];

export const formById = (id: string): ProgramForm | undefined => FORMS.find((f) => f.id === id);

/** Pages that collect answers, vs. pages that are only text to read. */
export function formStats(f: ProgramForm) {
  const consentPages = new Set(f.sections.filter((s) => s.consent).flatMap((s) => s.pages));
  const askPages = new Set(f.sections.filter((s) => !s.consent).flatMap((s) => s.pages));
  for (const p of askPages) consentPages.delete(p);
  return {
    questionSections: f.sections.filter((s) => !s.consent).length,
    readingPages: consentPages.size,
  };
}

/* ------------------------------------------------------------------ */
/*  The vocabulary the interview speaks                                */
/* ------------------------------------------------------------------ */

/**
 * The keys the model may emit. Deliberately the form's own vocabulary rather
 * than PDF field names — the PDF's field layer can be re-cut without
 * invalidating an answer someone already gave. `n` in a bracket is 1-based and
 * matches the roster order the user gave.
 */
export const FORM_KEYS: { key: string; what: string }[] = [
  { key: "programs", what: "comma-separated from: PA, ChildCareInLieuOfPA, SNAP, MedicaidAndSNAP, MedicaidAndPA, Services, ChildCare, Emergency" },
  { key: "language.read", what: "language they read" },
  { key: "language.speak", what: "language they speak" },
  { key: "interpreter", what: "yes or no" },
  { key: "urgent", what: "comma-separated, any of: pregnant, domesticViolence, establishParentage, needChildSupport, drugAlcohol, utilityShutoff, homeless, fireOrDisaster, noIncome, seriousMedical, pendingEviction, noFood, needFosterCare, needChildCare, problemsWithEnglish, reasonableAccommodations, other, none" },
  { key: "applicant.firstName", what: "first name" },
  { key: "applicant.middleInitial", what: "middle initial" },
  { key: "applicant.lastName", what: "last name" },
  { key: "applicant.dob", what: "date of birth, YYYY-MM-DD" },
  { key: "applicant.ssn", what: "Social Security number, digits only — only if freely given" },
  { key: "applicant.sex", what: "M, F or X" },
  { key: "applicant.phone", what: "phone, digits only" },
  { key: "applicant.email", what: "email" },
  { key: "address.street", what: "street address" },
  { key: "address.apt", what: "apartment" },
  { key: "address.city", what: "city" },
  { key: "address.state", what: "two-letter state" },
  { key: "address.zip", what: "ZIP" },
  { key: "address.county", what: "county" },
  { key: "mailing.same", what: "yes if mailing address is the same" },
  { key: "household.count", what: "how many people live there, including them" },
  { key: "household[n].firstName", what: "each other person's first name" },
  { key: "household[n].lastName", what: "last name" },
  { key: "household[n].dob", what: "date of birth, YYYY-MM-DD" },
  { key: "household[n].sex", what: "M, F or X" },
  { key: "household[n].ssn", what: "SSN, digits only — only if freely given" },
  { key: "household[n].relationship", what: "relationship to the applicant" },
  { key: "household[n].buysFoodTogether", what: "yes or no" },
  { key: "household[n].citizenship", what: "citizen, qualified non-citizen, or other" },
  { key: "income[n].source", what: "kind of income, e.g. job, SSI, SocialSecurity, childSupport" },
  { key: "income[n].who", what: "whose income it is" },
  { key: "income[n].amount", what: "amount in dollars" },
  { key: "income[n].period", what: "weekly, biweekly, monthly or yearly" },
  { key: "employment.status", what: "employed, unemployed, self-employed, unable to work" },
  { key: "employment.employer", what: "employer name" },
  { key: "employment.lastWorked", what: "when they last worked" },
  { key: "education.highestGrade", what: "highest grade or degree completed" },
  { key: "resources[n].kind", what: "savings, checking, cash, vehicle, property, life insurance, other" },
  { key: "resources[n].value", what: "value in dollars" },
  { key: "medical.insurance", what: "current health insurance, or none" },
  { key: "medical.pregnant", what: "who is pregnant, or no" },
  { key: "medical.disabled", what: "who is disabled, or no" },
  { key: "shelter.type", what: "rent, mortgage, room, shelter, or none" },
  { key: "shelter.amount", what: "monthly rent or mortgage in dollars" },
  { key: "shelter.heatIncluded", what: "yes or no" },
  { key: "utilities.heatCost", what: "monthly heating cost in dollars" },
  { key: "utilities.shutoffNotice", what: "yes or no" },
  { key: "expenses.childCare", what: "monthly child or dependent care paid" },
  { key: "expenses.childSupportPaid", what: "monthly child support they pay out" },
  { key: "other.veteran", what: "yes or no" },
  { key: "other.appliedElsewhere", what: "yes or no — applied in another county recently" },
  { key: "voter.register", what: "yes, no, or already registered" },
];

/* ------------------------------------------------------------------ */
/*  The interview                                                      */
/* ------------------------------------------------------------------ */

/**
 * The system prompt that turns the chat into this form's interface.
 * Built here, carried on the drag payload, and sent as-is by /api/chat in
 * form mode — no corpus retrieval, nothing else competing with it.
 */
export function buildFormInterview(f: ProgramForm): string {
  const stats = formStats(f);
  return [
    `You are sam, filling out ${f.code} with the user, one section at a time.`,
    `You are not advising and not deciding anything — you are the form's interface.`,
    "",
    `${f.code} — ${f.title}`,
    `${f.agency}, rev. ${f.revision}. ${f.pages} pages: ${stats.questionSections} sections that ask questions and ${stats.readingPages} pages that are only notices to read.`,
    `It applies for: ${f.covers.join(", ")}.`,
    "",
    "HOW TO RUN IT",
    "- Work through the sections in the order listed. Open by saying what the form is, roughly how long it takes, and that they can stop any time and come back.",
    "- Ask two or three plain questions at a time. Never paste a section wholesale, never use the form's bureaucratic wording when ordinary words will do.",
    "- Say where you are: \"Section 6 of 21 — the people in your home.\"",
    "- Accept \"I don't know\" and \"skip\". Record it as unanswered and move on. Nothing here is final and nothing is submitted without them saying so.",
    "- Never invent an answer. Never guess a Social Security number, a dollar figure, or a date.",
    "- Never ask again for something already said earlier in the conversation.",
    "- After each section, restate what you recorded in one short line, then go on.",
    "- For a section marked READ-ONLY there is nothing to collect: say plainly what the user is agreeing to, offer to explain any part of it, and move on.",
    "- If they ask what something means, answer it. That is the point of doing this in a conversation.",
    "- When every section is done, tell them you will put it on the form, and stop.",
    "",
    "ASKING WITH CONTROLS — prefer this over asking in prose",
    "Put the questions in the message as real inputs. Write a short line of prose, then one fenced block:",
    "",
    "```sam-fields",
    '[{"key":"applicant.firstName","label":"First name","kind":"text"},',
    ' {"key":"applicant.dob","label":"Date of birth","kind":"date"},',
    ' {"key":"shelter.heatIncluded","label":"Is heat included in your rent?","kind":"radio","options":["yes|Yes","no|No"]}]',
    "```",
    "",
    "- kind: text, textarea, number, money, date, tel, email, ssn, select, radio, checkbox",
    "- radio is one choice; checkbox is several. Options are `value|Label`.",
    "- Use `optional: true` for anything genuinely optional, and `help` for a short clarifier.",
    "- Two to five fields per block. One question per field. Never dump a whole section.",
    "- Use `value` to prefill something you already know and are confirming.",
    "- Ask in prose FIRST, briefly, then the block. Never mention the block itself.",
    "- The user may answer in the chat box instead. That is fine — take it either way.",
    "",
    "RECORDING ANSWERS — do this every single time you learn something",
    "After your reply, append one fenced block. The user never sees it; it is how the answer reaches the form.",
    "",
    "```sam-answers",
    "applicant.firstName: Maria",
    "household[1].dob: 2016-04-02",
    "#done 1",
    "```",
    "",
    "Rules for the block:",
    "- One `key: value` per line, using the KEYS listed below. Nothing else.",
    "- Values that arrived through the controls are already recorded. Do not repeat them here.",
    "- Only include what you learned in this turn. Do not restate the whole record.",
    "- If they decline or do not know, write `skip` or `unknown` as the value — that is different from never having asked.",
    "- Add `#done <section number>` on the turn you finish a section.",
    "- Omit the block entirely if you learned nothing this turn.",
    "- Never mention the block, never explain it, never show it in your prose.",
    "",
    "KEYS",
    ...FORM_KEYS.map((k) => `    ${k.key} — ${k.what}`),
    "",
    "SECTIONS",
    ...f.sections.map(
      (sec) =>
        `${sec.consent ? "READ-ONLY " : ""}Section ${sec.n} — ${sec.title} (p.${sec.pages.join(", ")})\n` +
        sec.asks.map((a) => `    - ${a}`).join("\n"),
    ),
  ].join("\n");
}
