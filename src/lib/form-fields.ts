/**
 * Interactive fields inside the assistant's own message.
 *
 * A benefits interview needs values, not prose, and asking a model to restate
 * an answer it just read back in a machine block is a game of telephone. So the
 * assistant asks with real controls: it emits a ```livingston-fields``` block and the
 * transcript renders actual inputs. Whatever the user types there is the value,
 * exactly as typed — no re-parsing, no transcription drift.
 *
 * The user can still ignore the controls and just say it in the chat box; the
 * assistant handles that turn the ordinary way. Both roads lead to the same
 * `livingston-answers` block, which is also what the submit button sends back — one
 * format in both directions, harvested by one parser.
 */

import { labelFor, optionsFor } from "@/lib/programs";

export type FieldKind = "text" | "textarea" | "number" | "money" | "date" | "tel" | "email" | "ssn" | "select" | "radio" | "checkbox" | "attest";

/** A field that stands in its own box: amber for something being attested to, blue for information. */
export type FieldTone = "caution" | "info";

export interface ChatField {
  /** A key from FORM_KEYS — this is what the answer gets stored under. */
  key: string;
  label: string;
  kind: FieldKind;
  /** For select / radio / checkbox. `value|Label` or just `Value`. */
  options?: string[];
  placeholder?: string;
  help?: string;
  /** Prefill, when the assistant is confirming something it already knows. */
  value?: string;
  optional?: boolean;
  /** Boxed on its own, in this colour. `attest` is always `caution`. */
  tone?: FieldTone;
  /** The fine print behind an attestation, opened in a new tab from the box's ⓘ. */
  href?: string;
}

const BLOCK = /```livingston-fields\s*([\s\S]*?)```/;
const REVIEW = /```livingston-review\s*([\s\S]*?)```/;

const KINDS: FieldKind[] = ["text", "textarea", "number", "money", "date", "tel", "email", "ssn", "select", "radio", "checkbox", "attest"];

/**
 * Keys the app boxes and colours on its own, whatever the model wrote — the
 * certification is an attestation and the voter question is an offer, and
 * neither should depend on the model remembering a `tone`.
 */
const HOUSE_TONE: Record<string, { tone: FieldTone; kind?: FieldKind; href?: string }> = {
  "certification.agree": { tone: "caution", kind: "attest", href: "/forms/LDSS-2921.pdf#page=5" },
  "voter.register": { tone: "info", href: "/forms/LDSS-2921.pdf#page=27" },
};

/** Read the field block out of a message, if there is one. */
export function parseFieldBlock(text: string): ChatField[] | null {
  const m = BLOCK.exec(text);
  if (!m) return null;
  const body = m[1].trim();
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    // The model sometimes writes the block as YAML-ish key/value lines instead
    // of JSON. Silently rendering nothing would be the worst outcome — the user
    // gets prose with no controls and no idea anything was meant to be there —
    // so read that shape too rather than dropping the questions on the floor.
    raw = parseLoose(body);
    if (!raw) return null;
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const out: ChatField[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const f = r as Record<string, unknown>;
    const key = typeof f.key === "string" ? f.key.trim() : "";
    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (!key) continue;
    const shown = label || labelFor(key);
    let kind = KINDS.includes(f.kind as FieldKind) ? (f.kind as FieldKind) : "text";
    let options = Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string") : undefined;
    // The form's own fixed values win. Employment status was once answered as
    // free text because the model asked in prose; a key with options in
    // FORM_KEYS is a select (or checkboxes) no matter what the model wrote,
    // and the model's own option list is dropped.
    const fixed = optionsFor(key);
    if (fixed) {
      kind = fixed.multi ? "checkbox" : kind === "attest" ? "attest" : "select";
      options = fixed.options;
    }
    const house = HOUSE_TONE[key];
    if (house?.kind) kind = house.kind;
    // An attestation is yes/no; the house values win, the model's are dropped.
    if (kind === "attest" && !options?.length) options = ["yes|I agree", "no|Not yet"];
    // A select with nothing to select from is a text box, not a dead dropdown.
    const settled: FieldKind = (kind === "select" || kind === "radio" || kind === "checkbox") && !options?.length ? "text" : kind;
    const tone: FieldTone | undefined =
      settled === "attest" ? "caution" : house?.tone ?? (f.tone === "caution" || f.tone === "info" ? f.tone : undefined);
    out.push({
      key,
      label: shown,
      kind: settled,
      options,
      placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
      help: typeof f.help === "string" ? f.help : undefined,
      value: typeof f.value === "string" ? f.value : undefined,
      optional: f.optional === true,
      tone,
      href: house?.href ?? (typeof f.href === "string" && /^(\/|https?:\/\/)/.test(f.href) ? f.href : undefined),
    });
  }
  return out.length ? out : null;
}

/** The close: the model asks for the review; the app draws it from the record. */
export const hasReviewBlock = (text: string) => REVIEW.test(text);

export function stripReviewBlock(text: string): string {
  return text.replace(REVIEW, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * A tolerant reader for the non-JSON shape:
 *
 *   key: programs
 *   kind: checkbox
 *   options:
 *     - PA|Public Assistance
 *
 * A blank line or a repeated `key:` starts the next field.
 */
function parseLoose(body: string): Record<string, unknown>[] | null {
  const out: Record<string, unknown>[] = [];
  let cur: Record<string, unknown> | null = null;
  let inOptions = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line === "-") {
      if (!line) inOptions = false;
      continue;
    }
    if (line.startsWith("-")) {
      if (cur && inOptions) ((cur.options as string[]) ??= []).push(line.replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
      continue;
    }
    const i = line.indexOf(":");
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "").replace(/,$/, "");
    if (k === "key") {
      if (cur) out.push(cur);
      cur = { key: v };
      inOptions = false;
      continue;
    }
    if (!cur) continue;
    if (k === "options") {
      inOptions = true;
      if (v) cur.options = v.replace(/^\[|\]$/g, "").split(",").map((o) => o.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      continue;
    }
    inOptions = false;
    cur[k] = k === "optional" ? /^(true|yes)$/i.test(v) : v;
  }
  if (cur) out.push(cur);
  return out.length ? out : null;
}

/** The block is scaffolding; it never belongs in the prose. */
export function stripFieldBlock(text: string): string {
  return text.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** Split `value|Label` options. */
export function optionParts(o: string): { value: string; label: string } {
  const i = o.indexOf("|");
  return i === -1 ? { value: o, label: o } : { value: o.slice(0, i), label: o.slice(i + 1) };
}

/**
 * What the user turn looks like when they submit the controls: the same
 * `livingston-answers` block the assistant emits, so one parser harvests both.
 */
export function answersMessage(values: Record<string, string>): string {
  const lines = Object.entries(values).map(([k, v]) => `${k}: ${v}`);
  return "```livingston-answers\n" + lines.join("\n") + "\n```";
}
