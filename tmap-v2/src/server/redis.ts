// Redis client for tmap-v2 — cache, session store, pub/sub, BullMQ connection
import Redis from 'ioredis';

function buildOptions(): ConstructorParameters<typeof Redis>[0] {
  const url = process.env.REDIS_TLS_URL ?? process.env.REDIS_URL;
  if (url) return url as string;
  return {
    host:     process.env.REDIS_HOST     ?? '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
    db:       parseInt(process.env.REDIS_DB   ?? '0',    10),
  };
}

function createRedis(label: string): Redis {
  const opts   = buildOptions();
  const isTls  = Boolean(process.env.REDIS_TLS_URL);

  const client = new Redis(
    typeof opts === 'string' ? opts : opts,
    {
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
    }
  );

  client.on('error',        (err: Error) => console.error(`[CGNTX][Redis:${label}]`, err.message));
  client.on('connect',      ()           => console.log(`[CGNTX][Redis:${label}] connected`));
  client.on('reconnecting', ()           => console.log(`[CGNTX][Redis:${label}] reconnecting`));

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

/** Returns a dedicated IORedis instance for BullMQ (maxRetriesPerRequest must be null). */
export function createBullRedis(): Redis {
  return createRedis(`bull-${Date.now()}`);
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
  ttlSec = 300
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
  ttlSec = 300
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fetcher();
  await cacheSet(key, value, ttlSec);
  return value;
}

// ── Pub/Sub helpers ───────────────────────────────────────────────────────────

export async function publish(channel: string, payload: unknown): Promise<void> {
  try {
    await getPublisher().publish(channel, JSON.stringify(payload));
  } catch (err) {
    console.error('[CGNTX][Redis] publish failed:', (err as Error).message);
  }
}

export const PubSubChannels = {
  chat:   (sessionId: string) => `cgntx:chat:${sessionId}`,
  tmap:   (jobId: string)     => `cgntx:tmap:${jobId}`,
  system: ()                  => 'cgntx:system',
  embed:  (userId: string)    => `cgntx:embed:${userId}`,
} as const;
