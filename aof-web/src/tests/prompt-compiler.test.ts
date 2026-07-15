// ── prompt-compiler.test.ts ──────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compilePrompt,
  estimateTokens,
  PROMPT_LAYER_ORDER,
  PROMPT_TEMPLATE_VERSION,
  type PromptInputs,
} from "../lib/server/prompt-compiler";
import { buildWorkflowSystem, PHASE_MARKER, type WorkflowStageSpec } from "../lib/server/model-workflow";

function baseInputs(overrides?: Partial<PromptInputs>): PromptInputs {
  return {
    layers: [
      { id: "system", text: "You are CoAI." },
      { id: "memory", text: "" },
      { id: "context", text: "" },
      { id: "workflow", text: "" },
    ],
    workflowId: "lite",
    stageId: "processing",
    provider: "anthropic",
    model: "claude-test",
    ...overrides,
  };
}

test("PROMPT_LAYER_ORDER is exactly this repo's real render order (workflow last)", () => {
  assert.deepEqual(PROMPT_LAYER_ORDER, ["system", "memory", "context", "workflow"]);
});

test("determinism: identical inputs compile to an identical system string", () => {
  const inputs = baseInputs({
    layers: [
      { id: "system", text: "SYS" },
      { id: "memory", text: "MEM" },
      { id: "context", text: "CTX" },
      { id: "workflow", text: "WF" },
    ],
  });
  const a = compilePrompt(inputs);
  const b = compilePrompt({ ...inputs, layers: inputs.layers.map((l) => ({ ...l })) });
  assert.equal(a.system, b.system);
  assert.equal(a.system, "SYS\n\nMEM\n\nCTX\n\nWF");
});

test("layers assemble in PROMPT_LAYER_ORDER regardless of input array order", () => {
  const inputs = baseInputs({
    stageId: "shuffled",
    layers: [
      { id: "workflow", text: "WF" },
      { id: "context", text: "CTX" },
      { id: "system", text: "SYS" },
      { id: "memory", text: "MEM" },
    ],
  });
  const out = compilePrompt(inputs);
  assert.equal(out.system, "SYS\n\nMEM\n\nCTX\n\nWF");
});

test("empty/whitespace-only layers are omitted — no stray blank joins", () => {
  const inputs = baseInputs({
    stageId: "sparse",
    layers: [
      { id: "system", text: "SYS" },
      { id: "memory", text: "   " },
      { id: "context", text: "" },
      { id: "workflow", text: "WF" },
    ],
  });
  const out = compilePrompt(inputs);
  assert.equal(out.system, "SYS\n\nWF");
});

test("dedup: a layer whose text duplicates an earlier layer's is dropped, and reported", () => {
  const inputs = baseInputs({
    stageId: "dup",
    layers: [
      { id: "system", text: "SAME TEXT" },
      { id: "memory", text: "SAME TEXT" },
      { id: "context", text: "" },
      { id: "workflow", text: "" },
    ],
  });
  const out = compilePrompt(inputs);
  assert.equal(out.system, "SAME TEXT");
  assert.ok(out.metadata.optimizationRatio > 0);
});

test("no cross-layer duplication in a normal turn ⇒ optimizationRatio is honestly 0, not fabricated", () => {
  const inputs = baseInputs({
    stageId: "no-dup",
    layers: [
      { id: "system", text: "SYS" },
      { id: "memory", text: "MEM" },
      { id: "context", text: "CTX" },
      { id: "workflow", text: "WF" },
    ],
  });
  const out = compilePrompt(inputs);
  assert.equal(out.metadata.optimizationRatio, 0);
});

test("validation: missing/empty required 'system' layer falls back to the safe template", () => {
  const inputs = baseInputs({
    stageId: "invalid",
    layers: [
      { id: "system", text: "" },
      { id: "memory", text: "MEM" },
      { id: "context", text: "" },
      { id: "workflow", text: "" },
    ],
  });
  const out = compilePrompt(inputs);
  assert.ok(out.system.length > 0);
  assert.match(out.system, /helpful AI assistant/);
});

test("cache: identical inputs hit the cache; different layer text misses it", () => {
  const inputs = baseInputs({ stageId: "cache-test", layers: [{ id: "system", text: "CACHE-ME" }] });
  const first = compilePrompt(inputs);
  assert.equal(first.metadata.cacheHit, false);
  const second = compilePrompt({ ...inputs, layers: inputs.layers.map((l) => ({ ...l })) });
  assert.equal(second.metadata.cacheHit, true);
  assert.equal(second.system, first.system);

  const different = compilePrompt({ ...inputs, layers: [{ id: "system", text: "CACHE-ME-DIFFERENTLY" }] });
  assert.equal(different.metadata.cacheHit, false);
});

test("metadata carries real, derived values — not placeholders", () => {
  const inputs = baseInputs({ stageId: "processing+review", workflowId: "normal" });
  const out = compilePrompt(inputs);
  assert.equal(out.metadata.workflowId, "normal");
  assert.equal(out.metadata.stageId, "processing+review");
  assert.equal(out.metadata.promptVersion, PROMPT_TEMPLATE_VERSION);
  assert.equal(out.metadata.estTokens, estimateTokens(out.system));
  assert.ok(out.metadata.compileMs >= 0);
  assert.ok(out.metadata.promptId.length > 0);
});

test("PHASE_MARKER pass-through: workflow layer text preserves every marker byte-for-byte", () => {
  const specs: WorkflowStageSpec[] = [
    { stage: "processing", label: "Processing", execution: "phase", final: false, baseMaxTokens: 600, instruction: "DRAFT phase instructions." },
    { stage: "deep-think", label: "Deep Think", execution: "phase", final: false, baseMaxTokens: 500, instruction: "DEEPTHINK phase instructions." },
    { stage: "review", label: "Review", execution: "phase", final: true, baseMaxTokens: 1200, instruction: "FINAL phase instructions." },
  ];
  const workflowLayerText = buildWorkflowSystem(specs, { baseSystem: "" }).replace(/^\n\n/, "");
  const out = compilePrompt(
    baseInputs({
      stageId: "context-builder+processing+deep-think+review",
      layers: [
        { id: "system", text: "PERSONA" },
        { id: "memory", text: "" },
        { id: "context", text: "" },
        { id: "workflow", text: workflowLayerText },
      ],
    }),
  );
  assert.ok(out.system.includes(PHASE_MARKER.processing!));
  assert.ok(out.system.includes(PHASE_MARKER["deep-think"]!));
  assert.ok(out.system.includes(PHASE_MARKER.review!));
  // Exact same protocol text as calling buildWorkflowSystem directly against
  // the full assembled base — the compiler must never rewrite marker text.
  const directly = buildWorkflowSystem(specs, { baseSystem: "PERSONA" });
  assert.equal(out.system, directly);
});

test("regression: 4-layer compile matches the pre-Part-6.6 manual concatenation for a representative Ypertatos-engineering turn", () => {
  const layers = {
    system: "PERSONA + EFFORT + SEARCH",
    memory: "USER PREFERENCE MEMORY",
    context: "CONTEXT-BUILDER DIGEST + REQUIREMENT SPEC + EXECUTION PLAN + ORCHESTRATION ARTIFACTS",
    workflow: "── Co.AI internal reasoning protocol ──\n<<<COAI_DRAFT>>>\n...\n<<<COAI_FINAL>>>\n...",
  };
  const out = compilePrompt(
    baseInputs({
      stageId: "requirement-analysis+planner+multi-agent+processing+review",
      workflowId: "pro",
      layers: [
        { id: "system", text: layers.system },
        { id: "memory", text: layers.memory },
        { id: "context", text: layers.context },
        { id: "workflow", text: layers.workflow },
      ],
    }),
  );
  // The OLD route.ts formula this replaces: system + "\n\n" + memory (if any)
  // + "\n\n" + context (if any) + "\n\n" + workflow (if any) — see route.ts's
  // history for the manual concatenation this module formalizes.
  const oldFormula = [layers.system, layers.memory, layers.context, layers.workflow]
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
  assert.equal(out.system, oldFormula);
});
