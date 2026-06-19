// Next.js instrumentation hook — registers OTel and Sentry before the server starts.
// This file runs once per process, not per request.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // OpenTelemetry — configure before Sentry so Sentry can use it as transport.
  // @vercel/otel reads OTEL_EXPORTER_OTLP_ENDPOINT automatically; if unset,
  // no spans are exported (zero overhead).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { registerOTel } = await import('@vercel/otel');
      registerOTel({
        serviceName: 'coagentix-web',
      });
    } catch {
      // @vercel/otel not installed — skip OTel
    }
  }

  // Sentry — only initialize when DSN is present (safe no-op otherwise).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Called on the request-response cycle for uncaught errors (Next.js 14+)
export const onRequestError = async (
  err: unknown,
  _request: { path: string; method: string },
  _context: { routerKind: string; routePath: string },
) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(err);
  } catch {
    // @sentry/nextjs not installed
  }
};
