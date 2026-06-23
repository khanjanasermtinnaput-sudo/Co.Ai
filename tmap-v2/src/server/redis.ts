// Redis connection — creates an ioredis client when REDIS_URL / REDIS_HOST is
// configured; returns a no-op mock client otherwise so the rest of the server
// can call Redis APIs without crashing when Redis is not available.

import { createRequire } from 'node:module';
import { logger } from './logger.js';

// createRequire lets ESM modules load CommonJS packages like ioredis.
const _require = createRequire(import.meta.url);

// Complete interface covering every Redis method used in this codebase.
export interface RedisClient {
  // String ops
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  set(key: string, value: string, mode: 'PX' | 'EX', ttl: number, flag?: 'NX'): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, ttl: number): Promise<number>;
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
  // Sorted-set ops
  zadd(key: string, score: number, member: string): Promise<number>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  zcard(key: string): Promise<number>;
  // List ops (used by analytics when Redis is available)
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<string>;
  // Set ops
  sadd(key: string, ...members: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  // Hash ops
  hgetall(key: string): Promise<Record<string, string> | null>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hincrbyfloat(key: string, field: string, increment: number): Promise<string>;
  // Server
  info(section: string): Promise<string>;
  dbsize(): Promise<number>;
  pipeline(): {
    get(key: string): unknown;
    set(key: string, value: string): unknown;
    setex(key: string, ttl: number, value: string): unknown;
    del(key: string): unknown;
    exec(): Promise<Array<[Error | null, unknown]>>;
  };
  on(event: string, handler: (...args: unknown[]) => void): void;
  quit(): Promise<void>;
  status?: string;
}

// In-memory mock (single-instance, no TTL enforcement — development / test only)
class MockRedis implements RedisClient {
  private store  = new Map<string, string>();
  private zsets  = new Map<string, Map<string, number>>();
  private lists  = new Map<string, string[]>();
  private sets   = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();

  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string, ..._rest: unknown[]) { this.store.set(key, value); return 'OK'; }
  async setex(key: string, _ttl: number, value: string) { this.store.set(key, value); return 'OK'; }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  async incr(key: string) {
    const v = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(v));
    return v;
  }
  async incrby(key: string, n: number) {
    const v = Number(this.store.get(key) ?? 0) + n;
    this.store.set(key, String(v));
    return v;
  }
  async expire(_k: string, _t: number) { return 1; }
  async eval(script: string, _numkeys: number, ...args: string[]) {
    // Handle the distributed lock-release pattern (only Lua pattern used in this codebase)
    if (script.includes('redis.call("get"') && script.includes('redis.call("del"')) {
      const key = args[0], expected = args[1];
      if (this.store.get(key) === expected) { this.store.delete(key); return 1; }
      return 0;
    }
    return 0;
  }

  // Sorted sets
  async zadd(key: string, score: number, member: string) {
    const z = this.zsets.get(key) ?? new Map<string, number>();
    z.set(member, score); this.zsets.set(key, z); return 1;
  }
  async zrangebyscore(key: string, min: number | string, max: number | string) {
    const z = this.zsets.get(key);
    if (!z) return [];
    const lo = Number(min), hi = Number(max);
    return [...z.entries()].filter(([, s]) => s >= lo && s <= hi).map(([m]) => m);
  }
  async zremrangebyscore(key: string, min: number | string, max: number | string) {
    const z = this.zsets.get(key); if (!z) return 0;
    const lo = Number(min), hi = Number(max);
    let removed = 0;
    for (const [m, s] of z.entries()) { if (s >= lo && s <= hi) { z.delete(m); removed++; } }
    return removed;
  }
  async zcard(key: string) { return this.zsets.get(key)?.size ?? 0; }

  // Lists
  async lpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];
    list.unshift(...values.slice().reverse());
    this.lists.set(key, list);
    return list.length;
  }
  async ltrim(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, list.slice(start, stop + 1));
    return 'OK';
  }

  // Sets
  async sadd(key: string, ...members: string[]) {
    const s = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) { if (!s.has(m)) { s.add(m); added++; } }
    this.sets.set(key, s);
    return added;
  }
  async scard(key: string) { return this.sets.get(key)?.size ?? 0; }

  // Hashes
  async hgetall(key: string) {
    const h = this.hashes.get(key);
    if (!h) return null;
    return Object.fromEntries(h.entries());
  }
  async hincrby(key: string, field: string, n: number) {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    const v = Number(h.get(field) ?? 0) + n;
    h.set(field, String(v));
    this.hashes.set(key, h);
    return v;
  }
  async hincrbyfloat(key: string, field: string, n: number) {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    const v = Number(h.get(field) ?? 0) + n;
    const str = String(Math.round(v * 1e9) / 1e9);
    h.set(field, str);
    this.hashes.set(key, h);
    return str;
  }

  // Server
  async info(_section: string) { return 'used_memory:1024\nmaxmemory:0\n'; }
  async dbsize() { return this.store.size; }

  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const pipe: ReturnType<RedisClient['pipeline']> = {
      get:   (key)          => { ops.push(() => this.get(key)); return pipe; },
      set:   (key, val)     => { ops.push(() => this.set(key, val)); return pipe; },
      setex: (key, ttl, v)  => { ops.push(() => this.setex(key, ttl, v)); return pipe; },
      del:   (key)          => { ops.push(() => this.del(key)); return pipe; },
      exec:  async () => {
        const results: Array<[Error | null, unknown]> = [];
        for (const op of ops) {
          try  { results.push([null, await op()]); }
          catch (e) { results.push([e as Error, null]); }
        }
        return results;
      },
    };
    return pipe;
  }
  on(_event: string, _handler: (...args: unknown[]) => void) {}
  async quit() {}
  status = 'ready';
}

let _client: RedisClient | null = null;
let _usingMock = false;

export function getRedis(): RedisClient {
  if (_client) return _client;

  const url  = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;

  if (url || host) {
    try {
      // Use createRequire so ioredis (CommonJS) works in this ESM module.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ioredis = _require('ioredis') as any;
      const IORedisCtor = ioredis.default ?? ioredis;
      const opts = url ? url : { host: host!, port: Number(process.env.REDIS_PORT ?? 6379) };
      const real = new IORedisCtor(opts) as RedisClient;
      real.on('error', (...args: unknown[]) => logger.warn('redis_error', { error: (args[0] as Error).message }));
      _client = real;
      logger.info('redis_connected', { url: url ?? host });
      return _client;
    } catch {
      logger.warn('redis_unavailable', { reason: 'ioredis not installed or connection failed — using in-memory fallback' });
    }
  }

  if (!_usingMock) {
    _usingMock = true;
    logger.info('redis_mock', { reason: 'REDIS_URL not set — using in-memory Redis mock (single-instance only)' });
  }
  _client = new MockRedis();
  return _client;
}

/** True when the operator has configured Redis (REDIS_URL or REDIS_HOST present).
 *  Synchronous env check — used by the production startup gate so a missing
 *  configuration is caught before the server begins serving traffic. */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

/** Returns true when a real Redis connection is available (not the in-memory mock). */
export async function isRedisAvailable(): Promise<boolean> {
  if (_usingMock || !_client) {
    const url  = process.env.REDIS_URL;
    const host = process.env.REDIS_HOST;
    if (!url && !host) return false;
  }
  try {
    const client = getRedis();
    if (_usingMock) return false;
    await client.dbsize();
    return true;
  } catch {
    return false;
  }
}

export function cacheKey(...parts: string[]): string {
  return `cgntx:${parts.join(':')}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const cached = await getRedis().get(key);
  if (cached === null) return null;
  try { return JSON.parse(cached) as T; } catch { return null; }
}

export async function cacheSet<T>(key: string, value: T, ttlSec: number): Promise<void> {
  await getRedis().setex(key, ttlSec, JSON.stringify(value));
}

/** Delete one or more cache keys. */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await getRedis().del(...keys);
}

export async function cacheGetOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSec: number,
): Promise<T> {
  const cached = await getRedis().get(key);
  if (cached !== null) {
    try { return JSON.parse(cached) as T; } catch { /* fall through */ }
  }
  const value = await fetcher();
  await getRedis().setex(key, ttlSec, JSON.stringify(value));
  return value;
}
