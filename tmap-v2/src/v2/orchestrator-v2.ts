// v2 — Orchestrator: probabilistic routing + cost optimizer.
//
// Given an RAA ExecutionPlan, decide HOW hard to run it: execution mode
// (fast/balanced/deep), parallel slot count, replan budget, and the scoring
// weights to favour next time. The decision is a score, not a rule table:
//
//   final_score = RAA_confidence − cost_penalty + latency_weight + reliability_weight
//
// where cost/latency/reliability are read live from the DARS HealthStore for the
// agents RAA actually selected.

import { HealthStore } from '../dars/health.js';
import { getAgent } from './registry.js';
import { DEFAULT_WEIGHTS, type ScoreWeights } from './score.js';
import type { ExecutionPlan } from './raa.js';

export type ExecutionMode = 'fast' | 'balanced' | 'deep';

export interface OrchestrationDecision {
  mode: ExecutionMode;
  maxParallel: number;
  maxReplans: number;
  weights: ScoreWeights;
  finalScore: number;
  reason: string;
}

const COST_TIER: Record<string, number> = {}; // memoized per call below

export function decideExecution(
  plan: ExecutionPlan,
  health: HealthStore,
  opts: { budgetTight?: boolean } = {},
): OrchestrationDecision {
  const confidence = plan.confidence; // 0..1 (RAA top scores)
  const complexity = plan.intent.complexity; // 0..1

  // Aggregate live signals across the agents RAA chose.
  const nodes = [...plan.graph.nodes.values()];
  let relSum = 0;
  let latScoreSum = 0;
  let costSum = 0;
  let n = 0;
  for (const node of nodes) {
    const agent = getAgent(node.agentId);
    costSum += COST_TIER[node.agentId] ?? agent?.costTier ?? 0.5;
    if (agent?.healthKey) {
      const h = health.get(agent.healthKey);
      relSum += h.circuit === 'open' ? 0 : h.successRate;
      latScoreSum += 1 / (1 + h.ewmaLatencyMs / 1000);
    } else {
      relSum += 0.8;
      latScoreSum += 0.5;
    }
    n++;
  }
  const reliability = n ? relSum / n : 0.8;
  const latency = n ? latScoreSum / n : 0.5;
  const cost = n ? costSum / n : 0.5;

  const costPenalty = (opts.budgetTight ? 0.35 : 0.2) * cost;
  const finalScore = confidence - costPenalty + 0.1 * latency + 0.2 * reliability;

  // Mode: spend more effort when the work is complex or RAA is unsure.
  let mode: ExecutionMode;
  if (complexity > 0.66 || confidence < 0.5) mode = 'deep';
  else if (complexity < 0.33 && confidence > 0.75) mode = 'fast';
  else mode = 'balanced';

  const profile: Record<ExecutionMode, { maxParallel: number; maxReplans: number }> = {
    fast: { maxParallel: 2, maxReplans: 1 },
    balanced: { maxParallel: 3, maxReplans: 2 },
    deep: { maxParallel: 5, maxReplans: 3 },
  };

  // Cost optimizer nudges the scoring weights for the next selection pass.
  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS };
  if (opts.budgetTight) {
    weights.cost = 0.30;
    weights.capability = 0.30;
  } else if (mode === 'deep') {
    weights.capability = 0.45;
    weights.reliability = 0.20;
    weights.cost = 0.05;
  } else if (mode === 'fast') {
    // Latency optimization: when the work is simple and confidence is high,
    // favor the quickest healthy agent.
    weights.latency = 0.25;
    weights.capability = 0.30;
    weights.cost = 0.15;
  }

  return {
    mode,
    ...profile[mode],
    weights,
    finalScore,
    reason: `mode=${mode} conf=${confidence.toFixed(2)} cmplx=${complexity.toFixed(2)} rel=${reliability.toFixed(2)} cost=${cost.toFixed(2)}`,
  };
}
