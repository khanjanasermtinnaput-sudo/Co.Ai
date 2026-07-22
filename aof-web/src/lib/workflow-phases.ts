// ── Workflow phases — user-facing names for the server's stage sequence ──────
// stagesFor() (model-workflow.ts) remains the ONE place that decides which
// stages a turn runs and what they're called server-side ("Context Builder",
// "Planning (TMAP)", …) — those labels stay in every log line and test
// unchanged. This module only maps the stable stage id every StageNotice
// frame already carries onto a calmer, user-facing PHASE for display —
// "Planning (TMAP)" never needs to reach a CoChat user as raw jargon, and a
// Kanon-low turn (context-builder + processing + review) shows only the
// phases it actually ran, never a padded five-phase bar.
//
// Deliberately client-side, not a server rename: renaming stagesFor()'s own
// labels would ripple into logAofStage()'s `stage=` fields and every
// regression test that locks them — for zero product value.

import type { WorkflowStage } from "./server/model-workflow";

export type WorkflowPhase = "Understanding" | "Planning" | "Building" | "Validating" | "Reviewing";

export const PHASE_ORDER: WorkflowPhase[] = [
  "Understanding",
  "Planning",
  "Building",
  "Validating",
  "Reviewing",
];

/** Exhaustive over WorkflowStage (minus "consensus", reserved/never emitted —
 *  see model-workflow.ts) so a mapping test can assert it stays in sync. */
const STAGE_TO_PHASE: Record<Exclude<WorkflowStage, "consensus">, WorkflowPhase> = {
  "context-builder": "Understanding",
  "requirement-analysis": "Understanding",
  planner: "Planning",
  processing: "Building",
  "multi-agent": "Building",
  "deep-think": "Validating",
  reflection: "Validating",
  review: "Reviewing",
};

/** Maps a StageNotice's stage id to its user-facing phase. Falls back to the
 *  server's own label for anything unrecognized (a future stage not yet
 *  wired here), never dropping the information — forward-compatible, not
 *  silently wrong. */
export function phaseForStage(stage: string, fallbackLabel: string): WorkflowPhase | string {
  return (STAGE_TO_PHASE as Record<string, WorkflowPhase>)[stage] ?? fallbackLabel;
}
