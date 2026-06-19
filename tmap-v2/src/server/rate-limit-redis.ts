// Redis sliding-window rate limiter for tmap-v2 (ESM).
// Same Lua script as aof-web/src/lib/server/rate-limit-redis.ts.

import { getRedis, cacheKey } from './redis.js';

export interface RateLimitResult {
  allowed:   boolean;
  limit:     number;
  remaining: number;
  resetAt:   number; // Unix epoch seconds
}

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
    return { allowed: true, limit, remaining: limit, resetAt: Math.ceil((now + windowSec * 1000) / 1000) };
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit':     result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset':     result.resetAt.toString(),
  };
}

// Express middleware: rate-limit by IP per preset
export function rateLimitMiddleware(
  limit: number,
  windowSec: number,
  keyPrefix: string,
): (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void {
  return async (req, res, next) => {
    const ip = (req.headers['cf-connecting-ip'] as string)
            ?? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            ?? req.ip
            ?? 'unknown';

    const result = await checkRateLimitRedis(`${keyPrefix}:${ip}`, limit, windowSec);
    const headers = rateLimitHeaders(result);

    for (const [k, v] of Object.entries(headers)) {
      if (v) res.setHeader(k, v);
    }

    if (!result.allowed) {
      res.status(429).json({
        error: 'Too Many Requests',
        retryAfter: result.resetAt - Math.ceil(Date.now() / 1000),
      });
      return;
    }
    next();
  };
}
