/**
 * Per-user API rate limiter — fixed-window counter.
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
 * Redis-ready: replace `store` with a Redis hash adapter (same key/value shape)
 * without changing call sites.
 */

export type ApiTier = 'run' | 'chat' | 'general';

interface Bucket {
  consumed: number;    // requests used in the current window
  windowStart: number; // epoch ms when the current window started
}

const HOUR_MS = 60 * 60 * 1_000;

const TIER_CAPACITY: Record<ApiTier, number> = {
  run:     Number(process.env.AOF_LIMIT_RUN_PER_HOUR     ?? 10),
  chat:    Number(process.env.AOF_LIMIT_CHAT_PER_HOUR    ?? 30),
  general: Number(process.env.AOF_LIMIT_GENERAL_PER_HOUR ?? 120),
};

const store = new Map<string, Bucket>();

function bucketKey(userId: string, tier: ApiTier): string {
  return `rl:${userId}:${tier}`;
}

export interface ApiRateLimitResult {
  allowed: boolean;
  remaining: number;    // requests remaining in the current window
  resetAfterSec: number; // seconds until the window resets
}

export function checkApiRate(userId: string, tier: ApiTier): ApiRateLimitResult {
  const cap = TIER_CAPACITY[tier];
  const now = Date.now();
  const k = bucketKey(userId, tier);

  let b = store.get(k) ?? { consumed: 0, windowStart: now };

  // New window when the current one has expired
  if (now - b.windowStart >= HOUR_MS) {
    b = { consumed: 0, windowStart: now };
  }

  const resetAfterSec = Math.ceil((HOUR_MS - (now - b.windowStart)) / 1_000);

  if (b.consumed >= cap) {
    store.set(k, b);
    return { allowed: false, remaining: 0, resetAfterSec };
  }

  b.consumed += 1;
  store.set(k, b);
  return { allowed: true, remaining: cap - b.consumed, resetAfterSec };
}

export function getRateLimitStatus(userId: string, tier: ApiTier): { remaining: number; resetAfterSec: number } {
  const cap = TIER_CAPACITY[tier];
  const now = Date.now();
  const k = bucketKey(userId, tier);
  const b = store.get(k) ?? { consumed: 0, windowStart: now };
  const expired = now - b.windowStart >= HOUR_MS;
  const consumed = expired ? 0 : b.consumed;
  const windowStart = expired ? now : b.windowStart;
  return {
    remaining: Math.max(0, cap - consumed),
    resetAfterSec: Math.ceil((HOUR_MS - (now - windowStart)) / 1_000),
  };
}

// Prune buckets whose window expired more than 2 hours ago
export function pruneApiStore(): void {
  const cutoff = Date.now() - 2 * HOUR_MS;
  for (const [k, b] of store.entries()) {
    if (b.windowStart < cutoff) store.delete(k);
  }
}

setInterval(pruneApiStore, 30 * 60 * 1_000).unref?.();
