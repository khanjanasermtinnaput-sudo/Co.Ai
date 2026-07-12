// ── Workflow stage runner ─────────────────────────────────────────────────────
// Sequences a Model Workflow's INTERIOR stages (everything but the last) to
// completion, server-side, one provider call each — then hands off a ready
// system prompt for the caller's FINAL stage, which streams live to the user
// through the existing, unmodified primeAndStream()/failover loop in route.ts.
//
// Deliberately simple failure semantics: an interior-stage failure (thrown
// error, or a stage that blows its deadline) propagates straight out of
// runInteriorStages(). The caller's existing top-level error handling turns
// that into a structured AofProviderError — no new error handling needed here.
// Rejected alternative: silently skip the failed stage and answer anyway —
// rejected because it would violate the workflow contract without telling
// the user.

import { effortMaxTokens, effortTemperature } from "@/lib/effort";
import { makeStageNotice, type StageNotice, type UsageNotice } from "@/lib/errors";
import type { EffortLevel } from "@/lib/types";
import { adapterFor, drainToText, type AdapterInput, type KeyOverrides, type ProviderMeta } from "./ai-providers";
import type { StageOutput, WorkflowStage, WorkflowStageSpec } from "./model-workflow";

/** Same shape adapterFor() returns — injectable so tests can stub a stage's
 *  provider call with a fake generator instead of hitting a real provider. */
type Adapter = (input: AdapterInput) => AsyncGenerator<string, UsageNotice | undefined>;

export interface StageResult {
  stage: WorkflowStage;
  text: string;
  usage?: UsageNotice;
}

export interface RunInteriorStagesOpts {
  /** Interior stages only — never includes the final (streamed) stage. */
  stages: WorkflowStageSpec[];
  /** The workflow's final stage — its ready-to-use system prompt is computed
   *  here (folding in every interior stage's output) and returned, but it is
   *  never itself executed: the caller runs it through the unmodified
   *  primeAndStream()/failover loop. */
  finalStage: WorkflowStageSpec;
  /** Total stages in the FULL workflow (interior + final) — used for the
   *  index/total shown on each StageNotice. */
  totalStages: number;
  provider: ProviderMeta;
  taskModel?: string;
  overrides?: KeyOverrides;
  baseSystem: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  effort: EffortLevel;
  signal: AbortSignal;
  onStage?: (notice: StageNotice) => void;
  /** Hard per-stage wall-clock ceiling, independent of the provider's own
   *  first-token timeout. Default 20s — keeps a 3-stage Kanon High request
   *  comfortably inside Vercel's 60s route ceiling alongside the final
   *  streamed stage. */
  perStageDeadlineMs?: number;
  /** Test-only injection point — defaults to the real adapterFor(). */
  adapterLookup?: (id: ProviderMeta["id"]) => Adapter;
}

export interface RunInteriorStagesResult {
  /** Ready-to-use system prompt for the caller's final stage. */
  system: string;
  results: StageResult[];
}

function raceWithDeadline<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`workflow stage exceeded ${ms}ms`));
    }, ms);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export async function runInteriorStages(opts: RunInteriorStagesOpts): Promise<RunInteriorStagesResult> {
  const {
    stages,
    finalStage,
    totalStages,
    provider,
    taskModel,
    overrides,
    baseSystem,
    message,
    history,
    effort,
    signal,
    onStage,
    perStageDeadlineMs = 20_000,
    adapterLookup = adapterFor,
  } = opts;

  const priorOutputs: StageOutput[] = [];
  const results: StageResult[] = [];

  for (let i = 0; i < stages.length; i++) {
    const spec = stages[i];
    const index = i + 1;
    onStage?.(makeStageNotice(spec.stage, spec.label, index, totalStages, "running"));

    const stageSystem = spec.buildSystem({ baseSystem, priorOutputs, message, history });
    const gen = adapterLookup(provider.id)({
      system: stageSystem,
      history,
      message,
      maxTokens: effortMaxTokens(spec.baseMaxTokens, effort),
      temperature: effortTemperature(spec.temperature, effort),
      signal,
      overrides,
      taskModel,
    });

    const { text, usage } = await raceWithDeadline(drainToText(gen), perStageDeadlineMs, signal);

    results.push({ stage: spec.stage, text, usage });
    priorOutputs.push({ stage: spec.stage, label: spec.label, text });
    onStage?.(makeStageNotice(spec.stage, spec.label, index, totalStages, "done"));
  }

  const system = finalStage.buildSystem({ baseSystem, priorOutputs, message, history });
  return { system, results };
}
