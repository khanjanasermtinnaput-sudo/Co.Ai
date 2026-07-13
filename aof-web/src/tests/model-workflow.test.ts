// ── Model Workflow — stage sequencing (no network) ────────────────────────────
// stagesFor() is the single place Model (tier) decides WHICH pipeline stages
// run — effort.ts separately decides DEPTH for whichever stage executes. Co.AI
// Master Prompt Part 4: Kanon makes exactly ONE provider call, however many
// stages it has — these tests lock in the worked-example sequences, the
// execution-mode split phase-stream.ts and route.ts depend on, and the
// one-final-stage invariant, plus the derived helpers workflowMaxTokens() and
// buildWorkflowSystem() that replaced the old per-stage buildSystem()/temperature.
//
// Co.AI Master Prompt Part 5.1/5.3: Ypertatos ("pro") additionally locks in
// the lightweight/engineering split and the structural guarantee that no
// tier but pro-engineering can ever produce a second (buffered) provider call.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkflowSystem,
  stagesFor,
  workflowMaxTokens,
  PHASE_MARKER,
  YPERTATOS_RESERVED_STAGES,
  type WorkflowStage,
  type YpertatosWorkflowKind,
} from "../lib/server/model-workflow";
import { EFFORT_LEVELS } from "../lib/effort";
import type { ModelTier } from "../lib/model-branding";

const ACTIVE_STAGES: WorkflowStage[] = [
  "context-builder",
  "requirement-analysis",
  "processing",
  "deep-think",
  "reflection",
  "review",
];
const NON_KANON_TIERS: (ModelTier | undefined)[] = ["lite", "titan", undefined];
const ALL_TIERS: (ModelTier | undefined)[] = ["lite", "normal", "pro", "titan", undefined];
const YPERTATOS_WORKFLOWS: YpertatosWorkflowKind[] = ["lightweight", "engineering"];

/** All (tier, effort, opts) triples worth sweeping — "pro" is expanded across
 *  both workflow kinds; every other tier ignores `opts` so it's swept once. */
function* allCombos(): Generator<[ModelTier | undefined, (typeof EFFORT_LEVELS)[number], YpertatosWorkflowKind | undefined]> {
  for (const tier of ALL_TIERS) {
    for (const effort of EFFORT_LEVELS) {
      if (tier === "pro") {
        for (const workflow of YPERTATOS_WORKFLOWS) yield [tier, effort, workflow];
      } else {
        yield [tier, effort, undefined];
      }
    }
  }
}

test("Kanon low/normal/high match the exact worked-example sequences", () => {
  assert.deepEqual(
    stagesFor("normal", "low").map((s) => s.stage),
    ["processing", "review"],
  );
  assert.deepEqual(
    stagesFor("normal", "normal").map((s) => s.stage),
    ["context-builder", "processing", "review"],
  );
  assert.deepEqual(
    stagesFor("normal", "high").map((s) => s.stage),
    ["context-builder", "processing", "deep-think", "review"],
  );
});

test("the 10 exact Ypertatos tables (5 efforts x 2 workflow kinds)", () => {
  const lightweight: Record<string, WorkflowStage[]> = {
    low: ["processing", "review"],
    normal: ["context-builder", "processing", "review"],
    high: ["context-builder", "processing", "deep-think", "review"],
    ultra: ["context-builder", "processing", "deep-think", "review"],
    extreme: ["context-builder", "processing", "deep-think", "review"],
  };
  const engineering: Record<string, WorkflowStage[]> = {
    low: ["requirement-analysis", "processing", "review"],
    normal: ["context-builder", "requirement-analysis", "processing", "review"],
    high: ["context-builder", "requirement-analysis", "processing", "deep-think", "review"],
    ultra: ["context-builder", "requirement-analysis", "processing", "deep-think", "reflection", "review"],
    extreme: ["context-builder", "requirement-analysis", "processing", "deep-think", "reflection", "review"],
  };
  for (const effort of EFFORT_LEVELS) {
    assert.deepEqual(
      stagesFor("pro", effort, { workflow: "lightweight" }).map((s) => s.stage),
      lightweight[effort],
      `lightweight@${effort}`,
    );
    assert.deepEqual(
      stagesFor("pro", effort, { workflow: "engineering" }).map((s) => s.stage),
      engineering[effort],
      `engineering@${effort}`,
    );
  }
  // Absent opts defaults to lightweight — the safe default that can never
  // introduce a second provider call.
  for (const effort of EFFORT_LEVELS) {
    assert.deepEqual(stagesFor("pro", effort).map((s) => s.stage), lightweight[effort]);
  }
  // Stage-count monotonicity within engineering: 3 -> 4 -> 5 -> 6 -> 6.
  const counts = EFFORT_LEVELS.map((e) => engineering[e].length);
  assert.deepEqual(counts, [3, 4, 5, 6, 6]);
});

test("every tier x effort x workflow combo has exactly one final stage, and it's always last, and it's always execution:phase", () => {
  for (const [tier, effort, workflow] of allCombos()) {
    const stages = stagesFor(tier, effort, { workflow });
    const finals = stages.filter((s) => s.final);
    assert.equal(finals.length, 1, `${tier}@${effort}/${workflow} has exactly one final stage`);
    assert.equal(stages[stages.length - 1].final, true, `${tier}@${effort}/${workflow} final stage is last`);
    assert.equal(stages[stages.length - 1].execution, "phase", `${tier}@${effort}/${workflow} final stage is a phase`);
  }
});

test("Mikros and every non-Kanon, non-Ypertatos tier resolve to the same single-stage stub", () => {
  for (const tier of NON_KANON_TIERS) {
    for (const effort of EFFORT_LEVELS) {
      const stages = stagesFor(tier, effort);
      assert.equal(stages.length, 1, `${tier}@${effort} is a single stage`);
      assert.equal(stages[0].stage, "processing");
      assert.equal(stages[0].final, true);
      assert.equal(stages[0].execution, "phase");
    }
  }
});

test("Kanon's defensive fallback (ultra/extreme, unreachable via clampEffort) still returns a valid workflow", () => {
  // Kanon's UI never offers ultra/extreme (effortLevelsFor("normal")), and
  // clampEffort() guarantees a stray value can't reach here — but stagesFor()
  // must still behave sanely (never throw, never return an empty array) if
  // called directly, since it doesn't itself gate on effortLevelsFor().
  for (const effort of ["ultra", "extreme"] as const) {
    const stages = stagesFor("normal", effort);
    assert.ok(stages.length > 0);
    assert.equal(stages[stages.length - 1].final, true);
  }
});

test("YPERTATOS_RESERVED_STAGES shares no names with the active stages, and is never returned", () => {
  for (const reserved of YPERTATOS_RESERVED_STAGES) {
    assert.ok(!ACTIVE_STAGES.includes(reserved), `${reserved} must not collide with an active stage name`);
  }
  for (const [tier, effort, workflow] of allCombos()) {
    const returned = stagesFor(tier, effort, { workflow }).map((s) => s.stage);
    for (const reserved of YPERTATOS_RESERVED_STAGES) {
      assert.ok(!returned.includes(reserved), `${tier}@${effort}/${workflow} must never return reserved stage ${reserved}`);
    }
  }
});

test("execution is `local` only for context-builder and `buffered` only for requirement-analysis", () => {
  for (const [tier, effort, workflow] of allCombos()) {
    for (const stage of stagesFor(tier, effort, { workflow })) {
      assert.equal(
        stage.execution === "local",
        stage.stage === "context-builder",
        `${tier}@${effort}/${workflow}/${stage.stage}.execution==="local"`,
      );
      assert.equal(
        stage.execution === "buffered",
        stage.stage === "requirement-analysis",
        `${tier}@${effort}/${workflow}/${stage.stage}.execution==="buffered"`,
      );
    }
  }
  assert.equal(stagesFor("normal", "low").filter((s) => s.execution !== "phase").length, 0);
});

test("non-phase stages are always a prefix of the stage list (phase-stream.ts's stageOffset assumption)", () => {
  for (const [tier, effort, workflow] of allCombos()) {
    const stages = stagesFor(tier, effort, { workflow });
    const firstPhase = stages.findIndex((s) => s.execution === "phase");
    const lastNonPhase = stages.map((s) => s.execution !== "phase").lastIndexOf(true);
    assert.ok(lastNonPhase < firstPhase || firstPhase === 0, `${tier}@${effort}/${workflow} non-phases-before-phases`);
  }
});

test("Kanon-regression guard: no tier but pro-engineering ever returns a buffered stage", () => {
  for (const [tier, effort, workflow] of allCombos()) {
    const stages = stagesFor(tier, effort, { workflow });
    const buffered = stages.filter((s) => s.execution === "buffered");
    if (tier === "pro" && workflow === "engineering") {
      assert.equal(buffered.length, 1, `${tier}@${effort}/${workflow} must have exactly one buffered stage`);
    } else {
      assert.equal(buffered.length, 0, `${tier}@${effort}/${workflow} must never have a buffered stage`);
    }
  }
});

test("workflowMaxTokens is monotonic across Kanon's effort levels and pays overhead on top of the effort-scaled answer", () => {
  const budgets = (["low", "normal", "high"] as const).map((effort) =>
    workflowMaxTokens(stagesFor("normal", effort), effort),
  );
  for (let i = 1; i < budgets.length; i++) assert.ok(budgets[i] > budgets[i - 1]);
  // High pays strictly more than Low even before the effort scaling difference
  // is considered — deep-think + context overhead is real, additive cost, not
  // silently absorbed into (or capped by) the effort-scaled answer ceiling.
  const highOverheadOnly = workflowMaxTokens(stagesFor("normal", "high"), "low");
  const lowTotal = workflowMaxTokens(stagesFor("normal", "low"), "low");
  assert.ok(highOverheadOnly > lowTotal);
});

test("workflowMaxTokens excludes the buffered requirement-analysis stage from the streamed budget", () => {
  // low/normal/high: engineering's streamed phases (processing[/deep-think]/review)
  // are byte-identical to lightweight's — RAA's 900 tokens must not shift the
  // streamed budget by even one token.
  for (const effort of ["low", "normal", "high"] as const) {
    const lightweightBudget = workflowMaxTokens(stagesFor("pro", effort, { workflow: "lightweight" }), effort);
    const engineeringBudget = workflowMaxTokens(stagesFor("pro", effort, { workflow: "engineering" }), effort);
    assert.equal(
      engineeringBudget,
      lightweightBudget,
      `${effort}: RAA's 900 tokens must not be added to the streamed call's budget`,
    );
  }
  // ultra/extreme: engineering adds the `reflection` PHASE (a real streamed
  // stage, +500 baseMaxTokens) on top of lightweight — the diff must be
  // exactly reflection's overhead, never RAA's excluded 900.
  for (const effort of ["ultra", "extreme"] as const) {
    const lightweightBudget = workflowMaxTokens(stagesFor("pro", effort, { workflow: "lightweight" }), effort);
    const engineeringBudget = workflowMaxTokens(stagesFor("pro", effort, { workflow: "engineering" }), effort);
    assert.equal(
      engineeringBudget - lightweightBudget,
      500,
      `${effort}: the only budget delta should be reflection's own overhead, not RAA's`,
    );
  }
});

test("buildWorkflowSystem renders DEEPTHINK only for High+, REFLECT only for Ultra/Extreme engineering, and is a no-op for single-stage (Mikros) workflows", () => {
  const base = "PERSONA";
  const low = buildWorkflowSystem(stagesFor("normal", "low"), { baseSystem: base });
  const medium = buildWorkflowSystem(stagesFor("normal", "normal"), { baseSystem: base });
  const high = buildWorkflowSystem(stagesFor("normal", "high"), { baseSystem: base });
  const mikros = buildWorkflowSystem(stagesFor("lite", "normal"), { baseSystem: base });

  for (const system of [low, medium, high]) {
    assert.ok(system.includes(PHASE_MARKER.processing!));
    assert.ok(system.includes(PHASE_MARKER.review!));
  }
  assert.ok(!low.includes(PHASE_MARKER["deep-think"]!));
  assert.ok(!medium.includes(PHASE_MARKER["deep-think"]!));
  assert.ok(high.includes(PHASE_MARKER["deep-think"]!));

  assert.equal(mikros, base); // single provider-facing stage → protocol is unnecessary overhead

  const engHigh = buildWorkflowSystem(stagesFor("pro", "high", { workflow: "engineering" }), { baseSystem: base });
  const engUltra = buildWorkflowSystem(stagesFor("pro", "ultra", { workflow: "engineering" }), { baseSystem: base });
  assert.ok(!engHigh.includes(PHASE_MARKER.reflection!));
  assert.ok(engUltra.includes(PHASE_MARKER.reflection!));

  // requirement-analysis is buffered — it must never be rendered as a phase,
  // whatever effort/workflow combination is asked for.
  for (const [tier, effort, workflow] of [
    ["pro", "low", "engineering"],
    ["pro", "extreme", "engineering"],
  ] as const) {
    const system = buildWorkflowSystem(stagesFor(tier, effort, { workflow }), { baseSystem: base });
    assert.ok(!system.includes("requirement-analysis"));
  }
});
