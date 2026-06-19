// Correlation-ID propagation via AsyncLocalStorage.
// The Express middleware reads X-Correlation-ID from incoming requests
// (or generates a new UUID), stores it in async-local context so every
// log line emitted during that request automatically includes it.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID }        from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface RequestContext {
  correlationId: string;
  requestId:     string;
  userId?:       string;
  path?:         string;
  method?:       string;
}

const _store = new AsyncLocalStorage<RequestContext>();

/** Returns the context for the currently-executing async task, if any. */
export function getContext(): RequestContext | undefined {
  return _store.getStore();
}

export function getCorrelationId(): string | undefined {
  return _store.getStore()?.correlationId;
}

export function getRequestId(): string | undefined {
  return _store.getStore()?.requestId;
}

/** Run `fn` with the given context bound to the async local store. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return _store.run(ctx, fn) as T;
}

/** Patch the current context with additional fields (e.g. userId after auth). */
export function patchContext(patch: Partial<RequestContext>): void {
  const ctx = _store.getStore();
  if (ctx) Object.assign(ctx, patch);
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * Reads or generates X-Correlation-ID, binds a RequestContext into
 * AsyncLocalStorage, and forwards both IDs as response headers.
 */
export function correlationMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
    const requestId = randomUUID();

    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('X-Request-ID',     requestId);

    const ctx: RequestContext = {
      correlationId,
      requestId,
      path:   req.path,
      method: req.method,
    };

    runWithContext(ctx, () => next());
  };
}
