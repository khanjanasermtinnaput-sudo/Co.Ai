# Security Report — Co.AI

**Date:** 2026-06-21 · **Branch:** `audit/production-hardening`

## Summary
One authorization issue found and fixed (H-1, fail-open admin gate). No secret leakage, XSS, SSRF, SQLi, RCE, or auth-bypass found. The app already ships several defenses uncommon at this stage.

## Checklist results

| Vector | Result | Evidence |
|--------|--------|----------|
| API key / secret exposure | ✅ none | grep for `sk-…`, `AKIA…`, private keys, `service_role` → only env refs + empty `.env.example` |
| Secret leakage to client | ✅ none | service-role key used only in server modules (`lib/server/*`, `middleware.ts`); `decryptSecret` never returns plaintext to browser (`crypto.ts`) |
| Prompt injection | ✅ bounded | chat route builds system prompt server-side; user content kept as message turns, history capped at 20 (`api/chat/route.ts:258`) |
| XSS | ✅ safe | `markdown.tsx` uses `react-markdown` with **no** `rehype-raw`; no `dangerouslySetInnerHTML` in app code |
| CSRF | ✅ present | origin/referer check on all non-GET `/api/*` (`middleware.ts:16-51`) |
| SSRF | ✅ safe | search providers hit fixed hosts with `encodeURIComponent` query params only (`lib/server/search/providers.ts`) |
| SQL injection | ✅ N/A | all DB access via Supabase client query builder / parameterized; no string-concatenated SQL |
| RCE | ✅ N/A | no `eval`/`new Function` on user input; CLI sandbox modules isolate execution |
| AuthN | ✅ solid | Bearer token verified via Supabase `auth.getUser(token)`; fails closed (`supabase-admin.ts:43-67`) |
| AuthZ | ⚠️→✅ fixed | **H-1**: middleware admin gate failed open without service key — now fail-closed |
| Supabase RLS | ✅ by design | `provider_keys` has RLS enabled with no policies (browser cannot touch it); all access via service-role server routes scoped to caller's `user.id` |
| JWT validation | ✅ delegated | session tokens validated by Supabase; tmap-v2 server signs its own JWTs with `JWT_SECRET` (`render.yaml` generates per-deploy) |
| Key encryption at rest | ✅ AES-256-GCM | scrypt KDF, versioned blobs, backward-compatible (`crypto.ts`) |

## Fix applied
**H-1 — `aof-web/src/middleware.ts`:** admin authorization is now fail-closed. A missing `SUPABASE_SERVICE_ROLE_KEY`, a role-lookup error, or any non-`OWNER/ADMIN/STAFF` role now denies access (403 for APIs, redirect for pages) instead of falling through.

## Provider key handling (Phase 8)
Providers (Anthropic, OpenRouter, Gemini, DeepSeek, Qwen/Llama, Tavily, Google CSE, GitHub) are all **env-/per-user-key driven** and **fail soft**: a missing key removes the provider from the routing order; a missing *everything* returns a structured `AOF_ERROR_001` with a user-facing hint (`api/chat/route.ts:290-300`). Per-user keys (Settings → API Keys) override env and are stored encrypted. User-friendly error classification already exists in `lib/errors` (`AOF_ERROR_001…013`).

## Recommendations (not auto-applied — policy decisions)
- **M-1:** in production, fail closed when Supabase env vars are absent (`middleware.ts:60`) rather than allowing all traffic. Currently bypasses for dev convenience.
- Consider per-record salts for `crypto.ts` on the next schema migration (M-2).
- Add `SUPABASE_SERVICE_ROLE_KEY` to a deploy-time required-env preflight so H-1's misconfiguration path can never occur in prod.
