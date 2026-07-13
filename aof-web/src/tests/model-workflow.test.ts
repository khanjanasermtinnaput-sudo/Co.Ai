// ── Model Workflow — stage sequencing (no network) ────────────────────────────
// stagesFor() is the single place Model (tier) decides WHICH pipeline stages
// run — effort.ts separately decides DEPTH for whichever stage executes. Co.AI
// Master Prompt Part 4: Kanon makes exactly ONE provider call, however many
// stages it has — these tests lock in the worked-example sequences, the
// local/provider-phase split phase-stream.ts and route.ts depend on, and the
// one-final-stage invariant, plus the derived helpers workflowMaxTokens() and
// buildWorkflowSystem() that replaced the old per-stage buildSystem()/temperature.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkflowSystem,
  stagesFor,
  workflowMaxTokens,
  PHASE_MARKER,
  YPERTATOS_RESERVED_STAGES,
  type WorkflowStage,
} from "../lib/server/model-workflow";
import { EFFORT_LEVELS } from "../lib/effort";
import type { ModelTier } from "../lib/model-branding";

const ACTIVE_STAGES: WorkflowStage[] = ["context-builder", "processing", "deep-think", "review"];
const NON_KANON_TIERS: (ModelTier | undefined)[] = ["lite", "pro", "titan", undefined];
const ALL_TIERS: (ModelTier | undefined)[] = ["lite", "normal", "pro", "titan", undefined];

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

test("every tier x effort combo has exactly one final stage, and it's always last", () => {
  for (const tier of ALL_TIERS) {
    for (const effort of EFFORT_LEVELS) {
      const stages = stagesFor(tier, effort);
      const finals = stages.filter((s) => s.final);
      assert.equal(finals.length, 1, `${tier}@${effort} has exactly one final stage`);
      assert.equal(stages[stages.length - 1].final, true, `${tier}@${effort} final stage is last`);
    }
  }
});

test("Mikros and every non-Kanon tier resolve to the same single-stage stub", () => {
  for (const tier of NON_KANON_TIERS) {
    for (const effort of EFFORT_LEVELS) {
      const stages = stagesFor(tier, effort);
      assert.equal(stages.length, 1, `${tier}@${effort} is a single stage`);
      assert.equal(stages[0].stage, "processing");
      assert.equal(stages[0].final, true);
      assert.equal(stages[0].local, false);
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

test("YPERTATOS_RESERVED_STAGES shares no names with the 4 active stages, and is never returned", () => {
  for (const reserved of YPERTATOS_RESERVED_STAGES) {
    assert.ok(!ACTIVE_STAGES.includes(reserved), `${reserved} must not collide with an active stage name`);
  }
  for (const tier of ALL_TIERS) {
    for (const effort of EFFORT_LEVELS) {
      const returned = stagesFor(tier, effort).map((s) => s.stage);
      for (const reserved of YPERTATOS_RESERVED_STAGES) {
        assert.ok(!returned.includes(reserved), `${tier}@${effort} must never return reserved stage ${reserved}`);
      }
    }
  }
});

test("`local` is true only for context-builder, and Kanon Low has zero local stages", () => {
  for (const tier of ALL_TIERS) {
    for (const effort of EFFORT_LEVELS) {
      for (const stage of stagesFor(tier, effort)) {
        assert.equal(stage.local, stage.stage === "context-builder", `${tier}@${effort}/${stage.stage}.local`);
      }
    }
  }
  assert.equal(stagesFor("normal", "low").filter((s) => s.local).length, 0);
});

test("local stages are always a prefix of the stage list (phase-stream.ts's stageOffset assumption)", () => {
  for (const tier of ALL_TIERS) {
    for (const effort of EFFORT_LEVELS) {
      const stages = stagesFor(tier, effort);
      const firstNonLocal = stages.findIndex((s) => !s.local);
      const lastLocal = stages.map((s) => s.local).lastIndexOf(true);
      assert.ok(lastLocal < firstNonLocal || firstNonLocal === 0, `${tier}@${effort} locals-before-providers`);
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

test("buildWorkflowSystem renders DEEPTHINK only for High, and is a no-op for single-stage (Mikros) workflows", () => {
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
});
