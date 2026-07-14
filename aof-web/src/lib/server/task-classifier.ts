// ── Ypertatos Task Classifier — Co.AI Master Prompt Part 5.2 ──────────────────
// Mandatory entry point for every Ypertatos ("pro") request: routes each turn
// to the smallest workflow capable of solving it (`stagesFor()`'s
// "lightweight" vs "engineering" tables in model-workflow.ts). Deterministic,
// synchronous, zero network, zero LLM call — target <15ms, measured, not
// asserted. Sibling of simple-task-detector.ts (same "not a workflow stage"
// discipline) and reuses router.ts's CategoryRule{category,weight,patterns}
// shape and EN+Thai regex-corpus style — but is otherwise a separate module:
// router.ts answers "which product surface (Co.AI/CoCode/Search)?", this
// answers "does this Ypertatos turn need the engineering workflow?". Zero
// taxonomy overlap between the two.
//
// Thai gotcha (see simple-task-detector.ts): Thai script isn't a JS regex
// "word" character, so `\b` is unreliable adjacent to it. English patterns
// use `\b`; Thai patterns rely on substring containment only — always kept as
// separate regex literals, never combined into one pattern with `\b`.

import type { EffortLevel, RepoMetadata } from "@/lib/types";
import type { ModelTier } from "@/lib/model-branding";
import type { YpertatosWorkflowKind } from "./model-workflow";

// RepoMetadata is defined in @/lib/types (client-safe) since api.ts also
// needs its shape to send workspace metadata in the request body — re-export
// it here so every existing import site (this module's own consumers,
// requirement-analysis.ts) keeps working unchanged.
export type { RepoMetadata };

export type YpertatosTaskCategory =
  | "conversation"
  | "question-answering"
  | "translation"
  | "summarization"
  | "explanation"
  | "writing"
  | "code-explanation"
  | "bug-fix"
  | "code-generation"
  | "refactoring"
  | "project-creation"
  | "architecture-design"
  | "database-design"
  | "api-design"
  | "repository-analysis"
  | "documentation"
  | "security-review"
  | "testing"
  | "deployment"
  | "unknown";

export type TaskComplexity = "simple" | "medium" | "complex" | "large" | "enterprise";
export type ClassifierConfidence = "high" | "medium" | "low";

export interface TaskClassifierInput {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  tier: ModelTier;
  effort: EffortLevel;
  /** CoCode's open workspace. Absent when the workspace is empty — contributes
   *  zero to complexity, never a guess. */
  repo?: RepoMetadata;
}

export interface TaskDecision {
  category: YpertatosTaskCategory;
  complexity: TaskComplexity;
  engineeringRequired: boolean;
  workflow: YpertatosWorkflowKind;
  confidence: ClassifierConfidence;
  /** one human-readable line, assembled from the signals that ACTUALLY fired */
  reasoning: string;
  /** the exact rule ids that fired — logged verbatim, never invented */
  signals: string[];
  /** measured inside classifyTask() with performance.now() */
  durationMs: number;
}

export const ENGINEERING_CATEGORIES: ReadonlySet<YpertatosTaskCategory> = new Set([
  "bug-fix",
  "code-generation",
  "refactoring",
  "project-creation",
  "architecture-design",
  "database-design",
  "api-design",
  "repository-analysis",
  "security-review",
  "testing",
  "deployment",
]);

// ── Category rules — EN patterns use \b, Thai patterns never do ──────────────

interface CategoryRule {
  category: YpertatosTaskCategory;
  weight: number;
  patterns: RegExp[];
}

const MIN_HIGH_CONFIDENCE_SCORE = 6;

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "security-review",
    weight: 10,
    patterns: [
      /\bsecurity (review|audit)\b/i,
      /\bvulnerabilit(y|ies)\b/i,
      /\bpenetration test(ing)?\b/i,
      /\b(xss|csrf|sql injection)\b/i,
      /\bauth(entication|orization)? bypass\b/i,
      /ตรวจสอบความปลอดภัย/,
      /ช่องโหว่/,
    ],
  },
  {
    category: "bug-fix",
    weight: 9,
    patterns: [
      /\bfix\b.{0,20}\b(bug|error|issue|crash)\b/i,
      /\bdebug\b/i,
      /\btraceback \(most recent call last\)/i,
      /\bstack trace\b/i,
      /\b\w+error\b\s*:/i,
      /\b\w+exception\b\s*:/i,
      /null pointer exception/i,
      /แก้บั๊ก/,
      /แก้.{0,10}error/i,
      /ข้อผิดพลาด/,
    ],
  },
  {
    category: "code-generation",
    weight: 9,
    patterns: [
      /\bbuild\b.{0,30}\b(app|api|website|system|feature|service)\b/i,
      /\bcreate\b.{0,30}\b(app|api|website|component|script|service)\b/i,
      /\bimplement\b.{0,20}\b(feature|function|endpoint)\b/i,
      /\bwrite (a|the) (function|class|script|component)\b/i,
      /สร้าง(แอป|เว็บ|api|ระบบ)/,
      /เขียนโค้ด|เขียนฟังก์ชัน/,
    ],
  },
  {
    category: "project-creation",
    weight: 9,
    patterns: [
      /\bnew project\b/i,
      /\bstart(ing)? (a|an) (app|project|website)\b/i,
      /\bfrom scratch\b/i,
      /\bscaffold\b/i,
      /โปรเจกต์ใหม่/,
    ],
  },
  {
    category: "architecture-design",
    weight: 9,
    patterns: [
      /\barchitecture\b/i,
      /\bsystem design\b/i,
      /\bmicroservices?\b/i,
      /\bdesign (the|a|an) system\b/i,
      /สถาปัตยกรรม(ซอฟต์แวร์)?/,
      /ออกแบบระบบ/,
    ],
  },
  {
    category: "database-design",
    weight: 9,
    patterns: [
      /\bdatabase schema\b/i,
      /\btable (design|structure)\b/i,
      /\ber diagram\b/i,
      /\b(sql|postgres|mysql|mongodb)\b.{0,15}\bschema\b/i,
      /ออกแบบฐานข้อมูล/,
      /สคีมา/,
    ],
  },
  {
    category: "api-design",
    weight: 9,
    patterns: [
      /\bapi (design|spec|endpoint)/i,
      /\brest(ful)? api\b/i,
      /\bgraphql\b/i,
      /\bdesign\b.{0,15}\bendpoints?\b/i,
      /ออกแบบ ?api/i,
    ],
  },
  {
    category: "repository-analysis",
    weight: 9,
    patterns: [
      /\banalyze\b.{0,20}\b(repo|repository|codebase|project)\b/i,
      /\breview (this|the) (repo|codebase)\b/i,
      /\bcode review\b/i,
      /วิเคราะห์(โค้ด|repo|โปรเจกต์)/,
    ],
  },
  {
    category: "testing",
    weight: 8,
    patterns: [
      /\bwrite (unit |integration |e2e )?tests?\b/i,
      /\btest coverage\b/i,
      /\b(jest|pytest|vitest|playwright)\b/i,
      /เขียนเทส/,
      /ทดสอบ/,
    ],
  },
  {
    category: "deployment",
    weight: 8,
    patterns: [
      /\bdeploy(ment)?\b/i,
      /\bci\/cd\b/i,
      /\bdocker(file)?\b/i,
      /\bkubernetes\b/i,
      /\bproduction\b.{0,10}\b(release|launch)\b/i,
      /ดีพลอย/,
      /ปล่อยระบบ/,
    ],
  },
  {
    category: "refactoring",
    weight: 8,
    patterns: [
      /\brefactor\b/i,
      /\bclean ?up\b.{0,20}\bcode\b/i,
      /\bimprove\b.{0,20}\bcode\b/i,
      /\bsimplify\b.{0,20}\bcode\b/i,
      /ปรับปรุงโค้ด/,
      /รีแฟคเตอร์/,
    ],
  },
  {
    category: "translation",
    weight: 8,
    patterns: [/\btranslate\b/i, /\bin (thai|english|spanish|french|japanese)\b/i, /แปล(ภาษา|คำ)?/],
  },
  {
    category: "summarization",
    weight: 8,
    patterns: [/\bsummari[sz]e\b/i, /\btl;?dr\b/i, /สรุป/],
  },
  {
    category: "code-explanation",
    weight: 7,
    patterns: [
      /\bexplain (this|the) code\b/i,
      /\bwhat does this (function|code) do\b/i,
      /อธิบายโค้ด/,
      /โค้ดนี้ทำอะไร/,
    ],
  },
  {
    category: "documentation",
    weight: 7,
    patterns: [
      /\bwrite\b.{0,20}\bdocs?\b/i,
      /\bdocumentation\b/i,
      /\breadme\b/i,
      /\b(jsdoc|docstring)\b/i,
      /เขียนเอกสาร/,
    ],
  },
  {
    category: "writing",
    weight: 6,
    patterns: [
      /\bwrite (a|an|me)\b.{0,20}\b(email|essay|poem|story|letter|blog)\b/i,
      /\brewrite\b/i,
      /\bparaphrase\b/i,
      /เขียน(อีเมล|เรียงความ|จดหมาย)/,
    ],
  },
  {
    category: "explanation",
    weight: 5,
    patterns: [/\bexplain\b/i, /\bhow does .+ work\b/i, /อธิบาย/],
  },
  {
    category: "conversation",
    // A single unambiguous greeting match alone reaches MIN_HIGH_CONFIDENCE_SCORE
    // — a lone "hi"/"thanks" is genuinely a high-confidence signal, not a weak one.
    weight: MIN_HIGH_CONFIDENCE_SCORE,
    patterns: [/^(hello+|hi+|hey+|yo)\b/i, /\bhow are you\b/i, /\bthanks?\b/i, /^(สวัสดี|หวัดดี|ขอบคุณ)/],
  },
  {
    category: "question-answering",
    weight: 4,
    patterns: [/\bwhat is\b/i, /\bwho is\b/i, /\bwhen (is|was|did)\b/i, /\bwhere is\b/i, /อะไรคือ/, /คือใคร/],
  },
];

function scoreCategories(message: string): { category: YpertatosTaskCategory; score: number; matches: number }[] {
  const results: { category: YpertatosTaskCategory; score: number; matches: number }[] = [];
  for (const rule of CATEGORY_RULES) {
    const matches = rule.patterns.filter((p) => p.test(message)).length;
    if (matches > 0) results.push({ category: rule.category, score: matches * rule.weight, matches });
  }
  return results.sort((a, b) => b.score - a.score);
}

function computeConfidence(
  scored: { category: YpertatosTaskCategory; score: number }[],
): ClassifierConfidence {
  if (scored.length === 0) return "low";
  const top = scored[0].score;
  const runnerUp = scored[1]?.score ?? 0;
  if (scored.length > 1 && top - runnerUp <= 1) return "low";
  if (top >= runnerUp * 2 && top >= MIN_HIGH_CONFIDENCE_SCORE) return "high";
  return "medium";
}

// ── Complexity — COMPUTED from observable signals, never a table lookup ──────

const ARTIFACT_NOUNS: { name: string; re: RegExp }[] = [
  { name: "frontend", re: /\bfront[- ]?end\b/i },
  { name: "backend", re: /\bback[- ]?end\b/i },
  { name: "database", re: /\bdatabase\b|\bschema\b/i },
  { name: "auth", re: /\bauth(entication|orization)?\b/i },
  { name: "infra", re: /\binfrastructure\b|\bkubernetes\b|\bdocker\b/i },
  { name: "api", re: /\bapi\b/i },
  { name: "deploy", re: /\bdeploy(ment)?\b/i },
  { name: "cache", re: /\bcache\b|\bcaching\b/i },
  { name: "queue", re: /\bqueue\b/i },
  { name: "microservice", re: /\bmicroservices?\b/i },
];
const LAYER_NOUN_NAMES = new Set(["frontend", "backend", "database", "auth", "infra"]);

const SCALE_WORD_PATTERNS = [
  /\benterprise\b/i,
  /\bmulti-tenant\b/i,
  /\bmicroservices?\b/i,
  /\bsla\b/i,
  /\bhigh availability\b/i,
  /ระดับองค์กร/,
  /หลายผู้เช่า/,
];

const ENUMERATED_LINE_RE = /^\s*([-*]|\d+[.)])\s+/;

function matchedArtifactNouns(message: string): string[] {
  return ARTIFACT_NOUNS.filter((n) => n.re.test(message)).map((n) => n.name);
}

function countEnumeratedLines(message: string): number {
  return message.split(/\r?\n/).filter((line) => ENUMERATED_LINE_RE.test(line)).length;
}

function computeComplexity(input: {
  message: string;
  historyTurns: number;
  repo?: RepoMetadata;
  engineeringRequired: boolean;
}): { complexity: TaskComplexity; score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  if (input.message.length > 1500) {
    score += 2;
    signals.push("length>1500");
  } else if (input.message.length > 600) {
    score += 1;
    signals.push("length>600");
  }

  const nouns = matchedArtifactNouns(input.message);
  const nounScore = Math.min(nouns.length, 4);
  if (nounScore > 0) {
    score += nounScore;
    signals.push(`artifactNouns:${nouns.join(",")}`);
  }

  const enumeratedLines = countEnumeratedLines(input.message);
  if (enumeratedLines >= 8) {
    score += 2;
    signals.push(`enumeratedLines>=8(${enumeratedLines})`);
  } else if (enumeratedLines >= 3) {
    score += 1;
    signals.push(`enumeratedLines>=3(${enumeratedLines})`);
  }

  const layerCount = nouns.filter((n) => LAYER_NOUN_NAMES.has(n)).length;
  if (layerCount >= 2) {
    score += 2;
    signals.push(`layers>=2(${layerCount})`);
  }

  if (input.repo) {
    if (input.repo.fileCount > 200) {
      score += 2;
      signals.push(`repoFiles>200(${input.repo.fileCount})`);
    } else if (input.repo.fileCount > 50) {
      score += 1;
      signals.push(`repoFiles>50(${input.repo.fileCount})`);
    }
    if (input.repo.languages.length >= 3) {
      score += 1;
      signals.push(`repoLanguages>=3(${input.repo.languages.length})`);
    }
  }

  if (SCALE_WORD_PATTERNS.some((p) => p.test(input.message))) {
    score += 2;
    signals.push("scaleWords");
  }

  if (input.historyTurns >= 8 && input.engineeringRequired) {
    score += 1;
    signals.push(`engineeringThreadDepth(${input.historyTurns})`);
  }

  let complexity: TaskComplexity;
  if (score >= 10) complexity = "enterprise";
  else if (score >= 7) complexity = "large";
  else if (score >= 4) complexity = "complex";
  else if (score >= 2) complexity = "medium";
  else complexity = "simple";

  return { complexity, score, signals };
}

// ── Chit-chat carve-out — required, or every "hi" costs 2 provider calls ────
// Zero rules fired, short message, no code/repo signal → genuine confidence
// this is chit-chat, not an "underestimate" of an engineering task (Part
// 5.2's "unknown"+low path is reserved for messages where SOME signal fired
// ambiguously).
const CODE_ARTIFACT_RE = /```|\btraceback \(most recent call last\)|\b\w+error\b\s*:|\b\w+exception\b\s*:/i;

function isChitChatCarveOut(message: string, repo: RepoMetadata | undefined, scored: unknown[]): boolean {
  return scored.length === 0 && message.length < 200 && !CODE_ARTIFACT_RE.test(message) && !repo;
}

function classifyTaskInner(input: TaskClassifierInput, start: number): TaskDecision {
  const trimmed = input.message.trim();
  const scored = scoreCategories(trimmed);

  if (isChitChatCarveOut(trimmed, input.repo, scored)) {
    return {
      category: "conversation",
      complexity: "simple",
      engineeringRequired: false,
      workflow: "lightweight",
      confidence: "high",
      reasoning: "no category signal matched; short message with no code/repo artifact — treated as chit-chat",
      signals: [],
      durationMs: Math.round((performance.now() - start) * 1000) / 1000,
    };
  }

  const category: YpertatosTaskCategory = scored[0]?.category ?? "unknown";
  const confidence = computeConfidence(scored);
  const engineeringRequired = ENGINEERING_CATEGORIES.has(category);
  // Part 5.2: "If confidence is low, fallback to safer workflow. Never
  // underestimate engineering tasks." Low confidence always escalates to the
  // engineering workflow, independent of whether `category` itself landed on
  // an engineering category.
  const workflow: YpertatosWorkflowKind = engineeringRequired || confidence === "low" ? "engineering" : "lightweight";

  const { complexity, signals: complexitySignals } = computeComplexity({
    message: trimmed,
    historyTurns: input.history.length,
    repo: input.repo,
    engineeringRequired,
  });

  const categorySignals = scored.slice(0, 3).map((s) => `category:${s.category}(score=${s.score})`);
  const signals = [...categorySignals, ...complexitySignals];

  const reasoning =
    signals.length > 0
      ? `classified "${category}" (confidence=${confidence}) from: ${signals.join("; ")}`
      : `no signals matched; defaulted to "${category}" (confidence=${confidence})`;

  return {
    category,
    complexity,
    engineeringRequired,
    workflow,
    confidence,
    reasoning,
    signals,
    durationMs: Math.round((performance.now() - start) * 1000) / 1000,
  };
}

/** Classify a Ypertatos turn. Deterministic, synchronous, no I/O, no LLM.
 *  Never throws — an internal failure degrades to the safest routing
 *  ("unknown" / engineering / low confidence) rather than propagating, per
 *  Part 5.2's classifier failure policy. */
export function classifyTask(input: TaskClassifierInput): TaskDecision {
  const start = performance.now();
  try {
    return classifyTaskInner(input, start);
  } catch {
    return {
      category: "unknown",
      complexity: "medium",
      engineeringRequired: true,
      workflow: "engineering",
      confidence: "low",
      reasoning: "classifier failed internally; defaulted to the safer engineering workflow",
      signals: [],
      durationMs: Math.round((performance.now() - start) * 1000) / 1000,
    };
  }
}
