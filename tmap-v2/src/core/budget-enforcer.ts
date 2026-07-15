// Budget Enforcer — Co.AI Master Prompt v1.0 Part 6.8.1.
//
// cost-budget.ts's CostMonitor already enforces hard ceilings (precheck()
// throws BudgetExceededError once a limit is truly reached). What it lacks
// is anything BETWEEN "fine" and "stop": no graduated levels, no signal a
// caller (or a subscriber on the EventBus) can react to before the run is
// forcibly cut off. This module adds that layer on top of CostMonitor —
// it does not replace precheck()'s hard-stop behavior, and it does not
// estimate budgets (that's cost-resource-manager.ts's job, Part 5.10).
//
// evaluate() is pure and deterministic: given a real BudgetSnapshot, it
// classifies the WORST-consumed category (tokens/cost/calls) into
// healthy/warning/critical/exceeded and recommends an action. BudgetEnforcer
// wraps a CostMonitor (and optionally an EventBus) so existing call sites can
// swap `budget.precheck()` for `enforcer.precheckWithEnforcement()` with no
// other change: the underlying precheck() still throws the exact same
// BudgetExceededError once truly exceeded, so every existing
// `catch (isBudgetError(e))` handler keeps working unmodified. The new
// behavior is purely additive: warning/critical events on the bus BEFORE
// that hard stop, once per level transition (not once per call, which would
// be log/event spam on a run with hundreds of calls at the same level).

import type { CostMonitor, BudgetSnapshot } from './cost-budget.js';
import type { EventBus } from '../v2/events.js';

export type BudgetLevel = 'healthy' | 'warning' | 'critical' | 'exceeded';
export type BudgetCategory = 'tokens' | 'cost' | 'calls';
export type BudgetAction = 'continue' | 'optimize' | 'reduce' | 'pause' | 'escalate' | 'abort';

export interface EnforcementDecision {
  level: BudgetLevel;
  category: BudgetCategory;
  action: BudgetAction;
  recommendation: string;
  /** used/limit for the worst category. 0 when that category has no limit
   *  set (BudgetLimits' own "0 = unlimited" convention). */
  ratio: number;
}

export interface EnforcementThresholds {
  warning: number;
  critical: number;
}

export const DEFAULT_THRESHOLDS: EnforcementThresholds = { warning: 0.8, critical: 0.95 };

function ratioFor(used: number, limit: number): number {
  if (limit <= 0) return 0; // unlimited — never drives a level on its own
  return used / limit;
}

function levelFor(ratio: number, thresholds: EnforcementThresholds): BudgetLevel {
  if (ratio >= 1) return 'exceeded';
  if (ratio >= thresholds.critical) return 'critical';
  if (ratio >= thresholds.warning) return 'warning';
  return 'healthy';
}

function actionFor(level: BudgetLevel): BudgetAction {
  switch (level) {
    case 'exceeded': return 'abort';
    case 'critical': return 'escalate';
    case 'warning': return 'optimize';
    default: return 'continue';
  }
}

function recommendationFor(level: BudgetLevel, category: BudgetCategory): string {
  if (level === 'healthy') return 'within budget';
  const what = category === 'tokens' ? 'token' : category === 'cost' ? 'cost' : 'call-count';
  switch (level) {
    case 'warning':
      return `${what} usage is high — prefer smaller prompts and fewer optional agents from here`;
    case 'critical':
      return `${what} usage is critical — escalate to the caller before starting more work`;
    default:
      return `${what} ceiling reached — stop the run, keep whatever was already produced`;
  }
}

/** Pure, deterministic, side-effect-free: never makes a provider call, never
 *  mutates the snapshot. The worst (highest-ratio) category drives the
 *  decision — a run is only as healthy as its tightest resource. */
export function evaluate(
  snapshot: BudgetSnapshot,
  thresholds: EnforcementThresholds = DEFAULT_THRESHOLDS,
): EnforcementDecision {
  const ratios: Record<BudgetCategory, number> = {
    tokens: ratioFor(snapshot.tokensUsed, snapshot.limits.maxTokens),
    cost: ratioFor(snapshot.estimatedCostUsd, snapshot.limits.maxCostUsd),
    calls: ratioFor(snapshot.calls, snapshot.limits.maxCalls),
  };
  const [category, ratio] = (Object.entries(ratios) as [BudgetCategory, number][]).reduce((worst, cur) =>
    cur[1] > worst[1] ? cur : worst,
  );
  const level = levelFor(ratio, thresholds);
  return {
    level,
    category,
    action: actionFor(level),
    ratio: Math.round(ratio * 1000) / 1000,
    recommendation: recommendationFor(level, category),
  };
}

export class BudgetEnforcer {
  private lastLevel: BudgetLevel = 'healthy';

  constructor(
    private readonly monitor: CostMonitor,
    private readonly bus?: EventBus,
    private readonly thresholds: EnforcementThresholds = DEFAULT_THRESHOLDS,
  ) {}

  get costMonitor(): CostMonitor {
    return this.monitor;
  }

  /** Evaluates the CURRENT snapshot. Emits a budget_warning/budget_critical
   *  event on the bus only the FIRST time a run crosses INTO that level —
   *  one signal per transition, not one per call. Never throws. */
  evaluate(): EnforcementDecision {
    const decision = evaluate(this.monitor.snapshot(), this.thresholds);
    if (decision.level !== this.lastLevel && (decision.level === 'warning' || decision.level === 'critical')) {
      this.bus?.emit({ type: `budget_${decision.level}`, category: decision.category, ratio: decision.ratio });
    }
    this.lastLevel = decision.level;
    return decision;
  }

  /** Drop-in replacement for `CostMonitor.precheck()`: evaluates graduated
   *  levels (emitting warning/critical transition events) THEN calls the
   *  underlying precheck(), which still throws BudgetExceededError exactly
   *  as before once a ceiling is truly reached — existing
   *  `catch (isBudgetError(e))` call sites are unaffected. */
  precheckWithEnforcement(): EnforcementDecision {
    const decision = this.evaluate();
    if (decision.level === 'exceeded') {
      this.bus?.emit({ type: 'budget_exceeded', category: decision.category, ratio: decision.ratio });
    }
    this.monitor.precheck();
    return decision;
  }
}
