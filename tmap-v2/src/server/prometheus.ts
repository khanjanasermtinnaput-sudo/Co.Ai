// Prometheus metrics — uses prom-client when available; exports a no-op stub
// registry otherwise so the rest of the server never crashes on import.

import type { RequestHandler } from 'express';

export interface Registry {
  metrics(): Promise<string>;
  contentType: string;
}

interface Counter {
  inc(labels?: Record<string, string>): void;
}

interface Histogram {
  observe(labels: Record<string, string>, value: number): void;
  startTimer(labels?: Record<string, string>): (labels?: Record<string, string>) => void;
}

interface Gauge {
  set(value: number): void;
  inc(): void;
  dec(): void;
}

// No-op implementations used when prom-client isn't installed
const noopCounter: Counter = { inc: () => {} };
const noopGauge:   Gauge   = { set: () => {}, inc: () => {}, dec: () => {} };
const noopHistogram: Histogram = {
  observe: () => {},
  startTimer: () => (_labels?: Record<string, string>) => {},
};

const noopRegistry: Registry = {
  metrics: async () => '# prom-client not installed\n',
  contentType: 'text/plain; version=0.0.4',
};

// Try to initialise prom-client; fall back to no-ops on failure.
let _registry: Registry = noopRegistry;
let httpRequestDuration: Histogram = noopHistogram;
let activeConnections:   Gauge     = noopGauge;
let requestsTotal:       Counter   = noopCounter;
let errorsTotal:         Counter   = noopCounter;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const prom = require('prom-client') as typeof import('prom-client');
  prom.collectDefaultMetrics({ prefix: 'coagentix_' });

  _registry = prom.register;

  httpRequestDuration = new prom.Histogram({
    name:       'coagentix_http_request_duration_ms',
    help:       'HTTP request duration in milliseconds',
    labelNames: ['method', 'route', 'status'],
    buckets:    [10, 50, 100, 250, 500, 1000, 2500, 5000],
  });

  activeConnections = new prom.Gauge({
    name: 'coagentix_active_connections',
    help: 'Number of currently active HTTP connections',
  });

  requestsTotal = new prom.Counter({
    name:       'coagentix_requests_total',
    help:       'Total number of HTTP requests',
    labelNames: ['method', 'route'],
  });

  errorsTotal = new prom.Counter({
    name:       'coagentix_errors_total',
    help:       'Total number of HTTP errors',
    labelNames: ['status'],
  });
} catch {
  // prom-client is optional — metrics endpoint returns a stub message
}

export const registry = _registry;

/** Express middleware: measures request duration and active connection count. */
export function prometheusMiddleware(): RequestHandler {
  return (req, res, next) => {
    const end = httpRequestDuration.startTimer({ method: req.method, route: req.path });
    activeConnections.inc();
    requestsTotal.inc({ method: req.method, route: req.path });

    res.on('finish', () => {
      end({ status: String(res.statusCode) });
      activeConnections.dec();
      if (res.statusCode >= 400) {
        errorsTotal.inc({ status: String(res.statusCode) });
      }
    });

    next();
  };
}
