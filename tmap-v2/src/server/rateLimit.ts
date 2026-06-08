/**
 * In-memory login rate limiter — brute-force protection for /v1/auth/login.
 *
 * Strategy: 5 failed attempts within a 15-minute window → 15-minute lockout.
 * Key = lowercase(username) + "::" + client IP (both vectors covered).
 *
 * Note: on Vercel serverless each instance owns its own store, so limits are
 * per-instance.  For strict multi-instance enforcement swap the Map for
 * Redis INCR+EXPIRE (drop-in replacement — same function signatures).
 */

interface Bucket {
  failed:      number;   // consecutive failed attempts in this window
  windowEnd:   number;   // epoch ms when the current window expires
  lockedUntil: number;   // epoch ms when lockout expires  (0 = not locked)
}

const MAX_FAILURES  = 5;
const WINDOW_MS     = 15 * 60 * 1_000;   // 15 min sliding window
const LOCKOUT_MS    = 15 * 60 * 1_000;   // 15 min lockout after MAX_FAILURES

const store = new Map<string, Bucket>();

// ── helpers ───────────────────────────────────────────────────────────────────

function bucketKey(username: string, ip: string): string {
  return `${username.toLowerCase()}::${ip}`;
}

function fresh(now: number): Bucket {
  return { failed: 0, windowEnd: now + WINDOW_MS, lockedUntil: 0 };
}

// ── public API ────────────────────────────────────────────────────────────────

export interface RateLimitInfo {
  blocked:        boolean;
  remaining:      number;   // attempts left before lockout  (0 when blocked)
  retryAfterSec:  number;   // > 0 only when blocked
}

/**
 * Call BEFORE verifying credentials.
 * Returns { blocked: true } when the account+IP is locked out.
 */
export function checkLoginRate(username: string, ip: string): RateLimitInfo {
  const k   = bucketKey(username, ip);
  const now = Date.now();
  let   b   = store.get(k);

  // Active lockout?
  if (b && b.lockedUntil > now) {
    return {
      blocked:       true,
      remaining:     0,
      retryAfterSec: Math.ceil((b.lockedUntil - now) / 1_000),
    };
  }

  // Window expired → treat as fresh
  if (!b || b.windowEnd <= now) {
    b = fresh(now);
    store.set(k, b);
  }

  const remaining = MAX_FAILURES - b.failed;
  return { blocked: false, remaining, retryAfterSec: 0 };
}

/**
 * Call AFTER a failed credential check.
 * Returns the updated RateLimitInfo so the caller can attach it to the response.
 */
export function recordFailure(username: string, ip: string): RateLimitInfo {
  const k   = bucketKey(username, ip);
  const now = Date.now();
  let   b   = store.get(k) ?? fresh(now);

  // If window expired, start fresh (but still count this failure)
  if (b.windowEnd <= now) b = fresh(now);

  b.failed += 1;

  if (b.failed >= MAX_FAILURES) {
    b.lockedUntil = now + LOCKOUT_MS;
  }

  store.set(k, b);

  const retryAfterSec = b.lockedUntil > now
    ? Math.ceil((b.lockedUntil - now) / 1_000)
    : 0;

  return {
    blocked:       b.lockedUntil > now,
    remaining:     Math.max(0, MAX_FAILURES - b.failed),
    retryAfterSec,
  };
}

/**
 * Call AFTER a successful login — clears the counter for this key.
 */
export function recordSuccess(username: string, ip: string): void {
  store.delete(bucketKey(username, ip));
}

/**
 * Housekeeping: remove fully-expired buckets.
 * Call from a setInterval (e.g. every 30 min) to avoid unbounded growth.
 */
export function pruneExpired(): void {
  const now = Date.now();
  for (const [k, b] of store.entries()) {
    if (b.windowEnd <= now && b.lockedUntil <= now) store.delete(k);
  }
}

// Auto-prune every 30 minutes (lightweight — only runs while the instance is warm)
setInterval(pruneExpired, 30 * 60 * 1_000).unref?.();
