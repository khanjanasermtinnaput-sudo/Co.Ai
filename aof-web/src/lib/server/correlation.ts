// Correlation ID helpers for Next.js API routes and middleware.
// Unlike the Express version (tmap-v2/src/server/correlation.ts) this does NOT
// use AsyncLocalStorage because Next.js Middleware runs in the Edge runtime
// which doesn't support it. Each API route reads the ID from the request header.

/**
 * Reads X-Correlation-ID from a Request object (works in both Node.js and Edge).
 * Returns the value as-is if present, otherwise generates a new UUID v4.
 */
export function getCorrelationId(req: Request): string {
  return req.headers.get('x-correlation-id') ?? crypto.randomUUID();
}

/**
 * Returns a Headers object with X-Correlation-ID and X-Request-ID set, ready
 * to be spread into a Response constructor.
 */
export function correlationHeaders(correlationId: string): Record<string, string> {
  return {
    'X-Correlation-ID': correlationId,
    'X-Request-ID':     crypto.randomUUID(),
  };
}
