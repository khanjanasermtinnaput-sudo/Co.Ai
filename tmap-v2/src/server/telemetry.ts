// Sentry telemetry — initialised only when SENTRY_DSN is set.
// Exports a SentryNode object; callers get no-op stubs when Sentry is absent.

import type { Request } from 'express';

// Minimal interface for what callers actually use from @sentry/node
interface SentryLike {
  init(opts: { dsn: string; tracesSampleRate?: number }): void;
  captureException(err: unknown): void;
  addBreadcrumb(crumb: { message: string; data?: Record<string, unknown>; level?: string }): void;
  expressErrorHandler(): (err: Error, req: Request, res: unknown, next: (e?: unknown) => void) => void;
}

const noop: SentryLike = {
  init: () => {},
  captureException: () => {},
  addBreadcrumb: () => {},
  expressErrorHandler: () => (_err, _req, _res, next) => next(),
};

let _sentry: SentryLike = noop;

async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const mod = await import('@sentry/node') as unknown as SentryLike;
    mod.init({ dsn, tracesSampleRate: 0.1 });
    _sentry = mod;
  } catch {
    // @sentry/node is an optional dep — proceed without it
  }
}

// Fire-and-forget; logger uses dynamic import so it is fine if this resolves
// slightly after the first log line.
initSentry().catch(() => {});

export const SentryNode: SentryLike = new Proxy(noop, {
  get(_target, prop: string) {
    return (_sentry as unknown as Record<string, unknown>)[prop] ?? (() => {});
  },
});
