/** @type {import('next').NextConfig} */

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  // Allow OTLP telemetry + Sentry ingestion + AI providers + Cloudflare Turnstile
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://openrouter.ai https://generativelanguage.googleapis.com https://api.deepseek.com https://dashscope.aliyuncs.com https://api.groq.com https://api.tavily.com https://www.googleapis.com https://*.sentry.io https://o*.ingest.sentry.io https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
  // CSP violation reporting — browser POSTs to /api/csp-report
  "report-uri /api/csp-report",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy",        value: CSP },
  { key: "X-Frame-Options",                value: "DENY" },
  { key: "X-Content-Type-Options",         value: "nosniff" },
  { key: "X-XSS-Protection",               value: "1; mode=block" },
  { key: "Referrer-Policy",                value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",             value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security",      value: "max-age=31536000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy",     value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy",   value: "same-site" },
  { key: "Cross-Origin-Embedder-Policy",   value: "unsafe-none" },
];

const nextConfig = {
  reactStrictMode: true,

  // Required to let Next.js register the instrumentation.ts hook (OTel + Sentry).
  experimental: {
    instrumentationHook: true,
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },

  // The Coagentix frontend talks to the tmap-v2 backend (/v1/*). When
  // COAGENTIX_API_PROXY is set we proxy /v1 to it so the browser stays
  // same-origin (no CORS in production).
  async rewrites() {
    const base = process.env.COAGENTIX_API_PROXY ?? process.env.CGNTX_API_PROXY;
    if (!base) return [];
    return [{ source: "/v1/:path*", destination: `${base}/v1/:path*` }];
  },
};

// ── Sentry webpack integration (optional) ────────────────────────────────────
// Wrap nextConfig with Sentry only when NEXT_PUBLIC_SENTRY_DSN is set and the
// @sentry/nextjs package is installed. This keeps the build output identical
// for teams that don't use Sentry.
let finalConfig = nextConfig;

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  try {
    const { withSentryConfig } = await import('@sentry/nextjs');
    finalConfig = withSentryConfig(nextConfig, {
      // Suppress build-time Sentry CLI output unless running in CI.
      silent: !process.env.CI,

      // Sentry org + project for source-map uploads (set in CI env).
      org:     process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,

      // Upload source maps so stack traces in Sentry show original TS code.
      widenClientFileUpload: true,
      hideSourceMaps:        true,
      disableLogger:         true,
    });
  } catch {
    // @sentry/nextjs not installed — Sentry SDK will still capture errors at
    // runtime but source maps won't be uploaded to Sentry dashboard.
    console.warn('[CGNTX] NEXT_PUBLIC_SENTRY_DSN is set but @sentry/nextjs is not installed.');
  }
}

export default finalConfig;
