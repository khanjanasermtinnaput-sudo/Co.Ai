// ── Budget Enforcer — Co.AI Master Prompt v1.0 Part 6.8.1 ────────────────────
// Deliberately mirrors tmap-v2/src/core/budget-enforcer.ts's vocabulary
// (BudgetLevel/BudgetCategory/BudgetAction/EnforcementDecision) — same
// pattern as crypto.ts and the Tool Execution Engine's two independent
// copies: aof-web and tmap-v2 are separate packages with no shared
// workspace, so this is a deliberate mirror, not a fake duplicate.
//
// Unifies two budgets that were previously judged independently:
// turn-budget.ts's wall-clock ledger (time-only, Part 5.5's Execution
// Monitor) and Part 6.7's TokenBudget (tokens-only). Neither existing
// module is rewritten — this layers graduated levels ON TOP of their real
// snapshots.
//
// Boundary (documented, following the Part 5.5 precedent of NOT building an
// Event Bus/Recovery Engine for a stateless single-request pipeline — see
// orchestrator.ts's own header): there is no pause/resume control plane
// here. A stateless HTTP request has no live actor to pause and resume
// later. "Enforcement" in this codebase is the ALREADY-EXISTING honest
// degrade — turn-budget.ts's deadlines, orchestrator.ts's `timeUp()` →
// `TaskRecord.skipReason: "budget"`, Part 6.7's guardOverflow() dropping
// history — this module formalizes that degrade's SEVERITY as a typed
// level/action pair for logging. It does not add a new runtime control
// surface that doesn't correspond to real, already-exercised code.

export type BudgetLevel = "healthy" | "warning" | "critical" | "exceeded";
export type BudgetCategory = "time" | "tokens";
export type BudgetAction = "continue" | "optimize" | "reduce" | "escalate" | "abort";

export interface EnforcementDecision {
  level: BudgetLevel;
  category: BudgetCategory;
  action: BudgetAction;
  recommendation: string;
  /** used/limit for the worst category, 0..1+ (>1 possible when genuinely
   *  over budget — never clamped, so the real degree of overrun is visible
   *  in logs). */
  ratio: number;
}

export interface EnforcementThresholds {
  warning: number;
  critical: number;
}

export const DEFAULT_THRESHOLDS: EnforcementThresholds = { warning: 0.8, critical: 0.95 };

export interface TimeSnapshot {
  elapsedMs: number;
  /** The denominator: TURN_BUDGET_MS - STREAM_RESERVE_MS (turn-budget.ts's
   *  pre-stream pool size), passed in rather than imported so this module
   *  has no dependency on turn-budget.ts's internals beyond its exported
   *  constants — callers already have both in scope. */
  totalPreStreamPoolMs: number;
}

export interface TokenSnapshot {
  totalBudget: number;
  contextWindow: number;
}

function ratioFor(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return used / limit;
}

function levelFor(ratio: number, thresholds: EnforcementThresholds): BudgetLevel {
  if (ratio >= 1) return "exceeded";
  if (ratio >= thresholds.critical) return "critical";
  if (ratio >= thresholds.warning) return "warning";
  return "healthy";
}

function actionFor(level: BudgetLevel): BudgetAction {
  switch (level) {
    case "exceeded":
      return "abort";
    case "critical":
      return "escalate";
    case "warning":
      return "optimize";
    default:
      return "continue";
  }
}

function recommendationFor(level: BudgetLevel, category: BudgetCategory): string {
  if (level === "healthy") return "within budget";
  const what = category === "time" ? "wall-clock time" : "token/context-window";
  switch (level) {
    case "warning":
      return `${what} usage is high — prefer skipping optional stages from here`;
    case "critical":
      return `${what} usage is critical — this turn should degrade (skip remaining optional work) rather than start more`;
    default:
      return `${what} budget exceeded — this turn must stop taking on new work`;
  }
}

/** Evaluates BOTH the wall-clock ledger and the token budget against the
 *  SAME graduated thresholds and returns whichever is WORSE (higher ratio)
 *  — a turn is only as healthy as its tightest resource. Pure,
 *  deterministic, real snapshots only — never estimates or fabricates a
 *  number itself. */
export function enforcementFor(
  time: TimeSnapshot,
  tokens: TokenSnapshot,
  thresholds: EnforcementThresholds = DEFAULT_THRESHOLDS,
): EnforcementDecision {
  const timeRatio = ratioFor(time.elapsedMs, time.totalPreStreamPoolMs);
  const tokenRatio = ratioFor(tokens.totalBudget, tokens.contextWindow);

  const [category, ratio]: [BudgetCategory, number] =
    tokenRatio > timeRatio ? ["tokens", tokenRatio] : ["time", timeRatio];

  const level = levelFor(ratio, thresholds);
  return {
    level,
    category,
    action: actionFor(level),
    ratio: Math.round(ratio * 1000) / 1000,
    recommendation: recommendationFor(level, category),
  };
}
