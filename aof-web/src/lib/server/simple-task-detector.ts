// ── Simple Task Detector — lightweight response-style classifier for Mikros ──
// Deterministic, zero-cost classification that runs before Mikros Processing to
// pick a response SHAPE (terse / explanatory / code-focused). Per the Co.AI
// Master Prompt's Simple Task Detector spec, this is explicitly NOT a workflow
// stage and NEVER an additional AI call: keyword/length/pattern matching only,
// target <10ms, no network, no external dependency. effort.ts separately owns
// response DEPTH (token budget/temperature) — this only owns SHAPE. Scoped by
// the caller to the same plain-chat Mikros (`lite`) path as tierAllowsSearch();
// Kanon and every agent-driven path are unaffected.
//
// Deliberately does NOT reuse mock.ts's isLearningProblem(): that classifier
// intentionally treats proofs/derivatives/theorems as "learning problems" for
// the offline tutor mock, which is the opposite of "simple" here — a request
// to prove a theorem is not a short-direct-answer task.

export type SimpleTaskCategory = "simple" | "medium" | "light-coding";

export interface TaskDetection {
  category: SimpleTaskCategory;
  reason: string;
}

// Thai script isn't a JS regex "word" character, so `\b` is unreliable right
// after/before it (e.g. it fails between a Thai char and a following space).
// English alternatives use `\b`; Thai ones rely on substring containment only.
const GREETING_TH_RE = /^(สวัสดี|หวัดดี)/;
const GREETING_EN_RE = /^(hello+|hi+|hey+|yo)\b/i;

// A bare small arithmetic expression ("2+2", "5 * 3 =", "10/2 เท่ากับเท่าไหร่") —
// narrow on purpose so it only catches trivial arithmetic, not word problems.
const BARE_ARITHMETIC_RE =
  /^[\d\s+\-*/×÷().]+[=?]?\s*(เท่ากับเท่าไหร่|เท่าไหร่|เท่ากับ|equals?)?\s*[?]?$/i;

const TRANSLATE_RE = /(แปล(ภาษา|คำ)?|translate)/i;
const MEANING_RE = /(ความหมาย(ของคำ)?นี้|.+แปลว่าอะไร|meaning of|what does .+ mean)/i;
const REWRITE_RE = /(เขียน.*ใหม่|เรียบเรียง.*ใหม่|rewrite|paraphrase)/i;

// Hard signals: unambiguous code artifacts regardless of surrounding wording.
const HARD_CODE_SIGNAL_RE =
  /```|traceback \(most recent call last\)|\b\w+error\b\s*:|\b\w+exception\b\s*:|undefined is not a function|null pointer exception|at\s+\S+\s*\([^)]*:\d+:\d+\)/i;

// Soft signals require BOTH an action verb and a code noun — a bare mention of
// "class"/"function" in a conceptual question ("Python class คืออะไร") must NOT
// trigger light-coding; only an actual verb-on-code phrasing should.
const CODE_ACTION_VERB_TH_RE = /(แก้|เขียน|ดีบัก|อธิบาย)/;
const CODE_ACTION_VERB_EN_RE = /\b(debug|fix|resolve|solve)\b/i;
const CODE_NOUN_TH_RE = /(โค้ด|ฟังก์ชัน|บั๊ก|ข้อผิดพลาด)/;
const CODE_NOUN_EN_RE = /\b(error|code|function|bug|exception|traceback|class)\b/i;

function hasCodeActionVerb(message: string): boolean {
  return CODE_ACTION_VERB_TH_RE.test(message) || CODE_ACTION_VERB_EN_RE.test(message);
}

function hasCodeNoun(message: string): boolean {
  return CODE_NOUN_TH_RE.test(message) || CODE_NOUN_EN_RE.test(message);
}

function isCodingSignal(message: string): boolean {
  if (HARD_CODE_SIGNAL_RE.test(message)) return true;
  return hasCodeActionVerb(message) && hasCodeNoun(message);
}

function simpleSignalReason(message: string): string | null {
  if (GREETING_TH_RE.test(message) || GREETING_EN_RE.test(message)) return "greeting";
  if (BARE_ARITHMETIC_RE.test(message)) return "bare arithmetic expression";
  if (message.length <= 80 && TRANSLATE_RE.test(message)) return "translation request";
  if (message.length <= 80 && MEANING_RE.test(message)) return "meaning/definition request";
  if (message.length <= 120 && REWRITE_RE.test(message)) return "rewrite request";
  return null;
}

/** Classify a Mikros plain-chat message into a response-style category.
 *  Deterministic, synchronous, no I/O. Coding signals are checked first since
 *  e.g. "อธิบาย code นี้" and "อธิบาย OAuth" share the same verb but need
 *  different response shapes — the presence of a code noun, not the verb
 *  alone, decides it. */
export function detectSimpleTask(message: string): TaskDetection {
  const trimmed = message.trim();
  if (isCodingSignal(trimmed)) {
    return { category: "light-coding", reason: "coding/error signal detected" };
  }
  const simpleReason = simpleSignalReason(trimmed);
  if (simpleReason) {
    return { category: "simple", reason: simpleReason };
  }
  return { category: "medium", reason: "default — explanatory request" };
}

/** Response-style instruction for `category`, appended to Mikros's system
 *  prompt. Distinct from effort.ts's addons, which size response DEPTH. */
export function simpleTaskSystemAddon(category: SimpleTaskCategory): string {
  switch (category) {
    case "simple":
      return (
        "RESPONSE STYLE — SIMPLE REQUEST: Give a short, direct answer. Skip explanation, " +
        "caveats and extra detail unless the user actually asked for them."
      );
    case "light-coding":
      return (
        "RESPONSE STYLE — CODE-FOCUSED REQUEST: Focus the response on the code itself — the " +
        "fix, the function, or the explanation of what the code does. Explain only the " +
        "important parts and skip unrelated architecture or design discussion."
      );
    case "medium":
    default:
      return (
        "RESPONSE STYLE — EXPLANATORY REQUEST: Give a clear explanation, with a short example " +
        "if it helps understanding. Moderate level of detail — not exhaustive."
      );
  }
}
