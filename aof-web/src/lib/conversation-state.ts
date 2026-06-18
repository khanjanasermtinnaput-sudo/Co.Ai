// ── Nexora Code V4 — Conversation State Machine ─────────────────────────────────
// Implements the six-state model from the AOF CODE V4 collaborative prompt.
// All functions are pure so they are trivially testable without mocks.
//
// States:
//   NORMAL_CHAT    — casual conversation, tech Q&A, greetings (no project context)
//   DISCOVERY      — understanding the user's goal (entry point for new projects)
//   BRAINSTORMING  — thinking TOGETHER: Nexora contributes ideas, directions, trade-offs
//                    (behavioural mode WITHIN discovery — classifyTurn never returns
//                    this; the persona handles the collaborative 50/50 behaviour)
//   PLANNING       — designing architecture, components, structure
//   CODING         — TMAP generation (only on explicit trigger)
//   DEBUGGING      — diagnosing errors / root cause / patch

export type ConvState =
  | "NORMAL_CHAT"
  | "DISCOVERY"
  | "BRAINSTORMING"
  | "PLANNING"
  | "CODING"
  | "DEBUGGING";

// Greetings: exact-match (after trim) so "hi, I want to build an app" is NOT a greeting.
const GREETING_EXACT = new Set([
  // English
  "hi", "hello", "hey", "yo", "test", "ok", "okay", "thanks", "thank you",
  "sup", "howdy", "hiya", "helo", "thx", "ty", "k", "np", "cool", "nice",
  "good", "great", "awesome", "alright", "sure", "yep", "yeah", "yup", "nope",
  // Thai
  "สวัสดี", "หวัดดี", "ไง", "ดี", "เฮ้", "โอเค", "ขอบคุณ", "ขอบคุณนะ",
  "ขอบใจ", "โอเคครับ", "โอเคค่ะ", "ดีครับ", "ดีค่ะ", "เยี่ยม", "เจ๋ง",
  "เข้าใจแล้ว", "รับทราบ", "โอเค้", "ok ครับ", "ok ค่ะ",
]);

// Software artifact nouns — shared across patterns.
const ARTIFACTS =
  "app|application|website|web\\s*app|web\\s*site|game|api|tool|saas|platform|system|bot|service|cli|dashboard|landing\\s*page|portfolio|backend|frontend";

// Build intent: software-artifact verbs paired with software artifact nouns.
// Patterns test against the RAW message (not lowercased) so Thai chars are preserved.
const BUILD_INTENT_PATTERNS: RegExp[] = [
  // Verb-first: "build/make/create X" where X is a software artifact
  new RegExp(`\\b(build|make|create|develop|write|implement|code|design|start)\\b.{0,50}\\b(${ARTIFACTS})\\b`, "i"),
  // Artifact-first descriptions (common when pasting project ideas):
  // "A snake game that…", "A REST API for…", "A landing page with…"
  new RegExp(`^(a|an)\\s+.{0,50}\\b(${ARTIFACTS})\\b`, "i"),
  // "[Name] clone" pattern — "discord clone", "twitter clone"
  /\b\w[\w-]+\s+(clone|alternative|replica)\b/i,
  // "I want/need to build/make/create/develop …"
  /\b(i\s+(want|need|wanna|would\s+like)\s+to|help\s+me|can\s+you\s+help)\b.{0,30}\b(build|make|create|develop|code|write|implement)\b/i,
  // "I'm building/creating/developing …"
  /\bi'?m\s+(building|creating|making|developing|working\s+on)\b/i,
  // Artifact noun appears BEFORE a build verb: "an app I want to build"
  new RegExp(`\\b(${ARTIFACTS})\\b.{0,30}\\b(build|make|create|develop|write|implement)\\b`, "i"),
  // Thai: ทำ/สร้าง + software artifact
  /ทำ(เว็บ|แอป|เกม|ระบบ|api|เครื่องมือ|บอท|แพลตฟอร์ม|แดชบอร์ด|เว็บแอป|เซอร์วิส|เซิร์ฟเวอร์|โปรแกรม)/,
  /สร้าง(เว็บ|แอป|เกม|ระบบ|api|เครื่องมือ|บอท|แพลตฟอร์ม|แดชบอร์ด|เว็บแอป|เซอร์วิส|โปรแกรม)/,
  // Thai: อยากทำ/อยากสร้าง + artifact
  /อยาก(ทำ|สร้าง|พัฒนา|เขียน).{0,25}(เว็บ|แอป|เกม|ระบบ|api|แพลตฟอร์ม|โปรแกรม)/,
  // Thai: ช่วยทำ/ช่วยสร้าง
  /ช่วย(ทำ|สร้าง|พัฒนา|เขียน).{0,25}(เว็บ|แอป|เกม|ระบบ|api|แพลตฟอร์ม|โปรแกรม)/,
  // Thai: ต้องการทำ
  /ต้องการ(ทำ|สร้าง|พัฒนา).{0,25}(เว็บ|แอป|เกม|ระบบ|api)/,
];

/** True when the message is a standalone greeting or casual acknowledgement. */
export function isGreeting(text: string): boolean {
  const t = text.trim().toLowerCase();
  // Remove trailing punctuation before matching exact set
  const stripped = t.replace(/[!?.…]+$/, "").trim();
  return GREETING_EXACT.has(stripped) || GREETING_EXACT.has(t);
}

/** True when the message describes intent to build a software project. */
export function containsBuildIntent(text: string): boolean {
  return BUILD_INTENT_PATTERNS.some((re) => re.test(text));
}

/**
 * Classify the current turn into one of the five conversation states.
 *
 * Priority order:
 * 1. debugMode flag → DEBUGGING  (explicit mode set by the user)
 * 2. projectActive  → DISCOVERY  (already in a project — stay sticky until reset)
 * 3. build intent   → DISCOVERY  (starts a new project conversation)
 * 4. everything else → NORMAL_CHAT
 */
export function classifyTurn(input: {
  message: string;
  projectActive: boolean;
  debugMode: boolean;
}): ConvState {
  const { message, projectActive, debugMode } = input;

  if (debugMode) return "DEBUGGING";
  if (projectActive) return "DISCOVERY";
  if (containsBuildIntent(message)) return "DISCOVERY";
  return "NORMAL_CHAT";
}
