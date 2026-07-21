// ── prestream-dispatch.test.ts — the findIndex-bug regression lock ──────────
// Fake callFn/runOrchestrationFn seams, no network. Uses the REAL stagesFor()
// (already covered by model-workflow.test.ts) so these tests exercise real
// integration with the actual stage tables, not a second hand-rolled table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runPreStreamStages } from "../lib/server/prestream-dispatch";
import { stagesFor } from "../lib/server/model-workflow";
import { REQUIREMENT_ANALYSIS_SYSTEM } from "../lib/server/requirement-analysis";
import { TMAP_SYSTEM } from "../lib/server/execution-plan";
import { makeTurnBudget } from "../lib/server/turn-budget";
import { makeUsageNotice, classifyProviderError } from "../lib/errors";
import type { ProviderMeta, ProviderId } from "../lib/server/ai-providers";
import type { BufferedCallOk, BufferedCallFail } from "../lib/server/buffered-call";
import type { OrchestrationRun } from "../lib/server/orchestrator";
import type { TaskDecision } from "../lib/server/task-classifier";

function meta(id: ProviderId, label: string): ProviderMeta {
  return {
    id,
    label,
    envVar: `${id.toUpperCase()}_API_KEY`,
    modelEnv: `${id.toUpperCase()}_MODEL`,
    defaultModel: `${id}-default`,
    priority: 1,
  };
}
const PROVIDER_A = meta("gemini", "Provider A");

const DECISION: TaskDecision = {
  category: "code-generation",
  complexity: "medium",
  engineeringRequired: true,
  workflow: "engineering",
  confidence: "high",
  reasoning: "test",
  signals: [],
  durationMs: 1,
};

const RAA_OK_TEXT = [
  "===COAI REQUIREMENT SPEC===",
  "Functional Requirements:",
  "- FR-001: build it",
  "Non-Functional Requirements:",
  "Constraints:",
  "Assumptions:",
  "Missing Information:",
  "Ambiguities:",
  "Risks:",
  "Acceptance Criteria:",
  "- it works",
  "Completeness Score: 90%",
  "Confidence Score: 90%",
  "Ready For Planning: true",
  "===END SPEC===",
].join("\n");

function tmapText(taskLines: string[], extra: string[] = []): string {
  return [
    "===COAI EXECUTION PLAN===",
    "Strategy: do it",
    "Tasks:",
    ...taskLines,
    "Risks:",
    "Plan Confidence: 85%",
    "===END PLAN===",
    ...extra,
  ].join("\n");
}
const TMAP_MULTI_TASK = tmapText([
  "- TASK-001 | title: Backend | agent: backend | depends: none | priority: high | complexity: medium | desc: build api | output: endpoint | validation: test | success: works",
  "- TASK-002 | title: Frontend | agent: frontend | depends: TASK-001 | priority: medium | complexity: simple | desc: build ui | output: component | validation: test | success: works",
]);
const TMAP_SINGLE_TASK = tmapText(["- TASK-001 | title: Do it | agent: general | depends: none"]);
const TMAP_CYCLE = tmapText([
  "- TASK-001 | title: A | agent: general | depends: TASK-002",
  "- TASK-002 | title: B | agent: general | depends: TASK-001",
]);

function okResult(text: string): BufferedCallOk {
  return {
    ok: true,
    text,
    usage: makeUsageNotice(20, 20),
    provider: PROVIDER_A,
    model: "test-model",
    executionId: "req-1",
    attempts: 1,
    durationMs: 1,
  };
}
function failResult(): BufferedCallFail {
  return { ok: false, error: classifyProviderError({ provider: "Provider A", message: "boom" }), aborted: false, attempts: 1, durationMs: 1 };
}
function abortedResult(): BufferedCallFail {
  return { ok: false, error: classifyProviderError({ provider: "Provider A", message: "Aborted" }), aborted: true, attempts: 1, durationMs: 1 };
}

function fakeOrchestrationRun(overrides: Partial<OrchestrationRun> = {}): OrchestrationRun {
  return {
    records: [],
    artifacts: [],
    waves: 1,
    maxParallelObserved: 2,
    completed: 2,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    partial: false,
    aborted: false,
    durationMs: 5,
    ...overrides,
  };
}

function baseOpts(overrides: Partial<Parameters<typeof runPreStreamStages>[0]> = {}) {
  return {
    stages: stagesFor("pro", "normal", { workflow: "engineering" }),
    tier: "pro" as const,
    effort: "normal" as const,
    decision: DECISION,
    message: "build a login form with an API",
    history: [],
    system: "BASE SYSTEM",
    providers: [PROVIDER_A],
    signal: new AbortController().signal,
    budget: makeTurnBudget(Date.now()),
    taskModelFor: () => undefined,
    ...overrides,
  };
}

function isPrefixValid(stages: ReturnType<typeof stagesFor>): boolean {
  const firstPhase = stages.findIndex((s) => s.execution === "phase");
  const lastNonPhase = stages.map((s) => s.execution !== "phase").lastIndexOf(true);
  return lastNonPhase < firstPhase || firstPhase === 0;
}

test("runs BOTH buffered stages, in order — the regression lock for the findIndex bug", async () => {
  const calls: string[] = [];
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => {
        calls.push(o.system === REQUIREMENT_ANALYSIS_SYSTEM ? "raa" : o.system === TMAP_SYSTEM ? "tmap" : "unknown");
        if (o.system === REQUIREMENT_ANALYSIS_SYSTEM) return okResult(RAA_OK_TEXT);
        if (o.system === TMAP_SYSTEM) return okResult(TMAP_SINGLE_TASK);
        return failResult();
      },
    }),
  );

  assert.deepEqual(calls, ["raa", "tmap"]);
  assert.equal(result.telemetry.raa?.executed, true);
  assert.equal(result.telemetry.tmap?.executed, true);
  assert.equal(result.aborted, false);
});

test("RAA fails: degrades to the lightweight table, TMAP is never invoked", async () => {
  const calls: string[] = [];
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => {
        calls.push(o.system === REQUIREMENT_ANALYSIS_SYSTEM ? "raa" : "tmap");
        return failResult();
      },
    }),
  );

  assert.deepEqual(calls, ["raa"]);
  assert.equal(result.telemetry.raa?.degraded, true);
  assert.equal(result.telemetry.tmap, undefined);
  assert.deepEqual(
    result.stages.map((s) => s.stage),
    stagesFor("pro", "normal", { workflow: "lightweight" }).map((s) => s.stage),
  );
  assert.ok(isPrefixValid(result.stages));
});

test("TMAP fails: orchestration is never invoked, the streamed call is still fully configured", async () => {
  let orchestrationCalls = 0;
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => (o.system === REQUIREMENT_ANALYSIS_SYSTEM ? okResult(RAA_OK_TEXT) : failResult()),
      runOrchestrationFn: async () => {
        orchestrationCalls += 1;
        return fakeOrchestrationRun();
      },
    }),
  );

  assert.equal(orchestrationCalls, 0);
  assert.equal(result.telemetry.tmap?.degraded, true);
  assert.equal(result.telemetry.orchestrationSkipped, "tmap-failed");
  assert.ok(!result.stages.some((s) => s.execution === "orchestrated"));
  assert.match(result.system, /BASE SYSTEM/);
  assert.ok(isPrefixValid(result.stages));
});

test("a 1-task plan: the orchestrated stage is never inserted, and the orchestrator is never called", async () => {
  let orchestrationCalls = 0;
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => (o.system === REQUIREMENT_ANALYSIS_SYSTEM ? okResult(RAA_OK_TEXT) : okResult(TMAP_SINGLE_TASK)),
      runOrchestrationFn: async () => {
        orchestrationCalls += 1;
        return fakeOrchestrationRun();
      },
    }),
  );

  assert.equal(orchestrationCalls, 0);
  assert.equal(result.telemetry.orchestrationSkipped, "single-task");
  assert.ok(!result.stages.some((s) => s.execution === "orchestrated"));
  assert.equal(result.telemetry.tmap?.tasks, 1);
  assert.ok(isPrefixValid(result.stages));
});

test("a >1-task acyclic plan: the orchestrated stage IS inserted, and the orchestrator runs exactly once", async () => {
  let orchestrationCalls = 0;
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => (o.system === REQUIREMENT_ANALYSIS_SYSTEM ? okResult(RAA_OK_TEXT) : okResult(TMAP_MULTI_TASK)),
      runOrchestrationFn: async (o) => {
        orchestrationCalls += 1;
        assert.equal(o.plan.tasks.length, 2);
        return fakeOrchestrationRun();
      },
    }),
  );

  assert.equal(orchestrationCalls, 1);
  assert.equal(result.telemetry.orchestrationSkipped, undefined);
  assert.ok(result.stages.some((s) => s.execution === "orchestrated" && s.stage === "multi-agent"));
  assert.ok(result.telemetry.orchestration);
  assert.ok(isPrefixValid(result.stages));
});

test("a dependency cycle: orchestration is never inserted", async () => {
  let orchestrationCalls = 0;
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => (o.system === REQUIREMENT_ANALYSIS_SYSTEM ? okResult(RAA_OK_TEXT) : okResult(TMAP_CYCLE)),
      runOrchestrationFn: async () => {
        orchestrationCalls += 1;
        return fakeOrchestrationRun();
      },
    }),
  );

  assert.equal(orchestrationCalls, 0);
  assert.equal(result.telemetry.orchestrationSkipped, "cycle");
  assert.equal(result.telemetry.tmap?.integrity, "cycle");
  assert.ok(!result.stages.some((s) => s.execution === "orchestrated"));
  assert.ok(isPrefixValid(result.stages));
});

test("orchestration integrates artifacts into system when it runs and completes something", async () => {
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => (o.system === REQUIREMENT_ANALYSIS_SYSTEM ? okResult(RAA_OK_TEXT) : okResult(TMAP_MULTI_TASK)),
      runOrchestrationFn: async () =>
        fakeOrchestrationRun({
          artifacts: [{ taskId: "TASK-001", agent: "backend", title: "API", text: "the api artifact text", partial: false }],
          records: [
            { taskId: "TASK-001", agent: "backend", state: "completed" },
            { taskId: "TASK-002", agent: "frontend", state: "completed" },
          ],
        }),
    }),
  );

  assert.match(result.system, /the api artifact text/);
});

test("Kanon (non-pro) path: only context-builder runs; RAA/TMAP/orchestration are never touched", async () => {
  let callCount = 0;
  const result = await runPreStreamStages(
    baseOpts({
      stages: stagesFor("normal", "high"),
      tier: "normal",
      decision: undefined,
      callFn: async () => {
        callCount += 1;
        return failResult();
      },
    }),
  );

  assert.equal(callCount, 0);
  assert.ok(result.telemetry.contextBuilder);
  assert.equal(result.telemetry.raa, undefined);
  assert.equal(result.telemetry.tmap, undefined);
  assert.equal(result.telemetry.orchestration, undefined);
});

test("a single-stage workflow (e.g. Mikros) is a complete no-op", async () => {
  const result = await runPreStreamStages(
    baseOpts({
      stages: stagesFor("lite", "normal"),
      tier: "lite",
      decision: undefined,
    }),
  );
  assert.equal(result.stagePrefix, "");
  assert.equal(result.system, "BASE SYSTEM");
  assert.equal(result.telemetry.preStreamProviderCalls, 0);
});

test("abort during RAA returns aborted:true immediately, TMAP never attempted", async () => {
  let tmapCalls = 0;
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => {
        if (o.system === TMAP_SYSTEM) tmapCalls += 1;
        return abortedResult();
      },
    }),
  );
  assert.equal(result.aborted, true);
  assert.equal(tmapCalls, 0);
});

test("abort during orchestration returns aborted:true", async () => {
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => (o.system === REQUIREMENT_ANALYSIS_SYSTEM ? okResult(RAA_OK_TEXT) : okResult(TMAP_MULTI_TASK)),
      runOrchestrationFn: async () => fakeOrchestrationRun({ aborted: true }),
    }),
  );
  assert.equal(result.aborted, true);
});

test("preStreamProviderCalls counts real calls: RAA + TMAP + every real agent attempt", async () => {
  const result = await runPreStreamStages(
    baseOpts({
      callFn: async (o) => (o.system === REQUIREMENT_ANALYSIS_SYSTEM ? okResult(RAA_OK_TEXT) : okResult(TMAP_MULTI_TASK)),
      runOrchestrationFn: async () =>
        fakeOrchestrationRun({
          records: [
            { taskId: "TASK-001", agent: "backend", state: "completed", attempts: 1 },
            { taskId: "TASK-002", agent: "frontend", state: "failed", attempts: 2 },
          ],
        }),
    }),
  );
  // RAA(1) + TMAP(1) + agent attempts(1 + 2) = 5
  assert.equal(result.telemetry.preStreamProviderCalls, 5);
});
