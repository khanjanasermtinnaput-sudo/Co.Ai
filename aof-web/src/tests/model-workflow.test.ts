// ── Model Workflow — stage sequencing (no network) ────────────────────────────
// stagesFor() is the single place Model (tier) decides WHICH pipeline stages
// run — effort.ts separately decides DEPTH for whichever stage executes. These
// tests lock in the worked-example sequences from the plan and the structural
// invariants the route.ts integration depends on: exactly one final stage,
// always last, and every non-Kanon tier collapsing to the same single-stage
// stub Mikros already uses today.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stagesFor, YPERTATOS_RESERVED_STAGES, type WorkflowStage } from "../lib/server/model-workflow";
import { EFFORT_LEVELS } from "../lib/effort";
import type { ModelTier } from "../lib/model-branding";

const ACTIVE_STAGES: WorkflowStage[] = ["context-builder", "processing", "deep-think", "review"];
const NON_KANON_TIERS: (ModelTier | undefined)[] = ["lite", "pro", "titan", undefined];

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
  const tiers: (ModelTier | undefined)[] = ["lite", "normal", "pro", "titan", undefined];
  for (const tier of tiers) {
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
  const tiers: (ModelTier | undefined)[] = ["lite", "normal", "pro", "titan", undefined];
  for (const tier of tiers) {
    for (const effort of EFFORT_LEVELS) {
      const returned = stagesFor(tier, effort).map((s) => s.stage);
      for (const reserved of YPERTATOS_RESERVED_STAGES) {
        assert.ok(!returned.includes(reserved), `${tier}@${effort} must never return reserved stage ${reserved}`);
      }
    }
  }
});

test("buildSystem folds prior stage outputs into the running system prompt", () => {
  const [contextBuilder, processing, review] = stagesFor("normal", "normal");
  const base = "PERSONA";
  const cbSystem = contextBuilder.buildSystem({ baseSystem: base, priorOutputs: [], message: "hi", history: [] });
  assert.match(cbSystem, /CONTEXT BUILDER/);

  const priorOutputs = [{ stage: contextBuilder.stage, label: contextBuilder.label, text: "relevant fact X" }];
  const procSystem = processing.buildSystem({ baseSystem: base, priorOutputs, message: "hi", history: [] });
  assert.match(procSystem, /relevant fact X/);

  const priorOutputs2 = [
    ...priorOutputs,
    { stage: processing.stage, label: processing.label, text: "draft answer Y" },
  ];
  const reviewSystem = review.buildSystem({ baseSystem: base, priorOutputs: priorOutputs2, message: "hi", history: [] });
  assert.match(reviewSystem, /draft answer Y/);
  assert.match(reviewSystem, /REVIEW/);
});
