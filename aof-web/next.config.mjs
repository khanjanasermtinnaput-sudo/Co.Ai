/** @type {import('next').NextConfig} */

// Monaco (CoCode's editor) is loaded at runtime from the jsdelivr CDN by
// @monaco-editor/react's default loader — its script tags, worker scripts,
// stylesheet, and codicon font all come from this origin, so it must be
// allow-listed alongside 'self' or the editor silently hangs on "Loading...".
const MONACO_CDN = "https://cdn.jsdelivr.net";

// CoCode's live preview renders inside a srcDoc iframe, which INHERITS this
// page CSP. Its React/SPA pipeline (src/lib/cocode/preview-runtime.ts) loads
// Babel Standalone from unpkg and bare modules (react, react-dom) from esm.sh,
// then imports each transpiled module from a blob:/data: URL — all four must
// be allow-listed or React previews silently render a blank frame while plain
// HTML previews keep working.
const PREVIEW_CDNS = "https://unpkg.com https://esm.sh";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: ${MONACO_CDN} ${PREVIEW_CDNS}`,
  // Monaco's tokenizer/language services run in web workers instantiated from
  // blob: URLs. worker-src has no fallback-from-script-src exemption for blob:,
  // so it needs its own directive rather than relying on the script-src fallback.
  "worker-src 'self' blob:",
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${MONACO_CDN}`,
  // data: is needed for Monaco's inlined codicon font (base64 data: URI).
  `font-src 'self' data: https://fonts.gstatic.com ${MONACO_CDN}`,
  "img-src 'self' data: blob: https:",
  // unpkg/esm.sh are needed by the preview iframe's module fetches (importmap
  // resolution + esm.sh's internal sub-requests), which count as connect-src.
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://openrouter.ai https://generativelanguage.googleapis.com https://api.deepseek.com https://dashscope.aliyuncs.com https://api.groq.com https://api.tavily.com https://www.googleapis.com ${MONACO_CDN} ${PREVIEW_CDNS}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Vercel serves prerendered/static content with Access-Control-Allow-Origin: *
// by default. Nothing on this site is meant to be read cross-origin (the /v1
// proxy keeps API calls same-origin too), so pin CORS to the canonical origin.
const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://aof-web.vercel.app";

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy",        value: CSP },
  { key: "Access-Control-Allow-Origin",    value: SITE_ORIGIN },
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

// The Coagentix frontend talks to the tmap-v2 backend (/v1/*). When
// COAGENTIX_API_PROXY is set we proxy /v1 to it so the browser stays
// same-origin (no CORS in production).
const apiProxy = process.env.COAGENTIX_API_PROXY ?? process.env.AOF_API_PROXY;

const nextConfig = {
  reactStrictMode: true,

  // Enable src/instrumentation.ts (deploy preflight on server start).
  experimental: {
    instrumentationHook: true,
  },

  // When a server-side proxy target is configured, expose a PUBLIC same-origin
  // flag to the browser bundle. Without this, getApiBase() (lib/api.ts) returns
  // null and isLive() stays false — so the /v1 rewrite below would never be used
  // and every feature silently falls back to single-pass /api/chat. Setting the
  // proxy alone is therefore enough to light up the full tmap-v2 backend.
  env: apiProxy ? { NEXT_PUBLIC_COAGENTIX_SAME_ORIGIN: "1" } : {},

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },

  async rewrites() {
    if (!apiProxy) return [];
    return [{ source: "/v1/:path*", destination: `${apiProxy}/v1/:path*` }];
  },

  // /cocode is a legacy bookmark for the CoCode workspace, which now lives at /code.
  async redirects() {
    return [{ source: "/cocode", destination: "/code", permanent: true }];
  },
};

export default nextConfig;
