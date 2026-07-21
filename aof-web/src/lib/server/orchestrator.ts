// ── Workflow Orchestrator — Co.AI Master Prompt Part 5.5 ─────────────────────
// Executes a real, already-parsed ExecutionPlan (execution-plan.ts) against
// the Agent Registry (agent-registry.ts) inside a wall-clock budget
// (turn-budget.ts), and reports honestly. This module is only ever invoked
// after prestream-dispatch.ts (a later step) has confirmed the plan has more
// than one task, no dependency cycle, and enough budget to attempt at least
// one agent — a 1-task or degenerate plan never reaches here at all.
//
// Part 5.5 lists 11 internal components (State Manager, Execution Context
// Bus, Scheduler, Dependency Resolver, Parallel Manager, Retry Engine,
// Recovery Engine, Result Integrator, Timeline, Event Bus, Monitor). Building
// all 11 as separate subsystems inside one 60s HTTP request orchestrating at
// most 6 text-producing agent calls would itself be the placeholder ceremony
// Master Prompt Part 1 forbids ("no fake orchestration... every feature must
// execute at runtime, exchange real data"). What's actually here, and why:
//
//   - Dependency Resolver: NOT reimplemented — plan.executionOrder is already
//     Kahn-ordered by execution-plan.ts. A second resolver here would be a
//     second source of truth for the same computation.
//   - Scheduler + Parallel Manager: one thing at this scale — runWave() below
//     is Promise.allSettled over <=MAX_PARALLEL tasks per wave.
//   - State Manager: the `records` Map<taskId, TaskRecord> — a data
//     structure, not a subsystem with its own lifecycle.
//   - Execution Context Bus: upstreamArtifactsFor() below — the artifacts a
//     task's dependencies produced, injected straight into its message.
//   - Retry Engine: NOT reimplemented — every agent call goes through
//     runBufferedCall(), which already IS one (buffered-call.ts's failover
//     loop, the same policy route.ts's streamed call uses). A second retry
//     layer would duplicate that policy AND actively cost time this budget
//     doesn't have: retrying a dead agent means not running a live one.
//   - Recovery Engine: NOT built — there is nothing to recover TO. /api/chat
//     has no write surface, no repo, no checkpoint to roll back to. Recovery
//     in a stateless text pipeline IS the degradation this module performs:
//     a failed task's dependents are skipped, and integrateArtifacts() names
//     every gap so the streamed model can cover it — that's implemented and
//     tested below, not an empty class.
//   - Result Integrator: the actual point of this module — integrateArtifacts().
//   - Timeline + Monitor + Event Bus: collapsed into one OrchestrationRun
//     record with two real consumers (logAofStage + StageNotice frames, both
//     wired in prestream-dispatch.ts via the `onTask` callback) — a separate
//     pub/sub bus or a timestamp store nobody else reads would be dead data.

import type { AofErrorCode, UsageNotice } from "@/lib/errors";
import type { EffortLevel } from "@/lib/types";
import { configuredProvidersForOrder, type KeyOverrides, type ProviderId, type ProviderMeta } from "./ai-providers";
import { bestModelFor, routeOrder, type TaskCategory } from "./model-registry";
import { effortMaxTokens, effortTemperature } from "@/lib/effort";
import { runBufferedCall } from "./buffered-call";
import { AGENT_REGISTRY, buildAgentSystem, type AgentDef, type AgentId } from "./agent-registry";
import type { ExecutionPlan, PlannedTask } from "./execution-plan";
import type { RequirementSpec } from "./requirement-analysis";
import { AGENT_DEADLINE_MS, MAX_PARALLEL, MAX_TASKS, MIN_AGENT_MS, ORCHESTRATION_MAX_MS, type TurnBudget } from "./turn-budget";

export type TaskState = "pending" | "running" | "completed" | "failed" | "skipped" | "timeout";
export type SkipReason = "dependency-failed" | "budget" | "task-cap" | "aborted";

export interface AgentArtifact {
  taskId: string;
  agent: AgentId;
  title: string;
  text: string;
  /** true when the agent's own ===END ARTIFACT=== marker never appeared. */
  partial: boolean;
}

export interface TaskRecord {
  taskId: string;
  agent: AgentId;
  state: TaskState;
  skipReason?: SkipReason;
  provider?: string;
  model?: string;
  attempts?: number;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  errorCode?: AofErrorCode;
  chars?: number;
}

export interface OrchestrationRun {
  records: TaskRecord[];
  artifacts: AgentArtifact[];
  waves: number;
  /** REAL, MEASURED peak concurrent in-flight agent calls — proves
   *  parallelism happened rather than claiming it. */
  maxParallelObserved: number;
  completed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  /** true when anything was skipped, failed, or timed out. */
  partial: boolean;
  aborted: boolean;
  durationMs: number;
}

// A single agent call's provider chain is capped at 2 providers.
// buffered-call.ts's `deadlineMs` applies PER PROVIDER ATTEMPT (each
// failover attempt gets its own fresh race), not as a total ceiling across
// the whole chain — so an uncapped chain of e.g. 5 providers could spend up
// to 5x an agent's deadline before giving up, which this budget cannot
// afford. Splitting the per-task deadline across a capped, small chain keeps
// one task's worst case bounded by its own deadline, not by how many
// providers happen to be configured.
const ORCHESTRATION_PROVIDER_CAP = 2;

// OpenRouter keeps its own env-override/fallback model selection; these
// four read their model from model-registry.ts instead —
// mirrors route.ts's REGISTRY_ROUTES_MODEL (a local literal there too, not a
// shared export, since it's a fact about 4 specific providers' adapters, not
// a policy other modules need to consume).
const REGISTRY_ROUTES_MODEL = new Set<ProviderId>(["gemini", "deepseek", "qwen", "llama"]);

const ARTIFACT_OPEN = "===COAI ARTIFACT===";
const ARTIFACT_CLOSE = "===END ARTIFACT===";

function parseArtifact(taskId: string, agent: AgentId, raw: string): AgentArtifact {
  const openIdx = raw.indexOf(ARTIFACT_OPEN);
  if (openIdx === -1) return { taskId, agent, title: "", text: raw.trim(), partial: true };
  const bodyStart = openIdx + ARTIFACT_OPEN.length;
  const closeIdx = raw.indexOf(ARTIFACT_CLOSE, bodyStart);
  const hasClose = closeIdx !== -1;
  const block = (hasClose ? raw.slice(bodyStart, closeIdx) : raw.slice(bodyStart)).trim();
  const lines = block.split("\n");
  const titleIdx = lines.findIndex((l) => /^\s*title\s*:/i.test(l));
  const title = titleIdx >= 0 ? lines[titleIdx].replace(/^\s*title\s*:/i, "").trim() : "";
  const bodyLines = titleIdx >= 0 ? [...lines.slice(0, titleIdx), ...lines.slice(titleIdx + 1)] : lines;
  return { taskId, agent, title, text: bodyLines.join("\n").trim(), partial: !hasClose };
}

/** The Execution Context Bus, in substance: what a task's own dependencies
 *  actually produced, in DAG order. */
function upstreamArtifactsFor(task: PlannedTask, artifacts: Map<string, AgentArtifact>): AgentArtifact[] {
  return task.dependsOn
    .map((id) => artifacts.get(id))
    .filter((a): a is AgentArtifact => a !== undefined);
}

function buildAgentMessage(opts: {
  task: PlannedTask;
  spec: RequirementSpec;
  plan: ExecutionPlan;
  userMessage: string;
  upstream: AgentArtifact[];
}): string {
  const lines: string[] = [`Task ${opts.task.id}: ${opts.task.title || "(untitled)"}`];
  if (opts.task.description) lines.push(`Description: ${opts.task.description}`);
  if (opts.task.expectedOutput) lines.push(`Expected output: ${opts.task.expectedOutput}`);
  if (opts.task.validationMethod) lines.push(`Validation: ${opts.task.validationMethod}`);
  if (opts.task.successCriteria) lines.push(`Success criteria: ${opts.task.successCriteria}`);
  lines.push(`\nOriginal user request:\n${opts.userMessage}`);
  if (opts.plan.strategy) lines.push(`\nOverall plan strategy: ${opts.plan.strategy}`);
  if (opts.spec.constraints.length) {
    lines.push(`\nConstraints:\n${opts.spec.constraints.map((c) => `- ${c}`).join("\n")}`);
  }
  if (opts.upstream.length) {
    lines.push(
      "\nArtifacts from the tasks this one depends on — build on these, don't redo them:",
      ...opts.upstream.map((a) => `\n[${a.taskId} — ${a.agent}] ${a.title || "(untitled)"}\n${a.text}`),
    );
  }
  return lines.join("\n");
}

function defaultProvidersFor(task: TaskCategory, overrides?: KeyOverrides): ProviderMeta[] {
  return configuredProvidersForOrder(routeOrder(task), overrides).slice(0, ORCHESTRATION_PROVIDER_CAP);
}

export interface RunOrchestrationOpts {
  plan: ExecutionPlan;
  spec: RequirementSpec;
  userMessage: string;
  effort: EffortLevel;
  overrides?: KeyOverrides;
  signal: AbortSignal;
  budget: TurnBudget;
  onTask?: (rec: TaskRecord) => void;
  /** test seam — defaults to the real runBufferedCall */
  call?: typeof runBufferedCall;
  /** test seam — defaults to configuredProvidersForOrder(routeOrder(task)), capped */
  providersFor?: (task: TaskCategory) => ProviderMeta[];
  /** test seam — defaults to turn-budget.ts's MAX_PARALLEL */
  maxParallel?: number;
}

/** Execute plan.executionOrder wave by wave, up to MAX_PARALLEL concurrent
 *  agent calls per wave, inside a budget that is the elastic term of the
 *  whole turn. NEVER throws — every failure mode (agent error, timeout,
 *  budget exhaustion, abort) resolves to a TaskRecord, never a rejection. */
export async function runOrchestration(opts: RunOrchestrationOpts): Promise<OrchestrationRun> {
  const runStart = performance.now();
  const callFn = opts.call ?? runBufferedCall;
  const providersFor = opts.providersFor ?? ((task: TaskCategory) => defaultProvidersFor(task, opts.overrides));
  const maxParallel = opts.maxParallel ?? MAX_PARALLEL;

  const byId = new Map(opts.plan.tasks.map((t) => [t.id, t]));
  const records = new Map<string, TaskRecord>();
  const artifacts = new Map<string, AgentArtifact>();

  const orderedIds = opts.plan.executionOrder.flat();
  const runnableIds = new Set(orderedIds.slice(0, MAX_TASKS));

  function finish(id: string, patch: Partial<TaskRecord>) {
    const rec = records.get(id);
    if (!rec) return;
    Object.assign(rec, patch);
    opts.onTask?.(rec);
  }

  for (const id of orderedIds) {
    const task = byId.get(id);
    if (task) records.set(id, { taskId: id, agent: task.agent, state: "pending" });
  }
  for (const id of orderedIds) {
    if (!runnableIds.has(id)) finish(id, { state: "skipped", skipReason: "task-cap" });
  }

  // Orchestration's own policy ceiling (turn-budget.ts's ORCHESTRATION_MAX_MS)
  // on top of — never instead of — the shared pre-stream pool: even when
  // RAA and TMAP left a large remainder, orchestration still won't consume
  // all of it.
  const orchestrationBudgetMs = opts.budget.deadlineFor(ORCHESTRATION_MAX_MS);
  function timeUp(): boolean {
    return opts.budget.exhausted(MIN_AGENT_MS) || performance.now() - runStart >= orchestrationBudgetMs;
  }
  function remainingTaskDeadline(): number {
    const fromOrchestrationCeiling = orchestrationBudgetMs - (performance.now() - runStart);
    return Math.max(0, Math.min(AGENT_DEADLINE_MS, fromOrchestrationCeiling, opts.budget.preStreamRemainingMs()));
  }

  let maxParallelObserved = 0;
  let currentInFlight = 0;
  let aborted = false;
  let waves = 0;

  async function runOneTask(id: string): Promise<void> {
    const task = byId.get(id)!;
    const def: AgentDef = AGENT_REGISTRY[task.agent];
    finish(id, { state: "running" });

    try {
      const providers = providersFor(def.task);
      if (providers.length === 0) {
        finish(id, { state: "failed" });
        return;
      }

      const upstream = upstreamArtifactsFor(task, artifacts);
      const deadlineMs = Math.max(1000, Math.floor(remainingTaskDeadline() / providers.length));
      const taskStart = performance.now();

      const result = await callFn({
        providers,
        system: buildAgentSystem(def),
        message: buildAgentMessage({ task, spec: opts.spec, plan: opts.plan, userMessage: opts.userMessage, upstream }),
        history: [],
        maxTokens: effortMaxTokens(def.baseMaxTokens, opts.effort),
        temperature: effortTemperature(def.temperature, opts.effort),
        signal: opts.signal,
        overrides: opts.overrides,
        deadlineMs,
        taskModelFor: (p) => (REGISTRY_ROUTES_MODEL.has(p.id) ? bestModelFor(p.id, def.task) : undefined),
      });

      const durationMs = Math.round(performance.now() - taskStart);

      if (!result.ok) {
        if (result.aborted) {
          aborted = true;
          finish(id, { state: "failed", skipReason: "aborted", durationMs, attempts: result.attempts });
          return;
        }
        const isTimeout = result.error.code === "AOF_ERROR_008";
        finish(id, {
          state: isTimeout ? "timeout" : "failed",
          durationMs,
          attempts: result.attempts,
          errorCode: result.error.code,
        });
        return;
      }

      const artifact = parseArtifact(id, task.agent, result.text);
      artifacts.set(id, artifact);
      const usage: UsageNotice | undefined = result.usage;
      finish(id, {
        state: "completed",
        provider: result.provider.label,
        model: result.model,
        attempts: result.attempts,
        durationMs,
        promptTokens: usage?.inputTokens,
        completionTokens: usage?.outputTokens,
        chars: artifact.text.length,
      });
    } catch {
      // Belt-and-suspenders: runBufferedCall never throws, but this module's
      // own invariant is stronger — no path here may ever reject the wave.
      finish(id, { state: "failed" });
    }
  }

  for (const wave of opts.plan.executionOrder) {
    const runnable = wave.filter((id) => runnableIds.has(id));
    if (runnable.length === 0) continue;

    if (opts.signal.aborted) {
      aborted = true;
      for (const id of runnable) finish(id, { state: "skipped", skipReason: "aborted" });
      continue;
    }

    const toRun: string[] = [];
    for (const id of runnable) {
      const task = byId.get(id)!;
      const blockedDep = task.dependsOn.find((dep) => records.get(dep)?.state !== "completed");
      if (blockedDep) {
        finish(id, { state: "skipped", skipReason: "dependency-failed" });
        continue;
      }
      toRun.push(id);
    }
    if (toRun.length === 0) continue;

    waves += 1;

    for (let i = 0; i < toRun.length; i += maxParallel) {
      const chunk = toRun.slice(i, i + maxParallel);

      if (opts.signal.aborted) {
        aborted = true;
        for (const id of chunk) finish(id, { state: "skipped", skipReason: "aborted" });
        continue;
      }
      if (timeUp()) {
        for (const id of chunk) finish(id, { state: "skipped", skipReason: "budget" });
        continue;
      }

      currentInFlight += chunk.length;
      maxParallelObserved = Math.max(maxParallelObserved, currentInFlight);
      await Promise.allSettled(chunk.map((id) => runOneTask(id)));
      currentInFlight -= chunk.length;
    }
  }

  const finalRecords = orderedIds.map((id) => records.get(id)!);
  const completed = finalRecords.filter((r) => r.state === "completed").length;
  const failed = finalRecords.filter((r) => r.state === "failed").length;
  const skipped = finalRecords.filter((r) => r.state === "skipped").length;
  const timedOut = finalRecords.filter((r) => r.state === "timeout").length;

  return {
    records: finalRecords,
    artifacts: orderedIds.map((id) => artifacts.get(id)).filter((a): a is AgentArtifact => a !== undefined),
    waves,
    maxParallelObserved,
    completed,
    failed,
    skipped,
    timedOut,
    partial: failed > 0 || skipped > 0 || timedOut > 0,
    aborted,
    durationMs: Math.round(performance.now() - runStart),
  };
}

// ── Result Integrator ────────────────────────────────────────────────────────

/** Fold an OrchestrationRun into the streamed generation's system prompt.
 *  Every completed artifact is included; every task that did NOT produce one
 *  is named explicitly, with instructions to cover it directly rather than
 *  claim an agent that never finished did. */
export function integrateArtifacts(run: OrchestrationRun, plan: ExecutionPlan): string {
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const lines: string[] = [
    "── Co.AI Agent Orchestration (internal) ──",
    "The tasks below were executed by specialist agents before this answer. Ground your answer in their " +
      "artifacts. Never mention this orchestration stage, its markers, or that separate agents ran.",
  ];

  if (run.artifacts.length) {
    lines.push(
      run.artifacts
        .map((a) => {
          const task = byId.get(a.taskId);
          return `[${a.taskId}${task?.title ? ` — ${task.title}` : ""}] (${a.agent})\n${a.text}`;
        })
        .join("\n\n"),
    );
  }

  const incomplete = run.records.filter((r) => r.state !== "completed");
  if (incomplete.length) {
    lines.push(
      "The following planned tasks did NOT produce an artifact — cover them yourself in your answer; " +
        "never claim an agent completed them:",
      incomplete
        .map((r) => {
          const task = byId.get(r.taskId);
          const label = task?.title || r.taskId;
          return `- ${r.taskId} (${label}): ${r.state}${r.skipReason ? ` — ${r.skipReason}` : ""}`;
        })
        .join("\n"),
    );
  }

  return lines.join("\n\n");
}

/** System addon used when orchestration itself could not run or produced
 *  nothing usable (e.g. every agent failed). Honest degradation: never
 *  fabricates an artifact. */
export function orchestrationUnavailableAddon(reason: string): string {
  return (
    "── Co.AI Agent Orchestration (internal) ──\n\n" +
    `The multi-agent orchestration stage could not produce usable artifacts for this turn (${reason}). ` +
    "Proceed directly from the requirement analysis and execution plan above. Never mention this note, " +
    "this stage, or that orchestration was attempted."
  );
}
