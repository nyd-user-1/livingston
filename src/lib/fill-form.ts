import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FormAnswers } from "@/lib/form-answers";
import type { ProgramForm } from "@/lib/programs";

/**
 * Put the collected answers onto the real form.
 *
 * Two passes, because LDSS-2921 ships no AcroForm layer of its own and the one
 * we generated is positional (see .research/build-fillable.mjs):
 *
 *   1. Checkboxes we can name with confidence — the Section 1 program boxes are
 *      matched by their printed label, which was read straight off the page.
 *   2. An answers appendix appended to the end: every value collected, in the
 *      form's own vocabulary, grouped and legible.
 *
 * The appendix is not a consolation prize. Until every one of the 1,775 field
 * positions is mapped by hand, a caseworker with a complete, ordered list of
 * answers attached to the application is materially better off than one holding
 * a partly-filled form — and nothing here is ever silently placed in the wrong
 * box, which is the failure that would actually cost someone their benefits.
 */

/** Section 1's program boxes, by the label printed beside them. */
const PROGRAM_BOX: Record<string, string> = {
  PA: "Public Assistance (PA)",
  ChildCareInLieuOfPA: "Child Care in lieu of PA",
  SNAP: "Supplemental Nutrition Assistance Program (SNAP)",
  MedicaidAndSNAP: "Medicaid (MA) and SNAP",
  MedicaidAndPA: "Medicaid (MA) and PA",
  Services: "Services (S), including Foster Care (FC)",
  ChildCare: "Child Care Assistance (CC)",
  Emergency: "Emergency Assistance Only (EMRG)",
};

/** Where those boxes sit on page 2, read from the glyph positions. */
const PROGRAM_XY: Record<string, { x: number; y: number }> = {
  "Public Assistance (PA)": { x: 232.8, y: 565.3 },
  "Child Care in lieu of PA": { x: 324.7, y: 565.3 },
  "Supplemental Nutrition Assistance Program (SNAP)": { x: 417.8, y: 565.3 },
  "Medicaid (MA) and SNAP": { x: 611.5, y: 565.3 },
  "Medicaid (MA) and PA": { x: 228.1, y: 550.3 },
  "Services (S), including Foster Care (FC)": { x: 319.2, y: 550.3 },
  "Child Care Assistance (CC)": { x: 469.8, y: 550.3 },
  "Emergency Assistance Only (EMRG)": { x: 576.8, y: 550.3 },
};

/**
 * Page 2's "DO ANY OF THESE APPLY TO YOU?" column — the triage flags a
 * caseworker reads first. Eviction, a shutoff notice, no food, no income and
 * domestic violence are what route an application to same-day handling, so
 * these are the highest-stakes boxes on the form and worth mapping exactly.
 * Coordinates read straight off the printed glyphs.
 */
const URGENT_XY: Record<string, { x: number; y: number }> = {
  pregnant: { x: 615.6, y: 496.4 },
  domesticViolence: { x: 615.6, y: 481.4 },
  establishParentage: { x: 615.6, y: 466.4 },
  needChildSupport: { x: 615.6, y: 451.4 },
  drugAlcohol: { x: 615.6, y: 436.4 },
  utilityShutoff: { x: 615.6, y: 421.4 },
  homeless: { x: 615.6, y: 406.4 },
  fireOrDisaster: { x: 615.6, y: 391.4 },
  noIncome: { x: 615.6, y: 376.4 },
  seriousMedical: { x: 615.6, y: 361.4 },
  pendingEviction: { x: 615.6, y: 346.4 },
  noFood: { x: 615.6, y: 331.4 },
  needFosterCare: { x: 615.6, y: 316.4 },
  needChildCare: { x: 615.6, y: 301.4 },
  problemsWithEnglish: { x: 615.6, y: 286.4 },
  reasonableAccommodations: { x: 615.6, y: 271.4 },
  other: { x: 615.3, y: 255.6 },
};

/** The language boxes, also page 2. */
const LANG_XY: Record<string, { x: number; y: number }> = {
  english: { x: 99.7, y: 507.6 },
  spanish: { x: 200.5, y: 507.6 },
  other: { x: 97.7, y: 496.6 },
};

/**
 * Section 6, page 3 — the household roster. Eight rows, and the columns are
 * regular, so this one section can be written into the real boxes rather than
 * only appended. Geometry read from the ruled grid; row 1 is the applicant,
 * matching how the form is printed ("List everybody who lives with you").
 *
 * Column x positions are the left edge of each cell; text is inset 2pt.
 */
const ROSTER = {
  rowY: [462, 442.3, 422.8, 403.2, 383.5, 362.3, 340.6, 321],
  col: {
    name: { x: 56.2, w: 224.9 },
    dob: { x: 390.2, w: 44.3 },
    sex: { x: 435.2, w: 26.3 },
    genderIdentity: { x: 462.2, w: 107.3 },
    ssn: { x: 615.2, w: 102 },
  },
} as const;

/**
 * Section 3, page 2 — the applicant's own details. Here the printed label sits
 * *inside* each box and you write underneath it, so the write position is the
 * cell's bottom-left rather than its middle.
 */
const APPLICANT = {
  firstName: { x: 18.4, y: 452, w: 147.6 },
  lastName: { x: 184.2, y: 452, w: 193.1 },
  maritalStatus: { x: 378.4, y: 452, w: 107.3 },
  phoneArea: { x: 486.4, y: 452, w: 63.1 },
  phoneRest: { x: 550.2, y: 452, w: 61.6 },
  street: { x: 18.4, y: 428.4, w: 231.1 },
  apt: { x: 250, y: 428.4, w: 29.2 },
  city: { x: 279.8, y: 428.4, w: 130.2 },
  county: { x: 410.8, y: 428.4, w: 88.6 },
  state: { x: 500, y: 428.4, w: 28 },
  zip: { x: 528.7, y: 428.4, w: 83 },
  mailStreet: { x: 18.4, y: 381.4, w: 231.1 },
  mailApt: { x: 250, y: 381.4, w: 29.2 },
  mailCity: { x: 279.8, y: 381.4, w: 130.2 },
  mailCounty: { x: 410.8, y: 381.4, w: 88.6 },
  mailState: { x: 500, y: 381.4, w: 28 },
  mailZip: { x: 528.7, y: 381.4, w: 83 },
} as const;

/** mm/dd/yyyy is what the form prints under the column. */
function usDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso.trim();
}

const GROUPS: { title: string; prefix: RegExp }[] = [
  { title: "Programs applied for", prefix: /^programs$/ },
  { title: "Language", prefix: /^(language|interpreter|urgent)/ },
  { title: "Applicant", prefix: /^applicant\./ },
  { title: "Address", prefix: /^(address|mailing)\./ },
  { title: "Household", prefix: /^household/ },
  { title: "Income", prefix: /^income/ },
  { title: "Employment & education", prefix: /^(employment|education)\./ },
  { title: "Resources", prefix: /^resources/ },
  { title: "Medical", prefix: /^medical\./ },
  { title: "Shelter & utilities", prefix: /^(shelter|utilities)\./ },
  { title: "Other expenses", prefix: /^expenses\./ },
  { title: "Other", prefix: /^(other|voter)\./ },
];

/* ------------------------------------------------------------------ */
/*  OCFS-6025 — a form that ships its own named fields                 */
/* ------------------------------------------------------------------ */

/**
 * The child-care application arrives with 429 semantically named AcroForm
 * fields, so this one gets written properly rather than appended to. The
 * adapter is the whole trick from the Jobright pattern: one stored profile,
 * one per-form map from our vocabulary onto that form's schema.
 */
function fillOcfs6025(doc: PDFDocument, v: Record<string, string>) {
  const form = doc.getForm();
  const tf = (name: string, val?: string) => {
    if (!val || val === "skip" || val === "unknown") return;
    try { form.getTextField(name).setText(val); } catch { /* field absent in this revision */ }
  };
  const cb = (name: string, on: boolean) => {
    if (!on) return;
    try { form.getCheckBox(name).check(); } catch { /* field absent */ }
  };
  const yn = (base: string, val?: string) => {
    if (!val) return;
    const y = /^(y|yes|true)$/i.test(val.trim());
    cb(`${base}_yes`, y);
    cb(`${base}_no`, !y && /^(n|no|false)$/i.test(val.trim()));
  };

  const first = v["applicant.firstName"] ?? "";
  const last = v["applicant.lastName"] ?? "";
  tf("full_name", [first, last].filter(Boolean).join(" "));
  tf("address_street", v["address.street"]);
  tf("address_apt", v["address.apt"]);
  tf("address_city", v["address.city"]);
  tf("address_state", v["address.state"] ?? "NY");
  tf("address_county", v["address.county"]);
  tf("address_zip", v["address.zip"]);
  tf("email", v["applicant.email"]);

  const digits = (v["applicant.phone"] ?? "").replace(/\D/g, "");
  if (digits.length >= 10) {
    tf("phone_area", digits.slice(0, 3));
    tf("phone_prefix", digits.slice(3, 6));
    tf("phone_line", digits.slice(6, 10));
  }
  if (v["applicant.email"]) cb("contact_pref_email", true);

  const lang = (v["language.speak"] ?? v["language.read"] ?? "").toLowerCase();
  if (lang) {
    cb("lang_english", lang.includes("english"));
    cb("lang_spanish", lang.includes("spanish"));
    if (!lang.includes("english") && !lang.includes("spanish")) {
      cb("lang_other", true);
      tf("lang_other_text", v["language.speak"] ?? v["language.read"]);
    }
  }

  // Household roster. hh1 is the applicant on this form; the people the user
  // listed start at hh2, matching household[1..] in our vocabulary.
  tf("hh1_name", [first, last].filter(Boolean).join(" "));
  tf("hh1_dob", v["applicant.dob"]);
  tf("hh1_sex", v["applicant.sex"]);
  tf("hh1_ssn", (v["applicant.ssn"] ?? "").replace(/\D/g, ""));
  for (let i = 1; i <= 7; i++) {
    const slot = i + 1;
    const name = [v[`household[${i}].firstName`], v[`household[${i}].lastName`]].filter(Boolean).join(" ");
    tf(`hh${slot}_name`, name);
    tf(`hh${slot}_dob`, v[`household[${i}].dob`]);
    tf(`hh${slot}_sex`, v[`household[${i}].sex`]);
    tf(`hh${slot}_ssn`, (v[`household[${i}].ssn`] ?? "").replace(/\D/g, ""));
    tf(`hh${slot}_relationship`, v[`household[${i}].relationship`]);
    // Exactly `citizen`: "qualified non-citizen" contains the word too, and
    // the select now offers it by name.
    yn(`hh${slot}_us_citizen`, v[`household[${i}].citizenship`]?.trim().toLowerCase() === "citizen" ? "yes" : undefined);
  }

  yn("homeless", v["shelter.type"]?.toLowerCase() === "shelter" ? "yes" : "no");

  // Benefits already received — the form asks which, as checkboxes.
  const progs = (v["programs"] ?? "").toLowerCase();
  cb("benefit_snap", progs.includes("snap"));
  cb("benefit_medicaid", progs.includes("medicaid"));
  cb("benefit_tanf", progs.includes("pa"));

  // Income: each kind is a yes/no plus who and how much.
  for (let i = 1; i <= 6; i++) {
    const src = (v[`income[${i}].source`] ?? "").toLowerCase();
    if (!src) continue;
    const who = v[`income[${i}].who`] ?? "";
    const amt = v[`income[${i}].amount`] ?? "";
    const per = v[`income[${i}].period`] ?? "";
    const target =
      src.includes("child") ? "income_child_support" :
      src.includes("disab") ? "income_disability" :
      src.includes("pension") || src.includes("retire") ? "income_pensions" :
      src.includes("alimony") ? "income_alimony" :
      src.includes("public") || src.includes("tanf") ? "income_public_assistance" :
      src.includes("divid") || src.includes("interest") ? "income_dividends" :
      src.includes("job") || src.includes("work") || src.includes("wage") || src.includes("employ") ? "income_work" :
      "income_other";
    yn(target, "yes");
    tf(`${target}_who1`, who);
    tf(`${target}_amount1`, amt);
    tf(`${target}_period1`, per);
  }
}

export async function fillForm(form: ProgramForm, answers: FormAnswers): Promise<Uint8Array> {
  if (!form.pdf) throw new Error(`${form.code} has no form to fill — it is applied for another way.`);
  const res = await fetch(form.pdf);
  if (!res.ok) throw new Error(`Could not load ${form.code} (${res.status})`);
  const doc = await PDFDocument.load(await res.arrayBuffer(), { ignoreEncryption: true });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  /* ---- 0. forms that carry their own field layer ------------------- */
  if (form.id === "ocfs-6025") {
    fillOcfs6025(doc, answers.values);
    // Still append the record: a caseworker reading the appendix can see every
    // answer given, including the ones this form has no box for.
    appendix(doc, form, answers, helv, bold);
    return doc.save();
  }

  /* ---- 1. the program checkboxes ---------------------------------- */
  const chosen = (answers.values["programs"] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const page2 = pages[1];
  // A box inferred twice (said once, implied once) must still be one mark.
  const ticked = new Set<string>();
  const tick = (xy: { x: number; y: number }) => {
    const at = `${xy.x}:${xy.y}`;
    if (ticked.has(at)) return;
    ticked.add(at);
    page2?.drawText("X", { x: xy.x + 0.8, y: xy.y + 1.2, size: 8, font: bold, color: rgb(0, 0, 0) });
  };

  if (page2) {
    for (const c of chosen) {
      const label = PROGRAM_BOX[c] ?? PROGRAM_BOX[Object.keys(PROGRAM_BOX).find((k) => k.toLowerCase() === c.toLowerCase()) ?? ""];
      const xy = label ? PROGRAM_XY[label] : undefined;
      if (xy) tick(xy);
    }

    // The urgent flags. Matched case-insensitively so the model's casing
    // cannot silently drop an eviction notice on the floor.
    const urgent = (answers.values["urgent"] ?? "").split(",").map((u) => u.trim()).filter(Boolean);
    for (const u of urgent) {
      if (/^none$/i.test(u)) continue;
      const key = Object.keys(URGENT_XY).find((k) => k.toLowerCase() === u.toLowerCase());
      if (key) tick(URGENT_XY[key]);
    }
    // Some of these are implied by answers given elsewhere; a person who told
    // us they have a shutoff notice should not have to say it twice.
    if (/^(y|yes|true)$/i.test(answers.values["utilities.shutoffNotice"] ?? "")) tick(URGENT_XY.utilityShutoff);
    if ((answers.values["shelter.type"] ?? "").toLowerCase() === "shelter") tick(URGENT_XY.homeless);

    const lang = (answers.values["language.read"] ?? answers.values["language.speak"] ?? "").toLowerCase();
    if (lang.includes("english")) tick(LANG_XY.english);
    else if (lang.includes("spanish")) tick(LANG_XY.spanish);
    else if (lang) tick(LANG_XY.other);
  }

  /* ---- 2b. Section 3, the applicant's own details ------------------ */
  if (page2) {
    const v = answers.values;
    const put = (c: { x: number; y: number; w: number }, text?: string) => {
      if (!text || text === "skip" || text === "unknown") return;
      let t = text;
      while (t.length > 1 && helv.widthOfTextAtSize(t, 8) > c.w - 5) t = t.slice(0, -1);
      // The label is printed inside the box; write below it, not over it.
      page2.drawText(t, { x: c.x + 3, y: c.y + 4, size: 8, font: helv, color: rgb(0, 0, 0) });
    };
    put(APPLICANT.firstName, v["applicant.firstName"]);
    put(APPLICANT.lastName, v["applicant.lastName"]);
    put(APPLICANT.street, v["address.street"]);
    put(APPLICANT.apt, v["address.apt"]);
    put(APPLICANT.city, v["address.city"]);
    put(APPLICANT.county, v["address.county"]);
    put(APPLICANT.state, v["address.state"] ?? (v["address.city"] ? "NY" : undefined));
    put(APPLICANT.zip, v["address.zip"]);

    const digits = (v["applicant.phone"] ?? "").replace(/\D/g, "");
    if (digits.length >= 10) {
      put(APPLICANT.phoneArea, digits.slice(0, 3));
      put(APPLICANT.phoneRest, `${digits.slice(3, 6)}-${digits.slice(6, 10)}`);
    }

    // The mailing block is only filled when it actually differs — a duplicated
    // address reads as a second address and gets queried.
    if (v["mailing.same"] && !/^(y|yes|true|same)$/i.test(v["mailing.same"])) {
      put(APPLICANT.mailStreet, v["mailing.street"]);
      put(APPLICANT.mailApt, v["mailing.apt"]);
      put(APPLICANT.mailCity, v["mailing.city"]);
      put(APPLICANT.mailCounty, v["mailing.county"]);
      put(APPLICANT.mailState, v["mailing.state"]);
      put(APPLICANT.mailZip, v["mailing.zip"]);
    }
  }

  /* ---- 3. Section 6, the household roster -------------------------- */
  const page3 = pages[2];
  if (page3) {
    const v = answers.values;
    const write = (row: number, col: keyof typeof ROSTER.col, text?: string) => {
      if (!text || text === "skip" || text === "unknown") return;
      const y = ROSTER.rowY[row];
      if (y === undefined) return;
      const c = ROSTER.col[col];
      // Clip rather than overflow into the neighbouring column.
      let t = text;
      while (t.length > 1 && helv.widthOfTextAtSize(t, 7.5) > c.w - 4) t = t.slice(0, -1);
      page3.drawText(t, { x: c.x + 2, y: y + 6, size: 7.5, font: helv, color: rgb(0, 0, 0) });
    };

    const people = [
      {
        name: [v["applicant.firstName"], v["applicant.lastName"]].filter(Boolean).join(" "),
        dob: v["applicant.dob"], sex: v["applicant.sex"], ssn: v["applicant.ssn"],
      },
      ...Array.from({ length: 7 }, (_, i) => {
        const n = i + 1;
        return {
          name: [v[`household[${n}].firstName`], v[`household[${n}].lastName`]].filter(Boolean).join(" "),
          dob: v[`household[${n}].dob`], sex: v[`household[${n}].sex`], ssn: v[`household[${n}].ssn`],
        };
      }),
    ];

    people.forEach((person, i) => {
      if (!person.name && !person.dob) return;
      write(i, "name", person.name);
      write(i, "dob", usDate(person.dob));
      write(i, "sex", person.sex);
      write(i, "ssn", (person.ssn ?? "").replace(/\D/g, ""));
    });
  }

  appendix(doc, form, answers, helv, bold);
  return doc.save();
}

function appendix(
  doc: PDFDocument,
  form: ProgramForm,
  answers: FormAnswers,
  helv: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  const entries = Object.entries(answers.values).filter(([, v]) => v && v !== "skip" && v !== "unknown");
  const skipped = Object.entries(answers.values).filter(([, v]) => v === "skip" || v === "unknown");

  const W = 792, H = 612, M = 46;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const line = (text: string, size: number, font = helv, color = rgb(0.1, 0.1, 0.1)) => {
    if (y < M + 20) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
    page.drawText(text, { x: M, y, size, font, color });
    y -= size + 5;
  };

  line(`${form.code} — answers collected with livingston`, 13, bold);
  line(form.title, 9, helv, rgb(0.35, 0.35, 0.35));
  line(
    `${entries.length} answered · ${skipped.length} asked and not given · ${answers.done.length} of ${form.sections.filter((s) => !s.consent).length} sections complete`,
    8,
    helv,
    rgb(0.35, 0.35, 0.35),
  );
  y -= 6;
  line("This is a draft. Nothing here has been submitted to any agency.", 8, helv, rgb(0.55, 0.15, 0.15));
  y -= 8;

  const used = new Set<string>();
  for (const g of GROUPS) {
    const rows = entries.filter(([k]) => g.prefix.test(k));
    if (!rows.length) continue;
    rows.forEach(([k]) => used.add(k));
    y -= 4;
    line(g.title.toUpperCase(), 8, bold, rgb(0.3, 0.3, 0.3));
    for (const [k, v] of rows) {
      const text = `${k}   ${v}`;
      line(text.length > 130 ? `${text.slice(0, 127)}…` : text, 9);
    }
  }
  const rest = entries.filter(([k]) => !used.has(k));
  if (rest.length) {
    y -= 4;
    line("OTHER", 8, bold, rgb(0.3, 0.3, 0.3));
    for (const [k, v] of rest) line(`${k}   ${v}`, 9);
  }
  if (skipped.length) {
    y -= 6;
    line("ASKED, NOT GIVEN", 8, bold, rgb(0.3, 0.3, 0.3));
    for (const [k, v] of skipped) line(`${k}   (${v})`, 9, helv, rgb(0.45, 0.45, 0.45));
  }
}
