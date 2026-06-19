// Sentry Edge runtime configuration.
// This file is imported by instrumentation.ts when NEXT_RUNTIME === 'edge'.
// The Edge runtime has restricted APIs — only a subset of Sentry features work.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release:     process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  });
}
