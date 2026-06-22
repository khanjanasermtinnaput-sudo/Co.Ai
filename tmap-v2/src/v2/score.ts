// v2 — Score-based agent selection.
//
// HARD RULE: no keyword routing, no static intent→agent map. Every candidate
// agent is scored by the SAME formula and ranked. The capability match is a
// cosine similarity between the task's required-capability vector and the
// agent's declared capability vector — pure data, no branching on task text.
//
// Reliability + historical performance are read live from the DARS HealthStore
// (success-rate EWMA + circuit state), so a degraded provider is ranked down
// automatically.

import { HealthStore } from '../dars/health.js';
import type { AgentDescriptor, Capability, CapabilityVector } from './registry.js';

// Six explicit scoring factors (RAA v2 spec). Each is read as live data — none
// branches on task text. `historicalSuccess` and `reliability` are deliberately
// SEPARATE: historical success is the agent's track record (telemetry/EWMA),
// reliability is its *current* health (a tripped circuit zeroes it immediately).
export interface ScoreWeights {
  capability: number;
  context: number;
  cost: number;
  historicalSuccess: number;
  reliability: number;
  latency: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  capability: 0.35,
  context: 0.10,
  cost: 0.10,
  historicalSuccess: 0.15,
  reliability: 0.15,
  latency: 0.15,
};

export interface AgentScore {
  agentId: string;
  total: number; // 0..1
  parts: Record<keyof ScoreWeights, number>;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Cosine similarity of two capability vectors. Returns 0 when either side has
 *  no capabilities (no spurious match). */
function capabilityMatch(req: CapabilityVector, agent: CapabilityVector): number {
  const keys = new Set<Capability>([
    ...(Object.keys(req) as Capability[]),
    ...(Object.keys(agent) as Capability[]),
  ]);
  let dot = 0;
  let ra = 0;
  let aa = 0;
  for (const cap of keys) {
    const r = req[cap] ?? 0;
    const a = agent[cap] ?? 0;
    dot += r * a;
    ra += r * r;
    aa += a * a;
  }
  if (ra === 0 || aa === 0) return 0;
  return dot / (Math.sqrt(ra) * Math.sqrt(aa));
}

export interface ScoreContext {
  health: HealthStore;
  contextFit: number; // 0..1 — memory/context relevance signal (Phase 5 feeds this)
  weights?: ScoreWeights;
}

export function scoreAgent(
  req: CapabilityVector,
  agent: AgentDescriptor,
  ctx: ScoreContext,
): AgentScore {
  const w = ctx.weights ?? DEFAULT_WEIGHTS;
  const h = agent.healthKey ? ctx.health.get(agent.healthKey) : undefined;

  const parts: Record<keyof ScoreWeights, number> = {
    capability: capabilityMatch(req, agent.capabilities),
    context: clamp01(ctx.contextFit),
    cost: 1 - (agent.costTier ?? 0.5),
    // Historical track record: telemetry-backed score if present, else the
    // success-rate EWMA, else a neutral prior.
    historicalSuccess: agent.historicalScore ?? (h ? h.successRate : 0.7),
    // Current health: a tripped circuit ranks reliability to 0 so an unhealthy
    // agent loses immediately, independent of its history.
    reliability: h ? (h.circuit === 'open' ? 0 : h.successRate) : 0.8,
    // Speed: faster providers score higher (EWMA latency from DARS health).
    latency: h ? 1 / (1 + h.ewmaLatencyMs / 1000) : 0.5,
  };

  const total =
    w.capability * parts.capability +
    w.context * parts.context +
    w.cost * parts.cost +
    w.historicalSuccess * parts.historicalSuccess +
    w.reliability * parts.reliability +
    w.latency * parts.latency;

  return { agentId: agent.id, total, parts };
}

export interface RankContext {
  health: HealthStore;
  /** Optional per-agent context-fit provider (memory influence). Defaults to 0.5. */
  contextFit?: (a: AgentDescriptor) => number;
  weights?: ScoreWeights;
}

/** Rank ALL candidate agents by score, descending. No keyword pre-filtering —
 *  the caller takes top-K as primary picks and the next-ranked as fallbacks. */
export function rankAgents(
  req: CapabilityVector,
  agents: AgentDescriptor[],
  ctx: RankContext,
): AgentScore[] {
  return agents
    .map((a) =>
      scoreAgent(req, a, {
        health: ctx.health,
        contextFit: ctx.contextFit ? ctx.contextFit(a) : 0.5,
        weights: ctx.weights,
      }),
    )
    .sort((x, y) => y.total - x.total);
}
