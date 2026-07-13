// ── Pre-Stream Dispatcher ─────────────────────────────────────────────────────
// Executes EVERY non-"phase" stage of a workflow, in order, before the
// streamed call is issued. Replaces the two `findIndex(s => s.execution ===
// "...")` calls that used to live inline in route.ts — each of those only
// ever ran the FIRST stage of its kind. That was harmless while at most one
// "local" and one "buffered" stage could ever exist, but Parts 5.4/5.5 make
// pro-engineering carry TWO buffered stages (requirement-analysis, then
// planner) and an optional third "orchestrated" stage — under the old
// `findIndex` code, TMAP would be silently skipped: present in the stage
// table, counted in the client's stage total, absent from the log's
// `stages=` field, and never actually executed. That is exactly the fake
// stage Master Prompt Part 1 forbids, and it would compile cleanly with no
// type error. This module's only job is to make sure that can't happen: run
// every non-phase stage that's actually in the table, by name, exactly once.
//
// Stage sequence handled (each optional — Kanon only ever hits the first):
//   1. context-builder  (local)        — zero-call, replaces `history`
//   2. requirement-analysis (buffered) — RAA; failure degrades the WHOLE
//      table to lightweight and returns early — planner/orchestration never
//      attempted, matching Part 5.3's "never terminate the workflow
//      unexpectedly" precedent.
//   3. planner (buffered)              — TMAP; failure leaves the streamed
//      answer to proceed from RAA's spec alone. Success always folds the
//      plan into `system`; ONLY a real, parsed, >1-task, acyclic plan with
//      enough remaining turn budget re-inserts the "multi-agent" stage — the
//      table is grown, never shrunk, by TMAP's outcome.
//   4. multi-agent (orchestrated)      — runs only if step 3 just added it.
//
// Every degradation is returned in `telemetry`, never silently absorbed —
// route.ts is expected to log every field that's actually present.

import {
  encodeStageFrame,
  makeStageNotice,
  type AofErrorCode,
} from "@/lib/errors";
import type { EffortLevel, RepoMetadata } from "@/lib/types";
import type { ModelTier } from "@/lib/model-branding";
import { effortMaxTokens, effortPolicy, effortTemperature } from "@/lib/effort";
import {
  stagesFor as stagesForReal,
  type StagesOpts,
  type WorkflowStageSpec,
  type YpertatosWorkflowKind,
} from "./model-workflow";
import { buildWorkflowContext as buildWorkflowContextReal } from "./workflow-context";
import type { TaskDecision } from "./task-classifier";
import {
  REQUIREMENT_ANALYSIS_SYSTEM,
  RAA_TEMPERATURE,
  buildRaaMessage,
  parseRequirementSpec,
  requirementSpecSystemAddon,
  raaUnavailableAddon,
  type RequirementSpec,
} from "./requirement-analysis";
import {
  TMAP_SYSTEM,
  TMAP_TEMPERATURE,
  buildTmapMessage,
  parseExecutionPlan,
  executionPlanSystemAddon,
  planUnavailableAddon,
  type ExecutionPlan,
} from "./execution-plan";
import { runBufferedCall as runBufferedCallReal } from "./buffered-call";
import {
  runOrchestration as runOrchestrationReal,
  integrateArtifacts,
  orchestrationUnavailableAddon,
  type OrchestrationRun,
  type TaskRecord,
} from "./orchestrator";
import { AGENT_REGISTRY } from "./agent-registry";
import { MIN_AGENT_MS, RAA_DEADLINE_MS, TMAP_DEADLINE_MS, type TurnBudget } from "./turn-budget";
import type { KeyOverrides, ProviderMeta } from "./ai-providers";

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export type OrchestrationSkipReason =
  | "single-task"
  | "cycle"
  | "empty-plan"
  | "budget"
  | "tmap-failed"
  | "raa-failed";

export interface PreStreamTelemetry {
  contextBuilder?: {
    durationMs: number;
    inputMessages: number;
    selectedMessages: number;
    charsSaved: number;
    degraded: boolean;
  };
  raa?: {
    executed: boolean;
    degraded: boolean;
    attempts: number;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    readyForPlanning?: boolean;
    readyForPlanningSource?: "model" | "derived";
    partial?: boolean;
    errorCode?: AofErrorCode;
  };
  tmap?: {
    executed: boolean;
    degraded: boolean;
    attempts: number;
    durationMs: number;
    tasks: number;
    integrity: ExecutionPlan["integrity"];
    partial: boolean;
    warnings: number;
    planConfidence: number | null;
    promptTokens?: number;
    completionTokens?: number;
    errorCode?: AofErrorCode;
  };
  /** Present only when orchestration actually ran. */
  orchestration?: OrchestrationRun;
  /** Present only when a >1-task plan existed but orchestration did NOT run —
   *  the honest reason it was never inserted into the stage table at all. */
  orchestrationSkipped?: OrchestrationSkipReason;
  /** Total real provider calls made in THIS module — RAA + TMAP (0, 1, or 2)
   *  plus every real agent attempt orchestration made. Counted, never assumed. */
  preStreamProviderCalls: number;
}

export interface PreStreamResult {
  /** The FINAL stage table — possibly shrunk (RAA failure) or grown
   *  (a real orchestration plan). */
  stages: WorkflowStageSpec[];
  system: string;
  history: HistoryItem[];
  /** Possibly reordered — the provider that most recently answered a
   *  buffered call is tried first for the streamed call too. */
  providers: ProviderMeta[];
  /** Accumulated StageNotice frames for every stage actually attempted. */
  stagePrefix: string;
  /** true when the user aborted during a buffered/orchestrated stage — the
   *  caller should return an empty 200 immediately, exactly like an abort
   *  during the streamed call. */
  aborted: boolean;
  telemetry: PreStreamTelemetry;
}

export interface RunPreStreamStagesOpts {
  /** The initial table — stagesFor(tier, effort, { workflow: decision?.workflow }),
   *  WITHOUT orchestrate (this module decides that after TMAP runs). */
  stages: WorkflowStageSpec[];
  tier: ModelTier | undefined;
  effort: EffortLevel;
  decision: TaskDecision | undefined;
  message: string;
  history: HistoryItem[];
  repo?: RepoMetadata;
  /** Base system prompt (persona + effort addon), before any stage's addon. */
  system: string;
  providers: ProviderMeta[];
  overrides?: KeyOverrides;
  signal: AbortSignal;
  budget: TurnBudget;
  /** Same model-selection glue route.ts already computes once
   *  (REGISTRY_ROUTES_MODEL + bestModelFor keyed on the outer task category)
   *  — injected rather than recomputed, so this module isn't a third copy. */
  taskModelFor: (p: ProviderMeta) => string | undefined;

  // Test seams — each defaults to the real implementation.
  stagesForFn?: (tier: ModelTier | undefined, effort: EffortLevel, opts?: StagesOpts) => WorkflowStageSpec[];
  buildWorkflowContextFn?: typeof buildWorkflowContextReal;
  callFn?: typeof runBufferedCallReal;
  runOrchestrationFn?: typeof runOrchestrationReal;
}

function emptyTelemetry(): PreStreamTelemetry {
  return { preStreamProviderCalls: 0 };
}

/** NEVER throws — every internal failure degrades the returned result rather
 *  than propagating (mirrors runBufferedCall/parseRequirementSpec/
 *  parseExecutionPlan's discipline one level up). */
export async function runPreStreamStages(opts: RunPreStreamStagesOpts): Promise<PreStreamResult> {
  const stagesForFn = opts.stagesForFn ?? stagesForReal;
  const buildContext = opts.buildWorkflowContextFn ?? buildWorkflowContextReal;
  const callFn = opts.callFn ?? runBufferedCallReal;
  const runOrchestrationFn = opts.runOrchestrationFn ?? runOrchestrationReal;

  let stages = opts.stages;
  let system = opts.system;
  let history = opts.history;
  let providers = opts.providers;
  let stagePrefix = "";
  const telemetry = emptyTelemetry();

  if (stages.length <= 1) {
    return { stages, system, history, providers, stagePrefix, aborted: false, telemetry };
  }

  // ── 1. Context Builder (local) ────────────────────────────────────────────
  const localIdx = stages.findIndex((s) => s.execution === "local");
  if (localIdx >= 0) {
    const local = stages[localIdx];
    const cbStart = performance.now();
    stagePrefix += encodeStageFrame(makeStageNotice(local.stage, local.label, localIdx + 1, stages.length, "running"));
    const built = buildContext({ message: opts.message, history: opts.history });
    history = built.history;
    if (built.digest) system = `${system}\n\n${built.digest}`;
    stagePrefix += encodeStageFrame(makeStageNotice(local.stage, local.label, localIdx + 1, stages.length, "done"));
    telemetry.contextBuilder = {
      durationMs: Math.round((performance.now() - cbStart) * 1000) / 1000,
      inputMessages: built.stats.inputMessages,
      selectedMessages: built.stats.selectedMessages,
      charsSaved: built.stats.charsSaved,
      degraded: built.stats.degraded,
    };
  }

  // ── 2. Requirement Analysis (buffered) ────────────────────────────────────
  const raaIdx = stages.findIndex((s) => s.execution === "buffered" && s.stage === "requirement-analysis");
  let reqSpec: RequirementSpec | undefined;
  if (raaIdx >= 0 && opts.decision) {
    const raaSpec = stages[raaIdx];
    const totalBefore = stages.length;
    stagePrefix += encodeStageFrame(makeStageNotice(raaSpec.stage, raaSpec.label, raaIdx + 1, totalBefore, "running"));

    const raa = await callFn({
      providers,
      system: REQUIREMENT_ANALYSIS_SYSTEM,
      message: buildRaaMessage({ message: opts.message, history, repo: opts.repo, decision: opts.decision }),
      history,
      maxTokens: effortMaxTokens(raaSpec.baseMaxTokens, opts.effort),
      temperature: effortTemperature(RAA_TEMPERATURE, opts.effort),
      signal: opts.signal,
      overrides: opts.overrides,
      taskModelFor: opts.taskModelFor,
      deadlineMs: opts.budget.deadlineFor(RAA_DEADLINE_MS),
    });

    if (!raa.ok && raa.aborted) {
      return { stages, system, history, providers, stagePrefix, aborted: true, telemetry };
    }

    telemetry.preStreamProviderCalls += 1;

    if (raa.ok) {
      reqSpec = parseRequirementSpec(raa.text);
      system = `${system}\n\n${requirementSpecSystemAddon(reqSpec, { clarifyFirst: effortPolicy(opts.effort).clarifyFirst })}`;
      providers = [raa.provider, ...providers.filter((p) => p.id !== raa.provider.id)];
      stagePrefix += encodeStageFrame(makeStageNotice(raaSpec.stage, raaSpec.label, raaIdx + 1, totalBefore, "done"));
      telemetry.raa = {
        executed: true,
        degraded: false,
        attempts: raa.attempts,
        durationMs: raa.durationMs,
        promptTokens: raa.usage?.inputTokens,
        completionTokens: raa.usage?.outputTokens,
        readyForPlanning: reqSpec.readyForPlanning,
        readyForPlanningSource: reqSpec.readyForPlanningSource,
        partial: reqSpec.partial,
      };
    } else {
      // Master Prompt 5.3: never terminate the workflow unexpectedly — degrade
      // to the lightweight table. planner/orchestration are dropped WITH it:
      // TMAP would be planning against no RequirementSpec, exactly the
      // placeholder stage Part 5.1 forbids.
      system = `${system}\n\n${raaUnavailableAddon()}`;
      telemetry.raa = {
        executed: false,
        degraded: true,
        attempts: raa.attempts,
        durationMs: raa.durationMs,
        errorCode: raa.error.code,
      };
      telemetry.orchestrationSkipped = "raa-failed";
      stages = stagesForFn(opts.tier, opts.effort, { workflow: "lightweight" satisfies YpertatosWorkflowKind });
      return { stages, system, history, providers, stagePrefix, aborted: false, telemetry };
    }
  }

  // ── 3. TMAP planning (buffered) ───────────────────────────────────────────
  const tmapIdx = stages.findIndex((s) => s.execution === "buffered" && s.stage === "planner");
  let plan: ExecutionPlan | undefined;
  if (tmapIdx >= 0 && opts.decision && reqSpec) {
    const tmapSpec = stages[tmapIdx];
    const totalBefore = stages.length;
    stagePrefix += encodeStageFrame(makeStageNotice(tmapSpec.stage, tmapSpec.label, tmapIdx + 1, totalBefore, "running"));

    const tmap = await callFn({
      providers,
      system: TMAP_SYSTEM,
      message: buildTmapMessage({ message: opts.message, spec: reqSpec, decision: opts.decision, repo: opts.repo }),
      history,
      maxTokens: effortMaxTokens(tmapSpec.baseMaxTokens, opts.effort),
      temperature: effortTemperature(TMAP_TEMPERATURE, opts.effort),
      signal: opts.signal,
      overrides: opts.overrides,
      taskModelFor: opts.taskModelFor,
      deadlineMs: opts.budget.deadlineFor(TMAP_DEADLINE_MS),
    });

    if (!tmap.ok && tmap.aborted) {
      return { stages, system, history, providers, stagePrefix, aborted: true, telemetry };
    }

    telemetry.preStreamProviderCalls += 1;

    if (tmap.ok) {
      plan = parseExecutionPlan(tmap.text);
      providers = [tmap.provider, ...providers.filter((p) => p.id !== tmap.provider.id)];
      stagePrefix += encodeStageFrame(makeStageNotice(tmapSpec.stage, tmapSpec.label, tmapIdx + 1, totalBefore, "done"));
      telemetry.tmap = {
        executed: true,
        degraded: false,
        attempts: tmap.attempts,
        durationMs: tmap.durationMs,
        tasks: plan.tasks.length,
        integrity: plan.integrity,
        partial: plan.partial,
        warnings: plan.warnings.length,
        planConfidence: plan.planConfidence,
        promptTokens: tmap.usage?.inputTokens,
        completionTokens: tmap.usage?.outputTokens,
      };

      // The plan reaches the streamed model either way — as its own
      // structuring context if orchestration doesn't run, or alongside the
      // orchestrated artifacts below if it does.
      system = `${system}\n\n${executionPlanSystemAddon(plan)}`;

      const shouldOrchestrate = plan.integrity === "ok" && plan.tasks.length > 1 && !opts.budget.exhausted(MIN_AGENT_MS);
      if (shouldOrchestrate) {
        stages = stagesForFn(opts.tier, opts.effort, {
          workflow: "engineering" satisfies YpertatosWorkflowKind,
          orchestrate: true,
        });
      } else {
        telemetry.orchestrationSkipped =
          plan.integrity === "cycle"
            ? "cycle"
            : plan.tasks.length === 0
              ? "empty-plan"
              : plan.tasks.length === 1
                ? "single-task"
                : "budget";
      }
    } else {
      // TMAP failing costs nothing structurally — "multi-agent" was never in
      // the table yet (it's only ever added AFTER a successful plan), so
      // there's nothing to remove. The streamed answer proceeds from RAA's
      // spec alone.
      system = `${system}\n\n${planUnavailableAddon()}`;
      telemetry.tmap = {
        executed: false,
        degraded: true,
        attempts: tmap.attempts,
        durationMs: tmap.durationMs,
        tasks: 0,
        integrity: "empty",
        partial: true,
        warnings: 0,
        planConfidence: null,
        errorCode: tmap.error.code,
      };
      telemetry.orchestrationSkipped = "tmap-failed";
    }
  }

  // ── 4. Agent Orchestration (orchestrated) ─────────────────────────────────
  const orchIdx = stages.findIndex((s) => s.execution === "orchestrated");
  if (orchIdx >= 0 && plan && reqSpec) {
    const orchSpec = stages[orchIdx];
    const totalNow = stages.length;

    const run = await runOrchestrationFn({
      plan,
      spec: reqSpec,
      userMessage: opts.message,
      effort: opts.effort,
      overrides: opts.overrides,
      signal: opts.signal,
      budget: opts.budget,
      onTask: (rec: TaskRecord) => {
        const label = `${AGENT_REGISTRY[rec.agent].label} — ${rec.taskId}`;
        const status = rec.state === "running" ? "running" : "done";
        stagePrefix += encodeStageFrame(makeStageNotice(orchSpec.stage, label, orchIdx + 1, totalNow, status));
      },
    });

    telemetry.preStreamProviderCalls += run.records.reduce((n, r) => n + (r.attempts ?? 0), 0);
    telemetry.orchestration = run;

    if (run.aborted) {
      return { stages, system, history, providers, stagePrefix, aborted: true, telemetry };
    }

    system =
      run.completed > 0
        ? `${system}\n\n${integrateArtifacts(run, plan)}`
        : `${system}\n\n${orchestrationUnavailableAddon("no agent produced a usable artifact")}`;
  }

  return { stages, system, history, providers, stagePrefix, aborted: false, telemetry };
}
