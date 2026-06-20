// Redis optimization — pipeline batching, distributed locks, batch-loading with
// cache-aside, cache warming, and memory usage reporting.
// Works with a single Redis instance or Sentinel/Cluster via REDIS_URL.

import { getRedis, cacheKey, cacheGetOrSet } from './redis.js';
import { logger } from './logger.js';
import { randomUUID } from 'node:crypto';

// ── Pipeline batching ─────────────────────────────────────────────────────────

export async function pipelineGet(keys: string[]): Promise<(string | null)[]> {
  if (keys.length === 0) return [];
  const pipe = getRedis().pipeline();
  for (const k of keys) pipe.get(k);
  const results = await pipe.exec();
  return (results ?? []).map(([err, val]: [Error | null, unknown]) => (err ? null : (val as string | null)));
}

export async function pipelineSet(
  entries: Array<{ key: string; value: string; ttlSec?: number }>,
): Promise<void> {
  if (entries.length === 0) return;
  const pipe = getRedis().pipeline();
  for (const e of entries) {
    if (e.ttlSec) pipe.setex(e.key, e.ttlSec, e.value);
    else pipe.set(e.key, e.value);
  }
  await pipe.exec();
}

export async function pipelineDel(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const pipe = getRedis().pipeline();
  for (const k of keys) pipe.del(k);
  await pipe.exec();
}

// ── Distributed lock (Redlock-style, single-node) ────────────────────────────

const LOCK_PREFIX = 'cgntx:lock:';
const LOCK_DEFAULT_TTL_MS = 5_000;

export async function acquireLock(resource: string, ttlMs = LOCK_DEFAULT_TTL_MS): Promise<string | null> {
  const token = randomUUID();
  const key = `${LOCK_PREFIX}${resource}`;
  const ok = await getRedis().set(key, token, 'PX', ttlMs, 'NX');
  return ok === 'OK' ? token : null;
}

export async function releaseLock(resource: string, token: string): Promise<boolean> {
  const key = `${LOCK_PREFIX}${resource}`;
  const LUA = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
  const result = await getRedis().eval(LUA, 1, key, token) as number;
  return result === 1;
}

export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  ttlMs = LOCK_DEFAULT_TTL_MS,
): Promise<T> {
  const token = await acquireLock(resource, ttlMs);
  if (!token) throw new Error(`Failed to acquire lock on: ${resource}`);
  try { return await fn(); } finally { await releaseLock(resource, token); }
}

// ── Batch loader (DataLoader pattern with Redis cache-aside) ──────────────────

type BatchFetcher<K extends string, V> = (keys: K[]) => Promise<Map<K, V>>;

export function createBatchLoader<K extends string, V>(
  fetcher: BatchFetcher<K, V>,
  cacheKeyFn: (key: K) => string,
  ttlSec = 300,
) {
  return async (keys: K[]): Promise<(V | undefined)[]> => {
    if (keys.length === 0) return [];
    const ckKeys = keys.map(cacheKeyFn);
    const cached = await pipelineGet(ckKeys);

    const missing: { key: K; idx: number }[] = [];
    const results: (V | undefined)[] = new Array(keys.length).fill(undefined);
    for (let i = 0; i < keys.length; i++) {
      if (cached[i] !== null) {
        try { results[i] = JSON.parse(cached[i]!); } catch { /* skip */ }
      } else {
        missing.push({ key: keys[i], idx: i });
      }
    }

    if (missing.length > 0) {
      const fetched = await fetcher(missing.map((m) => m.key));
      const toCache: Array<{ key: string; value: string; ttlSec: number }> = [];
      for (const { key, idx } of missing) {
        const val = fetched.get(key);
        results[idx] = val;
        if (val !== undefined) toCache.push({ key: cacheKeyFn(key), value: JSON.stringify(val), ttlSec });
      }
      if (toCache.length) await pipelineSet(toCache);
    }
    return results;
  };
}

// ── Cache warming ─────────────────────────────────────────────────────────────

export interface WarmTarget {
  key: string;
  fetcher: () => Promise<unknown>;
  ttlSec: number;
}

export async function warmCache(targets: WarmTarget[]): Promise<{ warmed: number; errors: number }> {
  let warmed = 0;
  let errors = 0;
  await Promise.all(targets.map(async (t) => {
    try {
      const val = await t.fetcher();
      await getRedis().setex(t.key, t.ttlSec, JSON.stringify(val));
      warmed++;
    } catch (e) {
      errors++;
      logger.warn('cache_warm_failed', { key: t.key, error: (e as Error).message });
    }
  }));
  return { warmed, errors };
}

// ── Sorted-set counter (for analytics / rate windows) ────────────────────────

export async function incrTimeSeries(
  key: string,
  value: number,
  ts: number = Date.now(),
  ttlSec = 86_400,
): Promise<void> {
  const redis = getRedis();
  await redis.zadd(key, ts, `${ts}:${randomUUID()}`);
  await redis.incrby(`${key}:val`, value);
  await redis.expire(key, ttlSec);
  await redis.expire(`${key}:val`, ttlSec);
}

export async function countTimeSeries(key: string, from: number, to: number): Promise<number> {
  const members = await getRedis().zrangebyscore(key, from, to);
  return members.length;
}

// ── Memory usage reporting ────────────────────────────────────────────────────

export async function getRedisMemoryStats(): Promise<{
  usedMemoryMb: number;
  maxMemoryMb: number | null;
  usedMemoryPct: number | null;
  keyCount: number;
}> {
  const redis = getRedis();
  const [memInfo, dbInfo] = await Promise.all([redis.info('memory'), redis.info('keyspace')]);
  const usedBytes = Number(memInfo.match(/used_memory:(\d+)/)?.[1] ?? 0);
  const maxBytes  = Number(memInfo.match(/maxmemory:(\d+)/)?.[1]  ?? 0);
  const keyMatch  = dbInfo.match(/keys=(\d+)/);
  return {
    usedMemoryMb:   Math.round(usedBytes / 1024 / 1024 * 100) / 100,
    maxMemoryMb:    maxBytes > 0 ? Math.round(maxBytes / 1024 / 1024 * 100) / 100 : null,
    usedMemoryPct:  maxBytes > 0 ? Math.round(usedBytes / maxBytes * 1000) / 10 : null,
    keyCount:       keyMatch ? Number(keyMatch[1]) : 0,
  };
}

export { cacheGetOrSet, cacheKey };
