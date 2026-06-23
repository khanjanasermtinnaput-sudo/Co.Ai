// v2 — RAA routing telemetry.
//
// Records every routing decision the score-based RAA makes so operators can see,
// at a glance, whether dynamic routing is actually carrying traffic or quietly
// falling back. Powers the metrics the remediation spec requires:
//   • RAA success rate  — share of runs served by the score-based DAG
//   • fallback rate      — share that dropped to the legacy single-route
//   • average confidence — mean RAA plan confidence
//
// Process-local and allocation-bounded (keeps only the most recent decisions).
// For multi-instance aggregation these counters are also surfaced per-request in
// the structured log, so a log pipeline can sum them across instances.

export type RoutingRoute = 'raa-v2' | 'legacy-fallback';

export interface RoutingDecisionLog {
  requestId: string;
  route: RoutingRoute;
  confidence: number;
  selected_agents: string[];
  fallback_used: boolean;
  reason?: string;
  ts: string;
}

export interface RoutingMetricsSnapshot {
  raaRuns: number;
  raaSuccessRate: number; // 0..1 — served by score-based DAG (not fallback)
  fallbackRate: number;   // 0..1
  avgConfidence: number;  // 0..1
  recent: RoutingDecisionLog[];
}

const MAX_RECENT = 200;

class RoutingTelemetry {
  private runs = 0;
  private fallbacks = 0;
  private confidenceSum = 0;
  private recent: RoutingDecisionLog[] = [];

  record(log: RoutingDecisionLog): void {
    this.runs += 1;
    if (log.fallback_used) this.fallbacks += 1;
    this.confidenceSum += Number.isFinite(log.confidence) ? log.confidence : 0;
    this.recent.unshift(log);
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
  }

  metrics(): RoutingMetricsSnapshot {
    const runs = this.runs;
    return {
      raaRuns: runs,
      raaSuccessRate: runs ? (runs - this.fallbacks) / runs : 0,
      fallbackRate: runs ? this.fallbacks / runs : 0,
      avgConfidence: runs ? this.confidenceSum / runs : 0,
      recent: this.recent.slice(0, 20),
    };
  }

  reset(): void {
    this.runs = 0;
    this.fallbacks = 0;
    this.confidenceSum = 0;
    this.recent = [];
  }
}

export const globalRoutingTelemetry = new RoutingTelemetry();
