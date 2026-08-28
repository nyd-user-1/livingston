/**
 * Answers collected during a form interview.
 *
 * The model runs the conversation, but a conversation is not a record. So each
 * time it learns something it emits a fenced `livingston-answers` block of plain
 * key/value pairs; the client parses those out of the stream, keeps them, and
 * hides the block from the transcript. The user sees a conversation; we get a
 * record we can write onto the PDF.
 *
 * Keys are the form's own vocabulary (`applicant.lastName`, `household[1].dob`),
 * not PDF field names. The adapter maps vocabulary to fields, so re-cutting the
 * PDF never invalidates an answer someone already gave.
 */

export interface FormAnswers {
  formId: string;
  /** key → value, in the form's vocabulary. */
  values: Record<string, string>;
  /** Sections the model has reported finished, in order. */
  done: string[];
  updatedAt: string;
}

/** Matches ```livingston-answers … ``` anywhere in a message. */
const BLOCK = /```livingston-answers\s*([\s\S]*?)```/g;

export function emptyAnswers(formId: string): FormAnswers {
  return { formId, values: {}, done: [], updatedAt: new Date().toISOString() };
}

/**
 * Pull every answer block out of a message.
 * Lines are `key: value`; a line of `#done <section>` marks a section complete.
 */
export function parseAnswerBlocks(text: string): { values: Record<string, string>; done: string[] } {
  const values: Record<string, string> = {};
  const done: string[] = [];
  for (const m of text.matchAll(BLOCK)) {
    for (const raw of m[1].split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#done")) {
        const s = line.slice(5).trim();
        if (s) done.push(s);
        continue;
      }
      const i = line.indexOf(":");
      if (i < 1) continue;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (!key) continue;
      // "skip" and "unknown" are real answers — they mean asked-and-not-given,
      // which is different from never asked. Keep them.
      values[key] = value;
    }
  }
  return { values, done };
}

/** The transcript should not show the machine block. */
export function stripAnswerBlocks(text: string): string {
  return text.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function mergeAnswers(prev: FormAnswers, next: { values: Record<string, string>; done: string[] }): FormAnswers {
  return {
    formId: prev.formId,
    values: { ...prev.values, ...next.values },
    done: [...new Set([...prev.done, ...next.done])],
    updatedAt: new Date().toISOString(),
  };
}

/* ---- persistence ----------------------------------------------------- */
// Local first: a benefits interview is 40 minutes and people get interrupted.
// The server copy comes later; losing a tab must never lose the answers.

const key = (formId: string, sessionId?: string | null) =>
  `livingston-answers:${formId}${sessionId ? `:${sessionId}` : ""}`;

export function loadAnswers(formId: string, sessionId?: string | null): FormAnswers {
  try {
    const raw = localStorage.getItem(key(formId, sessionId));
    if (raw) return JSON.parse(raw) as FormAnswers;
  } catch {
    /* private mode — start fresh, no harm */
  }
  return emptyAnswers(formId);
}

export function saveAnswers(a: FormAnswers, sessionId?: string | null) {
  try {
    localStorage.setItem(key(a.formId, sessionId), JSON.stringify(a));
  } catch {
    /* quota or private mode — the conversation still holds the answers */
  }
}

export const answerCount = (a: FormAnswers) => Object.keys(a.values).length;

/* ---- which form is in hand ------------------------------------------ */
// A 40-minute interview must survive a refresh, a closed tab, and a phone
// running out of battery. The answers already persist; this remembers which
// form they belong to so the conversation picks up where it stopped.

const ACTIVE = (sessionId?: string | null) => `livingston-active-form${sessionId ? `:${sessionId}` : ""}`;

export function rememberActiveForm(formId: string | null, sessionId?: string | null) {
  try {
    if (formId) localStorage.setItem(ACTIVE(sessionId), formId);
    else localStorage.removeItem(ACTIVE(sessionId));
  } catch {
    /* private mode — the conversation is still on screen */
  }
}

export function recallActiveForm(sessionId?: string | null): string | null {
  try {
    return localStorage.getItem(ACTIVE(sessionId));
  } catch {
    return null;
  }
}
