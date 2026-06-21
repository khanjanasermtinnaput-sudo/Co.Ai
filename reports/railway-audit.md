# Railway Deployment Audit — Co.Ai / Coagentix

**Date:** 2026-06-21
**Scope:** `aof-web/` (Next.js 14 app)
**Platform target:** Railway (containerised, stateless, single-region by default)

---

## Executive Summary

The application is architecturally sound for Railway: all API routes use `runtime = "nodejs"`, auth is Supabase-session-based (cookie + JWT, not in-memory), and provider API keys are persisted to a Supabase table with AES-256-GCM encryption. The three user-reported issues (API keys not saving, auth failures, Supabase connection problems) all trace back to **missing or misconfigured environment variables** rather than code bugs.

Nine concrete issues are documented below.

---

## Issue 1 — No `railway.toml` / No Railway-specific build config

**Severity:** High (deployment will guess incorrectly)

**Description:**
There is no `railway.toml` in the repository root or in `aof-web/`. Railway needs to know the root directory, build command, and start command for a monorepo. Without it Railway will attempt to detect the framework from the repo root, which contains both `aof-web/` and `tmap-v2/` subdirectories plus CI workflow files — this detection is unreliable.

**Affected Files:**
- (file absent) `railway.toml`

**Root Cause:**
The project was previously configured for Vercel (`aof-web/.vercel/project.json` exists and `aof-web/.github/workflows/vercel-deploy.yml` exists) but was never configured for Railway.

**Recommended Fix:**
Create `railway.toml` in the repository root:

```toml
[build]
builder = "nixpacks"
buildCommand = "cd aof-web && npm ci && npm run build"

[deploy]
startCommand = "cd aof-web && npm run start"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"

[environments.production.variables]
NODE_ENV = "production"
PORT = "3000"
```

---

## Issue 2 — Missing `PORT` binding (Railway injects `PORT`, Next.js ignores it)

**Severity:** High (app will fail health checks or be unreachable)

**Description:**
Railway assigns a dynamic port via the `PORT` environment variable and expects the process to bind to it. `next start` by default binds to port 3000 and ignores `PORT` unless explicitly told to use it.

**Affected Files:**
- `aof-web/package.json` (scripts section)

**Root Cause:**
The `"start"` script is `"next start"` with no `-p` flag. Railway routes traffic to `$PORT`, not to 3000.

**Recommended Fix:**
Change the start script in `aof-web/package.json`:

```json
"start": "next start -p ${PORT:-3000}"
```

Or in `railway.toml` start command:
```toml
startCommand = "cd aof-web && next start -p $PORT"
```

---

## Issue 3 — `NEXT_PUBLIC_SITE_URL` undocumented but used at runtime

**Severity:** Medium (broken referral URLs in production)

**Description:**
`src/app/api/referral/route.ts` reads `process.env.NEXT_PUBLIC_SITE_URL` and falls back to `"https://coagentix.app"` when unset. On Railway the domain will be a `*.up.railway.app` subdomain (or a custom domain). If this variable is not set, referral links will always point to `coagentix.app` instead of the actual Railway deployment URL.

**Affected Files:**
- `aof-web/src/app/api/referral/route.ts` (lines 55, 77)
- `aof-web/.env.example` (variable not documented)

**Root Cause:**
`NEXT_PUBLIC_SITE_URL` was never added to `.env.example`.

**Recommended Fix:**
Add to `.env.example`:
```
# Public-facing site URL (used for referral links, canonical URLs).
# On Railway: set to https://<your-app>.up.railway.app or your custom domain.
NEXT_PUBLIC_SITE_URL=
```
Set it in Railway dashboard to the deployment URL.

---

## Issue 4 — Hardcoded `HTTP-Referer: https://aof-web.vercel.app` sent to OpenRouter

**Severity:** Medium (OpenRouter attribution wrong; may affect rate limits or free-tier eligibility)

**Description:**
The OpenRouter adapter sends a hardcoded `HTTP-Referer` header pointing to the old Vercel deployment URL. OpenRouter uses this header for usage attribution and rate-limit bucketing. On Railway, every chat request will be misattributed to `aof-web.vercel.app`.

**Affected Files:**
- `aof-web/src/lib/server/ai-providers.ts` (line 332)

**Root Cause:**
Hardcoded string, never externalised to an env var.

**Recommended Fix:**
Replace the hardcoded value with a configurable env var:

```ts
"HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://coagentix.app",
```

Also add to `.env.example` (already covered by Issue 3 fix).

---

## Issue 5 — Auth Failure: `SUPABASE_SERVICE_ROLE_KEY` or `COAGENTIX_MASTER_KEY` missing in Railway env

**Severity:** Critical (user-reported: API keys not saving, auth failures)

**Description:**
This is the most likely root cause of both reported issues. The `instrumentation.ts` preflight check (`register()`) calls `process.exit(1)` if any of the four required secrets are absent in production:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
COAGENTIX_MASTER_KEY
```

If the app does not crash on startup, a missing `SUPABASE_SERVICE_ROLE_KEY` makes `isAdminConfigured()` return `false`, causing every `/api/keys` request to return HTTP 503 — silently discarding the user's API key without a UI-visible error. A missing `COAGENTIX_MASTER_KEY` causes `encryptSecret()` to throw, also returning 503.

**Affected Files:**
- `aof-web/src/instrumentation.ts`
- `aof-web/src/lib/server/supabase-admin.ts`
- `aof-web/src/lib/server/crypto.ts`
- `aof-web/src/app/api/keys/route.ts`

**Root Cause:**
Railway environment variables must be set manually in the Railway dashboard. They are not carried over from Vercel or from the local `.env` file.

**Recommended Fix:**
Set all four variables in Railway → Service → Variables:

| Variable | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → service_role key |
| `COAGENTIX_MASTER_KEY` | Generate: `openssl rand -hex 32` |

**Diagnosis command** (after deploying): visit `GET /api/auth/check` with a valid Bearer token. The `serverConfig` field in the JSON response shows exactly which secrets are missing.

---

## Issue 6 — Auth Failure: Supabase OAuth redirect URI not updated for Railway domain

**Severity:** Critical (users can't complete Google sign-in)

**Description:**
`signInWithGoogle()` in `auth-provider.tsx` (line 122) constructs the redirect URI dynamically from `window.location.origin`:

```ts
redirectTo: `${window.location.origin}/auth/callback`
```

This is correct client-side behaviour. However, Supabase's Google OAuth provider only allows redirect URIs that are explicitly whitelisted in two places:
1. **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**
2. **Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs**

If only the Vercel URL (`https://aof-web.vercel.app/auth/callback`) is whitelisted, every sign-in attempt on Railway will be rejected by Google with `redirect_uri_mismatch`.

**Affected Files:**
- `aof-web/src/components/providers/auth-provider.tsx` (line 122)

**Root Cause:**
External OAuth configuration (Supabase + Google Cloud Console) was set up for Vercel and was not updated for Railway.

**Recommended Fix:**
1. In Supabase Dashboard → Authentication → URL Configuration, add:
   - `https://<railway-domain>.up.railway.app/auth/callback`
   - (also add any custom domain)
2. In Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs, add the same URL.
3. In Supabase Dashboard → Authentication → URL Configuration → Site URL, set it to the Railway URL.

---

## Issue 7 — In-memory `startupLogged` flag breaks across Railway's stateless restarts

**Severity:** Low (cosmetic — startup log emits once per process, which is correct)

**Description:**
`ai-log.ts` uses a module-level boolean `let startupLogged = false` to emit the AOF startup banner exactly once. This is correct behaviour for a single process. On Railway, each container restart is a new process, so the banner re-appears after every restart/redeploy — this is expected and harmless.

Similarly, `supabase-admin.ts` caches the admin client in `let admin: SupabaseClient | null = null` and `supabase/client.ts` caches the browser client in `let client`. These are per-process singletons and work correctly on Railway (each instance has its own process memory). This is **not** a bug.

**Root Cause:** N/A — this is correct behaviour.

**Recommended Fix:** No change needed. Document that this is intentional.

---

## Issue 8 — Rate limiter falls back to in-memory store when Supabase RPC is missing

**Severity:** Medium (rate limits don't work correctly across Railway instances)

**Description:**
`rate-limit.ts` tries to call a Supabase RPC function `increment_rate_limit`. If the function doesn't exist (it is not in any migration file in this repo), it falls back to an in-memory `Map`. On Railway, each pod has its own memory, so the in-memory fallback means:
- A user who hits the 30 req/min chat limit on one pod is not limited on others
- After a restart, counters reset

**Affected Files:**
- `aof-web/src/lib/server/rate-limit.ts` (lines 55–62)

**Root Cause:**
The Supabase RPC `increment_rate_limit` is referenced but no migration creates it. The fallback is silently used in production.

**Recommended Fix:**
Create the required Supabase function. Apply this migration via Supabase Dashboard → SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_key TEXT,
  p_window_start TIMESTAMPTZ,
  p_max INTEGER
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO rate_limit_windows (key, window_start, count)
  VALUES (p_key, p_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = rate_limit_windows.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;
```

---

## Issue 9 — `maxDuration = 60` on `/api/chat` requires a Railway paid plan

**Severity:** Low-Medium (chat silently times out on free plan)

**Description:**
`/api/chat/route.ts` exports `export const maxDuration = 60` (line 80). This is a Vercel-specific hint for serverless function timeout. Railway does **not** use this export — it is silently ignored. Instead, Railway has a configurable timeout at the service level (default 60s for HTTP requests in most plans).

For Railway, long-running streaming responses work differently: the connection stays alive as long as data flows. The `maxDuration` export is harmless but misleading.

More importantly, streaming responses on Railway require that the platform does not buffer the response body. Railway passes through streaming responses correctly for HTTP/1.1 chunked transfer encoding and HTTP/2, so SSE/chunked streaming works correctly without any code changes.

**Affected Files:**
- `aof-web/src/app/api/chat/route.ts` (line 80)

**Root Cause:**
Left over from Vercel configuration. Harmless on Railway.

**Recommended Fix:**
Remove or document the `maxDuration` export as Vercel-only. In Railway dashboard, set the HTTP timeout to 120s or higher under Service → Settings → Networking to accommodate slow LLM responses.

---

## Summary Table

| # | Issue | Severity | Causes Reported Bug? |
|---|---|---|---|
| 1 | No `railway.toml` — build/start not configured | High | Yes (deployment fails) |
| 2 | `PORT` not passed to `next start` | High | Yes (app unreachable) |
| 3 | `NEXT_PUBLIC_SITE_URL` undocumented | Medium | Partial (referral links broken) |
| 4 | Hardcoded `HTTP-Referer: aof-web.vercel.app` | Medium | No (silent misattribution) |
| 5 | Missing Railway env vars → 503 on `/api/keys` | Critical | Yes (API keys not saving) |
| 6 | OAuth redirect URI not whitelisted for Railway | Critical | Yes (auth failures / can't sign in) |
| 7 | Module-level singletons reset on restart | None | No (expected behaviour) |
| 8 | Rate limiter RPC missing → in-memory fallback | Medium | No (limits not enforced across pods) |
| 9 | `maxDuration = 60` ignored by Railway | Low | No (harmless) |

---

## Minimum Steps to Fix Reported Issues

In order of priority:

1. **Set all 4 required env vars in Railway dashboard** (Issue 5) — fixes API key saving
2. **Add Railway domain to Supabase + Google OAuth redirect URI whitelist** (Issue 6) — fixes auth failures
3. **Create `railway.toml` + fix `PORT` binding** (Issues 1 & 2) — fixes deployment/routing
4. **Set `NEXT_PUBLIC_SITE_URL`** (Issue 3) — fixes referral links
5. **Fix `HTTP-Referer` header** (Issue 4) — fixes OpenRouter attribution
6. **Apply rate limiter SQL migration** (Issue 8) — enables distributed rate limiting

---

## What Works Correctly on Railway

- All API routes declare `export const runtime = "nodejs"` — no edge-incompatible APIs
- Supabase session is stored in cookies managed by `@supabase/ssr` — survives Railway restarts (sessions live in Supabase, not in-container memory)
- Provider API keys are stored encrypted in Supabase `provider_keys` table — not in container memory, persist across restarts
- Streaming/SSE uses native `ReadableStream` with `text/plain` chunked encoding — works on Railway
- No WebSocket usage detected
- No Next.js server actions detected — all mutations go through standard API routes
- Middleware runs on `/admin/:path*` and `/api/:path*` — correct scoping, no Railway-specific conflicts
- CSRF origin check in middleware correctly uses `request.url` host comparison — works with Railway's reverse proxy
- `@supabase/ssr` cookie handling in middleware correctly sets cookies on the response object — no domain issues (Railway serves HTTPS with its own domain)
- AES-256-GCM encryption uses Node.js `crypto` module — available in Railway's Node runtime
