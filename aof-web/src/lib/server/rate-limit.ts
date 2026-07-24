// ── Distributed API rate limiter ──────────────────────────────────────────────
// Supabase-backed sliding window counter. Works across multiple Vercel instances
// (unlike the in-memory Map in tmap-v2/rateLimit.ts which is per-instance only).
//
// Falls back to per-instance in-memory store when Supabase is not configured
// (local dev / demo mode).

import { getAdminSupabase, isAdminConfigured } from "./supabase-admin";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
}

interface WindowConfig {
  maxRequests: number;
  windowSec: number;
}

const PRESETS: Record<string, WindowConfig> = {
  chat:        { maxRequests: 30,  windowSec: 60 },     // 30 req/min per user
  search:      { maxRequests: 60,  windowSec: 60 },     // 60 req/min per user
  api:         { maxRequests: 120, windowSec: 60 },     // 120 req/min generic
  guest_daily: { maxRequests: 10,  windowSec: 86400 },  // 10 msg/day for anonymous
  // Fallback only — every real call scales this via maxRequestsOverride from
  // plans.ts's PlanLimits.dailyImages (see /api/chat's image-quota gate).
  image_daily: { maxRequests: 1,   windowSec: 86400 },
};

// ── In-memory fallback (single-instance only) ─────────────────────────────────
const memStore = new Map<string, { count: number; windowEnd: number }>();
const MEM_STORE_PRUNE_THRESHOLD = 10_000;

function pruneMemStore(): void {
  const now = Date.now();
  for (const [key, entry] of memStore) {
    if (entry.windowEnd <= now) memStore.delete(key);
  }
}

function memCheck(key: string, cfg: WindowConfig): RateLimitResult {
  const now = Date.now();
  if (memStore.size > MEM_STORE_PRUNE_THRESHOLD) pruneMemStore();
  let entry = memStore.get(key);
  if (!entry || entry.windowEnd <= now) {
    entry = { count: 0, windowEnd: now + cfg.windowSec * 1000 };
  }
  entry.count += 1;
  memStore.set(key, entry);
  const allowed = entry.count <= cfg.maxRequests;
  const remaining = Math.max(0, cfg.maxRequests - entry.count);
  const retryAfterSec = allowed ? 0 : Math.ceil((entry.windowEnd - now) / 1000);
  return { allowed, remaining, retryAfterSec, limit: cfg.maxRequests };
}

// ── Supabase sliding-window check ─────────────────────────────────────────────
async function supabaseCheck(key: string, cfg: WindowConfig): Promise<RateLimitResult> {
  const supabase = getAdminSupabase();
  const now = new Date();
  // Align to the start of the current window (floor to windowSec boundaries)
  const windowMs = cfg.windowSec * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();

  // Upsert: increment the counter atomically via RPC (COALESCE + returning)
  // We use a raw query via the rest API for the atomic increment.
  const { data, error } = await supabase.rpc("increment_rate_limit", {
    p_key: key,
    p_window_start: windowStart,
    p_max: cfg.maxRequests,
  });

  if (error) {
    // RPC not available yet — fall back to in-memory
    return memCheck(key, cfg);
  }

  const count = (data as number) ?? 1;
  const allowed = count <= cfg.maxRequests;
  const remaining = Math.max(0, cfg.maxRequests - count);
  const windowEnd = new Date(Math.floor(now.getTime() / windowMs) * windowMs + windowMs);
  const retryAfterSec = allowed ? 0 : Math.ceil((windowEnd.getTime() - now.getTime()) / 1000);
  return { allowed, remaining, retryAfterSec, limit: cfg.maxRequests };
}

/**
 * Check and increment the rate limit counter for a given user + bucket.
 *
 * @param userId - Supabase user ID (or IP string for unauthenticated)
 * @param bucket - one of "chat" | "search" | "api"
 * @param maxRequestsOverride - replaces the preset's request cap (same window),
 *   used to scale the "chat" bucket by plan tier (spec §13 Priority Queue) and
 *   the "image_daily" bucket by PlanLimits.dailyImages. 0 is a valid override
 *   (e.g. a tier with no image allowance) and must actually deny, not fall
 *   back to the preset — hence the explicit `undefined` check rather than a
 *   truthiness check.
 */
export async function checkRateLimit(
  userId: string,
  bucket: keyof typeof PRESETS = "api",
  maxRequestsOverride?: number,
): Promise<RateLimitResult> {
  const preset = PRESETS[bucket] ?? PRESETS.api;
  const cfg: WindowConfig =
    maxRequestsOverride !== undefined && maxRequestsOverride >= 0
      ? { ...preset, maxRequests: maxRequestsOverride }
      : preset;
  const key = `${bucket}::${userId}`;

  if (isAdminConfigured()) {
    return supabaseCheck(key, cfg);
  }
  return memCheck(key, cfg);
}

/** Attach rate-limit headers to a response object (mutates headers). */
export function applyRateLimitHeaders(
  headers: Headers,
  result: RateLimitResult,
): void {
  headers.set("X-RateLimit-Limit", String(result.limit));
  headers.set("X-RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    headers.set("Retry-After", String(result.retryAfterSec));
  }
}
