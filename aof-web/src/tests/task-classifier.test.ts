// ── task-classifier.ts — Ypertatos Task Classifier (no network, no LLM) ──────
// Master Prompt Part 5.2: deterministic, <15ms, mandatory before stagesFor()
// picks the "lightweight" vs "engineering" table. These tests lock in: every
// category fires on both EN and TH samples, complexity is COMPUTED (never a
// lookup), the "never underestimate" low-confidence-escalates-to-engineering
// rule, and the chit-chat carve-out that keeps trivial turns at one call.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTask,
  ENGINEERING_CATEGORIES,
  type TaskClassifierInput,
  type YpertatosTaskCategory,
} from "../lib/server/task-classifier";

function input(message: string, extra: Partial<TaskClassifierInput> = {}): TaskClassifierInput {
  return { message, history: [], tier: "pro", effort: "normal", ...extra };
}

// ── All 20 categories fire on ≥1 EN and ≥1 TH sample ─────────────────────────

const SAMPLES: [YpertatosTaskCategory, string, string][] = [
  ["conversation", "Hi there, how are you?", "สวัสดีครับ"],
  ["question-answering", "What is the capital of France?", "อะไรคือเมืองหลวงของฝรั่งเศส"],
  ["translation", "Can you translate this paragraph for me?", "ช่วยแปลประโยคนี้หน่อย"],
  ["summarization", "Please summarize this article for me.", "ช่วยสรุปบทความนี้หน่อย"],
  ["explanation", "Please explain machine learning to me.", "ช่วยอธิบายเรื่องนี้หน่อย"],
  ["writing", "Write me a short poem about the ocean.", "ช่วยเขียนอีเมลให้หน่อย"],
  ["code-explanation", "Can you explain this code snippet?", "อธิบายโค้ดนี้ให้หน่อย"],
  [
    "bug-fix",
    "I'm getting TypeError: undefined is not a function — can you fix this bug?",
    "ช่วยแก้บั๊กนี้หน่อย มีข้อผิดพลาดเกิดขึ้น",
  ],
  ["code-generation", "Please build a REST API for a todo app.", "ช่วยสร้างระบบจัดการงานให้หน่อย"],
  ["refactoring", "Can you refactor this function to be cleaner?", "ช่วยรีแฟคเตอร์โค้ดนี้หน่อย"],
  ["project-creation", "I want to start a new project from scratch.", "อยากเริ่มโปรเจกต์ใหม่"],
  ["architecture-design", "Help me design the system architecture for this app.", "ช่วยออกแบบระบบให้หน่อย"],
  ["database-design", "I need help designing a database schema for orders.", "ช่วยออกแบบฐานข้อมูลให้หน่อย"],
  ["api-design", "Let's design the API endpoints for this service.", "ช่วยออกแบบ api ให้หน่อย"],
  ["repository-analysis", "Can you analyze this codebase and give feedback?", "ช่วยวิเคราะห์โค้ดนี้หน่อย"],
  ["documentation", "Please write documentation for this API.", "ช่วยเขียนเอกสารให้หน่อย"],
  [
    "security-review",
    "Can you do a security review and check for vulnerabilities?",
    "ช่วยตรวจสอบความปลอดภัยให้หน่อย",
  ],
  ["testing", "Please write unit tests for this module.", "ช่วยเขียนเทสให้หน่อย"],
  ["deployment", "How do I deploy this app to production?", "ช่วยดีพลอยระบบให้หน่อย"],
];

test("every category fires on its EN sample", () => {
  for (const [category, en] of SAMPLES) {
    assert.equal(classifyTask(input(en)).category, category, `EN: "${en}"`);
  }
});

test("every category fires on its TH sample (Thai patterns never rely on \\b)", () => {
  for (const [category, , th] of SAMPLES) {
    assert.equal(classifyTask(input(th)).category, category, `TH: "${th}"`);
  }
});

test("a Thai engineering message is classified as engineering-required", () => {
  const decision = classifyTask(input("ช่วยออกแบบฐานข้อมูลให้หน่อย"));
  assert.equal(decision.category, "database-design");
  assert.equal(decision.engineeringRequired, true);
  assert.equal(decision.workflow, "engineering");
});

test("engineeringRequired is exactly true iff category is in ENGINEERING_CATEGORIES", () => {
  for (const [category, en] of SAMPLES) {
    const decision = classifyTask(input(en));
    assert.equal(decision.engineeringRequired, ENGINEERING_CATEGORIES.has(category), category);
  }
});

test("unknown category (no signal fires, message long enough to skip the chit-chat carve-out)", () => {
  const longNeutral =
    "The weather today was mild with occasional clouds drifting across an otherwise calm sky, and " +
    "the afternoon passed quietly without anything of particular note happening around the neighborhood " +
    "or further down the street where the shops usually stay open until early evening hours.";
  assert.ok(longNeutral.length >= 200);
  const decision = classifyTask(input(longNeutral));
  assert.equal(decision.category, "unknown");
  assert.equal(decision.confidence, "low");
  assert.equal(decision.engineeringRequired, false);
  assert.equal(decision.workflow, "engineering"); // never underestimate, even though category itself isn't "engineering"
});

// ── Complexity is COMPUTED, never a lookup ────────────────────────────────────

test("complexity escalates for the same category as scale signals accumulate", () => {
  const simple = classifyTask(input("Build a todo app."));
  assert.equal(simple.category, "code-generation");
  assert.equal(simple.complexity, "simple");

  const complex = classifyTask(
    input(
      "Build a full-stack app with a frontend, backend, database, and authentication. It needs an API " +
        "layer and should support caching for performance.",
    ),
  );
  assert.equal(complex.category, "code-generation");
  assert.equal(complex.complexity, "complex");

  const lines = Array.from(
    { length: 10 },
    (_, i) => `- Requirement ${i + 1}: the system must support feature number ${i + 1} reliably`,
  ).join("\n");
  const enterprise = classifyTask(
    input(
      "Build an enterprise app with a frontend, backend, database and authentication layer, run as a " +
        "multi-tenant service with strict SLA and high availability requirements across every region, " +
        `including a full API surface, caching layer, and message queue integration. Requirements:\n${lines}`,
    ),
  );
  assert.equal(enterprise.category, "code-generation");
  assert.equal(enterprise.complexity, "enterprise");

  const order: Record<string, number> = { simple: 0, medium: 1, complex: 2, large: 3, enterprise: 4 };
  assert.ok(order[simple.complexity] < order[complex.complexity]);
  assert.ok(order[complex.complexity] < order[enterprise.complexity]);
});

test("repo.fileCount lifts complexity for an otherwise-identical message", () => {
  const baseline = classifyTask(input("Build a todo app."));
  const withRepo = classifyTask(
    input("Build a todo app.", { repo: { fileCount: 500, languages: ["ts", "tsx", "css"] } }),
  );
  assert.equal(baseline.complexity, "simple");
  assert.equal(withRepo.complexity, "medium");
  const order: Record<string, number> = { simple: 0, medium: 1, complex: 2, large: 3, enterprise: 4 };
  assert.ok(order[withRepo.complexity] > order[baseline.complexity]);
});

// ── Confidence rules ───────────────────────────────────────────────────────────

test("low confidence (ambiguous top-two) always escalates to the engineering workflow", () => {
  // "what is" (question-answering, weight 4) and "explain" (explanation, weight
  // 5) each fire exactly once — scores 4 and 5 are within 1 point → low.
  const decision = classifyTask(input("What is machine learning? Please explain."));
  assert.equal(decision.confidence, "low");
  assert.equal(decision.workflow, "engineering");
});

// ── Chit-chat carve-out — required, or every "hi" costs 2 provider calls ─────

test("chit-chat carve-out: greetings/thanks route to conversation/lightweight/high confidence", () => {
  for (const message of ["hi", "hello!", "สวัสดี", "thanks"]) {
    const decision = classifyTask(input(message));
    assert.equal(decision.category, "conversation", message);
    assert.equal(decision.workflow, "lightweight", message);
    assert.equal(decision.confidence, "high", message);
    assert.equal(decision.engineeringRequired, false, message);
  }
});

// ── Determinism, robustness, performance ──────────────────────────────────────

test("classifyTask is deterministic (same input twice → identical decision modulo durationMs)", () => {
  const msg = "Build a REST API for a todo app with a database and authentication.";
  const a = classifyTask(input(msg));
  const b = classifyTask(input(msg));
  const { durationMs: _a, ...restA } = a;
  const { durationMs: _b, ...restB } = b;
  assert.deepEqual(restA, restB);
  assert.ok(typeof a.durationMs === "number" && a.durationMs >= 0);
  assert.ok(typeof b.durationMs === "number" && b.durationMs >= 0);
});

test("never throws on empty string, huge emoji payload, or malformed history", () => {
  assert.doesNotThrow(() => classifyTask(input("")));
  assert.doesNotThrow(() => classifyTask(input("🎉".repeat(100_000 / 4))));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const malformed = { message: "hello", history: null, tier: "pro", effort: "normal" } as any;
  assert.doesNotThrow(() => classifyTask(malformed));
  const decision = classifyTask(malformed);
  // The internal try/catch degrades to the safest routing rather than propagating.
  assert.equal(decision.confidence, "low");
  assert.equal(decision.workflow, "engineering");
});

test("perf: classification stays well under the 15ms budget on average", () => {
  const messages = SAMPLES.flatMap(([, en, th]) => [en, th]);
  while (messages.length < 200) messages.push(...messages.slice(0, 200 - messages.length));
  const start = performance.now();
  for (const message of messages) classifyTask(input(message));
  const elapsed = performance.now() - start;
  assert.ok(elapsed / messages.length < 15, `mean ${elapsed / messages.length}ms per call`);
});
