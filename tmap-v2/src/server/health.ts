// Dependency health check — aggregates liveness of Supabase, Redis, and the
// BullMQ queue into a single report object for the /v1/health endpoint.

import { logger } from './logger.js';

export type HealthStatus = 'ok' | 'degraded' | 'fail';

export interface DepHealth {
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: HealthStatus;
  uptime: number;
  ts: string;
  deps: {
    supabase: DepHealth;
    redis: DepHealth;
    queue: DepHealth;
  };
}

const startedAt = Date.now();

async function checkSupabase(): Promise<DepHealth> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { status: 'ok', error: 'Supabase not configured (using file fallback)' };

  const t0 = Date.now();
  try {
    const resp = await fetch(`${url}/rest/v1/users?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Date.now() - t0;
    if (!resp.ok) return { status: 'degraded', latencyMs, error: `HTTP ${resp.status}` };
    return { status: 'ok', latencyMs };
  } catch (e) {
    return { status: 'fail', latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}

async function checkRedis(): Promise<DepHealth> {
  const t0 = Date.now();
  try {
    const { getRedis } = await import('./redis.js');
    const redis = getRedis();
    // MockRedis.status is 'ready', real ioredis exposes .status too
    const status = redis.status;
    if (status && status !== 'ready') {
      return { status: 'degraded', latencyMs: Date.now() - t0, error: `Redis status: ${status}` };
    }
    // Ping via a cheap DBSIZE call
    await redis.dbsize();
    return { status: 'ok', latencyMs: Date.now() - t0 };
  } catch (e) {
    return { status: 'fail', latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}

async function checkQueue(): Promise<DepHealth> {
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    return { status: 'ok', error: 'Queue not configured (Redis required)' };
  }
  const t0 = Date.now();
  try {
    const { getQueueStats } = await import('./queue.js');
    const stats = await getQueueStats();
    return { status: 'ok', latencyMs: Date.now() - t0, ...stats };
  } catch (e) {
    return { status: 'fail', latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}

export async function buildHealthReport(): Promise<HealthReport> {
  const [supabase, redis, queue] = await Promise.all([
    checkSupabase().catch((e) => ({ status: 'fail' as HealthStatus, error: (e as Error).message })),
    checkRedis().catch((e) => ({ status: 'fail' as HealthStatus, error: (e as Error).message })),
    checkQueue().catch((e) => ({ status: 'fail' as HealthStatus, error: (e as Error).message })),
  ]);

  // Overall status: fail if any dep fails; degraded if any dep is degraded
  let overall: HealthStatus = 'ok';
  for (const dep of [supabase, redis, queue]) {
    if (dep.status === 'fail')     { overall = 'fail';     break; }
    if (dep.status === 'degraded') { overall = 'degraded'; }
  }

  const report: HealthReport = {
    status: overall,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    ts:     new Date().toISOString(),
    deps:   { supabase, redis, queue },
  };

  if (overall !== 'ok') {
    logger.warn('health_degraded', { status: overall, deps: report.deps });
  }

  return report;
}
