// Comprehensive dependency health checker for tmap-v2.
// Called by the /v1/health endpoint. Each check is time-boxed so a slow
// dependency cannot delay the response indefinitely.

import { getRedis } from './redis.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface DependencyCheck {
  status:          CheckStatus;
  responseTimeMs?: number;
  error?:          string;
  detail?:         Record<string, unknown>;
}

export interface HealthReport {
  status:      CheckStatus;
  version:     string;
  serviceId:   string;
  description: string;
  uptimeSec:   number;
  timestamp:   string;
  checks:      Record<string, DependencyCheck>;
}

// ── Individual checks ─────────────────────────────────────────────────────────

async function timedCheck<T>(
  fn: () => Promise<T>,
  timeoutMs = 3000,
): Promise<{ result: T; ms: number } | { error: string; ms: number }> {
  const start = performance.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ]);
    return { result, ms: performance.now() - start };
  } catch (err) {
    return { error: (err as Error).message, ms: performance.now() - start };
  }
}

async function checkRedis(): Promise<DependencyCheck> {
  const outcome = await timedCheck(async () => {
    const redis  = getRedis();
    const result = await redis.ping();
    return result;
  });

  if ('error' in outcome) {
    return { status: 'fail', responseTimeMs: Math.round(outcome.ms), error: outcome.error };
  }
  const ms = Math.round(outcome.ms);
  return {
    status:          ms < 200 ? 'pass' : 'warn',
    responseTimeMs:  ms,
    detail:          { pingResponse: outcome.result },
  };
}

async function checkSupabase(): Promise<DependencyCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return { status: 'warn', error: 'Supabase not configured' };
  }

  const outcome = await timedCheck(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await sb.from('conversation_turns').select('id').limit(1);
    if (error) throw new Error(error.message);
    return true;
  });

  if ('error' in outcome) {
    return { status: 'fail', responseTimeMs: Math.round(outcome.ms), error: outcome.error };
  }
  return { status: 'pass', responseTimeMs: Math.round(outcome.ms) };
}

async function checkQueues(): Promise<DependencyCheck> {
  const url  = process.env.REDIS_TLS_URL ?? process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  if (!url && !host) {
    return { status: 'warn', error: 'Redis not configured — queues disabled' };
  }

  const outcome = await timedCheck(async () => {
    const { QUEUE_NAMES, makeQueue } = await import('./queue.js');
    type QueueDepths = Record<string, { waiting: number; active: number; failed: number }>;
    const depths: QueueDepths = {};

    await Promise.all(
      Object.values(QUEUE_NAMES).map(async (name) => {
        const q = makeQueue(name);
        try {
          const [waiting, active, failed] = await Promise.all([
            q.getWaitingCount(),
            q.getActiveCount(),
            q.getFailedCount(),
          ]);
          depths[name] = { waiting, active, failed };
        } finally {
          await q.close();
        }
      })
    );
    return depths;
  });

  if ('error' in outcome) {
    return { status: 'warn', responseTimeMs: Math.round(outcome.ms), error: outcome.error };
  }
  return { status: 'pass', responseTimeMs: Math.round(outcome.ms), detail: { queues: outcome.result } };
}

// ── Aggregate health report ───────────────────────────────────────────────────

const _startedAt = Date.now();

export async function buildHealthReport(): Promise<HealthReport> {
  const [redisCheck, supabaseCheck, queueCheck] = await Promise.all([
    checkRedis(),
    checkSupabase(),
    checkQueues(),
  ]);

  const checks: Record<string, DependencyCheck> = {
    'redis:ping':     redisCheck,
    'supabase:query': supabaseCheck,
    'bullmq:queues':  queueCheck,
  };

  const statuses = Object.values(checks).map((c) => c.status);
  const overallStatus: CheckStatus =
    statuses.includes('fail') ? 'fail' :
    statuses.includes('warn') ? 'warn' : 'pass';

  return {
    status:      overallStatus,
    version:     '1',
    serviceId:   'coagentix-tmap-v2',
    description: 'Coagentix TMAP v2 API — multi-agent pipeline server',
    uptimeSec:   Math.floor((Date.now() - _startedAt) / 1000),
    timestamp:   new Date().toISOString(),
    checks,
  };
}
