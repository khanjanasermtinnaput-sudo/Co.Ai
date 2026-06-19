// OTel span helpers for Next.js API routes.
// Spans are exported to OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is configured
// (set up by @vercel/otel in instrumentation.ts); otherwise returns no-op spans.

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import * as Sentry from '@sentry/nextjs';

const _tracer = trace.getTracer('coagentix-web', '0.1.0');

/**
 * Wraps an async function in an OTel span. Automatically records exceptions
 * and sets span status. Forwards errors to Sentry when configured.
 */
export async function withSpan<T>(
  name:        string,
  fn:          (span: Span) => Promise<T>,
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
      if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
        Sentry.captureException(err);
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

export function captureException(err: unknown, extras?: Record<string, unknown>): void {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(err, extras ? { extra: extras } : undefined);
  }
}

export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.addBreadcrumb({ message, data, timestamp: Date.now() / 1000 });
  }
}
