// Redis client — cache layer, session store, pub/sub (server-only)
// Requires REDIS_URL or REDIS_TLS_URL (or REDIS_HOST/PORT/PASSWORD for local).
import Redis, { type RedisOptions } from 'ioredis';

// ── Connection factory ────────────────────────────────────────────────────────

function buildRedisOptions(): string | RedisOptions {
  const url = process.env.REDIS_TLS_URL ?? process.env.REDIS_URL;
  if (url) return url;
  return {
    host:     process.env.REDIS_HOST     ?? '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db:       parseInt(process.env.REDIS_DB   ?? '0',    10),
  };
}

function createRedis(label: string): Redis {
  const opts  = buildRedisOptions();
  const isTls = Boolean(process.env.REDIS_TLS_URL);
  const extra: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck:     true,
    lazyConnect:          false,
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
    reconnectOnError(err: Error) {
      return /READONLY|ETIMEDOUT|ECONNRESET/.test(err.message);
    },
    retryStrategy(times: number) {
      return Math.min(times * 150, 5000);
    },
  };

  const client = typeof opts === 'string'
    ? new Redis(opts, extra)
    : new Redis({ ...opts, ...extra });

  client.on('error',       (err: Error) => console.error(`[CGNTX][Redis:${label}] error:`, err.message));
  client.on('connect',     ()           => console.log(`[CGNTX][Redis:${label}] connected`));
  client.on('reconnecting',()           => console.log(`[CGNTX][Redis:${label}] reconnecting`));

  return client;
}

// ── Singletons ────────────────────────────────────────────────────────────────

let _main:       Redis | null = null;
let _subscriber: Redis | null = null;
let _publisher:  Redis | null = null;

export function getRedis(): Redis {
  if (!_main) _main = createRedis('main');
  return _main;
}

export function getSubscriber(): Redis {
  if (!_subscriber) _subscriber = createRedis('sub');
  return _subscriber;
}

export function getPublisher(): Redis {
  if (!_publisher) _publisher = createRedis('pub');
  return _publisher;
}

export async function isRedisAvailable(): Promise<boolean> {
  try {
    await getRedis().ping();
    return true;
  } catch {
    return false;
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

const DEFAULT_TTL_SEC = 300; // 5 min

export function cacheKey(...parts: string[]): string {
  return `cgntx:${parts.join(':')}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSec: number = DEFAULT_TTL_SEC
): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch (err) {
    console.error('[CGNTX][Redis] cacheSet failed:', (err as Error).message);
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await getRedis().del(...keys);
  } catch (err) {
    console.error('[CGNTX][Redis] cacheDel failed:', (err as Error).message);
  }
}

export async function cacheGetOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSec: number = DEFAULT_TTL_SEC
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const value = await fetcher();
  await cacheSet(key, value, ttlSec);
  return value;
}

export async function cacheInvalidatePattern(pattern: string): Promise<number> {
  const client = getRedis();
  let cursor = '0';
  let deleted = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length) {
      await client.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');
  return deleted;
}

// ── Session store ─────────────────────────────────────────────────────────────
// Stores arbitrary server-side session state keyed by a session ID.
// Sessions expire automatically via Redis TTL.

export interface SessionData {
  userId:    string;
  createdAt: number;
  [key: string]: unknown;
}

const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export function sessionKey(sessionId: string): string {
  return cacheKey('session', sessionId);
}

export async function sessionGet(sessionId: string): Promise<SessionData | null> {
  return cacheGet<SessionData>(sessionKey(sessionId));
}

export async function sessionSet(
  sessionId: string,
  data: SessionData,
  ttlSec: number = SESSION_TTL_SEC
): Promise<void> {
  await cacheSet(sessionKey(sessionId), data, ttlSec);
}

export async function sessionPatch(
  sessionId: string,
  patch: Partial<SessionData>
): Promise<SessionData | null> {
  const existing = await sessionGet(sessionId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await sessionSet(sessionId, updated);
  return updated;
}

export async function sessionDestroy(sessionId: string): Promise<void> {
  await cacheDel(sessionKey(sessionId));
}

export async function sessionTouch(sessionId: string, ttlSec: number = SESSION_TTL_SEC): Promise<void> {
  try {
    await getRedis().expire(sessionKey(sessionId), ttlSec);
  } catch {
    // non-fatal
  }
}

// ── Rate-limit counter (atomic increment) ─────────────────────────────────────

export async function rlIncr(key: string, windowSec: number): Promise<number> {
  const client = getRedis();
  const fullKey = cacheKey('rl', key);
  const count = await client.incr(fullKey);
  if (count === 1) await client.expire(fullKey, windowSec);
  return count;
}

// ── Pub/Sub helpers ───────────────────────────────────────────────────────────

export type PubSubHandler = (channel: string, message: string) => void;

export async function publish(channel: string, payload: unknown): Promise<void> {
  try {
    await getPublisher().publish(channel, JSON.stringify(payload));
  } catch (err) {
    console.error('[CGNTX][Redis] publish failed:', (err as Error).message);
  }
}

export async function subscribe(
  channel: string,
  handler: PubSubHandler
): Promise<() => Promise<void>> {
  const sub = getSubscriber();
  await sub.subscribe(channel);
  sub.on('message', handler);
  return async () => {
    sub.off('message', handler);
    await sub.unsubscribe(channel);
  };
}

export async function psubscribe(
  pattern: string,
  handler: PubSubHandler
): Promise<() => Promise<void>> {
  const sub = getSubscriber();
  await sub.psubscribe(pattern);
  sub.on('pmessage', (_pat: string, channel: string, message: string) => handler(channel, message));
  return async () => {
    await sub.punsubscribe(pattern);
  };
}

// ── Named pub/sub channels ────────────────────────────────────────────────────

export const PubSubChannels = {
  chat:   (sessionId: string) => `cgntx:chat:${sessionId}`,
  tmap:   (jobId: string)     => `cgntx:tmap:${jobId}`,
  system: ()                  => 'cgntx:system',
  embed:  (userId: string)    => `cgntx:embed:${userId}`,
} as const;
