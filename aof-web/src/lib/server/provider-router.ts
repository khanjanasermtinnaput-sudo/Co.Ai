// ── Co.AI — Provider Router (Master Prompt Part 6.4) ───────────────────────────
// Turns the static task-priority chain in model-registry.ts's ROUTE_PRIORITY into
// a live, health-scored ordering — mirroring tmap-v2's DARS (dars/select.ts +
// dars/health.ts): capability fit + live success rate + latency + cost,
// recomputed from real call outcomes the chat route records after every attempt.
// ROUTE_PRIORITY itself stays the source of truth for *eligibility* (which
// providers are even valid for a task) — this module only reorders that
// eligible set by how providers are actually performing right now.

import type { AofErrorCode } from "@/lib/errors";
import { configuredProviders, type KeyOverrides, type ProviderId, type ProviderMeta } from "./ai-providers";
import { modelDefFor, routeOrder, type CostTier, type TaskCategory } from "./model-registry";

// ── Health store (per-provider, in-memory — warm-instance-scoped, same MVP
//    tradeoff tmap-v2's dars/health.ts documents: no cross-instance sharing
//    without a shared backing store, resets on cold start) ─────────────────────

export type FailureKind = "down" | "timeout" | "rate_limit" | "quota" | "auth" | "low_quality";

type Circuit = "closed" | "open" | "half_open";

interface ProviderHealthEntry {
  circuit: Circuit;
  consecutiveFails: number;
  ewmaLatencyMs: number;
  successRate: number; // EWMA of success(1)/fail(0), 0..1
  cooldownUntil?: number; // epoch ms
  lastKind?: FailureKind;
  updatedAt: number;
}

const INIT_LATENCY_MS = 1500;
const FAIL_THRESHOLD = 3; // consecutive transient fails -> open
const BASE_COOLDOWN_MS = 30_000;
const RATE_COOLDOWN_MS = 60_000;
const QUOTA_COOLDOWN_MS = 60 * 60_000;
const AUTH_COOLDOWN_MS = 24 * 60 * 60_000; // bad key is permanent until changed

/** Per-provider health + circuit breaker — the same shape as tmap-v2's
 *  dars/health.ts HealthStore, so both stacks degrade a flaky/misconfigured
 *  provider the same way instead of two divergent recovery policies. */
class ProviderHealthStore {
  private map = new Map<ProviderId, ProviderHealthEntry>();

  private entry(id: ProviderId): ProviderHealthEntry {
    let h = this.map.get(id);
    if (!h) {
      h = { circuit: "closed", consecutiveFails: 0, ewmaLatencyMs: INIT_LATENCY_MS, successRate: 1, updatedAt: Date.now() };
      this.map.set(id, h);
    }
    return h;
  }

  /** Available to take traffic now? (closed, or open past cooldown -> half-open probe). */
  isAvailable(id: ProviderId): boolean {
    const h = this.entry(id);
    if (h.circuit === "closed") return true;
    if (h.circuit === "open") {
      if (Date.now() >= (h.cooldownUntil ?? 0)) {
        h.circuit = "half_open";
        return true;
      }
      return false;
    }
    return true; // half_open -> single probe allowed
  }

  recordSuccess(id: ProviderId, latencyMs: number): void {
    const h = this.entry(id);
    h.consecutiveFails = 0;
    h.circuit = "closed";
    h.cooldownUntil = undefined;
    h.ewmaLatencyMs = 0.7 * h.ewmaLatencyMs + 0.3 * latencyMs;
    h.successRate = 0.8 * h.successRate + 0.2 * 1;
    h.updatedAt = Date.now();
  }

  recordFailure(id: ProviderId, kind: FailureKind): void {
    const h = this.entry(id);
    h.consecutiveFails += 1;
    h.successRate = 0.8 * h.successRate + 0.2 * 0;
    h.lastKind = kind;
    h.updatedAt = Date.now();

    if (kind === "auth") {
      // Invalid/missing key is permanent until the key changes — open for 24h
      // rather than wasting calls retrying a provider that will always reject.
      h.circuit = "open";
      h.cooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
    } else if (kind === "quota") {
      h.circuit = "open";
      h.cooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
    } else if (kind === "rate_limit") {
      h.circuit = "open";
      h.cooldownUntil = Date.now() + RATE_COOLDOWN_MS;
    } else if (h.consecutiveFails >= FAIL_THRESHOLD) {
      // down / timeout / low_quality: exponential backoff after repeated fails.
      const factor = Math.min(h.consecutiveFails - FAIL_THRESHOLD, 4);
      h.circuit = "open";
      h.cooldownUntil = Date.now() + BASE_COOLDOWN_MS * 2 ** factor;
    }
  }

  get(id: ProviderId): Readonly<ProviderHealthEntry> {
    return this.entry(id);
  }

  /** For the health/diagnostics surface — every provider with a recorded call. */
  snapshot(): Array<{ id: ProviderId } & ProviderHealthEntry> {
    return [...this.map.entries()].map(([id, h]) => ({ id, ...h }));
  }
}

/** Module-level singleton — shared across requests on a warm serverless
 *  instance, exactly like tmap-v2's dars/health.ts globalHealth. */
export const globalProviderHealth = new ProviderHealthStore();

/** Map a classified Co.AI error code (errors.ts's existing AOF_ERROR taxonomy)
 *  to a DARS-style failure kind, instead of re-deriving one from raw error
 *  strings the way tmap-v2's dars/classify.ts has to (aof-web already
 *  classifies upstream errors into structured codes, so reuse that). */
export function classifyFailureKind(code: AofErrorCode): FailureKind {
  switch (code) {
    case "AOF_ERROR_001": // API Key Missing
    case "AOF_ERROR_002": // Invalid API Key
    case "AOF_ERROR_003": // Expired API Key
    case "AOF_ERROR_010": // Authentication Failure
      return "auth";
    case "AOF_ERROR_004": // Quota Exceeded
      return "quota";
    case "AOF_ERROR_005": // Rate Limit Exceeded
      return "rate_limit";
    case "AOF_ERROR_008": // Request Timeout
      return "timeout";
    case "AOF_ERROR_011": // Empty Response
      return "low_quality";
    default: // Provider Unavailable / Network Failure / Invalid Model / Unknown / Config
      return "down";
  }
}

// ── Scoring (mirrors tmap-v2 dars/select.ts scoreCandidate's weights) ─────────

const COST_RANK: Record<CostTier, number> = { free: 0, low: 1, medium: 2, high: 3 };

/** Capability fit, 0..1 — derived from ROUTE_PRIORITY's existing curated rank
 *  for this task (position 0 = best fit) rather than a second, hand-tuned
 *  number that could silently drift out of sync with that list. */
function capabilityScore(id: ProviderId, task: TaskCategory): number {
  const order = routeOrder(task);
  const i = order.indexOf(id);
  if (i < 0) return 0.5;
  return 1 - i / order.length;
}

function costScore(id: ProviderId, task: TaskCategory): number {
  const def = modelDefFor(id, task);
  if (!def) return 0.5;
  return 1 - COST_RANK[def.costTier] / 3;
}

function scoreProvider(id: ProviderId, task: TaskCategory): number {
  const h = globalProviderHealth.get(id);
  const cap = capabilityScore(id, task);
  const speed = 1 / (1 + h.ewmaLatencyMs / 1000);
  return 0.5 * cap + 0.2 * h.successRate + 0.15 * speed + 0.15 * costScore(id, task);
}

/** Configured providers eligible for `task` (per ROUTE_PRIORITY), ordered by
 *  live score instead of the static priority array — the "Intelligent Provider
 *  Router" (Master Prompt 6.4) piece: capability + live health + cost, not a
 *  fixed chain. A provider with no recorded calls yet scores on capability +
 *  cost alone (successRate defaults to 1, latency to INIT_LATENCY_MS), so a
 *  cold instance still respects task-capability ordering rather than picking
 *  randomly.
 *
 *  Providers whose circuit is open (e.g. a bad key, or repeated timeouts) are
 *  pushed out of the primary pool so the route doesn't keep re-trying a
 *  provider known to be down first — unless *every* eligible provider is
 *  currently open, in which case the full set is returned anyway (a half-open
 *  probe is still worth attempting over refusing the request outright). */
export function configuredProvidersByScore(task: TaskCategory, overrides?: KeyOverrides): ProviderMeta[] {
  const eligible = new Set(routeOrder(task));
  const configured = configuredProviders(overrides).filter((p) => eligible.has(p.id));
  const available = configured.filter((p) => globalProviderHealth.isAvailable(p.id));
  const pool = available.length ? available : configured;
  return pool
    .map((p) => ({ p, score: scoreProvider(p.id, task) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}
