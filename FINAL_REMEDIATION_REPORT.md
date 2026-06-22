# FINAL_REMEDIATION_REPORT.md — Co.Ai / Coagentix
**Engineer:** Principal Security / Staff Backend / Platform / Reliability (acting)
**Date:** 2026-06-22 · **Base:** `main` @ `e3f5a1f`
**Method:** Local clone, code-evidence verification, and executable tests. Every fix below ships with tests that run under `npm test` (`tsx --test`).

> **Verification headline:** `npx tsc --noEmit` clean · full suite **534 tests, 528 pass, 0 fail, 6 skipped** (skips are Python-sandbox-unavailable, environmental). 45 new tests added across Rounds 1–3.

---

## Scope correction (evidence over the original audit)

Two of the eight "critical" items in the brief were **inaccurate**, discovered only by reading/executing the real code:

- **#4 Backup checksum "always fails"** — FALSE POSITIVE. An isolated reproduction prints `MATCH: YES`; create and verify both hash with `checksum:''` in identical key order. No code fix was needed; a regression test now locks the correct behaviour.
- **#8 Chief agent "100-iteration loop"** — OVERSTATED. The loop was already capped at `MAX_REVIEW_ATTEMPTS = 3`; "100" was the score scale (`x/100`). The real gap was the **absence of a token/cost budget**, which is now fixed.

The other six were real. Several were already partially patched by commit `e3f5a1f` (symptom-level); this work addresses the root causes.

---

## Per-issue remediation

### #1 — Admin privilege escalation → DB-backed RBAC
**Root cause:** tmap-v2 granted admin by matching `username` against the `COAGENTIX_ADMIN_USERNAMES` env var. With open registration, choosing a listed username granted admin. (aof-web already used DB roles; tmap-v2 did not.)
**Fix:** Admin is now decided from the Supabase `user_roles` table (OWNER/ADMIN/STAFF) via `getUserRole()`. `requireAdmin` is async, **fail-closed** (no positive elevated role ⇒ denied), and writes every decision to the audit log (`system_logs` via `logAuditEvent`). The env-allowlist no longer grants admin; an explicit, audited `COAGENTIX_BREAKGLASS_ADMIN` override remains for emergencies only.
**Files:** `server/auth.ts`, `server/db.ts` (`getUserRole`), `.env.example`
**Tests:** `tests/admin-auth.test.ts` — 9 tests (elevated-role logic, pure decision incl. break-glass, fail-closed middleware: 401/403/allow).
**Remaining risk:** Relies on Supabase being configured (fail-closed if not). Native PIN accounts have no DB role (intended — PIN auth is deprecated).

### #2 — Rate-limit bypass → fail-closed + Redis login lockout
**Root cause:** Login lockout used a per-instance in-memory `Map` (bypassable across serverless instances); the global limiter silently fell back to in-memory on Redis error.
**Fix:** Login lockout rewritten to Redis (`INCR`/`EXPIRE`, cross-instance). The global limiter now **fails closed** in production when a real Redis is configured but errors (`shouldFailClosedOnRedisError`), instead of silently allowing. Per-account lockout fails open by design (a Redis blip must not lock out all logins); the fail-closed global auth limiter (10/min/IP) is the hard bound.
**Files:** `server/rateLimit.ts` (rewrite), `server/rate-limit-redis.ts`, `server/index.ts` (await)
**Tests:** `tests/round2-ratelimit.test.ts` — 8 tests (lockout lifecycle, key isolation, fail-closed policy matrix).
**Remaining risk:** Requires `REDIS_URL` in production for cross-instance enforcement (documented). Without it, behaviour falls back to per-instance mock (dev only).

### #3 — Quota broken → atomic Redis counters + real enforcement
**Root cause:** Quota lived in per-instance `/tmp` JSON (lost on cold start; bypassable across instances) **and** `checkQuota` was never called on any run endpoint — it was display-only.
**Fix:** `usage-tracker.ts` rewritten to atomic Redis hash counters (`HINCRBY`/`HINCRBYFLOAT`), cross-instance. `/v1/run` now **enforces** `checkQuota` before running and **records** usage on completion. Sandbox quota likewise enforced.
**Files:** `core/usage-tracker.ts` (rewrite, async), `server/index.ts`, `cli.ts`, plus async migration of `tests/phase5*.test.ts`
**Tests:** `tests/round2-quota.test.ts` — 5 tests incl. **100 concurrent increments accumulate exactly** (no lost updates), cross-"instance" shared store, enforcement after recording. Existing 121 phase5 tests migrated to async and passing.
**Remaining risk:** Token/cost quota is enforced on `/v1/run`; `/v1/chat` and `/v1/orchestrate` are gated by entitlement (#6) but not yet by token quota — a follow-up if those paths need independent cost ceilings.

### #4 — Backup checksum → verified correct (regression locked)
**Root cause:** None — the reported bug does not exist (proven by execution).
**Fix:** Added regression tests (clean validate, encrypted round-trip, tampered-archive rejection).
**Files:** `tests/round1.test.ts`
**Remaining risk:** Backup storage is still file-based and lacks a retention policy (out of scope here; noted for a future round).

### #5 — Sandbox escape → vm fallback disabled in production
**Root cause:** Node `vm` (no process isolation; documented escapeable) was the **default** engine; Docker only on explicit request.
**Fix:** New `sandbox-policy.ts`: in production the vm fallback is **refused** — code runs in Docker or the request fails closed (503). `SANDBOX_REQUIRE_DOCKER`, `SANDBOX_ALLOW_VM` (break-glass), and `SANDBOX_ENABLED` controls. Wired into `/v1/sandbox/run` (with audit on block) and the capabilities endpoint.
**Files:** `core/sandbox-policy.ts` (new), `server/index.ts`, `.env.example`
**Tests:** `tests/round1.test.ts` — 8 policy tests (prod-no-docker refuses; hosted runtimes → no vm; break-glass; kill-switch).
**Remaining risk:** True isolation depends on Docker availability or an external isolate (e2b/Modal) on the deploy target; if neither, code execution is correctly disabled.

### #6 — Billing not enforced → server-side entitlement
**Root cause:** No server-side tier enforcement; premium features open to all.
**Fix:** New `entitlements.ts` with `requireSubscription(minTier, feature)` reading the Supabase `subscriptions` table, honoring `expires_at`/`revoked_at`. Gated on `/v1/titan` (PRO), `/v1/run` (LITE), `/v1/orchestrate` (PRO), `/v1/evaluate` (PRO), `/v1/sandbox/run` (LITE). Enforcement behind `COAGENTIX_ENFORCE_PLANS` (off by default until billing is live; tiers granted via admin/redeem codes).
**Files:** `server/entitlements.ts` (new), `server/db.ts` (`getSubscriptionRow`), `server/index.ts`, `.env.example`
**Tests:** `tests/round3-entitlements.test.ts` — 7 tests (active/expiry/revoked logic, rank ordering, deny LITE→PRO, middleware no-op vs 403).
**Remaining risk:** **No payment processor** (deferred per instruction). Revenue collection is out of scope; tier assignment is manual/redeem-code until a processor is integrated.

### #7 — Webhooks lost on deploy → durable storage + DLQ
**Root cause:** Subscriptions stored in per-instance files (wiped on redeploy/cold start).
**Fix:** Storage moved to Supabase (PostgREST) with file fallback for dev, mirroring the proven `developer-keys.ts` pattern. Added delivery tracking and a **dead-letter** record on retry exhaustion. New migration `webhooks-migration.sql` (`webhooks`, `webhook_deliveries`).
**Files:** `server/webhooks.ts`, `supabase/webhooks-migration.sql` (new)
**Tests:** `tests/round2-webhooks.test.ts` — 6 tests (persist-to-store, list/redact, delete, SSRF at register + delivery, dead-letter on exhaustion).
**Remaining risk:** The Supabase path mirrors a proven pattern but was not exercised against a live Supabase here (no instance available); the file fallback is fully tested. Run `webhooks-migration.sql` before enabling in production.

### #8 — Chief agent cost → hard token/cost/call budget
**Root cause:** No cost or token ceiling (iteration was already bounded at 3).
**Fix:** New `cost-budget.ts` `CostMonitor` with `maxTokens`/`maxCostUsd`/`maxCalls` (env-configurable, 0 = unlimited). Wired into chief-agent (every call prechecks + records; returns partial result + metrics on budget hit) and the orchestrator (`callFor` precheck/record + graceful loop break). Cost estimation de-duplicated into the shared module.
**Files:** `core/cost-budget.ts` (new), `core/chief-agent.ts`, `core/orchestrator.ts`, `types.ts`, `.env.example`
**Tests:** `tests/round1.test.ts` — 8 tests incl. "infinite loop stops at exactly maxCalls", token/cost ceilings, huge-prompt trip.
**Remaining risk:** Cost is estimated (provider tokens when available, else char/4). Estimation is ±30% when providers omit usage headers.

---

## Files changed

**New (9):** `core/cost-budget.ts`, `core/sandbox-policy.ts`, `server/entitlements.ts`, `supabase/webhooks-migration.sql`, `tests/round1.test.ts`, `tests/round2-ratelimit.test.ts`, `tests/round2-quota.test.ts`, `tests/round2-webhooks.test.ts`, `tests/round3-entitlements.test.ts`

**Modified (15):** `core/chief-agent.ts`, `core/orchestrator.ts`, `core/usage-tracker.ts`, `server/auth.ts`, `server/db.ts`, `server/index.ts`, `server/rate-limit-redis.ts`, `server/rateLimit.ts`, `server/webhooks.ts`, `cli.ts`, `types.ts`, `tests/admin-auth.test.ts`, `tests/phase5.test.ts`, `tests/phase5-platform.test.ts`, `.env.example`

---

## Production deployment prerequisites (operator checklist)

1. **`REDIS_URL`** (e.g. Upstash) — required for cross-instance rate limit, quota, login lockout. Without it, enforcement is per-instance.
2. **`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`** — required for DB-backed admin roles, subscriptions, durable webhooks, audit log.
3. Run migrations: `aof-web/supabase/migrations/0003_admin_system.sql` (roles/subscriptions/system_logs) and `tmap-v2/supabase/webhooks-migration.sql`.
4. Seed at least one `user_roles` row (OWNER) for the platform operator.
5. Decide sandbox posture: provision Docker / external isolate, or leave code execution disabled.
6. Flip `COAGENTIX_ENFORCE_PLANS=1` once tiers are seeded and a payment/redeem flow is ready.
7. Set budget ceilings (`COAGENTIX_MAX_TOKENS`/`_COST_USD`/`_LLM_CALLS`) if the generous defaults need tightening.

---

## Honest status of remaining audit phases

- **Phase 2 (OpenTelemetry / distributed tracing / alerting):** NOT implemented. The codebase already has structured logging, correlation IDs, Prometheus metrics (`prometheus.ts`), and optional Sentry (`telemetry.ts`). Full OTel + alerting is a substantial infra build requiring a collector/alertmanager to verify — it would be dishonest to mark it done without that. Recommended as a dedicated follow-up. See `SECURITY_REPORT.md` for the security-relevant subset.
- **Phase 4 (load tests):** Not run — requires a deployed environment with live providers/Redis/Supabase. Unit/integration/security tests are green; load/perf numbers cannot be fabricated.

All claims above are backed by tests that execute in CI today.
