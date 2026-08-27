// /api/send-application — put the filled application in someone's hands.
//   POST { to, formCode, pdfBase64, mode: "self" | "office", county?, note? }
//
// Two modes, and the difference matters:
//   "self"   — email the draft to the applicant. They sign it and file it.
//   "office" — email it to the county district on their behalf.
//
// "office" is a real-world action taken for someone else, so it is deliberately
// harder than "self": it requires an explicit `confirm: true`, it always copies
// the applicant so they hold a record of what was sent in their name, and it
// says plainly in the body that the county may still require a signed original.
// Most New York districts do NOT accept an emailed application as a filing —
// this gets the paperwork in front of a caseworker, it does not file it.
//
// Classic (req, res) signature — the web-handler form hangs on Vercel here.

export const config = { maxDuration: 30 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PDF = 10 * 1024 * 1024;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Email isn't configured yet — RESEND_API_KEY is missing." });

  const { to, cc, formCode, formTitle, pdfBase64, mode, county, note, confirm } = req.body ?? {};

  const addr = String(to ?? "").trim();
  if (!EMAIL.test(addr)) return res.status(400).json({ error: "That email address doesn't look right." });
  if (!pdfBase64) return res.status(400).json({ error: "There's no application to send yet." });
  if (mode !== "self" && mode !== "office") return res.status(400).json({ error: "mode must be self or office" });
  if (mode === "office" && confirm !== true) {
    return res.status(400).json({ error: "Sending on someone's behalf needs an explicit confirmation." });
  }

  let pdf: Buffer;
  try {
    pdf = Buffer.from(String(pdfBase64), "base64");
  } catch {
    return res.status(400).json({ error: "Could not read the application file." });
  }
  if (!pdf.length || pdf.length > MAX_PDF) return res.status(400).json({ error: "That application file looks invalid." });

  const code = String(formCode ?? "application").replace(/[^A-Za-z0-9-]/g, "");
  const title = String(formTitle ?? "");
  const filename = `${code || "application"}-draft.pdf`;

  const selfBody = [
    `<p>Your <strong>${code}</strong> draft is attached.${title ? ` (${title})` : ""}</p>`,
    `<p>It was filled in from the answers you gave in the conversation. <strong>Read it before you file it</strong> — check every line, and fill in anything that was left blank.</p>`,
    `<p>Nothing has been submitted to any agency. To file it, sign it and take or mail it to your county Department of Social Services, or apply online at <a href="https://mybenefits.ny.gov">mybenefits.ny.gov</a>.</p>`,
    note ? `<p>${String(note).slice(0, 800)}</p>` : "",
    `<p style="color:#666;font-size:12px">You always have the right to apply, whatever any screening tool says.</p>`,
  ].join("");

  const officeBody = [
    `<p>Attached is a <strong>${code}</strong> application draft${county ? ` for ${String(county).slice(0, 40)} County` : ""}, prepared with the applicant and sent at their request.</p>`,
    `<p>The applicant is copied on this message.</p>`,
    note ? `<p>${String(note).slice(0, 800)}</p>` : "",
    `<p style="color:#666;font-size:12px">Prepared with sam. If a signed original or a different filing method is required, please reply so the applicant can complete it.</p>`,
  ].join("");

  const recipients = [addr];
  const ccList = typeof cc === "string" && EMAIL.test(cc.trim()) ? [cc.trim()] : [];

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "sam <onboarding@resend.dev>",
        to: recipients,
        cc: ccList.length ? ccList : undefined,
        subject: mode === "self" ? `Your ${code} draft` : `${code} application${county ? ` — ${county} County` : ""}`,
        html: mode === "self" ? selfBody : officeBody,
        attachments: [{ filename, content: pdf.toString("base64") }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: `Email provider refused it (${r.status})`, detail: detail.slice(0, 300) });
    }
    return res.status(200).json({ ok: true, sentTo: addr, cc: ccList[0] ?? null, mode });
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message });
  }
}
