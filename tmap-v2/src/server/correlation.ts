// Request correlation — injects X-Correlation-ID / X-Request-ID into every
// request context via AsyncLocalStorage so any log line emitted during a
// request automatically includes them, even without passing an object around.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface CorrelationContext {
  correlationId: string;
  requestId:     string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Returns the current request's correlation context, or undefined outside a request. */
export function getContext(): CorrelationContext | undefined {
  return storage.getStore();
}

/** Express middleware: reads or generates correlation IDs, stores them in ALS. */
export function correlationMiddleware(): RequestHandler {
  return (req, res, next) => {
    const correlationId =
      String(req.headers['x-correlation-id'] ?? randomUUID()).slice(0, 64);
    const requestId = randomUUID();

    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('X-Request-ID', requestId);

    storage.run({ correlationId, requestId }, next);
  };
}
