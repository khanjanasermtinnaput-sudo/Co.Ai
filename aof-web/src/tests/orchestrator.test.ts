// ── orchestrator.test.ts — fake call/providersFor seams, no network ─────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { runOrchestration, integrateArtifacts, type OrchestrationRun } from "../lib/server/orchestrator";
import type { ExecutionPlan, PlannedTask } from "../lib/server/execution-plan";
import type { RequirementSpec } from "../lib/server/requirement-analysis";
import { makeTurnBudget } from "../lib/server/turn-budget";
import { classifyProviderError, makeUsageNotice } from "../lib/errors";
import type { ProviderMeta, ProviderId } from "../lib/server/ai-providers";
import type { BufferedCallOk, BufferedCallFail } from "../lib/server/buffered-call";

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
const PROVIDER_A = meta("anthropic", "Provider A");

function mkTask(id: string, dependsOn: string[] = [], agent: PlannedTask["agent"] = "general"): PlannedTask {
  return {
    id,
    title: `Title ${id}`,
    description: `Description ${id}`,
    agent,
    agentSource: "model",
    dependsOn,
    priority: null,
    complexity: null,
    expectedOutput: "",
    validationMethod: "",
    successCriteria: "",
  };
}

function mkPlan(tasks: PlannedTask[], executionOrder: string[][]): ExecutionPlan {
  return {
    strategy: "test strategy",
    tasks,
    risks: [],
    planConfidence: 80,
    executionOrder,
    integrity: "ok",
    cycleTasks: [],
    warnings: [],
    raw: "",
    partial: false,
  };
}

const SPEC: RequirementSpec = {
  functional: [],
  nonFunctional: [],
  constraints: [],
  assumptions: [],
  missingInformation: [],
  ambiguities: [],
  risks: [],
  acceptanceCriteria: [],
  completenessScore: 100,
  confidenceScore: 100,
  readyForPlanning: true,
  readyForPlanningSource: "model",
  raw: "",
  partial: false,
};

function okResult(text: string): BufferedCallOk {
  return {
    ok: true,
    text,
    usage: makeUsageNotice(10, 10),
    provider: PROVIDER_A,
    model: "test-model",
    executionId: "req-1",
    attempts: 1,
    durationMs: 1,
  };
}
function failResult(hint?: "timeout"): BufferedCallFail {
  return {
    ok: false,
    error: classifyProviderError({ provider: "Provider A", message: "boom", hint }),
    aborted: false,
    attempts: 1,
    durationMs: 1,
  };
}
function abortedResult(): BufferedCallFail {
  return {
    ok: false,
    error: classifyProviderError({ provider: "Provider A", message: "Aborted" }),
    aborted: true,
    attempts: 1,
    durationMs: 1,
  };
}

function artifact(id: string): string {
  return `===COAI ARTIFACT===\nTitle: Artifact for ${id}\nbody for ${id}\n===END ARTIFACT===`;
}

function baseOpts(overrides: Partial<Parameters<typeof runOrchestration>[0]> = {}) {
  return {
    plan: mkPlan([], []),
    spec: SPEC,
    userMessage: "build the thing",
    effort: "normal" as const,
    signal: new AbortController().signal,
    budget: makeTurnBudget(Date.now()),
    providersFor: () => [PROVIDER_A],
    ...overrides,
  };
}

test("diamond DAG: 3 waves, real measured parallelism of 2", async () => {
  const tasks = [mkTask("TASK-001"), mkTask("TASK-002", ["TASK-001"]), mkTask("TASK-003", ["TASK-001"]), mkTask("TASK-004", ["TASK-002", "TASK-003"])];
  const plan = mkPlan(tasks, [["TASK-001"], ["TASK-002", "TASK-003"], ["TASK-004"]]);

  const run = await runOrchestration(
    baseOpts({
      plan,
      call: async (opts) => okResult(artifact("x")),
    }),
  );

  assert.equal(run.waves, 3);
  assert.equal(run.maxParallelObserved, 2);
  assert.equal(run.completed, 4);
  assert.equal(run.partial, false);
  assert.equal(run.aborted, false);
});

test("maxParallel=1 caps observed concurrency at 1 even with a wave of 2", async () => {
  const tasks = [mkTask("TASK-001"), mkTask("TASK-002", ["TASK-001"]), mkTask("TASK-003", ["TASK-001"])];
  const plan = mkPlan(tasks, [["TASK-001"], ["TASK-002", "TASK-003"]]);

  const run = await runOrchestration(
    baseOpts({
      plan,
      maxParallel: 1,
      call: async () => okResult(artifact("x")),
    }),
  );

  assert.equal(run.maxParallelObserved, 1);
  assert.equal(run.completed, 3);
});

test("a failing task skips its dependents as dependency-failed; siblings still complete", async () => {
  const tasks = [mkTask("TASK-001"), mkTask("TASK-002", ["TASK-001"]), mkTask("TASK-003")];
  const plan = mkPlan(tasks, [["TASK-001", "TASK-003"], ["TASK-002"]]);

  const run = await runOrchestration(
    baseOpts({
      plan,
      call: async (opts) => (opts.message.includes("TASK-001") ? failResult() : okResult(artifact("x"))),
    }),
  );

  const rec001 = run.records.find((r) => r.taskId === "TASK-001")!;
  const rec002 = run.records.find((r) => r.taskId === "TASK-002")!;
  const rec003 = run.records.find((r) => r.taskId === "TASK-003")!;
  assert.equal(rec001.state, "failed");
  assert.equal(rec002.state, "skipped");
  assert.equal(rec002.skipReason, "dependency-failed");
  assert.equal(rec003.state, "completed");
  assert.equal(run.partial, true);
});

test("all agents fail: completed=0, run still resolves, never throws", async () => {
  const tasks = [mkTask("TASK-001"), mkTask("TASK-002")];
  const plan = mkPlan(tasks, [["TASK-001", "TASK-002"]]);

  const run = await runOrchestration(
    baseOpts({
      plan,
      call: async () => failResult(),
    }),
  );

  assert.equal(run.completed, 0);
  assert.equal(run.failed, 2);
  assert.equal(run.partial, true);
});

test("a task whose call classifies as a timeout gets state:timeout, not failed", async () => {
  const plan = mkPlan([mkTask("TASK-001")], [["TASK-001"]]);
  const run = await runOrchestration(baseOpts({ plan, call: async () => failResult("timeout") }));
  assert.equal(run.records[0].state, "timeout");
  assert.equal(run.timedOut, 1);
});

test("budget exhausted before the next wave: remaining tasks are skipped/budget, returns promptly", async () => {
  const tasks = [mkTask("TASK-001"), mkTask("TASK-002", ["TASK-001"])];
  const plan = mkPlan(tasks, [["TASK-001"], ["TASK-002"]]);

  // A budget that is already exhausted from the start (started far enough in
  // the past that preStreamRemainingMs() is 0) — the very first wave should
  // be skipped as budget, and the call promptly returns.
  const spentBudget = makeTurnBudget(Date.now() - 999_999);

  const start = Date.now();
  const run = await runOrchestration(
    baseOpts({
      plan,
      budget: spentBudget,
      call: async () => okResult(artifact("x")),
    }),
  );
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 2000, `expected a prompt return, took ${elapsed}ms`);
  assert.equal(run.completed, 0);
  // TASK-001 is skipped directly for budget; TASK-002 (which depends on it)
  // is skipped as dependency-failed, since its dependency never completed —
  // a more precise report than relabeling every downstream task "budget" too.
  assert.equal(run.records.find((r) => r.taskId === "TASK-001")?.skipReason, "budget");
  assert.equal(run.records.find((r) => r.taskId === "TASK-002")?.skipReason, "dependency-failed");
  assert.equal(run.records.every((r) => r.state === "skipped"), true);
});

test("an already-aborted signal: tasks are skipped/aborted, run resolves promptly and marks aborted:true", async () => {
  const controller = new AbortController();
  controller.abort();
  const tasks = [mkTask("TASK-001"), mkTask("TASK-002")];
  const plan = mkPlan(tasks, [["TASK-001", "TASK-002"]]);

  const run = await runOrchestration(
    baseOpts({
      plan,
      signal: controller.signal,
      call: async () => okResult(artifact("x")),
    }),
  );

  assert.equal(run.aborted, true);
  assert.equal(run.records.every((r) => r.state === "skipped" && r.skipReason === "aborted"), true);
});

test("a plan with more tasks than MAX_TASKS: the excess is skipped/task-cap, the rest still run", async () => {
  const ids = Array.from({ length: 7 }, (_, i) => `TASK-${String(i + 1).padStart(3, "0")}`);
  const tasks = ids.map((id) => mkTask(id));
  const plan = mkPlan(tasks, [ids]);

  const run = await runOrchestration(baseOpts({ plan, call: async () => okResult(artifact("x")) }));

  assert.equal(run.completed, 6);
  const capped = run.records.filter((r) => r.skipReason === "task-cap");
  assert.equal(capped.length, 1);
});

test("integrateArtifacts includes every completed artifact and names every incomplete task, never claiming false completion", async () => {
  const tasks = [mkTask("TASK-001"), mkTask("TASK-002", ["TASK-001"])];
  const plan = mkPlan(tasks, [["TASK-001"], ["TASK-002"]]);

  const run = await runOrchestration(
    baseOpts({
      plan,
      call: async (opts) => (/^Task TASK-001:/.test(opts.message) ? okResult(artifact("TASK-001")) : failResult()),
    }),
  );

  const addon = integrateArtifacts(run, plan);
  assert.match(addon, /body for TASK-001/);
  assert.match(addon, /TASK-002/);
  assert.match(addon, /did NOT produce an artifact/);
  assert.doesNotMatch(addon, /body for TASK-002/);
});

test("never throws even if the injected call function itself throws", async () => {
  const plan = mkPlan([mkTask("TASK-001")], [["TASK-001"]]);
  await assert.doesNotReject(
    runOrchestration(
      baseOpts({
        plan,
        call: async () => {
          throw new Error("simulated adapter crash");
        },
      }),
    ),
  );
});
