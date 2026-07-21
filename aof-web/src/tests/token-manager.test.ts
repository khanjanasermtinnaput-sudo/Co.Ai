// ── token-manager.test.ts ────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateBudget, guardOverflow, reportEfficiency, estimateTokens } from "../lib/server/token-manager";
import { estimateTokens as compilerEstimateTokens } from "../lib/server/prompt-compiler";
import { workflowMaxTokens, type WorkflowStageSpec } from "../lib/server/model-workflow";
import { MODEL_REGISTRY } from "../lib/server/model-registry";

const MIKROS_STAGE: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  execution: "phase",
  final: true,
  baseMaxTokens: 1000,
  instruction: "",
};

test("token-manager re-exports prompt-compiler's exact estimateTokens — single source of truth", () => {
  assert.equal(estimateTokens("hello world"), compilerEstimateTokens("hello world"));
});

test("allocateBudget's outputBudget is byte-identical to the pre-6.7 formula for a staged workflow", () => {
  const specs: WorkflowStageSpec[] = [
    MIKROS_STAGE,
    { stage: "review", label: "Review", execution: "phase", final: true, baseMaxTokens: 1200, instruction: "" },
  ];
  const budget = allocateBudget({
    stages: specs,
    effort: "normal",
    isStaged: true,
    baseMaxTokens: 1000,
    compiledSystem: "SYSTEM TEXT",
    history: [],
    message: "hi",
    provider: "gemini",
    model: "gemini-2.5-flash",
  });
  assert.equal(budget.outputBudget, workflowMaxTokens(specs, "normal"));
});

test("allocateBudget finds the real contextWindow for an exact registry match", () => {
  const gemini = MODEL_REGISTRY.find((m) => m.provider === "gemini" && m.model === "gemini-2.5-pro")!;
  const budget = allocateBudget({
    stages: [MIKROS_STAGE],
    effort: "normal",
    isStaged: false,
    baseMaxTokens: 1000,
    compiledSystem: "SYS",
    history: [],
    message: "hi",
    provider: "gemini",
    model: gemini.model,
  });
  assert.equal(budget.contextWindow, gemini.contextWindow);
  assert.equal(budget.contextWindowIsDefault, false);
});

test("allocateBudget falls back to the conservative default for an unregistered model — never throws, never fabricates a real lookup", () => {
  const budget = allocateBudget({
    stages: [MIKROS_STAGE],
    effort: "normal",
    isStaged: false,
    baseMaxTokens: 1000,
    compiledSystem: "SYS",
    history: [],
    message: "hi",
    provider: "openrouter",
    model: "some/arbitrary-model-not-in-registry",
  });
  assert.equal(budget.contextWindowIsDefault, true);
  assert.equal(budget.contextWindow, Math.min(...MODEL_REGISTRY.map((m) => m.contextWindow)));
});

test("guardOverflow: well under the context window leaves history and outputBudget untouched", () => {
  const result = guardOverflow({
    compiledSystem: "short system",
    history: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
    message: "how are you",
    outputBudget: 1000,
    contextWindow: 200_000,
  });
  assert.equal(result.overflow, false);
  assert.equal(result.compressed, false);
  assert.equal(result.historyDropped, 0);
  assert.equal(result.history.length, 2);
  assert.equal(result.outputBudget, 1000);
});

test("guardOverflow: over budget drops the OLDEST history turns first, keeps the freshest", () => {
  const history = [
    { role: "user" as const, content: "OLDEST turn ".repeat(200) },
    { role: "assistant" as const, content: "middle turn ".repeat(200) },
    { role: "user" as const, content: "NEWEST turn" },
  ];
  const contextWindow = estimateTokens(history[1].content + history[2].content) + 50; // fits last two, not all three
  const result = guardOverflow({
    compiledSystem: "sys",
    history,
    message: "go",
    outputBudget: 10,
    contextWindow,
  });
  assert.equal(result.overflow, true);
  assert.ok(result.historyDropped >= 1);
  assert.ok(!result.history.some((h) => h.content.includes("OLDEST")));
  assert.ok(result.history.some((h) => h.content.includes("NEWEST")));
});

test("guardOverflow: extreme case floors outputBudget instead of throwing or leaving it unbounded", () => {
  const result = guardOverflow({
    compiledSystem: "a".repeat(4000), // ~1000 tokens, alone exceeds a tiny window
    history: [{ role: "user", content: "b".repeat(4000) }],
    message: "c".repeat(4000),
    outputBudget: 5000,
    contextWindow: 500,
  });
  assert.equal(result.overflow, true);
  assert.equal(result.historyDropped, 1); // all history dropped
  assert.ok(result.outputBudget >= 256); // MIN_OUTPUT_BUDGET floor, never 0
  assert.equal(result.stillOver, true); // system+message alone still exceed 500 — honestly reported, not hidden
});

test("reportEfficiency: no usage ⇒ no fabricated actual/accuracy fields", () => {
  const report = reportEfficiency(500);
  assert.equal(report.estimatedPromptTokens, 500);
  assert.equal(report.actualPromptTokens, undefined);
  assert.equal(report.estimateAccuracy, undefined);
});

test("reportEfficiency: real usage present ⇒ real accuracy ratio computed from it", () => {
  const report = reportEfficiency(500, { inputTokens: 400, outputTokens: 120 });
  assert.equal(report.actualPromptTokens, 400);
  assert.equal(report.actualCompletionTokens, 120);
  assert.equal(report.estimateAccuracy, Math.round((500 / 400) * 1000) / 1000);
});
