/**
 * Login rate limiter — brute-force protection for /v1/auth/login.
 *
 * Strategy: 5 failed attempts within a 15-minute window → 15-minute lockout.
 * Key = lowercase(username) + "::" + client IP (both vectors covered).
 *
 * Storage: Redis (INCR + EXPIRE), so the lockout is enforced ACROSS instances —
 * unlike the previous in-memory Map which was per-instance and trivially bypassed
 * on serverless. When Redis is not configured, getRedis() returns an in-memory
 * mock (single-instance) for local dev.
 *
 * Availability note: the per-account lockout is best-effort — if Redis errors we
 * fail OPEN here (so a Redis blip can't lock every user out) and rely on the
 * fail-CLOSED global auth limiter (rate-limit-redis, 10/min/IP) as the hard
 * brute-force bound.
 */

import { getRedis } from './redis.js';
import { logger } from './logger.js';

const MAX_FAILURES = 5;
const WINDOW_SEC   = 15 * 60;        // 15-min sliding window for the failure counter
const LOCKOUT_SEC  = 15 * 60;        // 15-min lockout once MAX_FAILURES is hit
const LOCKOUT_MS   = LOCKOUT_SEC * 1_000;

function failKey(username: string, ip: string): string {
  return `cgntx:login:fail:${username.toLowerCase()}::${ip}`;
}
function lockKey(username: string, ip: string): string {
  return `cgntx:login:lock:${username.toLowerCase()}::${ip}`;
}

export interface RateLimitInfo {
  blocked:        boolean;
  remaining:      number;   // attempts left before lockout (0 when blocked)
  retryAfterSec:  number;   // > 0 only when blocked
}

/**
 * Call BEFORE verifying credentials.
 * Returns { blocked: true } when the account+IP is locked out.
 */
export async function checkLoginRate(username: string, ip: string): Promise<RateLimitInfo> {
  const redis = getRedis();
  const now = Date.now();
  try {
    const lock = await redis.get(lockKey(username, ip));
    if (lock && Number(lock) > now) {
      return { blocked: true, remaining: 0, retryAfterSec: Math.ceil((Number(lock) - now) / 1_000) };
    }
    const failed = Number((await redis.get(failKey(username, ip))) ?? 0);
    return { blocked: false, remaining: Math.max(0, MAX_FAILURES - failed), retryAfterSec: 0 };
  } catch (err) {
    // Fail OPEN: never lock out logins because of a Redis blip. The global auth
    // limiter still bounds total attempts per IP.
    logger.warn('login_rate_check_error', { error: (err as Error).message });
    return { blocked: false, remaining: MAX_FAILURES, retryAfterSec: 0 };
  }
}

/**
 * Call AFTER a failed credential check.
 * Returns the updated RateLimitInfo so the caller can attach it to the response.
 */
export async function recordFailure(username: string, ip: string): Promise<RateLimitInfo> {
  const redis = getRedis();
  const now = Date.now();
  try {
    const n = await redis.incr(failKey(username, ip));
    await redis.expire(failKey(username, ip), WINDOW_SEC);

    if (n >= MAX_FAILURES) {
      const until = now + LOCKOUT_MS;
      await redis.set(lockKey(username, ip), String(until), 'EX', LOCKOUT_SEC);
      return { blocked: true, remaining: 0, retryAfterSec: LOCKOUT_SEC };
    }
    return { blocked: false, remaining: Math.max(0, MAX_FAILURES - n), retryAfterSec: 0 };
  } catch (err) {
    logger.warn('login_rate_record_error', { error: (err as Error).message });
    return { blocked: false, remaining: MAX_FAILURES, retryAfterSec: 0 };
  }
}

/** Call AFTER a successful login — clears the counter + lock for this key. */
export async function recordSuccess(username: string, ip: string): Promise<void> {
  const redis = getRedis();
  try {
    await redis.del(failKey(username, ip), lockKey(username, ip));
  } catch (err) {
    logger.warn('login_rate_clear_error', { error: (err as Error).message });
  }
}
