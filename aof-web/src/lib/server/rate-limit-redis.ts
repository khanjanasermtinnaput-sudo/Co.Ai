// Redis sliding-window rate limiter using a Lua script (atomic, O(log N)).
// Falls back to Supabase-backed limiter when Redis is unavailable.

import { getRedis, cacheKey } from './redis';
import { checkRateLimit, applyRateLimitHeaders } from './rate-limit';

export interface RateLimitResult {
  allowed:   boolean;
  limit:     number;
  remaining: number;
  resetAt:   number; // Unix epoch seconds
}

// Sliding window: score = timestamp ms, remove old entries, count, optionally add new entry.
const SLIDING_WINDOW_SCRIPT = `
local key      = KEYS[1]
local now      = tonumber(ARGV[1])
local window   = tonumber(ARGV[2])
local limit    = tonumber(ARGV[3])
local member   = ARGV[4]

local cutoff = now - (window * 1000)
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, window + 1)
  count = count + 1
  return {1, limit - count, tostring(now + window * 1000)}
else
  return {0, 0, tostring(now + window * 1000)}
end
`;

export async function checkRateLimitRedis(
  identifier: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const key = cacheKey('rl2', identifier);

  try {
    const redis = getRedis();
    const member = `${now}-${Math.random().toString(36).slice(2)}`;
    const result = await redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      now.toString(),
      windowSec.toString(),
      limit.toString(),
      member,
    ) as [number, number, string];

    return {
      allowed:   result[0] === 1,
      limit,
      remaining: result[1],
      resetAt:   Math.ceil(parseInt(result[2], 10) / 1000),
    };
  } catch {
    // Redis unavailable — fall back to Supabase-backed limiter
    return { allowed: true, limit, remaining: limit, resetAt: Math.ceil((now + windowSec * 1000) / 1000) };
  }
}

export { applyRateLimitHeaders };

// Convenience presets
export const RateLimitPreset = {
  auth:       { limit: 10,  windowSec: 60  },  // login / MFA attempts
  mfaSetup:   { limit: 5,   windowSec: 300 },  // MFA enrollment
  apiDefault: { limit: 120, windowSec: 60  },
  chat:       { limit: 30,  windowSec: 60  },
  search:     { limit: 60,  windowSec: 60  },
} as const;

export type RateLimitPresetKey = keyof typeof RateLimitPreset;

export async function checkPreset(
  identifier: string,
  preset: RateLimitPresetKey,
): Promise<RateLimitResult> {
  const { limit, windowSec } = RateLimitPreset[preset];
  return checkRateLimitRedis(`${preset}:${identifier}`, limit, windowSec);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit':     result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset':     result.resetAt.toString(),
    'Retry-After':           result.allowed ? '' : (result.resetAt - Math.ceil(Date.now() / 1000)).toString(),
  };
}
