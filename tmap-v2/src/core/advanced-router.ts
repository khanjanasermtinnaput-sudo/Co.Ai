// Advanced TMAP Router — adapts routing decisions using historical performance data.
// Wraps the base model-router and overrides provider hints when metrics show a
// superior performer for the selected role. Requires ≥ MIN_OBSERVATIONS before
// trusting the metrics (falls back to base router until enough data is collected).

import type { Role, TaskCategory } from '../types.js';
import type { CredentialBag } from '../config.js';
import type { HealthStore } from '../dars/health.js';
import { routeToRole, selectTemperature, type ModelRoutingDecision } from './model-router.js';
import { globalRoutingMetrics, type RoutingMetricsStore } from './routing-metrics.js';

export interface AdvancedRoutingDecision extends ModelRoutingDecision {
  providerHint?: string;    // best historical provider for this role
  modelHint?: string;       // best historical model for this role
  adaptiveScore?: number;   // composite score 0-1 that drove the hint
  metricsAvailable: boolean;
  rationale: string[];
}

const MIN_OBSERVATIONS = 5;
const HIGH_HALLUCINATION_THRESHOLD = 0.20;  // 20% — avoid this provider
const LOW_SUCCESS_THRESHOLD         = 0.60;  // 60% — consider alternatives

export function advancedRouteToRole(
  categories: TaskCategory[],
  creds: CredentialBag,
  health: HealthStore,
  metrics: RoutingMetricsStore = globalRoutingMetrics,
): AdvancedRoutingDecision {
  const base = routeToRole(categories, creds, health);
  const rationale: string[] = [`Base: ${base.reason}`];

  const candidates = metrics
    .getMetrics()
    .filter((m) => m.role === base.role && m.total >= MIN_OBSERVATIONS);

  if (candidates.length === 0) {
    return {
      ...base,
      metricsAvailable: false,
      rationale: [...rationale, `No metrics yet (need ≥${MIN_OBSERVATIONS} observations)`],
    };
  }

  // candidates is already sorted by composite score desc
  let selected = candidates[0];

  const hasIssue =
    selected.hallucinationRate > HIGH_HALLUCINATION_THRESHOLD ||
    selected.successRate < LOW_SUCCESS_THRESHOLD;

  if (hasIssue) {
    rationale.push(
      `Top provider issues — hallucination=${Math.round(selected.hallucinationRate * 100)}%` +
      ` success=${Math.round(selected.successRate * 100)}%`,
    );
    const alternative = candidates.find(
      (m) =>
        m.hallucinationRate <= HIGH_HALLUCINATION_THRESHOLD &&
        m.successRate >= LOW_SUCCESS_THRESHOLD,
    );
    if (alternative) {
      selected = alternative;
      rationale.push(`Switched to ${selected.provider} (score=${selected.score})`);
    }
  } else {
    rationale.push(
      `${selected.provider} preferred: score=${selected.score}` +
      ` success=${Math.round(selected.successRate * 100)}%` +
      ` hallucination=${Math.round(selected.hallucinationRate * 100)}%`,
    );
  }

  return {
    ...base,
    providerHint: selected.provider,
    modelHint: selected.model,
    adaptiveScore: selected.score,
    metricsAvailable: true,
    rationale,
  };
}

export { selectTemperature };
