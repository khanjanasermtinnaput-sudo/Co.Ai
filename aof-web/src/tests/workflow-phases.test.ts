import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseForStage, PHASE_ORDER } from "../lib/workflow-phases";
import type { WorkflowStage } from "../lib/server/model-workflow";

// STAGE_TO_PHASE is typed as Record<Exclude<WorkflowStage, "consensus">, WorkflowPhase>,
// so tsc itself already refuses to compile if a stage is ever added to
// WorkflowStage without a mapping here. This test is the runtime companion:
// it walks every stage stagesFor() can actually emit and asserts each lands
// on a real PHASE_ORDER entry, never silently falling through to the
// fallback-label branch.
const REAL_STAGES: Exclude<WorkflowStage, "consensus">[] = [
  "context-builder",
  "requirement-analysis",
  "planner",
  "processing",
  "multi-agent",
  "deep-think",
  "reflection",
  "review",
];

test("every real WorkflowStage maps onto a canonical user-facing phase", () => {
  for (const stage of REAL_STAGES) {
    const phase = phaseForStage(stage, "server label");
    assert.ok(
      (PHASE_ORDER as string[]).includes(phase),
      `stage "${stage}" did not map to a PHASE_ORDER entry (got "${phase}")`,
    );
  }
});

test("an unrecognized stage id falls back to the server's own label, not silently dropped", () => {
  assert.equal(phaseForStage("some-future-stage", "Consensus Vote"), "Consensus Vote");
});

test("Understanding groups the two pre-planning stages; Building groups processing + orchestration", () => {
  assert.equal(phaseForStage("context-builder", ""), "Understanding");
  assert.equal(phaseForStage("requirement-analysis", ""), "Understanding");
  assert.equal(phaseForStage("processing", ""), "Building");
  assert.equal(phaseForStage("multi-agent", ""), "Building");
});

test("PHASE_ORDER is the fixed Understanding→Reviewing sequence", () => {
  assert.deepEqual(PHASE_ORDER, ["Understanding", "Planning", "Building", "Validating", "Reviewing"]);
});
