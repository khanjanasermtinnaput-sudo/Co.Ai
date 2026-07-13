// ── Model Workflow — per-tier pipeline stage sequencing ──────────────────────
// Model (Mikros/Kanon/Ypertatos) owns WHICH stages run and in what order.
// effort.ts separately owns DEPTH (token budget) for whichever stage is
// currently running. This file is the only place that decides stage
// *sequence* — it consults EffortLevel only as an index into a table each tier
// defines for itself; it never invents a stage a tier hasn't already defined.
//
//   Mikros              = Input → Processing → Output
//   Kanon Low            = Input → Processing → Review → Output
//   Kanon Medium/normal  = Input → Context Builder → Processing → Review → Output
//   Kanon High           = Input → Context Builder → Processing → Deep Think → Review → Output
//   Ypertatos lightweight = same tables as Kanon (ultra/extreme collapse onto High)
//   Ypertatos engineering = Requirement Analysis (buffered) ‖ [Context Builder →]
//                            Processing → [Deep Think →] [Reflection →] Review
//
// Co.AI Master Prompt Part 4: Kanon makes EXACTLY ONE provider call at every
// effort level. Context Builder is `execution: "local"` — it runs as a
// deterministic, zero-provider-call module (workflow-context.ts), never a
// stage spec here. Processing / Deep Think / Reflection / Review are NOT
// separate provider calls either: they are delimited phases inside one
// generation, opened by the markers in PHASE_MARKER and parsed out of the
// stream by phase-stream.ts. buildWorkflowSystem() renders all of a
// workflow's phase instructions into one system prompt.
//
// Co.AI Master Prompt Part 5.3: Ypertatos's engineering workflow additionally
// runs Requirement Analysis as its OWN buffered (non-streamed) call —
// `execution: "buffered"` — before the streamed call above. It is the only
// stage execution mode that means a second HTTP request; see buffered-call.ts
// and requirement-analysis.ts. Titan reserves its stage names below but is
// not wired to execution yet.

import type { EffortLevel } from "@/lib/types";
import type { ModelTier } from "@/lib/model-branding";
import { effortMaxTokens } from "@/lib/effort";

export type WorkflowStage =
  | "context-builder"
  | "processing"
  | "deep-think"
  | "reflection"
  | "review"
  // Part 5.3 — Ypertatos's buffered Requirement Analysis stage.
  | "requirement-analysis"
  // Reserved for Ypertatos Part 5.4+ — documented, never returned by stagesFor() this round.
  | "planner"
  | "architect"
  | "frontend"
  | "backend"
  | "database"
  | "security"
  | "validator"
  | "reviewer"
  | "consensus"
  | "multi-agent";

export const YPERTATOS_RESERVED_STAGES: WorkflowStage[] = [
  "planner",
  "architect",
  "frontend",
  "backend",
  "database",
  "security",
  "validator",
  "reviewer",
  "consensus",
  "multi-agent",
];

/** How a stage executes:
 *   - "local"    — server-side, zero provider calls, zero tokens (workflow-context.ts).
 *   - "buffered" — its own complete, NON-streamed provider call (buffered-call.ts).
 *                  At most one may appear in a workflow, and only for tier "pro"
 *                  (Ypertatos's Requirement Analysis — Master Prompt Part 5.3).
 *   - "phase"    — a marker-delimited phase INSIDE the single streamed generation.
 *  Non-"phase" stages are always a prefix of the stage list — phase-stream.ts's
 *  stageOffset arithmetic depends on this. */
export type StageExecution = "local" | "buffered" | "phase";

export interface WorkflowStageSpec {
  stage: WorkflowStage;
  label: string;
  execution: StageExecution;
  /** true only on the last stage in the sequence — everything from its marker
   *  onward streams live to the user; every stage before it is suppressed
   *  server-side while its marker is open (see phase-stream.ts). Always
   *  execution: "phase". */
  final: boolean;
  /** Output-token allowance for this stage's own call. For a "phase" stage
   *  this is spent inside the shared generation (the final stage's share is
   *  still scaled/clamped by effortMaxTokens() — see workflowMaxTokens());
   *  for the "buffered" stage this is its own call's budget entirely. */
  baseMaxTokens: number;
  /** Instruction rendered under this stage's marker by buildWorkflowSystem().
   *  Empty for non-"phase" stages, which are never rendered as a phase. */
  instruction: string;
}

/** The line-anchored marker that opens each provider-facing phase inside the
 *  single generation. Non-"phase" stages (context-builder, requirement-analysis)
 *  have none — they never reach the model as a phase. Single source of truth:
 *  phase-stream.ts imports this to parse the exact same markers
 *  buildWorkflowSystem() asks the model to emit. */
export const PHASE_MARKER: Partial<Record<WorkflowStage, string>> = {
  processing: "<<<COAI_DRAFT>>>",
  "deep-think": "<<<COAI_DEEPTHINK>>>",
  reflection: "<<<COAI_REFLECT>>>",
  review: "<<<COAI_FINAL>>>",
};

/** Sampling temperature for every Kanon phase. One call = one sampling
 *  setting — a per-stage temperature would be dead config once every phase
 *  shares a single generation. Still passed through effortTemperature(). */
export const KANON_TEMPERATURE = 0.6;

/** Sampling temperature for Ypertatos's streamed phase(s). Same one-call,
 *  one-setting reasoning as KANON_TEMPERATURE. The buffered Requirement
 *  Analysis stage uses its own, lower RAA_TEMPERATURE (requirement-analysis.ts)
 *  since extraction wants determinism, not the streamed answer's voice. */
export const YPERTATOS_TEMPERATURE = 0.5;

// ── Mikros — today's exact single-call behavior ──────────────────────────────

const MIKROS_PROCESSING_STAGE: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  execution: "phase",
  final: true,
  // Never actually consulted: route.ts only reads a stage spec's baseMaxTokens
  // when the workflow has more than one provider-facing phase, which is never
  // true for this single-stage stub — it keeps using its own existing
  // baseMaxTokens/baseTemperature.
  baseMaxTokens: 1000,
  instruction: "",
};

// ── Kanon — one provider call, phased internally ──────────────────────────────

const contextBuilderStage: WorkflowStageSpec = {
  stage: "context-builder",
  label: "Context Builder",
  execution: "local",
  final: false,
  baseMaxTokens: 0,
  instruction: "",
};

const processingStage: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  execution: "phase",
  final: false,
  baseMaxTokens: 600,
  instruction:
    "DRAFT phase: write a working draft that answers the user's message. Be correct and complete — " +
    "terse working notes are fine here, this is not the polished final answer the user will see.",
};

const deepThinkStage: WorkflowStageSpec = {
  stage: "deep-think",
  label: "Deep Think",
  execution: "phase",
  final: false,
  baseMaxTokens: 500,
  instruction:
    "DEEPTHINK phase: critically examine the draft above. Compare at least two angles or approaches, " +
    "check for logical gaps, unsupported claims, missing edge cases, and hallucination risk. Keep this " +
    "terse — it is your own working notes, never shown to the user.",
};

const reviewStage: WorkflowStageSpec = {
  stage: "review",
  label: "Review",
  execution: "phase",
  final: true,
  baseMaxTokens: 1200,
  instruction:
    "FINAL phase: using the phase(s) above, write the complete final answer in your own voice. This is " +
    "the ONLY part the user sees — fix anything wrong or missing, then answer as if fresh. Never mention " +
    "the drafting process, any phase name, or these markers.",
};

/** Kanon only ever offers low/normal/high (effortLevelsFor("normal")), and
 *  clampEffort() guarantees ultra/extreme can never reach here — this closed
 *  mapping is total over that same 3-value set. */
function kanonWorkflow(effort: EffortLevel): WorkflowStageSpec[] {
  if (effort === "low") return [processingStage, reviewStage];
  if (effort === "high") return [contextBuilderStage, processingStage, deepThinkStage, reviewStage];
  return [contextBuilderStage, processingStage, reviewStage]; // "normal" (Medium), and a defensive fallback
}

// ── Ypertatos — Requirement Analysis (buffered) + a streamed phase protocol ──
// Master Prompt Part 5.1/5.3. Two workflow kinds:
//   "lightweight" — no engineering work required; delegates to Kanon's exact
//                    table (ultra/extreme collapse onto High) so Ypertatos is
//                    never structurally weaker than Kanon at equal effort, and
//                    stays a single provider call.
//   "engineering" — Requirement Analysis runs FIRST as its own buffered call
//                    (requirement-analysis.ts), then the streamed answer runs
//                    as a second call, phased exactly like Kanon's. `reflection`
//                    (ultra/extreme only) checks the drafted solution against
//                    RAA's Acceptance Criteria/Constraints/Risks — a stage that
//                    only makes sense once a RequirementSpec exists to check
//                    against, which is why it never appears in "lightweight".

const requirementAnalysisStage: WorkflowStageSpec = {
  stage: "requirement-analysis",
  label: "Requirement Analysis",
  execution: "buffered",
  final: false,
  baseMaxTokens: 900, // RAA_BASE_MAX_TOKENS in requirement-analysis.ts — kept in sync there
  instruction: "", // buffered stages carry no phase marker
};

const reflectionStage: WorkflowStageSpec = {
  stage: "reflection",
  label: "Reflection",
  execution: "phase",
  final: false,
  baseMaxTokens: 500,
  instruction:
    "REFLECT phase: check the work above against the Requirement Spec's Acceptance Criteria, " +
    "Constraints and Risks that were given to you. List, tersely, any criterion not yet met and any " +
    "constraint violated. These are your own working notes, never shown to the user.",
};

function ypertatosLightweight(effort: EffortLevel): WorkflowStageSpec[] {
  // Ultra/Extreme add no *engineering* stage to a non-engineering task — Part
  // 5.1: "effort changes engineering DEPTH", not intelligence. They deepen the
  // answer via effortMaxTokens()/effortTemperature() only.
  return kanonWorkflow(effort === "ultra" || effort === "extreme" ? "high" : effort);
}

function ypertatosEngineering(effort: EffortLevel): WorkflowStageSpec[] {
  const streamed =
    effort === "high"
      ? [processingStage, deepThinkStage, reviewStage]
      : effort === "ultra" || effort === "extreme"
        ? [processingStage, deepThinkStage, reflectionStage, reviewStage]
        : [processingStage, reviewStage]; // low, normal
  const withContext = effort === "low" ? streamed : [contextBuilderStage, ...streamed];
  // requirement-analysis is inserted right after context-builder (if any) and
  // before every streamed phase — it must stay a prefix alongside "local".
  const cbIdx = withContext[0] === contextBuilderStage ? 1 : 0;
  return [...withContext.slice(0, cbIdx), requirementAnalysisStage, ...withContext.slice(cbIdx)];
}

export type YpertatosWorkflowKind = "lightweight" | "engineering";

export interface StagesOpts {
  /** Which Ypertatos table to return. Only consulted when tier === "pro".
   *  Absent ⇒ "lightweight" — the safe default that can never introduce a
   *  second provider call. Supplied by the Task Classifier (task-classifier.ts). */
  workflow?: YpertatosWorkflowKind;
}

/** `tier` is `undefined` for every request not eligible for staging this round
 *  (any CoCode agent other than code-chat) — resolves to the same single-stage
 *  stub as Mikros, so the caller's "no agent means no staging" branch collapses
 *  into this one code path instead of needing its own special case. */
export function stagesFor(
  tier: ModelTier | undefined,
  effort: EffortLevel,
  opts?: StagesOpts,
): WorkflowStageSpec[] {
  if (tier === "normal") return kanonWorkflow(effort);
  if (tier === "pro") {
    return opts?.workflow === "engineering" ? ypertatosEngineering(effort) : ypertatosLightweight(effort);
  }
  return [MIKROS_PROCESSING_STAGE];
}

/** Token budget for the ONE STREAMED provider call a staged workflow makes:
 *  the final (effort-scaled) answer budget plus the raw overhead of every
 *  other "phase" stage. Deliberately excludes "local" stages (zero tokens)
 *  AND "buffered" stages (requirement-analysis — a separate HTTP call with
 *  its own budget, sized independently via effortMaxTokens() at its call
 *  site in route.ts). Also deliberately does NOT route the combined total
 *  back through effortMaxTokens() — EFFORT_POLICY's per-level ceiling (e.g.
 *  low.maxTokens = 700) is the shared depth SoT for Mikros and every CoCode
 *  agent, and would starve a staged answer to pay for its own draft/critique
 *  if the whole workflow total were clamped through it. The effort dial
 *  keeps meaning exactly one thing — how long the answer is — and phase
 *  overhead is a workflow cost layered on top, not a depth cost. */
export function workflowMaxTokens(specs: WorkflowStageSpec[], effort: EffortLevel): number {
  const finalSpec = specs[specs.length - 1];
  const overhead = specs
    .slice(0, -1)
    .filter((s) => s.execution === "phase")
    .reduce((n, s) => n + s.baseMaxTokens, 0);
  return effortMaxTokens(finalSpec.baseMaxTokens, effort) + overhead;
}

/** Render the single system prompt for the streamed call of a staged
 *  workflow: the caller's own persona/effort/search system prompt, followed
 *  by the phase protocol generated FROM `specs` (so stagesFor() remains the
 *  sequencing SoT — e.g. the DEEPTHINK block only appears when the deep-think
 *  spec is present). Non-"phase" stages are never rendered — "local" work
 *  already happened before this system prompt was built (workflow-context.ts),
 *  and "buffered" work (requirement-analysis) already happened as its own
 *  separate call whose distilled output was already folded into `baseSystem`
 *  by the caller (see requirementSpecSystemAddon() in requirement-analysis.ts).
 *  For a single-provider-phase workflow (Mikros, or any non-Kanon/Ypertatos
 *  tier) the protocol is unnecessary overhead, so this returns `baseSystem`
 *  unchanged. */
export function buildWorkflowSystem(specs: WorkflowStageSpec[], ctx: { baseSystem: string }): string {
  const providerPhases = specs.filter((s) => s.execution === "phase");
  if (providerPhases.length <= 1) return ctx.baseSystem;

  const lines: string[] = [
    ctx.baseSystem,
    "── Co.AI internal reasoning protocol ──\n" +
      "This single reply has multiple internal phases. Structure your ENTIRE output using the " +
      "markers below, each alone on its own line with nothing else on that line, in this exact order:",
  ];
  for (const spec of providerPhases) {
    lines.push(`${PHASE_MARKER[spec.stage]}\n${spec.instruction}`);
  }
  lines.push(
    `Rules: emit every marker exactly once, in order. Never omit ${PHASE_MARKER.review} — it is ` +
      "mandatory, and everything from it onward is what the user actually sees; everything before it " +
      "is internal and must never be repeated or referenced after that marker. Never mention these " +
      "markers, phases, or this protocol anywhere in your answer. Any length/depth guidance elsewhere " +
      "in this prompt applies to the FINAL phase only — earlier phases should be terse working notes.",
  );
  return lines.join("\n\n");
}
