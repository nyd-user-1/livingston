/**
 * The forms livingston can walk you through.
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
  /** The short name a card shows — "Public Assistance", not "LDSS-2921". */
  name: string;
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
  /** The blank form, served from public/. Absent when there is no form to fill. */
  pdf?: string;
  sections: FormSection[];
  /** How you apply when there is no form here to fill in. */
  apply?: { how: string; phone?: string; url?: string };
  /** Grouping for the rail. */
  category: "apply" | "food" | "health" | "energy" | "family" | "money" | "older";
}

/* ------------------------------------------------------------------ */
/*  LDSS-2921 — the Common Application                                 */
/* ------------------------------------------------------------------ */

const LDSS_2921: ProgramForm = {
  id: "ldss-2921",
  code: "LDSS-2921",
  name: "Public Assistance",
  title: "New York State Application for Certain Benefits and Services",
  blurb: "One application for food, cash, medical, heating and child care help.",
  covers: [
    "Public Assistance",
    "SNAP",
    "Medicaid",
    "Child Care Assistance",
    "Services incl. Foster Care",
    "Emergency Assistance",
  ],
  agency: "NYS Office of Temporary and Disability Assistance",
  revision: "07/23",
  pages: 28,
  minutes: 30,
  category: "apply",
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
    // Section 9 is printed on page 5 but asked LAST — see the end of this list.
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
      "Nothing to fill in. Seven pages of legal notices — how your Social Security number is used, consent to investigation, the penalties for lying, assignment of support rights, and the Early Intervention release. livingston can explain any of it in plain language.",
    ] },
    { n: "withdraw", title: "Withdrawing an application", pages: [25], consent: true, asks: [
      "Only if you want to withdraw an application for one or more programs",
    ] },
    { n: "vote", title: "Voter registration", pages: [27, 28], asks: [
      "Optional — a voter registration form that rides along with the application",
    ] },
    // The one exception to printed order. The certification is printed on
    // page 5, but it attests to everything the applicant has said, so it is
    // asked after everything has been said. One answer: certification.agree.
    { n: "9", title: "Certification", pages: [5], asks: [
      "Whether you agree to the certification — that what you told us is true and complete, that the district may verify it, and that you assign child-support rights while on assistance",
    ] },
  ],
};


/* ------------------------------------------------------------------ */
/*  OCFS-6025 — Child Care Assistance                                  */
/* ------------------------------------------------------------------ */

const OCFS_6025: ProgramForm = {
  id: "ocfs-6025",
  code: "OCFS-6025",
  name: "Childcare Assistance",
  title: "New York State Application for Child Care Assistance",
  blurb: "Help paying for child care while you work, study or look for work.",
  covers: ["Child Care Assistance Program (CCAP)"],
  agency: "NYS Office of Children and Family Services",
  revision: "current",
  pages: 5,
  minutes: 15,
  category: "family",
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


/* ------------------------------------------------------------------ */
/*  Programs without a form here to fill                               */
/*                                                                     */
/*  Dragging one of these into the chat still works — livingston walks you     */
/*  through whether you qualify and exactly how to apply. Details and   */
/*  numbers below came from the state's own prescreening results page,  */
/*  not from memory.                                                    */
/* ------------------------------------------------------------------ */

const guide = (
  o: Omit<ProgramForm, "pages" | "sections" | "revision" | "agency" | "name"> &
    Partial<Pick<ProgramForm, "pages" | "sections" | "revision" | "agency" | "name">>,
): ProgramForm => ({
  pages: 0,
  revision: "",
  agency: o.agency ?? "New York State",
  sections: o.sections ?? [],
  // Most guide codes already read as names (SNAP, WIC, HEAP…).
  name: o.name ?? o.code,
  ...o,
});

const GUIDES: ProgramForm[] = [
  guide({
    id: "snap", code: "SNAP", title: "Supplemental Nutrition Assistance Program",
    blurb: "Monthly money for groceries, on a card that works like a debit card.",
    covers: ["SNAP"], category: "food", minutes: 20,
    agency: "NYS Office of Temporary and Disability Assistance",
    apply: { how: "Apply online, or use the LDSS-2921 in this list.", url: "https://mybenefits.ny.gov" },
  }),
  guide({
    id: "heap", code: "HEAP", title: "Home Energy Assistance Program",
    blurb: "Help paying a heating bill, and emergency help if you are being shut off.",
    covers: ["HEAP", "Emergency HEAP"], category: "energy", minutes: 10,
    apply: { how: "Apply through your county district. Seasonal — benefits open at set times of year.", url: "https://otda.ny.gov/programs/heap/" },
  }),
  guide({
    id: "wap", code: "WAP", title: "Weatherization Assistance Program",
    blurb: "Insulation, heating repairs and other work to cut what your home costs to heat.",
    covers: ["Weatherization"], category: "energy", minutes: 10,
    agency: "NYS Homes and Community Renewal",
    apply: { how: "Contact your local Weatherization provider. Renters qualify too — ask about apartments.", phone: "1-866-275-3427", url: "https://hcr.ny.gov/weatherization-assistance-program" },
  }),
  guide({
    id: "wic", code: "WIC", title: "Women, Infants and Children",
    blurb: "Food, formula and nutrition help while pregnant and for children under five.",
    covers: ["WIC"], category: "family", minutes: 10,
    agency: "NYS Department of Health",
    apply: { how: "Call the Growing Up Healthy Hotline to find your nearest WIC office and book an appointment.", phone: "1-800-522-5006" },
  }),
  guide({
    id: "school-meals", code: "School Meals", title: "Free and Reduced-Price School Meals",
    blurb: "Free or cheaper breakfast and lunch at school, and meals over the summer.",
    covers: ["School Meals", "Summer Meals"], category: "food", minutes: 5,
    apply: { how: "Apply through your child's school district. Many children qualify automatically once a household gets SNAP." },
  }),
  guide({
    id: "medicaid", code: "Medicaid", title: "Medicaid and Child Health Plus",
    blurb: "Health coverage for people with lower incomes, and for children in most households.",
    covers: ["Medicaid", "Child Health Plus", "Essential Plan"], category: "health", minutes: 25,
    agency: "NY State of Health",
    apply: { how: "Apply through NY State of Health, or use the LDSS-2921 in this list.", url: "https://nystateofhealth.ny.gov", phone: "1-855-355-5777" },
  }),
  guide({
    id: "epic", code: "EPIC", title: "Elderly Pharmaceutical Insurance Coverage",
    blurb: "Help with prescription costs for New Yorkers 65 and over, on top of Part D.",
    covers: ["EPIC"], category: "older", minutes: 15,
    agency: "NYS Department of Health",
    apply: { how: "Call for an application. You must be 65+, a NY resident, and in or eligible for a Part D plan.", phone: "1-800-332-3742", url: "https://www.health.ny.gov/health_care/epic/" },
  }),
  guide({
    id: "ny-connects", code: "NY Connects", title: "NY Connects: long term care help",
    blurb: "Free help understanding care options and staying in your own home.",
    covers: ["NY Connects", "HIICAP"], category: "older", minutes: 5,
    agency: "NYS Office for the Aging",
    apply: { how: "Contact your local NY Connects office. Free, and no income test to ask.", url: "https://www.nyconnects.ny.gov" },
  }),
  guide({
    id: "eitc", code: "EITC", name: "Earned Income Tax Credit", title: "Earned Income and Child Tax Credits",
    blurb: "Money back at tax time.",
    covers: ["Earned Income Credit", "Child Tax Credit", "Empire State Child Credit", "Child & Dependent Care Credit"],
    category: "money", minutes: 15,
    agency: "IRS and NYS Department of Taxation and Finance",
    apply: { how: "Claim it on your tax return. Free filing help is available if you earn under the limit.", url: "https://www.tax.ny.gov/pit/credits/earned_income_credit.htm" },
  }),
  guide({
    id: "veterans", code: "Veterans", title: "Veterans' benefits and annuities",
    blurb: "Including the Gold Star Parent Annuity and the Blind Annuity for wartime veterans.",
    covers: ["Gold Star Parent Annuity", "Blind Annuity", "Veterans services"], category: "money", minutes: 10,
    agency: "NYS Division of Veterans' Services",
    apply: { how: "Call the state veterans line to be connected to a benefits advisor.", phone: "1-888-838-7697", url: "https://veterans.ny.gov" },
  }),
  guide({
    id: "ssi-ssp", code: "SSI / SSP", name: "SSI / SSP", title: "Supplemental Security Income and the State Supplement",
    blurb: "Monthly cash if you are 65+, blind or disabled and have little income.",
    covers: ["SSI", "NYS Supplement Program"], category: "money", minutes: 30,
    agency: "Social Security Administration and NYS OTDA",
    apply: { how: "Apply to Social Security. The New York supplement is added automatically once SSI starts.", phone: "1-800-772-1213", url: "https://www.ssa.gov/ssi" },
  }),
  guide({
    id: "msp", code: "Medicare Savings", title: "Medicare Savings Program",
    blurb: "The state pays your Medicare Part B premium, and sometimes more.",
    covers: ["QMB", "SLMB", "QI"], category: "older", minutes: 20,
    agency: "NYS Department of Health",
    apply: { how: "Apply through your county district. There is no resource test in New York.", url: "https://www.health.ny.gov/health_care/medicaid/program/medicare_savings" },
  }),
  guide({
    id: "hiicap", code: "HIICAP", title: "Health Insurance Counseling (HIICAP)",
    blurb: "Free, unbiased help choosing or fixing Medicare coverage.",
    covers: ["Medicare counselling"], category: "older", minutes: 5,
    agency: "NYS Office for the Aging",
    apply: { how: "Call your county Office for the Aging and ask for HIICAP. Free, and nobody is selling you anything.", phone: "1-800-701-0501" },
  }),
  guide({
    id: "ofa-meals", code: "Senior Meals", title: "Home-delivered and congregate meals",
    blurb: "Meals brought to your door, or eaten together at a senior centre.",
    covers: ["Home-delivered meals", "Congregate dining"], category: "older", minutes: 10,
    agency: "NYS Office for the Aging",
    apply: { how: "Contact your county Area Agency on Aging. For anyone 60 or over; spouses of any age can join.", phone: "1-800-342-9871" },
  }),
  guide({
    id: "snap-ed", code: "SNAP-Ed", title: "Nutrition Education",
    blurb: "Free classes on food budgeting, meal planning and cooking.",
    covers: ["SNAP-Ed"], category: "food", minutes: 5,
    apply: { how: "Free if you get SNAP or are income-eligible. Ask your county SNAP-Ed representative.", url: "https://www.snapedny.org" },
  }),
  guide({
    id: "ovs", code: "Victim Services", title: "Office of Victim Services",
    blurb: "Money back for costs after a crime — medical bills, counselling, lost wages, funerals.",
    covers: ["Crime victim compensation"], category: "money", minutes: 25,
    agency: "NYS Office of Victim Services",
    apply: { how: "Apply directly to OVS. It pays what insurance does not, and you do not need to have brought charges.", phone: "1-800-247-8035", url: "https://ovs.ny.gov" },
  }),
  guide({
    id: "child-care-scholarships", code: "Head Start", title: "Head Start and Early Head Start",
    blurb: "Free preschool and family support for children under five.",
    covers: ["Head Start", "Early Head Start"], category: "family", minutes: 15,
    agency: "Federal, run locally",
    apply: { how: "Apply to your local Head Start programme. Free for families under the income limit, and for children in foster care or experiencing homelessness.", url: "https://eclkc.ohs.acf.hhs.gov/center-locator" },
  }),
  guide({
    id: "uninsured-care", code: "ADAP", name: "Uninsured Care", title: "Uninsured Care Programs",
    blurb: "Medication and care for New Yorkers who are HIV positive and uninsured.",
    covers: ["ADAP", "ADAP Plus", "APIC", "HIV Home Care"], category: "health", minutes: 10,
    agency: "NYS Department of Health",
    apply: { how: "Call the programme directly. You need not be a citizen; you must be a NY resident.", phone: "1-800-542-2437" },
  }),
];

/** The fillable ones first — those are the ones livingston can actually complete. */
export const FORMS: ProgramForm[] = [LDSS_2921, OCFS_6025, ...GUIDES];

export const fillable = (f: ProgramForm) => Boolean(f.pdf);

/**
 * The rail's order — Brendan's, not the catalogue's: the two forms Penny can
 * fill, then the two people ask about most, then everything else as listed.
 * The /programs grid keeps catalogue order and its own filters.
 */
const RAIL_ORDER = ["ldss-2921", "ocfs-6025", "eitc", "heap"];

export function railForms(): ProgramForm[] {
  const rank = (f: ProgramForm) => {
    const i = RAIL_ORDER.indexOf(f.id);
    return i === -1 ? RAIL_ORDER.length : i;
  };
  return [...FORMS].sort((a, b) => rank(a) - rank(b));
}

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
 *
 * `label` is what a person sees on a chip or a control. `options` are the
 * fixed values the form allows, `value|Label`; a key that has them is always
 * asked as a select (or checkboxes when `multi`) — the client enforces that in
 * `parseFieldBlock`, whatever the model wrote.
 */
export interface FormKey {
  key: string;
  label: string;
  what: string;
  options?: string[];
  /** Several values may be chosen; stored comma-separated. */
  multi?: boolean;
}

const YN = ["yes|Yes", "no|No"];
const SEX = ["M|Male", "F|Female", "X|X"];
const CITIZENSHIP = ["citizen|U.S. citizen", "qualified non-citizen|Qualified non-citizen", "other|Other"];
const LANGUAGE = ["english|English", "spanish|Spanish", "other|Another language"];

/*
 * The lists below follow the printed form, in printed order, so a value the
 * user picks is a box a caseworker can find. Where the user's own words do not
 * match a value, the model records `other` and puts the words in the key's
 * `…Detail` companion — never the nearest value (see RECORDING in the prompt).
 */

/** Section 15 (p.8), the 27 printed kinds, plus work from Section 17. */
const INCOME_SOURCES = [
  "job|Wages from a job", "selfEmployment|Self-employment",
  "unemployment|Unemployment insurance", "ssi|SSI", "ssd|Social Security Disability (SSD)",
  "socialSecurityDependent|Social Security dependent benefits", "socialSecuritySurvivor|Social Security survivor's benefits",
  "socialSecurityRetirement|Social Security retirement", "railroadRetirement|Railroad retirement",
  "pension|Pension or retirement benefits", "dividendsInterest|Dividends or interest",
  "workersComp|Workers' compensation", "nysDisability|NYS disability benefits",
  "veterans|Veteran's pension or benefits", "publicAssistance|Public Assistance grant",
  "giAllotment|GI dependency allotment", "educationGrant|Education grants or loans",
  "contributions|Contributions or gifts", "fosterCare|Foster care maintenance payments",
  "childSupport|Child support received", "spousalSupport|Spousal support received",
  "privateDisability|Private disability or accident insurance", "noFault|No-fault insurance benefits",
  "unionBenefits|Union or strike benefits", "loans|Loans other than education",
  "trust|Income from a trust", "trainingStipend|Training allotment or stipend",
  "rental|Rental income", "boarders|Boarders or lodgers", "other|Something else",
];

/** Section 19 (p.13), the 21 printed kinds. */
const RESOURCE_KINDS = [
  "cash|Cash", "checking|Checking account", "savings|Savings account or CD", "creditUnion|Credit union account",
  "lifeInsurance|Life insurance", "vehicle|Car or other vehicle", "stocksBonds|Stocks, bonds or mutual funds",
  "savingsBonds|Savings bonds", "retirementAccount|IRA, 401(k) or deferred compensation",
  "burialTrust|Irrevocable burial trust", "burialFund|Burial fund", "burialSpace|Burial space",
  "ownHome|Their own home", "realEstate|Other real estate", "taxRefund|An income tax refund coming",
  "annuity|Annuity", "trustBeneficiary|Beneficiary of a trust", "expectedMoney|Money expected — settlement, inheritance",
  "inTrustAccount|An \"in trust\" account", "safeDepositBox|Safe deposit box", "other|Something else",
];

/** Section 21 (p.15): the shelter cost lines, plus the page-2 shelter question. */
const SHELTER_TYPES = [
  "rent|Rent", "mortgage|Mortgage", "roomAndBoard|Room and board", "trailerLot|Trailer lot rent",
  "shelter|A shelter", "none|No housing cost", "other|Something else",
];

/** Section 18 (p.12), as printed. */
const EDUCATION = [
  "lessThanHighSchool|Less than a high school diploma", "iep|Completed an IEP",
  "highSchoolOrGed|High school diploma, GED or TASC", "associates|Associate's degree",
  "bachelorsOrHigher|Bachelor's degree or higher", "other|Something else",
];

export const FORM_KEYS: FormKey[] = [
  { key: "programs", label: "Programs", what: "which programs they are applying for", multi: true, options: [
    "PA|Public Assistance (cash)", "ChildCareInLieuOfPA|Child Care in lieu of PA", "SNAP|SNAP (food)", "MedicaidAndSNAP|Medicaid + SNAP",
    "MedicaidAndPA|Medicaid + Public Assistance", "Services|Services including Foster Care", "ChildCare|Child Care Assistance", "Emergency|Emergency Assistance only",
  ] },
  { key: "language.read", label: "Language you read", what: "language they read", options: LANGUAGE },
  { key: "language.readDetail", label: "Language you read", what: "the language, when it is not English or Spanish" },
  { key: "language.speak", label: "Language you speak", what: "language they speak", options: LANGUAGE },
  { key: "language.speakDetail", label: "Language you speak", what: "the language, when it is not English or Spanish" },
  { key: "interpreter", label: "Interpreter", what: "whether they want an interpreter", options: YN },
  { key: "urgent", label: "Urgent", what: "anything urgent that applies", multi: true, options: [
    "pregnant|Pregnant", "domesticViolence|Victim of domestic violence", "establishParentage|Need to establish parentage", "needChildSupport|Need child support",
    "drugAlcohol|Drug or alcohol problem", "utilityShutoff|Fuel or utility shut-off", "homeless|No place to stay", "fireOrDisaster|Fire or other disaster",
    "noIncome|No income", "seriousMedical|Serious medical problem", "pendingEviction|Pending eviction", "noFood|No food", "needFosterCare|Need foster care",
    "needChildCare|Need child care", "problemsWithEnglish|Problems with English", "reasonableAccommodations|Reasonable accommodations", "other|Other", "none|None of these",
  ] },
  { key: "urgent.otherDetail", label: "Other urgent need", what: "what the urgent need is, when it is not in the list" },
  { key: "applicant.firstName", label: "First Name", what: "first name" },
  { key: "applicant.middleInitial", label: "Middle Initial", what: "middle initial" },
  { key: "applicant.lastName", label: "Last Name", what: "last name" },
  { key: "applicant.dob", label: "DOB", what: "date of birth, YYYY-MM-DD" },
  { key: "applicant.ssn", label: "SSN", what: "Social Security number, digits only — only if freely given" },
  { key: "applicant.sex", label: "Sex", what: "sex", options: SEX },
  { key: "applicant.phone", label: "Phone", what: "phone, digits only" },
  { key: "applicant.email", label: "Email", what: "email" },
  { key: "address.street", label: "Street", what: "street address" },
  { key: "address.apt", label: "Apt", what: "apartment" },
  { key: "address.city", label: "City", what: "city" },
  { key: "address.state", label: "State", what: "two-letter state" },
  { key: "address.zip", label: "ZIP", what: "ZIP" },
  { key: "address.county", label: "County", what: "county" },
  { key: "mailing.same", label: "Same mailing address", what: "whether mail goes to the home address", options: ["yes|Yes, the same", "no|No, a different address"] },
  { key: "mailing.street", label: "Mailing street", what: "mailing street, only if different" },
  { key: "mailing.apt", label: "Mailing apt", what: "mailing apartment" },
  { key: "mailing.city", label: "Mailing city", what: "mailing city" },
  { key: "mailing.county", label: "Mailing county", what: "mailing county" },
  { key: "mailing.state", label: "Mailing state", what: "mailing state" },
  { key: "mailing.zip", label: "Mailing ZIP", what: "mailing ZIP" },
  { key: "applicant.maritalStatus", label: "Marital status", what: "marital status", options: ["single|Single", "married|Married", "separated|Separated", "divorced|Divorced", "widowed|Widowed", "other|Something else"] },
  { key: "applicant.maritalStatusDetail", label: "Marital status", what: "their words, when none of the fixed values fit" },
  { key: "household.count", label: "People in home", what: "how many people live there, including them" },
  { key: "household[n].firstName", label: "First Name", what: "each other person's first name" },
  { key: "household[n].lastName", label: "Last Name", what: "last name" },
  { key: "household[n].dob", label: "DOB", what: "date of birth, YYYY-MM-DD" },
  { key: "household[n].sex", label: "Sex", what: "sex", options: SEX },
  { key: "household[n].ssn", label: "SSN", what: "SSN, digits only — only if freely given" },
  { key: "household[n].relationship", label: "Relationship", what: "relationship to the applicant" },
  { key: "household[n].buysFoodTogether", label: "Buys food together", what: "whether they buy food or prepare meals with the applicant", options: YN },
  { key: "raceEthnicity.provide", label: "Share race and ethnicity", what: "whether they want to answer the optional race and ethnicity question", options: YN },
  { key: "applicant.race", label: "Race and ethnicity", what: "the applicant's race and ethnicity, in their words — optional" },
  { key: "household[n].race", label: "Race and ethnicity", what: "that person's race and ethnicity — optional" },
  { key: "applicant.citizenship", label: "Citizenship", what: "the applicant's citizenship or immigration status", options: CITIZENSHIP },
  { key: "applicant.citizenshipDetail", label: "Immigration status", what: "the status in their words, when it is `other`" },
  { key: "household[n].citizenship", label: "Citizenship", what: "citizenship or immigration status", options: CITIZENSHIP },
  { key: "household[n].citizenshipDetail", label: "Immigration status", what: "the status in their words, when it is `other`" },
  { key: "childSupport.absentParent", label: "Parent absent from home", what: "whether a child's parent is absent from the home", options: YN },
  { key: "childSupport.absentParent.firstName", label: "First Name", what: "the absent parent's first name" },
  { key: "childSupport.absentParent.lastName", label: "Last Name", what: "the absent parent's last name" },
  { key: "childSupport.absentParent.dob", label: "DOB", what: "the absent parent's date of birth, YYYY-MM-DD, if known" },
  { key: "childSupport.absentParent.lastAddress", label: "Last Address", what: "the absent parent's last known address" },
  { key: "childSupport.absentParent.forChild", label: "For which child", what: "which child or children the absent parent is a parent of" },
  { key: "taxes.files", label: "Files taxes", what: "whether they file a tax return", options: YN },
  { key: "taxes.dependents", label: "Dependents claimed", what: "who they claim as a dependent" },
  { key: "spouse.absent", label: "Spouse absent", what: "whether a spouse is absent from the home", options: YN },
  { key: "spouse.deceased", label: "Spouse deceased", what: "whether a spouse has died", options: YN },
  { key: "spouse.firstName", label: "First Name", what: "the spouse's first name" },
  { key: "spouse.lastName", label: "Last Name", what: "the spouse's last name" },
  { key: "child.absent", label: "Child living elsewhere", what: "whether a child of theirs lives elsewhere", options: YN },
  { key: "teenParent", label: "Teen parent", what: "whether a parent in the home is under 18", options: YN },
  { key: "income.hasAny", label: "Any income", what: "whether anyone in the home has any money coming in", options: YN },
  { key: "income[n].source", label: "Income source", what: "kind of income", options: INCOME_SOURCES },
  { key: "income[n].sourceDetail", label: "Income source", what: "what the income is, in their words, when it is `other`" },
  { key: "income[n].who", label: "Whose income", what: "whose income it is" },
  { key: "income[n].amount", label: "Amount", what: "amount in dollars, digits only" },
  { key: "income[n].period", label: "How often", what: "how often it comes", options: ["weekly|Weekly", "biweekly|Every two weeks", "twiceMonthly|Twice a month", "monthly|Monthly", "yearly|Yearly", "other|Something else"] },
  { key: "income[n].periodDetail", label: "How often", what: "how often, in their words, when it is `other`" },
  { key: "stepparent.income", label: "Stepparent income", what: "a stepparent's income, if one lives in the home — amount, or none" },
  { key: "sponsor.income", label: "Sponsor income", what: "an immigration sponsor's income, if that applies — amount, or none" },
  { key: "employment.status", label: "Employment status", what: "employment status", options: ["employed|Employed", "self-employed|Self-employed", "unemployed|Unemployed", "unable to work|Unable to work", "other|Something else"] },
  { key: "employment.statusDetail", label: "Employment status", what: "their situation in their words, when it is `other`" },
  { key: "employment.employer", label: "Employer", what: "employer name" },
  { key: "employment.lastWorked", label: "Last worked", what: "when they last worked, YYYY-MM-DD" },
  { key: "employment.lastEmployer", label: "Last employer", what: "the last employer, if not working now" },
  { key: "employment.endReason", label: "Why it ended", what: "why the last job ended" },
  { key: "employment.lookingForWork", label: "Looking for work", what: "whether they are looking for work", options: YN },
  { key: "employment.inTraining", label: "In training", what: "whether they are in a training program", options: YN },
  { key: "education.highestGrade", label: "Highest grade", what: "highest level of education completed", options: EDUCATION },
  { key: "education.highestGradeDetail", label: "Highest grade", what: "the last grade completed, or their words when it is `other`" },
  { key: "education.currentSchool", label: "School or training now", what: "any school or training they are in now, or none" },
  { key: "resources.hasAny", label: "Any resources", what: "whether anyone in the home has savings, accounts, vehicles or property", options: YN },
  { key: "resources[n].kind", label: "Resource", what: "kind of resource", options: RESOURCE_KINDS },
  { key: "resources[n].kindDetail", label: "Resource", what: "what it is, in their words, when it is `other`" },
  { key: "resources[n].value", label: "Value", what: "value in dollars, digits only" },
  { key: "medical.insurance", label: "Health insurance", what: "current health insurance, or none" },
  { key: "medical.pregnant", label: "Pregnant", what: "who is pregnant, or no" },
  { key: "medical.disabled", label: "Disabled", what: "who is disabled, or no" },
  { key: "medical.bills", label: "Unpaid medical bills", what: "whether there are medical bills they cannot pay", options: YN },
  { key: "medical.longTermCare", label: "Long-term care", what: "who needs long-term care, or no" },
  { key: "medical.retroactive", label: "Retroactive Medicaid", what: "whether they want Medicaid for bills from the last three months", options: YN },
  { key: "shelter.type", label: "Housing", what: "how they are housed and what they pay for", options: SHELTER_TYPES },
  { key: "shelter.typeDetail", label: "Housing", what: "their situation in their words — e.g. staying with a relative — when it is `other` or `none`" },
  { key: "shelter.amount", label: "Rent / mortgage", what: "monthly rent or mortgage in dollars, digits only" },
  { key: "shelter.payee", label: "Paid to", what: "who the rent or mortgage is paid to" },
  { key: "shelter.heatIncluded", label: "Heat included", what: "whether heat is included in the rent", options: YN },
  { key: "utilities.heatCost", label: "Heating cost", what: "monthly heating cost in dollars" },
  { key: "utilities.shutoffNotice", label: "Shut-off notice", what: "whether they have had a shut-off notice", options: YN },
  { key: "expenses.childCare", label: "Child care paid", what: "monthly child or dependent care paid" },
  { key: "expenses.childSupportPaid", label: "Child support paid", what: "monthly child support they pay out" },
  { key: "expenses.other", label: "Other bills", what: "other regular bills they pay" },
  { key: "other.veteran", label: "Veteran", what: "whether they are a veteran", options: YN },
  { key: "other.appliedElsewhere", label: "Applied elsewhere", what: "whether they applied in another county recently", options: YN },
  { key: "other.soldRecently", label: "Sold or gave away property", what: "whether anyone sold, traded or gave away property recently", options: YN },
  { key: "other.strike", label: "On strike", what: "whether anyone in the home is on strike", options: YN },
  { key: "other.priorBenefits", label: "Got benefits before", what: "whether anyone has received benefits before", options: YN },
  { key: "other.disqualified", label: "Disqualified before", what: "whether anyone has been disqualified from benefits before", options: YN },
  { key: "voter.register", label: "Register to vote", what: "whether they want to register to vote", options: ["yes|Yes, register me", "no|No, I do not want to register", "already|I am already registered"] },
  { key: "certification.agree", label: "Certification", what: "whether they agree to the certification — asked last, as an attestation", options: ["yes|I agree", "no|Not yet"] },
  { key: "form.fill", label: "Fill out the form", what: "this is an action, not an answer — the app fills the PDF the moment it is yes", options: ["yes|Yes, fill it out", "no|Not yet"] },
];

/** Keys that drive the app rather than describe the applicant; never on the form. */
export const isActionKey = (key: string) => key.startsWith("form.");

/** `household[3].dob` → `household[n].dob`, so a roster key matches its FORM_KEYS entry. */
export const normaliseKey = (key: string) => key.replace(/\[\d+\]/g, "[n]");

const KEY_INDEX = new Map(FORM_KEYS.map((k) => [k.key, k]));

/** The FORM_KEYS entry for a key, roster index normalised. */
export const formKey = (key: string): FormKey | undefined => KEY_INDEX.get(normaliseKey(key));

/**
 * A label a person would read. Exact match on the normalised key, else the
 * last segment humanised: `lastAddress` → `Last Address`, `hasAny` → `Has Any`.
 */
export function labelFor(key: string): string {
  const hit = formKey(key);
  if (hit) return hit.label;
  const last = key.split(".").pop()!.replace(/\[\d+\]/g, "");
  return last
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The fixed values for a key, if the form has them. */
export function optionsFor(key: string): { options: string[]; multi: boolean } | undefined {
  const hit = formKey(key);
  return hit?.options ? { options: hit.options, multi: hit.multi === true } : undefined;
}

/** The label printed beside a fixed value — `biweekly` → `Every two weeks`. */
export function optionLabel(key: string, value: string): string | undefined {
  const opts = optionsFor(key)?.options;
  if (!opts) return undefined;
  const hit = opts.find((o) => o.split("|")[0].toLowerCase() === value.trim().toLowerCase());
  return hit ? hit.split("|")[1] ?? hit : undefined;
}

const MONEY_KEY = /(amount|value|cost|Paid|\.childCare$|\.other$|\.income$)/;
const DATE_KEY = /(\.dob$|lastWorked$)/;

/**
 * What a person sees for a stored value. Storage stays machine-shaped — ten
 * digits for a phone, digits for money, ISO for a date — because the PDF
 * adapters depend on that; this is the one place it is turned back into the
 * shape it was typed in.
 */
export function displayValue(key: string, value: string): string {
  const v = (value ?? "").trim();
  if (!v || v === "skip" || v === "unknown") return v;
  const k = normaliseKey(key);
  if (k === "applicant.phone" || /\.phone$/.test(k)) {
    const d = v.replace(/\D/g, "");
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    return v;
  }
  if (DATE_KEY.test(k)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
  }
  if (MONEY_KEY.test(k)) {
    const m = /^\$?\s*([\d,]+)(\.\d{1,2})?$/.exec(v);
    if (m) {
      const whole = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(whole)) return `$${whole.toLocaleString("en-US")}${m[2] ?? ""}`;
    }
    return v;
  }
  if (optionsFor(k) && !optionsFor(k)!.multi) return optionLabel(k, v) ?? v;
  if (optionsFor(k)?.multi) {
    return v
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => optionLabel(k, p) ?? p)
      .join(", ");
  }
  return v;
}

/* ------------------------------------------------------------------ */
/*  Which section a key belongs to                                    */
/* ------------------------------------------------------------------ */

/**
 * Key prefix → the printed section (LDSS-2921's `FormSection.n`). The
 * question's prose says where it is; this is the fallback when it does not,
 * and it is what turns a bare record into "DONE: 1, 2–5, 3". Longest prefix
 * wins, so `applicant.race` lands in 7 while `applicant.` stays in 3.
 */
export const KEY_SECTION: Record<string, string> = {
  "programs": "1",
  "language.": "2–5",
  "interpreter": "2–5",
  "urgent": "2–5",
  "applicant.": "3",
  "address.": "3",
  "mailing.": "3",
  "household": "6",
  "raceEthnicity.": "7",
  "applicant.race": "7",
  "household[n].race": "7",
  "applicant.citizenship": "8",
  "household[n].citizenship": "8",
  "childSupport.": "10",
  "taxes.": "11",
  "spouse.": "12",
  "child.": "13",
  "teenParent": "14",
  "income": "15",
  "stepparent.": "16",
  "sponsor.": "16",
  "employment.": "17",
  "education.": "18",
  "resources": "19",
  "medical.": "20",
  "shelter.": "21",
  "utilities.": "21",
  "expenses.": "22",
  "other.": "23",
  "voter.": "vote",
  "certification.": "9",
};

const KEY_SECTION_ORDERED = Object.entries(KEY_SECTION).sort((a, b) => b[0].length - a[0].length);

export function sectionForKey(key: string): string | undefined {
  const k = normaliseKey(key);
  return KEY_SECTION_ORDERED.find(([prefix]) => k.startsWith(prefix))?.[1];
}

/** `Section 6 — Everyone in your home`; unnumbered parts are just their title. */
export function sectionLabel(f: ProgramForm | undefined, n: string): string {
  const sec = f?.sections.find((s) => s.n === n);
  const num = /^\d/.test(n) ? `Section ${n}` : "";
  if (!sec) return num || n;
  return num ? `${num} — ${sec.title}` : sec.title;
}

/** The sections that ask something, in interview order. */
export const askedSections = (f: ProgramForm) => f.sections.filter((s) => !s.consent);

/**
 * How far along the interview is, without waiting for the model to say
 * `#done`. A section counts as done when the model marked it, or when the
 * interview has already moved past it — the section of the latest question
 * (or of the latest recorded key) is further along in interview order.
 * Never lags, so "19 of 21" and "Section 23" stop contradicting each other.
 */
export function formProgress(
  f: ProgramForm,
  answers: { values: Record<string, string>; done: string[] },
  currentSection?: string,
): { done: number; total: number; current?: string } {
  const order = askedSections(f).map((s) => s.n);
  const total = order.length;
  const idx = (n?: string) => (n === undefined ? -1 : order.indexOf(n));
  // The furthest section touched: the open question's, or the last key's.
  let furthest = idx(currentSection);
  for (const k of Object.keys(answers.values)) {
    const s = sectionForKey(k);
    if (s && idx(s) > furthest) furthest = idx(s);
  }
  const done = new Set(answers.done.filter((n) => order.includes(n)));
  for (let i = 0; i < furthest; i++) done.add(order[i]);
  // A section whose every question is answered is done too, but that is the
  // page's knowledge (it has the questions) — see Chat.tsx.
  const current = furthest >= 0 ? order[furthest] : undefined;
  return { done: done.size, total, current };
}

/**
 * The record, as a block for the system prompt. The history sent to the
 * model is the last 16 turns, so on a long form the early answers scroll
 * out — and a corrected chip never enters the history at all. This is how
 * both reach the model. Capped; the earliest sections go first when it is
 * too long, and the block says so.
 */
export function recordedSoFar(f: ProgramForm, answers: { values: Record<string, string>; done: string[] }, cap = 4000): string {
  const entries = Object.entries(answers.values).filter(([k, v]) => v !== "" && !isActionKey(k));
  if (!entries.length && !answers.done.length) return "";
  const order = new Map(f.sections.map((s, i) => [s.n, i]));
  const bySection = new Map<string, string[]>();
  for (const [k, v] of entries) {
    const s = sectionForKey(k) ?? "";
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s)!.push(`${k}: ${v}`);
  }
  const groups = [...bySection.entries()].sort(
    ([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999),
  );
  const head = "RECORDED SO FAR (the user's answers; treat as true; never re-ask):";
  const tail = `DONE: ${answers.done.join(", ") || "none yet"}`;
  const room = cap - head.length - tail.length - 48;
  const size = () => groups.reduce((n, [, lines]) => n + lines.join("\n").length + 1, 0);
  let truncated = false;
  while (groups.length > 1 && size() > room) {
    groups.shift();
    truncated = true;
  }
  // One section can be over the cap on its own (a long roster): keep its
  // latest lines.
  let lines = groups.flatMap(([, l]) => l);
  while (lines.length > 1 && lines.join("\n").length > room) {
    lines = lines.slice(1);
    truncated = true;
  }
  return [head, truncated ? "… (earlier answers omitted for length)" : "", lines.join("\n"), tail].filter(Boolean).join("\n");
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
  // No form here to fill: livingston explains the programme and how to apply,
  // and does not pretend to be filling anything in.
  if (!f.pdf) {
    return [
      `You are Penny, livingston's benefits assistant. The user is asking about ${f.code} — ${f.title}.`,
      `${f.blurb}`,
      f.covers.length ? `It covers: ${f.covers.join(", ")}.` : "",
      f.apply ? `How to apply: ${f.apply.how}` : "",
      f.apply?.phone ? `Phone: ${f.apply.phone}` : "",
      f.apply?.url ? `Online: ${f.apply.url}` : "",
      "",
      "- Help them work out whether it is worth applying, and how to do it.",
      "- Never tell them they do not qualify. You are not the decision — say what the rule is and who decides.",
      "- They always have the right to apply, whatever any screening says. Say so if they sound discouraged.",
      "- If another programme in the list would suit them better, say which and why.",
      "- Keep it short. Give the phone number or the link plainly, not buried in a paragraph.",
      "- If they want the paperwork done with them, the LDSS-2921 covers cash, food, medical, heating and child care in one application.",
      "",
      "CITING",
      "A statement of fact about this programme — who runs it, how to apply, what it covers — ends with",
      f.apply?.url
        ? `a citation to its official page, written [[${f.apply.url}]]. Only that URL; never invent one.`
        : "the words \"— from the programme details above\". There is no URL for this one; never invent one.",
      "Say plainly when something is not in the details above, and who decides.",
    ].filter(Boolean).join("\n");
  }
  const stats = formStats(f);
  return [
    `You are Penny, livingston's benefits assistant, filling out ${f.code} with the user, one section at a time.`,
    `You are not advising and not deciding anything — you are the form's interface.`,
    "",
    "THE ONE RULE THAT MATTERS MOST",
    "Every question you ask must be a control, not a list in prose. Write one or two",
    "sentences, then a ```livingston-fields``` block. Do NOT write questions as bullet points",
    "or numbered lists and ask them to reply in words — that is the failure mode. If",
    "you are asking for anything at all, there is a livingston-fields block in your message.",
    "",
    `${f.code} — ${f.title}`,
    `${f.agency}, rev. ${f.revision}. ${f.pages} pages: ${stats.questionSections} sections that ask questions and ${stats.readingPages} pages that are only notices to read.`,
    `It applies for: ${f.covers.join(", ")}.`,
    "",
    "HOW TO RUN IT",
    "- Work through the sections in the order listed. Open by saying what the form is, roughly how long it takes, and that they can stop any time and come back.",
    "- Ask two or three plain questions at a time. Never paste a section wholesale, never use the form's bureaucratic wording when ordinary words will do.",
    "- Head the first question of a section `**Section 17 — Employment.**` Any further question in the same section is headed `**Section 17, continued.**` Never repeat the full heading, and never say \"of 21\". An unnumbered part is headed by its title alone: `**Voter registration.**`",
    "- Accept \"I don't know\" and \"skip\". Record it as unanswered and move on. Nothing here is final and nothing is submitted without them saying so.",
    "- Never invent an answer. Never guess a Social Security number, a dollar figure, or a date.",
    "- Never ask again for something already said earlier in the conversation or listed under RECORDED SO FAR.",
    "- After each section, one short line starting `**Section 17:**` (the number, a colon) that says what you have, e.g. `**Section 11:** You file taxes and claim Aiden and Ailish as dependents.` Not \"recorded\".",
    "- For a section marked READ-ONLY there is nothing to collect: say plainly what the user is agreeing to, offer to explain any part of it, and move on.",
    "- If they ask what something means, answer it. That is the point of doing this in a conversation.",
    "- You never fill, print, or submit anything yourself, and you never say you cannot: the application fills the PDF the moment they say yes to the closing question. If they ask you to fill it out at any point, ask the `form.fill` question (see THE CLOSE).",
    "",
    "YOUR FIRST MESSAGE — copy this shape exactly",
    `Say what ${f.code} is and roughly how long it takes, say they can stop and come back,`,
    "then ask section 1 as controls. Like this:",
    "",
    `This is ${f.code} — ${f.title.toLowerCase()}. About ${f.minutes} minutes. You can stop any time and pick up where you left off.`,
    "",
    "Which of these are you applying for?",
    "",
    "```livingston-fields",
    '[{"key":"programs","label":"Programs","kind":"checkbox","options":["PA|Public Assistance (cash)","SNAP|SNAP (food)","MedicaidAndPA|Medicaid + Public Assistance","MedicaidAndSNAP|Medicaid + SNAP","ChildCare|Child Care Assistance","Services|Services including Foster Care","Emergency|Emergency Assistance only"]}]',
    "```",
    "",
    "ASKING WITH CONTROLS",
    "Put the questions in the message as real inputs. Write a short line of prose, then one fenced block:",
    "",
    "```livingston-fields",
    '[{"key":"applicant.firstName","label":"First name","kind":"text"},',
    ' {"key":"applicant.dob","label":"Date of birth","kind":"date"},',
    ' {"key":"shelter.heatIncluded","label":"Is heat included in your rent?","kind":"radio","options":["yes|Yes","no|No"]}]',
    "```",
    "",
    "- kind: text, textarea, number, money, date, tel, email, ssn, select, radio, checkbox, attest",
    "- radio is one choice; checkbox is several. Options are `value|Label`.",
    "- Keys with fixed values in KEYS are selects; never ask them as free text. The app renders those values whatever you write, so you may leave `options` out for them.",
    "- Use `optional: true` for anything genuinely optional, and `help` for a short clarifier.",
    "- Two to five fields per block. One question per field. Never dump a whole section.",
    "- Use `value` to prefill something you already know and are confirming.",
    "- Ask in prose FIRST, briefly, then the block. Never mention the block itself.",
    "- The user may answer in the chat box instead. That is fine — take it either way.",
    "",
    "RECORDING ANSWERS — do this every single time you learn something",
    "After your reply, append one fenced block. The user never sees it; it is how the answer reaches the form.",
    "",
    "```livingston-answers",
    "applicant.firstName: <first name as they gave it>",
    "household[1].dob: <YYYY-MM-DD>",
    "#done 1",
    "```",
    "",
    "Rules for the block:",
    "- One `key: value` per line, using the KEYS listed below. Nothing else.",
    "- Values that arrived through the controls are already recorded. Do not repeat them here.",
    "- Only include what you learned in this turn. Do not restate the whole record.",
    "- If they decline or do not know, write `skip` or `unknown` as the value — that is different from never having asked.",
    "- When their words do not match one of a key's fixed values, record `other` (or `none` where that is what they mean) and put their words in the key's `…Detail` companion — `shelter.type: other` + `shelter.typeDetail: staying with a relative`. Never pick the nearest value for them.",
    "- Phone numbers as ten digits, money as digits, dates as YYYY-MM-DD. The app formats them for the user.",
    "- Add `#done <section number>` on the turn you finish a section.",
    "- Omit the block entirely if you learned nothing this turn.",
    "- Never mention the block, never explain it, never show it in your prose.",
    "",
    "THE CERTIFICATION — Section 9, asked last",
    "It is an attestation, not a notice. Ask it with one field: `{\"key\":\"certification.agree\",\"kind\":\"attest\",\"label\":\"Do you agree?\",\"help\":\"…\"}`",
    "where `help` is exactly this: By agreeing, you are saying that what you told us is true and complete as far as you know; that the district can check it with employers, banks, and agencies; that giving false information can mean losing benefits or being prosecuted; and that while you get assistance, child support owed to you is paid to the district.",
    "No \"if you lie on this form\". A `no` is allowed: say the application can still be filed but the district will need the certification before a decision, then go on.",
    "",
    "VOTER REGISTRATION — the `vote` section",
    "Ask `voter.register` as a select with `\"tone\":\"info\"`. If they say yes, say exactly these facts and no others: the New York State voter registration form is pages 27 and 28 of this application [[p.27 §vote]]; it is filed together with the application; the Board of Elections mails a confirmation notice once it is processed. You did not email anyone and they are not registered yet — never say either. Then go on.",
    "",
    "THE CLOSE — when every section including the certification is done",
    "Write one sentence saying you have everything, then a review block, then the fill question — nothing else. Do not list the answers yourself; the app draws the review from the record.",
    "",
    "You're all set — here is everything you told me.",
    "",
    "```livingston-review",
    "```",
    "",
    "If you like, I will now fill out the correct form (LDSS-2921) on your behalf.",
    "",
    "```livingston-fields",
    '[{"key":"form.fill","label":"Fill out the form","kind":"radio"}]',
    "```",
    "",
    "When `form.fill` comes back `yes`, the app builds the PDF and shows it in the conversation. Your next message says the filled form is below, that it is a draft to read before filing, and that nothing has been sent anywhere.",
    "",
    "CITING",
    "Any statement about what the form asks, requires, says, or where something is filled in",
    "must carry a citation at the end of the sentence, written `[[p.8 §15]]` — the page and",
    "section from SECTIONS. Several are fine: `[[p.2 §3]] [[p.3 §6]]`. A fact that is not on",
    "the form has no citation and you say so: it is not on the form, and the county district",
    "decides. The section heading is not a citation — add the chip too.",
    "",
    "KEYS",
    ...FORM_KEYS.map((k) =>
      `    ${k.key} — ${k.what}${k.options ? `. Values${k.multi ? " (several, comma-separated)" : ""}: ${k.options.map((o) => o.split("|")[0]).join(", ")}` : ""}`,
    ),
    "",
    "SECTIONS — in the order to ask them",
    ...f.sections.map(
      (sec) =>
        `${sec.consent ? "READ-ONLY " : ""}Section ${sec.n} — ${sec.title} (p.${sec.pages.join(", ")})\n` +
        sec.asks.map((a) => `    - ${a}`).join("\n"),
    ),
  ].join("\n");
}
