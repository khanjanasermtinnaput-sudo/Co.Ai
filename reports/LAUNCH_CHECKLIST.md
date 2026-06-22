# LAUNCH CHECKLIST — Co.AI Production Readiness
**Generated:** 2026-06-22  
**Version:** Post Phase 8-12 Audit

---

## BLOCKERS — Must Resolve Before Launch

- [x] **AOF_ERROR_006 ("CoAgentix Backend" 502)** — All 9 stream functions now fall through to `/api/chat` when Render backend is unreachable. Fixed in commits `9a77357`, `2f6cf4c`.
- [x] **Render `providers:[]`** — AI provider keys added to Render environment. Verified via `GET /v1/health`.
- [x] **Image MIME validation missing** — Fixed in this commit. `/v1/image/analyze` now validates content type and returns 415 on unsupported formats.
- [ ] **`COAGENTIX_MASTER_KEY` parity** — Verify the exact same value is set on both Vercel (aof-web) AND Render (tmap-v2). Mismatch = cannot decrypt user-stored API keys. Test: store a key in Settings → reload → verify it's readable.

---

## HIGH PRIORITY

- [ ] **At least 1 AI provider key verified on Vercel** — `GET https://aof-web.vercel.app/api/health` should return at least one configured provider. Required for `/api/chat` (the fallback path).
- [ ] **At least 1 AI provider key verified on Render** — `GET https://aof-code.onrender.com/v1/health` should return `"providers": ["openrouter"]` (or similar, non-empty). Required for `/v1/*` routes.
- [ ] **`SUPABASE_SERVICE_ROLE_KEY` set on Vercel** — Required for admin routes (`/api/admin/**`). Without it all admin calls return 403.
- [ ] **`SUPABASE_SERVICE_ROLE_KEY` set on Render** — Required for `requireAuth` Supabase token verification in tmap-v2.
- [ ] **Supabase migrations applied** — Run `supabase/v2-migration.sql` if not already applied. Adds `execution_traces`, `trace_nodes`, ranked-memory columns on `memories`, and fixes `audit_events` schema.
- [ ] **Verify Supabase `health` endpoint** — `GET /v1/health` → `deps.supabase.status === "ok"`.

---

## MEDIUM PRIORITY

- [ ] **Render Starter tier upgrade** — Free tier spins down after 15 min idle → cold start 502s on first request after inactivity. Starter ($7/mo) keeps service always-on. This is the underlying cause of many AOF_ERROR_006 reports.
- [ ] **First-token timeout tuned** — Default increased to 10s (this commit). Verify no regression on Anthropic/Gemini (fast providers). Adjust `FIRST_TOKEN_TIMEOUT_MS` env var if needed.
- [ ] **`COAGENTIX_ALLOWED_ORIGINS` on Render** — Must include `https://aof-web.vercel.app` and any custom domain. Example: `COAGENTIX_ALLOWED_ORIGINS=https://aof-web.vercel.app,https://co.ai`.
- [ ] **`COAGENTIX_API_PROXY` on Vercel** — Should be `https://aof-code.onrender.com` (no trailing slash). This enables multi-agent features. Without it, all requests go to `/api/chat` (safe but no tmap-v2 pipeline).
- [ ] **Test end-to-end chat flow** — Send a message at `aof-web.vercel.app` → verify response received → check Network tab for which route was used (`/api/chat` or `/v1/chat`).
- [ ] **Test multi-agent flow (if Render active)** — Trigger a code build or orchestrate request → verify `/v1/run` returns a result → check `GET /v1/health` providers.

---

## LOW PRIORITY

- [ ] **Webhook HMAC signatures** — Add `X-Coagentix-Signature: sha256=<HMAC(body, secret)>` to webhook delivery. Verify on receive with timing-safe comparison. (Security finding C5)
- [ ] **CSRF hardening** — Document accepted risk for current SPA-only use. If REST API clients are added: require `X-Requested-With: XMLHttpRequest` header on state-changing endpoints. (Security finding C2)
- [ ] **Login rate limiter → Redis** — When scaling to multiple Render instances, promote `tmap-v2/src/server/rateLimit.ts` to use Redis. (Security finding C4)
- [ ] **Document KDF salt constraint** — `"aof-master-key-kdf-v2"` in `crypto.ts` cannot be changed without re-encrypting all stored keys. Add comment in crypto.ts. (Security finding C3)
- [ ] **Decomposition cache → Redis** — Current cache is in-process only. When running multiple Render instances, move to `cacheGetOrSet()` Redis wrapper for shared cache.

---

## Observability

- [ ] **`SENTRY_DSN` on Render** — Enables automatic crash capture and stack trace reporting. Set in Render environment.
- [ ] **`PROMETHEUS_SCRAPE_TOKEN` on Render** — Required to protect `/metrics` endpoint. Set if using Prometheus/Grafana monitoring.
- [ ] **Audit log rotation** — `audit-YYYY-MM-DD.jsonl` files in `.aof-server/` accumulate indefinitely. Add a cron job or size-based rotation if running long-term.
- [ ] **Health monitoring** — Set up uptime monitoring on `https://aof-code.onrender.com/v1/health` (e.g., UptimeRobot free tier). Alerts on cold starts or downtime.

---

## Final Sign-Off

| Check | Owner | Status |
|-------|-------|--------|
| AOF_ERROR_006 resolved | Engineering | ✅ Done |
| Provider keys configured | Ops | ✅ Done |
| Image MIME validation | Engineering | ✅ Done |
| Master key parity | Ops | ☐ Pending |
| End-to-end chat test | QA | ☐ Pending |
| Render tier upgrade | Ops | ☐ Pending |
| Supabase migrations | Engineering | ☐ Confirm |
| Sentry configured | Ops | ☐ Pending |
