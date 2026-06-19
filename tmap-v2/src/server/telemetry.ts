// Observability init — import this FIRST in index.ts, immediately after dotenv/config.
// Initializes Sentry (which sets up OTel as its transport) before Express loads,
// so HTTP auto-instrumentation patches take effect. All features are no-ops when
// the respective env vars are absent.

import * as Sentry from '@sentry/node';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

const _dsn = process.env.SENTRY_DSN;

if (_dsn) {
  Sentry.init({
    dsn: _dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release:
      process.env.SENTRY_RELEASE ??
      `coagentix-tmap-v2@${process.env.npm_package_version ?? '0.1.0'}`,
    tracesSampleRate:   parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE   ?? '0.1'),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.0'),
    integrations: [
      Sentry.httpIntegration({ breadcrumbs: true }),
      Sentry.expressIntegration(),
    ],
    // Do not create performance transactions for internal probe routes.
    ignoreTransactions: ['/v1/health', '/v1/metrics/prometheus'],
    beforeSend(event) {
      // Strip request body from error events to avoid leaking secrets.
      if (event.request?.data) delete event.request.data;
      return event;
    },
  });
}

// ── OTel tracer ───────────────────────────────────────────────────────────────
// When Sentry is configured it registers itself as the OTel global trace
// provider, so these spans are automatically captured there.  When neither
// Sentry nor an OTLP endpoint is configured the API returns a no-op tracer.

const _tracer = trace.getTracer('coagentix-tmap-v2', '0.1.0');

/** Wraps an async function in an OTel span, forwarding errors to Sentry. */
export async function withSpan<T>(
  name: string,
  fn:   (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return _tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      Sentry.captureException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

export function captureException(err: unknown, extras?: Record<string, unknown>): void {
  if (_dsn) Sentry.captureException(err, extras ? { extra: extras } : undefined);
}

export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (_dsn) {
    Sentry.addBreadcrumb({ message, data, timestamp: Date.now() / 1000 });
  }
}

export async function flushTelemetry(timeoutMs = 2000): Promise<void> {
  if (_dsn) await Sentry.flush(timeoutMs);
}

// Export the full Sentry namespace so callers can use Sentry.expressErrorHandler() etc.
// Re-exported as a value object rather than a namespace re-export for CJS/ESM compat.
export { Sentry as SentryNode };
