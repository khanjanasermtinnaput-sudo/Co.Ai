# Co.Ai — Remediation Plan (evidence-verified)
**Date:** 2026-06-22 · **Branch base:** `main` @ `e3f5a1f` · **Method:** local clone + code read + execution tests

> This plan supersedes the WebFetch-based audit. Reading the real code (and running
> a checksum reproduction) **disproved 2 of the original 8 criticals**. Decisions:
> Auth = Supabase single source of truth; deprecate PIN+JWT. Tiers = existing
> GUEST/FREE/LITE/PRO/ADVANCED. Payment processor = deferred (entitlement via
> `subscriptions` table + redeem codes).

---

## Verified status of the 8 prompt criticals

| # | Issue | Real state (evidence) | Verdict |
|---|-------|----------------------|---------|
| 1 | Admin escalation | aof-web middleware already uses DB `user_roles` (fail-closed). **tmap-v2** still uses env allowlist `COAGENTIX_ADMIN_USERNAMES` matching `username` (auth.ts:119-131). Registration now blocks reserved names (symptom patch only). | **REAL — half-fixed.** tmap-v2 must use DB roles. |
| 2 | Rate-limit bypass | Redis sliding-window exists & wired: `/v1/`=120/60, `/v1/auth/`=10/60 (rate-limit-redis.ts, index.ts:131/166). aof-web uses Supabase-backed limiter (cross-instance). **Gaps:** silent in-memory fallback when Redis down; login lockout (rateLimit.ts) still per-instance. | **REAL — ~60% done.** |
| 3 | Quota broken | `usage-tracker.ts` = JSON file in `/tmp`, per-instance (confirmed lines 7-12, 28-29). `api_usage_metrics` table exists for logging; no atomic counter. | **REAL — confirmed broken.** |
| 4 | Backup checksum | **Execution test: stored === expected → MATCH: YES.** Create (backup.ts:96-99) and verify (:156) both hash with `checksum:''` in identical key order. | **FALSE POSITIVE — retracted.** |
| 5 | Sandbox escape | Node `vm` with blocked globals + Docker option + timeouts. Code itself states vm is not full isolation (sandbox.ts:19-23). Docker unavailable on Vercel/Railway → falls back to vm. | **REAL — needs policy decision.** |
| 6 | Billing non-functional | `subscriptions` + `redeem_codes` + `system_logs` schema already exist. plans.ts tiers exist; `NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS` default off. No payment (deferred). | **REAL — enforcement wiring only.** |
| 7 | Webhook persistence | `webhooks.ts` = file storage (writeFileSync), warns "LOST on redeploy" (lines 83-108). No DB table. | **REAL — confirmed.** |
| 8 | Chief agent cost | Iteration **already capped at 3** (`MAX_REVIEW_ATTEMPTS`, review-gate.ts:60). No token/cost hard budget. | **OVERSTATED — only cost/token budget missing.** |

**Honest correction:** The fix mission's #4 is a non-issue, and #8 is far smaller than stated. The
other 6 are real, but most of the DB schema the prompt asks to "create" **already exists** in
`aof-web/supabase/migrations/0003_admin_system.sql`. This is a *wire-and-enforce* mission, not greenfield.

---

## Existing assets to reuse (do NOT recreate)

| Asset | Location | Use for |
|-------|----------|---------|
| `user_roles` (OWNER/ADMIN/STAFF/BETA_TESTER) | 0003_admin_system.sql | #1 RBAC |
| `system_logs` (immutable audit) | 0003 | #1 admin audit log |
| `subscriptions` (FREE/LITE/PRO/ADVANCED, expires/revoked) | 0003 | #6 entitlements |
| `redeem_codes` + `redeem_code_uses` | 0003 | #6 grant w/o payment |
| `feature_flags` | 0003 | feature gating |
| `api_usage_metrics` (tokens/cost/provider) | 0003 | #3 usage logging |
| Supabase-backed rate limiter | aof-web/lib/server/rate-limit.ts | #2 pattern to reuse |
| Redis sliding-window | tmap-v2/rate-limit-redis.ts | #2 |
| CLI tokens migration | 20260619_cli_tokens.sql | deprecating PIN+JWT |

---

## New schema needed (only these)

```sql
-- #3 atomic quota counter (Postgres) — replaces /tmp files
quota_counters(user_id, period_key, kind, value, updated_at)  -- unique(user_id,period_key,kind)
-- #7 webhooks (replaces file storage)
webhooks(id, user_id, url, secret_encrypted, secret_prefix, events, status, created_at)
webhook_deliveries(id, webhook_id, event, status, attempts, next_attempt_at, last_error, payload)  -- DLQ via status='dead'
```
`usage_logs` requested in prompt ≈ existing `api_usage_metrics` (reuse, extend if needed).

---

## Decisions (made by auditor, per user instruction)

1. **Auth:** Supabase = single identity + role source. tmap-v2 verifies Supabase tokens (already supported via supabase-auth.ts) and reads `user_roles`/`subscriptions` via service role. PIN+JWT deprecated behind `LEGACY_PIN_AUTH` flag (default off), CLI moves to Supabase CLI tokens.
2. **Tiers/quota (existing source of truth):** GUEST 3 · FREE 20 · LITE 200 · PRO 600 · ADVANCED ∞ messages/day. (Prompt's "Lite=20/Pro=∞" was imprecise.)
3. **Payment:** deferred. Entitlement set via `subscriptions` (manual/admin or redeem code). `requireSubscription()` reads `subscriptions`, honors `expires_at`/`revoked_at`.
4. **Sandbox:** default **disable vm fallback in production**; require Docker or an external isolate (e2b/Modal) to enable code execution. Security > feature, per prompt.

---

## Execution order (dependency-aware)

### Round 0 — Foundations
- New migrations: `quota_counters`, `webhooks`, `webhook_deliveries`.
- Shared `requireRole()` / `requireSubscription()` helpers in tmap-v2 backed by Supabase.
- Decide Redis provider (Upstash) + confirm `REDIS_URL` available for tests.

### Round 1 — Quick, low-risk wins
- **#8** Add `max_tokens` / `max_cost_usd` hard budget + abort in chief-agent/orchestrator (iteration already capped). Cost monitor emits `tokens_used`/`estimated_cost`.
- **#5** Gate sandbox: `SANDBOX_REQUIRE_DOCKER=1` in prod; refuse vm fallback; keep vm only for local dev. Tests: known escape attempts must be refused.
- **#4** No code fix. Add a regression test that proves checksum create/verify round-trips (lock in correctness).

### Round 2 — Distributed state (shared root cause of #2,#3,#7)
- **#2** Fail-closed when Redis configured-but-down in prod (no silent in-memory). Migrate login lockout to Redis. Keep IP+identity keying.
- **#3** Replace `usage-tracker.ts` file store with atomic counter (`quota_counters`, Postgres `INSERT … ON CONFLICT … value=value+delta`); plan read from `subscriptions`; enforce pre-request. Log to `api_usage_metrics`.
- **#7** Move webhook storage to `webhooks` table; deliveries → `webhook_deliveries` with retry/backoff + dead-letter status.

### Round 3 — Identity & entitlement (depend on Round 0/2)
- **#1** tmap-v2 `isAdminUser`/`requireAdmin` → query `user_roles` via Supabase; remove env allowlist (keep as break-glass only via explicit `BREAKGLASS_ADMIN` flag). Every admin action writes `system_logs`. Migrate existing admins to DB rows.
- **#6** `requireSubscription(feature)` middleware on premium endpoints; server-side tier check from `subscriptions`; honor expiry/revocation.

### Round 4 — Hardening & validation
- Phase 2: OpenTelemetry/structured logs/health/alerts (extend existing prometheus.ts + telemetry.ts).
- Phase 3: full auth/authz/secrets/JWT/CSRF/XSS/prompt-injection/SSRF audit → `SECURITY_REPORT.md`.
- Phase 4: unit + integration + security + load + e2e → `FINAL_REMEDIATION_REPORT.md` with proof per issue.

---

## Effort estimate (real, post-verification)

| Round | Issues | Effort |
|-------|--------|--------|
| 0 | migrations + helpers | 0.5 day |
| 1 | #8, #5, #4-test | 0.5 day |
| 2 | #2, #3, #7 | 2 days |
| 3 | #1, #6 | 1.5 days |
| 4 | hardening + validation | 2 days |

Total ≈ **6.5 days**, materially less than the original "8 greenfield criticals" because schema exists and 2 findings were false/overstated.
