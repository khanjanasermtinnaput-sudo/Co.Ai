// Sentry browser/client configuration.
// This file is loaded by the Sentry webpack plugin on the client bundle.
// It runs inside the user's browser.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release:     process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // Capture 10 % of sessions for performance monitoring — adjust in production.
    tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

    // Replay 10% of all sessions, 100% of sessions with an error.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.replayIntegration({
        // Mask all text and input values in replays for privacy.
        maskAllText:   true,
        blockAllMedia: true,
      }),
    ],

    beforeSend(event) {
      // Do not send events when running locally to avoid polluting Sentry with dev noise.
      if (process.env.NODE_ENV === 'development') return null;
      return event;
    },
  });
}
