// Cost & token budget enforcement — Round 1 #8.
//
// A single orchestration (Chief Agent universal route, or a TMAP run) makes many
// LLM calls: classification, prompt expansion, planning, several specialist
// agents, synthesis, plus a quality-review loop. Without a hard ceiling a
// pathological request (large prompts, low-scoring outputs that keep retrying,
// recursive agent chains) can run an unbounded number of expensive calls.
//
// The iteration count is already capped (review-gate MAX_REVIEW_ATTEMPTS = 3,
// orchestrator lite/normal/pro caps). This module adds the *cost* and *token*
// ceilings the audit flagged as missing, plus a per-run call ceiling as a final
// backstop. Limits are read from env with generous defaults so normal traffic is
// never affected; set any limit to 0 to disable that specific ceiling.
//
// Usage (every LLM call site):
//   monitor.precheck();                       // BEFORE the call — throws if over budget
//   const r = await chatWithDARS(...);        // make the call
//   monitor.record(model, inTokens, outTokens); // AFTER — accumulate usage
//
// `estimateTokens` / `estimateCost` / `COST_PER_1M` live here so the orchestrator,
// the chief agent, and the budget monitor all use one source of truth.

// ── Provider pricing (USD per 1M tokens) ─────────────────────────────────────
// OpenRouter-proxied models are billed at ~their direct counterpart; the bare
// model name is used for lookup (suffixes like " (via OpenRouter)" are stripped).
export const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'gemini-2.0-flash':         { input: 0.10, output: 0.40 },
  'gemini-2.5-flash':         { input: 0.15, output: 0.60 },
  'deepseek-chat':            { input: 0.14, output: 0.28 },
  'deepseek-v3':              { input: 0.14, output: 0.28 },
  'qwen-plus':                { input: 0.40, output: 1.20 },
  'qwen-turbo':               { input: 0.05, output: 0.15 },
  'llama-3.3-70b-versatile':  { input: 0.59, output: 0.79 },
  'llama-3.1-70b-versatile':  { input: 0.59, output: 0.79 },
  default:                    { input: 0.50, output: 1.50 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Strip " (via OpenRouter)" / " -> Fallback" suffixes if present.
  const baseModel = model.replace(/\s*\(.*?\)\s*$/, '').replace(/\s*->.*$/, '').trim();
  const rates = COST_PER_1M[baseModel] ?? COST_PER_1M.default;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// Token estimate from text length. The average English token is ~4 chars; the
// 4-char divisor is the industry-standard approximation when provider headers
// are unavailable. Rough (±30%) but far better than nothing for budget tracking.
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

// ── Budget limits ────────────────────────────────────────────────────────────
export interface BudgetLimits {
  /** Max total tokens (input + output) across the whole run. 0 = unlimited. */
  maxTokens: number;
  /** Max estimated USD cost across the whole run. 0 = unlimited. */
  maxCostUsd: number;
  /** Max number of LLM calls in the whole run. 0 = unlimited. */
  maxCalls: number;
}

export interface BudgetSnapshot {
  tokensUsed: number;
  estimatedCostUsd: number;
  calls: number;
  limits: BudgetLimits;
}

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/**
 * Default per-run budget. Generous ceilings that stop a runaway request without
 * ever tripping on normal traffic (a full Chief run is ~10 calls; pro voting more).
 */
export function defaultBudget(overrides: Partial<BudgetLimits> = {}): BudgetLimits {
  return {
    maxTokens:  num(process.env.COAGENTIX_MAX_TOKENS,    2_000_000),
    maxCostUsd: num(process.env.COAGENTIX_MAX_COST_USD,  2.0),
    maxCalls:   num(process.env.COAGENTIX_MAX_LLM_CALLS, 40),
    ...overrides,
  };
}

export class BudgetExceededError extends Error {
  readonly snapshot: BudgetSnapshot;
  readonly limitHit: 'tokens' | 'cost' | 'calls';
  constructor(limitHit: 'tokens' | 'cost' | 'calls', snapshot: BudgetSnapshot) {
    const detail =
      limitHit === 'tokens' ? `${snapshot.tokensUsed.toLocaleString()} / ${snapshot.limits.maxTokens.toLocaleString()} tokens`
      : limitHit === 'cost' ? `$${snapshot.estimatedCostUsd.toFixed(4)} / $${snapshot.limits.maxCostUsd.toFixed(2)}`
      : `${snapshot.calls} / ${snapshot.limits.maxCalls} calls`;
    super(`Budget exceeded (${limitHit}): ${detail}`);
    this.name = 'BudgetExceededError';
    this.limitHit = limitHit;
    this.snapshot = snapshot;
  }
}

export function isBudgetError(e: unknown): e is BudgetExceededError {
  return e instanceof BudgetExceededError;
}

/**
 * Per-run cost/token/call accumulator with a hard ceiling.
 *
 * `precheck()` throws BudgetExceededError when a ceiling has already been reached
 * — call it BEFORE every LLM call so the run stops instead of spending more.
 * `record()` accumulates the usage of a completed call.
 */
export class CostMonitor {
  private tokensUsed = 0;
  private costUsd = 0;
  private calls = 0;

  constructor(readonly limits: BudgetLimits = defaultBudget()) {}

  snapshot(): BudgetSnapshot {
    return {
      tokensUsed: this.tokensUsed,
      estimatedCostUsd: round8(this.costUsd),
      calls: this.calls,
      limits: this.limits,
    };
  }

  /** Throws if any active ceiling has already been reached. Call before each LLM call. */
  precheck(): void {
    const { maxTokens, maxCostUsd, maxCalls } = this.limits;
    if (maxCalls > 0 && this.calls >= maxCalls) {
      throw new BudgetExceededError('calls', this.snapshot());
    }
    if (maxTokens > 0 && this.tokensUsed >= maxTokens) {
      throw new BudgetExceededError('tokens', this.snapshot());
    }
    if (maxCostUsd > 0 && this.costUsd >= maxCostUsd) {
      throw new BudgetExceededError('cost', this.snapshot());
    }
  }

  /** Accumulate the usage of one completed LLM call. */
  record(model: string, inputTokens: number, outputTokens: number): void {
    this.calls += 1;
    this.tokensUsed += Math.max(0, inputTokens) + Math.max(0, outputTokens);
    this.costUsd = round8(this.costUsd + estimateCost(model, inputTokens, outputTokens));
  }

  /** Convenience: record a call when only the raw texts are known (no provider usage). */
  recordText(model: string, inputText: string, outputText: string): void {
    this.record(model, estimateTokens(inputText), estimateTokens(outputText));
  }

  get tokens(): number { return this.tokensUsed; }
  get cost(): number { return round8(this.costUsd); }
  get callCount(): number { return this.calls; }
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
