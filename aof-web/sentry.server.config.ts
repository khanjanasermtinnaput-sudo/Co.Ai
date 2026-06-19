// Sentry Node.js server configuration.
// This file is imported by instrumentation.ts when NEXT_RUNTIME === 'nodejs'.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release:     process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

    // Strip request bodies from error events so API keys / chat content are not
    // accidentally leaked to Sentry's servers.
    beforeSend(event) {
      if (event.request?.data) delete event.request.data;
      return event;
    },
  });
}
