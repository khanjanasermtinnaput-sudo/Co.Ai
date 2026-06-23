# Coagentix — Critical Remediation Deliverable

**Branch:** `remediation/production-blockers` · **Base:** `main@f66abc5`
**Scope:** 7 commits · 73 files · +813 / −357
**Verification:** tmap-v2 **626/626** hermetic · aof-web **183/183** · both `tsc --noEmit` exit 0

All work obeyed the brief's CRITICAL RULES: no working functionality removed, no API
contracts broken, no placeholder/mocked-away fixes, every change verified by tests.

---

## 1. Root Cause Analysis

| Blocker | Root cause | Fix (commit) |
|---|---|---|
| RAA v2 disabled by default | Score-based router was mounted only behind `COAGENTIX_V2=1`; the live default path was the v1 fixed pipeline + regex `classifier.ts`. A deliberate "safe rollout" flag that was never flipped. | v2 now **default-on**; flag inverted to a kill-switch (`5788c70`) |
| Tests burn real credits | `config.ts` loads `.env`; the provider client made real `fetch` calls during `node --test`. No offline guarantee → 47 live `402` failures. | Force-offline when `NODE_ENV=test` at the single provider choke point (`83128c3`) |
| Fail-open security under load | Redis/DB degrade silently to per-instance memory; login lockout fails open. Only DB had a startup gate. | Redis now a hard prod requirement (`04dd63f`) |
| Unbounded cost on default path | `/v2/run` (now default) never called `checkQuota`/`recordUsage`; no pre-flight estimate. | Quota gate + estimate/actual logging on `/v2/run` (`f8d17b9`) |
| Duplicated admin guards | 16 copy-pasted `requireAdmin` blocks; behaviour already drifting (2 role-set variants). | One hierarchy-aware shared guard (`96f4ac7`) |
| No input validation layer | ~85 routes hand-rolled `typeof`/`String()` coercion. | Shared zod helpers + applied to chat/admin (`5e1903b`) |
| Brand leakage | Half-finished "AOF → Coagentix" rebrand left old name in prompts/headers. | Unified to Coagentix (`a2719ec`) |

**Common theme:** the system was built feature-first with "safe" fallbacks everywhere
(mock providers, in-memory Redis, ephemeral DB, opt-in v2). Each fallback was reasonable
alone, but together they let the platform *appear* healthy while silently running in its
weakest configuration. The remediation makes the strong configuration the **default** and
the weak one an **explicit, logged opt-out**.

---

## 2. Architecture (after remediation)

```
                          ┌──────────────────────────── aof-web (Next.js 14) ───────────────────────────┐
  Browser ── HTTPS ──▶    │  middleware.ts (auth)                                                        │
   (Supabase              │  Security headers (next.config.mjs: CSP/XFO/HSTS/…)                          │
    Google OAuth JWT)     │  /api/chat  ── zod ChatBodySchema ─▶ ai-providers (Anthropic→OpenRouter)     │
                          │  /api/admin/* ─ requireAdmin(minRole) [shared] ─▶ Supabase (service role)    │
                          │  /v1/* ── rewrite/proxy ─▶ tmap-v2                                            │
                          └──────────────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
        ┌──────────────────────────────── tmap-v2 (Express) ─────────────────────────────────┐
        │  preflightEnv(): PROD requires JWT_SECRET + MASTER_KEY + Supabase + Redis (gated)   │
        │  Security headers + restricted CORS                                                 │
        │                                                                                     │
        │  POST /v1/run   ── code-gen pipeline (planner→coder→vote→review→doc) ─▶ files[]     │  (unchanged contract)
        │                                                                                     │
        │  POST /v2/run  (DEFAULT ON) ── checkQuota ─▶ cost estimate ─▶ runV2:                │
        │        RAA(intent→decompose→score) ─ confidence ≥ θ ? ─┬─ DAG executor ─▶ output    │
        │                                                        └─ legacy single route       │  ← fallback (never crash)
        │        ▼ structured log {route,confidence,selected_agents,fallback_used}            │
        │        ▼ recordUsage(actual)        GET /v2/routing-metrics (success/fallback/avg)  │
        └─────────────────────────────────────────────────────────────────────────────────────┘
                                                          │
                              getRedis() ── REDIS_URL ? real ioredis : in-memory mock (dev only)
                              db ── Supabase Postgres ? durable : JSON file (dev only)
```

---

## 3. Files Changed (highlights)

**New:** `tmap-v2/src/v2/routing-telemetry.ts`, `tmap-v2/src/server/preflight.ts`,
`tmap-v2/scripts/test.mjs`, `aof-web/src/lib/server/validate.ts`, plus 3 test files
(`raa-default-routing`, `preflight`, `cost-control-v2`, `validate`).

**Core modified:** `tmap-v2/src/server/index.ts` (v2 default, quota, preflight),
`tmap-v2/src/v2/run.ts` (confidence/fallback/telemetry), `config.ts` + `providers/client.ts`
(hermetic guard), `aof-web/src/lib/admin/server.ts` (shared `requireAdmin`),
14 admin routes, `aof-web/src/app/api/chat/route.ts` (zod). 40 files for brand.

Per-commit exact diffs: `git show <sha>` for the 7 SHAs in §Test Results.

---

## 4. P7 — Auth Consolidation Strategy (migration, not rip-out)

**Finding:** two independent auth systems exist —
(A) **aof-web Supabase Auth** (Google OAuth, JWT verified server-side, `user_roles` table) and
(B) **tmap-v2 username+PIN + local JWT** (`server/auth.ts`, `db.ts pinHash`).

**Why this is NOT a single-commit change:** ripping out (B) would break the CLI auth flow
(`/v1/cli/auth`), existing tmap-v2 sessions, and every `/v1/*` endpoint's `requireAuth`.
That violates CRITICAL RULES #1/#2. Auth migration must be staged and reversible.

**Recommended target:** **Supabase Auth as the single identity provider.** It is the
stronger system (OAuth, no PIN, RLS, role table, already used by the paid web surface).

**Staged plan (backward-compatible at every step):**
1. **Dual-accept (no breakage):** make tmap-v2 `requireAuth` accept *either* a tmap JWT
   *or* a Supabase JWT (verify via Supabase JWKS). New clients send Supabase tokens; old
   tmap sessions keep working. *(~1 file: `server/auth.ts`, additive.)*
2. **Identity bridge:** on first Supabase-authenticated tmap call, link/create the tmap
   user row keyed by Supabase `user.id` (carry over encrypted provider keys).
3. **Migrate the CLI:** `/v1/cli/auth` issues a device code that exchanges for a Supabase
   session instead of a PIN.
4. **Deprecate PIN:** stop issuing PINs; keep verification for a grace window; then remove
   `pinHash` paths.
5. **Remove tmap-local JWT signing** once telemetry shows zero tmap-native tokens in use.

Each step is independently shippable and reversible. Estimated 2–3 focused PRs.

---

## 5. P13 — Production Readiness Checklist

| Item | Status | Evidence |
|---|---|---|
| RAA v2 enabled by default | ✅ Done | `5788c70`; `/v2/run` mounted unless `COAGENTIX_V2=0` |
| No keyword-first routing (RAA primary, regex = fallback only) | ✅ Done | confidence-gated; legacy = fallback path in `runV2` |
| No JSON prod database | ✅ Enforced | `preflightEnv` refuses prod boot w/o Supabase |
| Redis required in prod | ✅ Done | `04dd63f` preflight gate (+ override) |
| Cost controls enabled | ✅ Done | `checkQuota` on `/v1/run` + `/v2/run`; estimate/actual logged |
| CSP + security headers | ✅ Pre-existing, verified | `next.config.mjs` + Express middleware |
| Tests hermetic | ✅ Done | `83128c3`; 626/0 with keys present, 0 live calls |
| Auth consolidated | 🟡 Strategy delivered | §4 — staged migration (not a single commit) |
| Validation layer | 🟡 Foundation + key routes | `5e1903b`; reusable helper, incremental rollout |
| No duplicate admin middleware | ✅ Done | `96f4ac7`; 14 routes → 1 guard |

✅ 8 done · 🟡 2 in progress (auth migration, full validation rollout — both safe to ship incrementally).

---

## 6. Test Results

```
tmap-v2  npm test (NODE_ENV=test, real OPENROUTER_API_KEY still in .env)
         → 626 pass / 0 fail / exit 0 / 0 live network calls
aof-web   npm test → 183 pass / 0 fail / exit 0
typecheck tmap-v2 → exit 0      aof-web → exit 0
```
New tests added: RAA-default-routing (RAA executes, confidence, dynamic selection,
fallback), preflight gate (Redis/DB/secret matrix), v2 cost control (estimate + budget
rejection), zod validate helpers.

---

## 7. Security Report (delta)

- **Fixed:** prod now fails closed without Redis (login lockout no longer silently fails
  open); admin authz unified onto one hierarchy-checked guard (with role-expiry honoured);
  untrusted chat/admin input validated by zod; test suite can no longer leak a real key via
  billed calls.
- **Already strong (verified, not changed):** AES-256-GCM + scrypt key encryption; CSP &
  security headers on both apps; sandbox uses `spawnSync(file, [args])` — no shell, no
  injection, shell/bash rejected.
- **Unchanged risk:** two auth systems until §4 lands; weak PIN factor on tmap until then.

---

## 8. Performance Impact

- **Hermetic tests:** faster + free (mock vs network); CI no longer flakes on credits.
- **`/v2/run`:** +1 Redis `hgetall` (quota check) and a string-length cost estimate before
  each run — sub-millisecond, negligible vs LLM latency. Confidence gate can *reduce* cost
  by skipping low-value DAG execution in favour of a single call.
- **Admin routes:** shared guard adds one `user_roles` lookup (same as before; no extra
  round-trip).
- **Startup:** preflight is O(few env reads); no runtime cost.

---

## 9. Deployment Instructions

**Required env in production (server refuses to boot otherwise):**
```
JWT_SECRET=<32+ random>
COAGENTIX_MASTER_KEY=<32+ random>        # or legacy AOF_MASTER_KEY
SUPABASE_URL=...                         # durable DB
SUPABASE_SERVICE_ROLE_KEY=...
REDIS_URL=redis://...                    # distributed rate-limit + lockout
```
**Optional / tuning:**
```
COAGENTIX_V2=0                  # kill-switch: revert to legacy routing only
COAGENTIX_RAA_MIN_CONFIDENCE=0.25   # fallback threshold
COAGENTIX_ALLOW_NO_REDIS=1      # single-instance escape hatch (NOT recommended)
COAGENTIX_ALLOW_EPHEMERAL_DB=1  # dev/demo only
AOF_DAILY_TOKEN_LIMIT / AOF_MONTHLY_* / AOF_*_COST_LIMIT  # per-user budgets
```
**Rollback:** set `COAGENTIX_V2=0` to disable the new default router instantly; all other
changes are backward-compatible (no schema migrations were required).

**CI:** run `npm test` (now hermetic) for both packages. Keep `npm run test:live` out of CI.

---

## 10. Remaining Risks

1. **Auth still dual** until §4 migration lands — highest remaining architectural risk.
2. **Validation coverage partial** — helper is in place and applied to the hottest routes;
   the remaining ~80 routes should adopt it incrementally (mechanical, low-risk).
3. **`/v1/run` codegen not routed through RAA v2** — intentional: different output contract
   (`files[]` vs text). Unifying is a product decision, not a safe mechanical swap.
4. **v2 token accounting is best-effort** when providers omit usage headers (falls back to
   char-based estimate) — cost ceilings hold; per-token reporting may under-count.
5. **No live load test at 1k/10k** performed in this environment — gates are correct by
   construction but should be validated under real concurrency before public scale.
```
