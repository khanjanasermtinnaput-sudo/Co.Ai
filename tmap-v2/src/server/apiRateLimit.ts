/**
 * Per-user API rate limiter — token-bucket algorithm.
 * Three tiers with independent quotas:
 *   'run'     — full TMAP/Orchestrate pipelines (expensive)
 *   'chat'    — single-call streams (RAA, debug, analyze, titan)
 *   'general' — lightweight reads (GET endpoints, memory, projects)
 *
 * Env vars (per-hour limits):
 *   AOF_LIMIT_RUN_PER_HOUR     (default 10)
 *   AOF_LIMIT_CHAT_PER_HOUR    (default 30)
 *   AOF_LIMIT_GENERAL_PER_HOUR (default 120)
 *
 * Redis-ready: the store is a plain Map<string, Bucket>.  When AOF_REDIS_URL is
 * available, replace `store` with a Redis hash adapter (same key/value shape)
 * without changing call sites.
 */

export type ApiTier = 'run' | 'chat' | 'general';

interface Bucket {
  tokens: number;
  lastRefill: number; // epoch ms
}

const HOUR_MS = 60 * 60 * 1_000;

const TIER_CAPACITY: Record<ApiTier, number> = {
  run:     Number(process.env.AOF_LIMIT_RUN_PER_HOUR     ?? 10),
  chat:    Number(process.env.AOF_LIMIT_CHAT_PER_HOUR    ?? 30),
  general: Number(process.env.AOF_LIMIT_GENERAL_PER_HOUR ?? 120),
};

const store = new Map<string, Bucket>();

function key(userId: string, tier: ApiTier): string {
  return `rl:${userId}:${tier}`;
}

function refill(b: Bucket, cap: number, now: number): Bucket {
  const elapsed = now - b.lastRefill;
  if (elapsed <= 0) return b;
  if (elapsed >= HOUR_MS) {
    return { tokens: cap, lastRefill: now };
  }
  const added = Math.floor((elapsed / HOUR_MS) * cap);
  if (added === 0) return b;
  return { tokens: Math.min(cap, b.tokens + added), lastRefill: now };
}

export interface ApiRateLimitResult {
  allowed: boolean;
  remaining: number;   // tokens left after this call
  resetAfterSec: number;
}

export function checkApiRate(userId: string, tier: ApiTier): ApiRateLimitResult {
  const cap = TIER_CAPACITY[tier];
  const now = Date.now();
  const k = key(userId, tier);

  let b = store.get(k) ?? { tokens: cap, lastRefill: now };
  b = refill(b, cap, now);

  const resetAfterSec = Math.ceil((HOUR_MS - (now - b.lastRefill)) / 1_000);

  if (b.tokens <= 0) {
    store.set(k, b);
    return { allowed: false, remaining: 0, resetAfterSec };
  }

  b.tokens -= 1;
  store.set(k, b);
  return { allowed: true, remaining: b.tokens, resetAfterSec };
}

export function getRateLimitStatus(userId: string, tier: ApiTier): { remaining: number; resetAfterSec: number } {
  const cap = TIER_CAPACITY[tier];
  const now = Date.now();
  const k = key(userId, tier);
  const b = refill(store.get(k) ?? { tokens: cap, lastRefill: now }, cap, now);
  return {
    remaining: b.tokens,
    resetAfterSec: Math.ceil((HOUR_MS - (now - b.lastRefill)) / 1_000),
  };
}

// Prune buckets idle for more than 2 hours
export function pruneApiStore(): void {
  const cutoff = Date.now() - 2 * HOUR_MS;
  for (const [k, b] of store.entries()) {
    if (b.lastRefill < cutoff) store.delete(k);
  }
}

setInterval(pruneApiStore, 30 * 60 * 1_000).unref?.();
