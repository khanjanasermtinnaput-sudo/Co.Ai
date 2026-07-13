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
//
// Co.AI Master Prompt Part 4: Kanon makes EXACTLY ONE provider call at every
// effort level. Context Builder is `local: true` — it runs as a deterministic,
// zero-provider-call module (workflow-context.ts), never a stage spec here.
// Processing / Deep Think / Review are NOT separate provider calls either: they
// are delimited phases inside one generation, opened by the markers in
// PHASE_MARKER and parsed out of the stream by phase-stream.ts. buildWorkflowSystem()
// renders all of a workflow's phase instructions into one system prompt.
//
// Ypertatos/Titan reserve their stage names below but are not wired to
// execution yet — stagesFor() falls back to the single-stage Mikros-equivalent
// for every tier other than Kanon, so extending Ypertatos later only means
// adding a new branch here — zero lines change in the Kanon/Mikros tables.

import type { EffortLevel } from "@/lib/types";
import type { ModelTier } from "@/lib/model-branding";
import { effortMaxTokens } from "@/lib/effort";

export type WorkflowStage =
  | "context-builder"
  | "processing"
  | "deep-think"
  | "review"
  // Reserved for Ypertatos/Titan — documented, never returned by stagesFor() this round.
  | "planner"
  | "architect"
  | "frontend"
  | "backend"
  | "database"
  | "security"
  | "validator"
  | "reviewer"
  | "reflection"
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
  "reflection",
  "consensus",
  "multi-agent",
];

export interface WorkflowStageSpec {
  stage: WorkflowStage;
  label: string;
  /** Executed locally on the server — no provider call, no marker, no output
   *  tokens. Only `context-builder` is ever local today (workflow-context.ts). */
  local: boolean;
  /** true only on the last stage in the sequence — everything from its marker
   *  onward streams live to the user; every stage before it is suppressed
   *  server-side while its marker is open (see phase-stream.ts). */
  final: boolean;
  /** Output-token allowance for this phase INSIDE the one generation. For the
   *  final stage, effortMaxTokens() still scales/clamps it (see
   *  workflowMaxTokens()); interior phases spend this raw, as fixed overhead. */
  baseMaxTokens: number;
  /** Instruction rendered under this stage's marker by buildWorkflowSystem().
   *  Empty for local stages, which never appear in the rendered prompt. */
  instruction: string;
}

/** The line-anchored marker that opens each provider-facing phase inside the
 *  single generation. Local stages (context-builder) have none — they never
 *  reach the model. Single source of truth: phase-stream.ts imports this to
 *  parse the exact same markers buildWorkflowSystem() asks the model to emit. */
export const PHASE_MARKER: Partial<Record<WorkflowStage, string>> = {
  processing: "<<<COAI_DRAFT>>>",
  "deep-think": "<<<COAI_DEEPTHINK>>>",
  review: "<<<COAI_FINAL>>>",
};

/** Sampling temperature for every Kanon phase. One call = one sampling
 *  setting — a per-stage temperature would be dead config once every phase
 *  shares a single generation. Still passed through effortTemperature(). */
export const KANON_TEMPERATURE = 0.6;

// ── Mikros — today's exact single-call behavior ──────────────────────────────

const MIKROS_PROCESSING_STAGE: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  local: false,
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
  local: true,
  final: false,
  baseMaxTokens: 0,
  instruction: "",
};

const processingStage: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  local: false,
  final: false,
  baseMaxTokens: 600,
  instruction:
    "DRAFT phase: write a working draft that answers the user's message. Be correct and complete — " +
    "terse working notes are fine here, this is not the polished final answer the user will see.",
};

const deepThinkStage: WorkflowStageSpec = {
  stage: "deep-think",
  label: "Deep Think",
  local: false,
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
  local: false,
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

/** `tier` is `undefined` for every request not eligible for staging this round
 *  (any CoCode agent other than code-chat) — resolves to the same single-stage
 *  stub as Mikros, so the caller's "no agent means no staging" branch collapses
 *  into this one code path instead of needing its own special case. */
export function stagesFor(tier: ModelTier | undefined, effort: EffortLevel): WorkflowStageSpec[] {
  if (tier === "normal") return kanonWorkflow(effort);
  return [MIKROS_PROCESSING_STAGE];
}

/** Token budget for the ONE provider call a staged workflow makes: the final
 *  (effort-scaled) answer budget plus the raw overhead of every non-local
 *  interior phase. Deliberately does NOT route the combined total back through
 *  effortMaxTokens() — EFFORT_POLICY's per-level ceiling (e.g. low.maxTokens =
 *  700) is the shared depth SoT for Mikros and every CoCode agent, and would
 *  starve a staged answer to pay for its own draft/critique if the whole
 *  workflow total were clamped through it. The effort dial keeps meaning
 *  exactly one thing — how long the answer is — and phase overhead is a
 *  workflow cost layered on top, not a depth cost. */
export function workflowMaxTokens(specs: WorkflowStageSpec[], effort: EffortLevel): number {
  const finalSpec = specs[specs.length - 1];
  const overhead = specs
    .slice(0, -1)
    .filter((s) => !s.local)
    .reduce((n, s) => n + s.baseMaxTokens, 0);
  return effortMaxTokens(finalSpec.baseMaxTokens, effort) + overhead;
}

/** Render the single system prompt for a staged workflow: the caller's own
 *  persona/effort/search system prompt, followed by the phase protocol
 *  generated FROM `specs` (so stagesFor() remains the sequencing SoT — e.g. the
 *  DEEPTHINK block only appears when the deep-think spec is present). Local
 *  stages are never rendered — their work already happened before this system
 *  prompt was built (see workflow-context.ts). For a single-provider-phase
 *  workflow (Mikros, or any non-Kanon tier) the protocol is unnecessary
 *  overhead, so this returns `baseSystem` unchanged. */
export function buildWorkflowSystem(specs: WorkflowStageSpec[], ctx: { baseSystem: string }): string {
  const providerPhases = specs.filter((s) => !s.local);
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
