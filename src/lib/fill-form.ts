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

export async function fillForm(form: ProgramForm, answers: FormAnswers): Promise<Uint8Array> {
  const res = await fetch(form.pdf);
  if (!res.ok) throw new Error(`Could not load ${form.code} (${res.status})`);
  const doc = await PDFDocument.load(await res.arrayBuffer(), { ignoreEncryption: true });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  /* ---- 1. the program checkboxes ---------------------------------- */
  const chosen = (answers.values["programs"] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const page2 = pages[1];
  if (page2) {
    for (const c of chosen) {
      const label = PROGRAM_BOX[c] ?? PROGRAM_BOX[Object.keys(PROGRAM_BOX).find((k) => k.toLowerCase() === c.toLowerCase()) ?? ""];
      const xy = label ? PROGRAM_XY[label] : undefined;
      if (!xy) continue;
      page2.drawText("X", { x: xy.x + 0.8, y: xy.y + 1.2, size: 8, font: bold, color: rgb(0, 0, 0) });
    }
  }

  /* ---- 2. the answers appendix ------------------------------------ */
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

  line(`${form.code} — answers collected with sam`, 13, bold);
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

  return doc.save();
}
