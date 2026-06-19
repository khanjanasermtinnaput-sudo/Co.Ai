// Prometheus metrics for tmap-v2.
// Exposes /v1/metrics/prometheus for Grafana / Prometheus scraping.
// All metrics use the `cgntx_` prefix to avoid collisions.

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

export const registry = new Registry();

// ── Default Node.js metrics (memory, CPU, GC, event loop lag) ────────────────
collectDefaultMetrics({ register: registry, prefix: 'cgntx_node_' });

// ── HTTP ──────────────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name:       'cgntx_http_requests_total',
  help:       'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers:  [registry],
});

export const httpRequestDurationMs = new Histogram({
  name:       'cgntx_http_request_duration_ms',
  help:       'HTTP request duration in milliseconds',
  labelNames: ['method', 'route'] as const,
  buckets:    [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers:  [registry],
});

// ── TMAP pipeline runs ────────────────────────────────────────────────────────

export const tmapRunsTotal = new Counter({
  name:       'cgntx_tmap_runs_total',
  help:       'Total TMAP pipeline runs',
  labelNames: ['mode', 'status'] as const,
  registers:  [registry],
});

export const tmapDurationMs = new Histogram({
  name:       'cgntx_tmap_duration_ms',
  help:       'TMAP pipeline end-to-end duration in milliseconds',
  labelNames: ['mode'] as const,
  buckets:    [500, 1000, 2500, 5000, 10000, 30000, 60000, 120000],
  registers:  [registry],
});

// ── Tokens + cost ─────────────────────────────────────────────────────────────

export const tokensTotal = new Counter({
  name:       'cgntx_tokens_total',
  help:       'Total tokens consumed across all agents',
  labelNames: ['provider', 'agent_role'] as const,
  registers:  [registry],
});

export const costUsdTotal = new Counter({
  name:       'cgntx_cost_usd_total',
  help:       'Total estimated cost in USD',
  labelNames: ['provider'] as const,
  registers:  [registry],
});

// ── Errors ────────────────────────────────────────────────────────────────────

export const errorsTotal = new Counter({
  name:       'cgntx_errors_total',
  help:       'Total errors by classification',
  labelNames: ['code', 'provider'] as const,
  registers:  [registry],
});

// ── Queue metrics ─────────────────────────────────────────────────────────────

export const queueJobsTotal = new Counter({
  name:       'cgntx_queue_jobs_total',
  help:       'Total BullMQ job outcomes',
  labelNames: ['queue', 'status'] as const,
  registers:  [registry],
});

export const queueDepth = new Gauge({
  name:       'cgntx_queue_depth',
  help:       'Current waiting jobs per queue',
  labelNames: ['queue'] as const,
  registers:  [registry],
});

// ── Dependency health ─────────────────────────────────────────────────────────

export const redisConnected = new Gauge({
  name:      'cgntx_redis_connected',
  help:      'Whether the Redis connection is active (1 = yes, 0 = no)',
  registers: [registry],
});

export const supabaseConnected = new Gauge({
  name:      'cgntx_supabase_connected',
  help:      'Whether Supabase is reachable (1 = yes, 0 = no)',
  registers: [registry],
});

// ── Embeddings ────────────────────────────────────────────────────────────────

export const embeddingDurationMs = new Histogram({
  name:       'cgntx_embedding_duration_ms',
  help:       'Embedding generation duration in milliseconds',
  labelNames: ['provider'] as const,
  buckets:    [10, 25, 50, 100, 250, 500, 1000, 2500],
  registers:  [registry],
});

// ── Express middleware ────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';

export function prometheusMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip the metrics endpoint itself to avoid noise
    if (req.path === '/v1/metrics/prometheus') { next(); return; }

    const start = performance.now();
    res.on('finish', () => {
      const route       = (req.route?.path as string | undefined) ?? req.path;
      const durationMs  = performance.now() - start;
      const statusCode  = String(res.statusCode);

      httpRequestsTotal.inc({ method: req.method, route, status_code: statusCode });
      httpRequestDurationMs.observe({ method: req.method, route }, durationMs);
    });
    next();
  };
}
