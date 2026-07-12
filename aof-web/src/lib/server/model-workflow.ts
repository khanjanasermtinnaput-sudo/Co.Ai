// ── Model Workflow — per-tier pipeline stage sequencing ──────────────────────
// Model (Mikros/Kanon/Ypertatos) owns WHICH stages run and in what order.
// effort.ts separately owns DEPTH (token budget, temperature) for whichever
// stage is currently running. This file is the only place that decides stage
// *sequence* — it consults EffortLevel only as an index into a table each tier
// defines for itself; it never invents a stage a tier hasn't already defined.
//
//   Mikros            = Input → Processing → Output
//   Kanon Low          = Input → Processing → Review → Output
//   Kanon Medium/normal = Input → Context Builder → Processing → Review → Output
//   Kanon High          = Input → Context Builder → Processing → Deep Think → Review → Output
//
// Ypertatos/Titan reserve their stage names below but are not wired to
// execution yet — stagesFor() falls back to the single-stage Mikros-equivalent
// for every tier other than Kanon, so extending Ypertatos later only means
// adding a new branch here — zero lines change in the Kanon/Mikros tables.

import type { EffortLevel } from "@/lib/types";
import type { ModelTier } from "@/lib/model-branding";

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

export interface StageOutput {
  stage: WorkflowStage;
  label: string;
  text: string;
}

export interface StageBuildCtx {
  /** The persona/system prompt already resolved by the caller (chatModelConfig
   *  or agentConfig, plus the effort addon and any search addon). */
  baseSystem: string;
  /** Outputs of every stage that already ran this request, in order. */
  priorOutputs: StageOutput[];
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
}

export interface WorkflowStageSpec {
  stage: WorkflowStage;
  label: string;
  /** true only on the last stage in the sequence — that stage streams live to
   *  the user via the existing primeAndStream/failover loop; every other
   *  stage runs to completion server-side first (see workflow-runner.ts). */
  final: boolean;
  /** Pre-effort token budget; effortMaxTokens() still scales/clamps it. */
  baseMaxTokens: number;
  /** Pre-effort temperature; effortTemperature() still caps it. */
  temperature: number;
  buildSystem: (ctx: StageBuildCtx) => string;
}

function wrapPriorOutput(o: StageOutput): string {
  return [`<${o.stage}_output label="${o.label}">`, o.text, `</${o.stage}_output>`].join("\n");
}

/** Fold every prior stage's output into the running system prompt, then append
 *  this stage's own instruction. Mirrors the wrap-and-label shape
 *  buildSearchContext() uses for search results (context-builder.ts) — minus
 *  the "untrusted data" framing, since this is the model's own prior output. */
function withPriorOutputs(ctx: StageBuildCtx, instruction: string): string {
  const blocks = ctx.priorOutputs.map(wrapPriorOutput).join("\n\n");
  return [ctx.baseSystem, blocks, instruction].filter(Boolean).join("\n\n");
}

// ── Mikros — today's exact single-call behavior ──────────────────────────────

const MIKROS_PROCESSING_STAGE: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  final: true,
  // Never actually consulted: route.ts only reads a stage spec's baseMaxTokens/
  // temperature when interiorStages.length > 0, which is never true for this
  // single-stage stub — it keeps using its own existing baseMaxTokens/baseTemperature.
  baseMaxTokens: 1000,
  temperature: 0.7,
  buildSystem: (ctx) => ctx.baseSystem,
};

// ── Kanon — real interior stages ─────────────────────────────────────────────

const contextBuilderStage: WorkflowStageSpec = {
  stage: "context-builder",
  label: "Context Builder",
  final: false,
  baseMaxTokens: 400,
  temperature: 0.3,
  buildSystem: () =>
    [
      "You are the CONTEXT BUILDER stage of a multi-stage assistant pipeline. Your only " +
        "job: read the conversation history and the user's current message, then extract " +
        "ONLY the prior facts, decisions, or answers that are actually relevant to answering " +
        "the current message. Skip anything unrelated — the goal is to save tokens downstream, " +
        "not to summarize everything.",
      "Output a short, dense bullet list of relevant context. If nothing in the history is " +
        "relevant, output exactly: (no relevant context)",
      "Do NOT answer the user's question yourself. Do not add commentary.",
    ].join("\n\n"),
};

const processingStage: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  final: false,
  baseMaxTokens: 900,
  temperature: 0.6,
  buildSystem: (ctx) =>
    ctx.priorOutputs.length
      ? withPriorOutputs(
          ctx,
          "Using any relevant context above, draft an answer to the user's message. This is a " +
            "draft — later stages may refine it — so focus on being correct and complete rather " +
            "than polished.",
        )
      : ctx.baseSystem,
};

const deepThinkStage: WorkflowStageSpec = {
  stage: "deep-think",
  label: "Deep Think",
  final: false,
  baseMaxTokens: 700,
  temperature: 0.5,
  buildSystem: (ctx) =>
    withPriorOutputs(
      ctx,
      "You are the DEEP THINK stage of a multi-stage assistant pipeline. A draft answer from " +
        "the Processing stage is included above. Compare at least two different approaches or " +
        "angles to the user's question, weigh their trade-offs, check the draft's own reasoning " +
        "for gaps or unsupported claims, and note anything that reduces hallucination risk. " +
        "Output your analysis and, if the draft should change, a revised draft. Be concise — " +
        "this feeds the Review stage next, not the user directly.",
    ),
};

const reviewStage: WorkflowStageSpec = {
  stage: "review",
  label: "Review",
  final: true,
  baseMaxTokens: 1200,
  temperature: 0.55,
  buildSystem: (ctx) =>
    withPriorOutputs(
      ctx,
      "You are the REVIEW stage — the FINAL stage of this pipeline. Everything you output now " +
        "streams directly to the user as the answer. Using the draft(s) above, check correctness, " +
        "completeness and quality, fix anything wrong or missing, then write the final answer in " +
        "your own voice. Do NOT mention the review process, the pipeline, or any internal stage " +
        "names — just give the best possible answer, as if you were answering fresh.",
    ),
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
