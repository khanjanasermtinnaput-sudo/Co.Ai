// Redis-backed sliding-window rate limiter (falls back to in-memory when Redis
// is unavailable so the server starts cleanly without a Redis dependency).
//
// Algorithm: sorted set per (namespace, IP) where each member is a unique
// request timestamp.  On each request:
//   1. ZREMRANGEBYSCORE removes events outside the window.
//   2. ZCARD counts remaining events.
//   3. If count < limit, ZADD adds the new event and sets TTL.
//   4. Otherwise return 429.

import type { RequestHandler } from 'express';
import { getRedis } from './redis.js';
import { logger } from './logger.js';
import { isProductionRuntime } from '../core/sandbox-policy.js';

// When a real Redis is configured but a call fails in production, we must NOT
// silently fall back to the per-instance in-memory store — that would let an
// attacker bypass the limit by spreading requests across instances. In that case
// we fail CLOSED (deny). In dev, or when only the mock is in use, degrade to the
// in-memory store so local development keeps working.
export function shouldFailClosedOnRedisError(env: Record<string, string | undefined> = process.env): boolean {
  const redisConfigured = Boolean(env.REDIS_URL || env.REDIS_HOST);
  return isProductionRuntime(env) && redisConfigured;
}

// In-memory fallback — one counter per (namespace:IP) key
interface InMemoryBucket {
  timestamps: number[];
  windowMs: number;
}
const inMemory = new Map<string, InMemoryBucket>();

// Prune buckets whose window has fully expired to prevent unbounded map growth.
// Runs every 5 minutes — lightweight since it only removes expired entries.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of inMemory) {
    b.timestamps = b.timestamps.filter((t) => t > now - b.windowMs);
    if (b.timestamps.length === 0) inMemory.delete(k);
  }
}, 5 * 60 * 1_000).unref?.();

function inMemoryCheck(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now    = Date.now();
  const bucket = inMemory.get(key) ?? { timestamps: [], windowMs };
  const cutoff = now - windowMs;

  // Prune expired entries for this bucket
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    return { allowed: false, remaining: 0, retryAfterMs: oldest + windowMs - now };
  }

  bucket.timestamps.push(now);
  inMemory.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.timestamps.length, retryAfterMs: 0 };
}

async function redisCheck(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const redis = getRedis();
  const now = Date.now();
  const cutoff = now - windowMs;

  try {
    // Remove events outside the window
    await redis.zremrangebyscore(key, '-inf', cutoff);
    // Count remaining events in window
    const count = await redis.zcard(key);

    if (count >= limit) {
      return { allowed: false, remaining: 0, retryAfterMs: windowMs };
    }

    // Add this request
    await redis.zadd(key, now, `${now}-${Math.random()}`);
    await redis.expire(key, Math.ceil(windowMs / 1000) + 1);

    return { allowed: true, remaining: limit - count - 1, retryAfterMs: 0 };
  } catch (err) {
    // Redis failure handling. If a real Redis is configured and we're in
    // production, fail CLOSED — falling back to the per-instance in-memory store
    // would let callers bypass the global limit across instances. In dev (or when
    // only the mock is in use) degrade gracefully to in-memory.
    logger.warn('rate_limit_redis_error', { error: (err as Error).message });
    if (shouldFailClosedOnRedisError()) {
      return { allowed: false, remaining: 0, retryAfterMs: windowMs };
    }
    return inMemoryCheck(key, limit, windowMs);
  }
}

/**
 * Express middleware factory for sliding-window rate limiting.
 *
 * @param limit      Max requests per window
 * @param windowSec  Window duration in seconds
 * @param namespace  Logical namespace (e.g. 'global', 'auth')
 */
export function rateLimitMiddleware(
  limit: number,
  windowSec: number,
  namespace: string,
): RequestHandler {
  const windowMs = windowSec * 1_000;

  return async (req, res, next) => {
    const ip = String(
      req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown',
    ).split(',')[0].trim();

    const key = `cgntx:rl:${namespace}:${ip}`;
    const { allowed, remaining, retryAfterMs } = await redisCheck(key, limit, windowMs);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
    res.setHeader('X-RateLimit-Window-Sec', windowSec);

    if (!allowed) {
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      res.status(429).json({
        error: 'Too many requests. Please slow down.',
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
      });
      return;
    }

    next();
  };
}
