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

export type FieldKind = "text" | "textarea" | "number" | "money" | "date" | "tel" | "email" | "ssn" | "select" | "radio" | "checkbox";

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
}

const BLOCK = /```livingston-fields\s*([\s\S]*?)```/;

const KINDS: FieldKind[] = ["text", "textarea", "number", "money", "date", "tel", "email", "ssn", "select", "radio", "checkbox"];

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
    const shown = label || key.split(".").pop()!.replace(/\[\d+\]/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    const kind = KINDS.includes(f.kind as FieldKind) ? (f.kind as FieldKind) : "text";
    const options = Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string") : undefined;
    // A select with nothing to select from is a text box, not a dead dropdown.
    const settled: FieldKind = (kind === "select" || kind === "radio" || kind === "checkbox") && !options?.length ? "text" : kind;
    out.push({
      key,
      label: shown,
      kind: settled,
      options,
      placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
      help: typeof f.help === "string" ? f.help : undefined,
      value: typeof f.value === "string" ? f.value : undefined,
      optional: f.optional === true,
    });
  }
  return out.length ? out : null;
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
