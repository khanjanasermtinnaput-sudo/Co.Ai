# Phase 3: Security & Audit — Environment Variables

## aof-web

| Variable | Required | Description |
|---|---|---|
| `SESSION_HMAC_SECRET` | Recommended | HMAC-SHA256 secret for hashing session tokens before storing in `user_sessions`. Falls back to `SUPABASE_JWT_SECRET`. Generate: `openssl rand -hex 32` |
| `MFA_ISSUER` | Optional | Issuer name shown in authenticator apps (default: `Coagentix`) |
| `CF_TURNSTILE_SECRET_KEY` | Optional | Cloudflare Turnstile server-side secret. When set, `verifyTurnstile()` will validate bot challenges. |
| `BOT_BLOCK_THRESHOLD` | Optional | Score 0–100 at which bot-protection blocks the request (default: `80`) |
| `NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY` | Optional | Public Turnstile site key exposed to the browser widget |

## tmap-v2

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Optional | If set, audit events are written to Supabase. Without it, `logAuditEvent` is a no-op. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Service-role key for Supabase audit writes. Required together with `SUPABASE_URL`. |
| `BOT_BLOCK_THRESHOLD` | Optional | Score 0–100 at which bot-protection blocks the request (default: `80`). Same semantics as aof-web. |

## Shared (already documented in Phase 1/2)

| Variable | Phase | Description |
|---|---|---|
| `COAGENTIX_MASTER_KEY` | 1 | AES-256-GCM master key — also used to encrypt MFA TOTP secrets at rest |
| `REDIS_URL` / `REDIS_TLS_URL` | 1 | Redis URL for sliding-window rate limiting |
| `NEXT_PUBLIC_SUPABASE_URL` | 1 | Supabase project URL (aof-web) |
| `SUPABASE_SERVICE_ROLE_KEY` | 1 | Supabase service-role key (aof-web) |

## New Postgres objects (applied via migration 0007)

| Object | Type | Notes |
|---|---|---|
| `audit_log` | table | Append-only security event trail |
| `user_sessions` | table | Tracked Supabase sessions + device linkage |
| `user_devices` | table | Device fingerprint registry |
| `user_mfa` | table | TOTP secret (encrypted) + hashed backup codes |
| `role_permissions` | table | Permission strings per role; seeded by migration |
| `security_alerts` | table | Flagged security events (brute force, bots, etc.) |
| `csp_violations` | table | CSP report-uri collector |
| `log_audit_event()` | function | RPC helper called by all audit writes |
| `get_user_permissions()` | function | Returns all permissions for a user |
| `user_has_permission()` | function | Returns boolean for a single permission check |
| `upsert_session()` | function | Safe session upsert (conflict on token hash) |
| `prune_old_sessions()` | function | Cleanup for cron/scheduled jobs |
