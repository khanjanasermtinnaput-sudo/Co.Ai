// ── Token Manager — Co.AI Master Prompt v1.0 Part 6.7 ────────────────────────
// Runs immediately after the Prompt Compiler (Part 6.6), right before
// route.ts's provider loop. Owns three real things this repo didn't have:
//
//   1. TokenBudget — wraps the EXISTING output-budget computation
//      (workflowMaxTokens()/effortMaxTokens(), unchanged, reused verbatim)
//      alongside a real estimate of the whole turn's size (compiled system +
//      history + message).
//   2. guardOverflow() — the first place model-registry.ts's
//      ModelDef.contextWindow is actually consulted to keep a request under
//      it. Every other reader of MODEL_REGISTRY (matchScore, bestModelFor)
//      ignores contextWindow entirely.
//   3. reportEfficiency() — a token-efficiency figure computed ONLY from
//      real provider `usage`, never fabricated (see ai-log.ts's own
//      precedent: "Kanon's single call is the one path where real token
//      usage genuinely is observable").
//
// Doesn't estimate tokens itself — reuses prompt-compiler.ts's
// estimateTokens() (chars/4, ±30%, no tokenizer dependency exists in this
// stack) rather than defining a second one.
//
// Overflow compression is deliberately narrow in scope: only the OLDEST
// history turns are dropped (safe — history is separate from the
// already-compiled `system` text, and dropping the earliest turns first
// mirrors workflow-context.ts's own "replace conversation, keep the
// freshest" precedent), and only as an absolute last resort is outputBudget
// reduced (floored at MIN_OUTPUT_BUDGET, never to 0). Dropping
// lower-priority PROMPT LAYERS from the compiled system (RAA/TMAP grounding,
// memory, etc.) is deliberately NOT implemented: there is no layer in this
// pipeline that's safe to drop without risking the exact engineering-context
// loss Part 5.3's "never terminate the workflow unexpectedly" and this
// repo's anti-fabrication discipline guard against. The spec's own Design
// Philosophy — "Engineering correctness always has higher priority than
// token reduction" — is honored by keeping compression scope narrow, not by
// a fake step that claims to preserve correctness while actually risking it.

import type { EffortLevel } from "@/lib/types";
import { effortMaxTokens } from "@/lib/effort";
import { workflowMaxTokens, type WorkflowStageSpec } from "./model-workflow";
import { MODEL_REGISTRY } from "./model-registry";
import { estimateTokens } from "./prompt-compiler";

export { estimateTokens };

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface TokenBudget {
  /** The ONE streamed call's output-token allowance — identical to what
   *  route.ts computed before Part 6.7 existed. Reused, not recomputed
   *  differently, so this changes nothing for any turn that doesn't
   *  actually overflow. */
  outputBudget: number;
  /** Real char/4 estimate of system + history + message combined. */
  promptTokens: number;
  /** ModelDef.contextWindow for the resolved primary provider/model, or
   *  CONSERVATIVE_DEFAULT_CONTEXT_WINDOW when no exact registry match
   *  exists (an OpenRouter model outside its one representative registry
   *  entry, or an explicit `*_MODEL` env override) — a documented
   *  conservative default, never a fabricated measurement. */
  contextWindow: number;
  contextWindowIsDefault: boolean;
  /** promptTokens + outputBudget. */
  totalBudget: number;
  /** totalBudget / contextWindow — > 1 means overflow. */
  utilization: number;
}

/** Smallest real contextWindow in the registry — the safest assumption when
 *  the resolved model isn't an exact registry match. */
const CONSERVATIVE_DEFAULT_CONTEXT_WINDOW = Math.min(...MODEL_REGISTRY.map((m) => m.contextWindow));

function lookupContextWindow(
  provider: string,
  model: string | undefined,
): { contextWindow: number; isDefault: boolean } {
  const found = model ? MODEL_REGISTRY.find((m) => m.provider === provider && m.model === model) : undefined;
  return found
    ? { contextWindow: found.contextWindow, isDefault: false }
    : { contextWindow: CONSERVATIVE_DEFAULT_CONTEXT_WINDOW, isDefault: true };
}

export interface AllocateBudgetOpts {
  stages: WorkflowStageSpec[];
  effort: EffortLevel;
  isStaged: boolean;
  baseMaxTokens: number;
  compiledSystem: string;
  history: HistoryItem[];
  message: string;
  provider: string;
  model: string | undefined;
}

/** Wraps the EXISTING output-budget computation (unchanged) with a real
 *  prompt-size estimate and the resolved model's real context window. */
export function allocateBudget(opts: AllocateBudgetOpts): TokenBudget {
  const outputBudget = opts.isStaged
    ? workflowMaxTokens(opts.stages, opts.effort)
    : effortMaxTokens(opts.baseMaxTokens, opts.effort);

  const promptTokens =
    estimateTokens(opts.compiledSystem) +
    opts.history.reduce((n, h) => n + estimateTokens(h.content), 0) +
    estimateTokens(opts.message);

  const { contextWindow, isDefault } = lookupContextWindow(opts.provider, opts.model);
  const totalBudget = promptTokens + outputBudget;

  return {
    outputBudget,
    promptTokens,
    contextWindow,
    contextWindowIsDefault: isDefault,
    totalBudget,
    utilization: contextWindow > 0 ? Math.round((totalBudget / contextWindow) * 1000) / 1000 : 0,
  };
}

export interface GuardOverflowOpts {
  compiledSystem: string;
  history: HistoryItem[];
  message: string;
  outputBudget: number;
  contextWindow: number;
}

export interface GuardOverflowResult {
  overflow: boolean;
  compressed: boolean;
  historyDropped: number;
  history: HistoryItem[];
  outputBudget: number;
  finalPromptTokens: number;
  /** True only in the extreme case where dropping ALL history still doesn't
   *  fit — outputBudget was floored as a last resort rather than the turn
   *  being aborted ("Token Manager must never terminate workflows
   *  unexpectedly"). */
  stillOver: boolean;
}

const MIN_OUTPUT_BUDGET = 256;

/** Never throws. Drops the OLDEST history turns first until the turn fits
 *  the model's real context window; only floors outputBudget as an absolute
 *  last resort. `compiledSystem` is never touched — it was already compiled
 *  by Part 6.6 and re-splitting it is out of scope (see module header). */
export function guardOverflow(opts: GuardOverflowOpts): GuardOverflowResult {
  const systemTokens = estimateTokens(opts.compiledSystem);
  const messageTokens = estimateTokens(opts.message);
  const history = [...opts.history];
  let outputBudget = opts.outputBudget;

  const promptTokens = () =>
    systemTokens + history.reduce((n, h) => n + estimateTokens(h.content), 0) + messageTokens;

  if (promptTokens() + outputBudget <= opts.contextWindow) {
    return {
      overflow: false,
      compressed: false,
      historyDropped: 0,
      history,
      outputBudget,
      finalPromptTokens: promptTokens(),
      stillOver: false,
    };
  }

  let dropped = 0;
  while (history.length > 0 && promptTokens() + outputBudget > opts.contextWindow) {
    history.shift();
    dropped += 1;
  }

  let stillOver = promptTokens() + outputBudget > opts.contextWindow;
  if (stillOver) {
    const room = opts.contextWindow - promptTokens();
    outputBudget = Math.max(MIN_OUTPUT_BUDGET, room);
    stillOver = promptTokens() + outputBudget > opts.contextWindow;
  }

  return {
    overflow: true,
    compressed: dropped > 0 || outputBudget !== opts.outputBudget,
    historyDropped: dropped,
    history,
    outputBudget,
    finalPromptTokens: promptTokens(),
    stillOver,
  };
}

export interface TokenReport {
  /** Real provider-reported usage — undefined when unavailable (never
   *  substituted with an estimate; that would misrepresent an estimate as a
   *  measurement). */
  actualPromptTokens?: number;
  actualCompletionTokens?: number;
  estimatedPromptTokens: number;
  /** actualPromptTokens / estimatedPromptTokens — how close the char/4
   *  heuristic was, when a real measurement exists to compare against.
   *  Undefined (never a fabricated 1.0) when no real usage was reported. */
  estimateAccuracy?: number;
}

/** Real observed efficiency only — mirrors ai-log.ts's own discipline
 *  ("only log real, observed values — never fabricate a metric that isn't
 *  actually available at that layer"). */
export function reportEfficiency(
  estimatedPromptTokens: number,
  usage?: { inputTokens?: number; outputTokens?: number },
): TokenReport {
  if (!usage || usage.inputTokens === undefined) {
    return { estimatedPromptTokens };
  }
  return {
    actualPromptTokens: usage.inputTokens,
    actualCompletionTokens: usage.outputTokens,
    estimatedPromptTokens,
    estimateAccuracy:
      usage.inputTokens > 0 ? Math.round((estimatedPromptTokens / usage.inputTokens) * 1000) / 1000 : undefined,
  };
}
