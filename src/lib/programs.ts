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

export const FORMS: ProgramForm[] = [LDSS_2921];

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
    "SECTIONS",
    ...f.sections.map(
      (sec) =>
        `${sec.consent ? "READ-ONLY " : ""}Section ${sec.n} — ${sec.title} (p.${sec.pages.join(", ")})\n` +
        sec.asks.map((a) => `    - ${a}`).join("\n"),
    ),
  ].join("\n");
}
