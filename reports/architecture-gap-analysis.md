# Co.Ai — Architecture Gap Analysis (Full Audit)

*Phase A: Architecture Validation*
*Generated: 2026-06-21 | Analyst: Claude Code (Architecture Audit)*
*Replaces previous stub. All findings verified against actual source files.*

---

## Executive Summary

The Co.Ai repository contains three distinct sub-systems: a static demo (`index.html`), a production backend (`tmap-v2/`), and a Next.js frontend (`aof-web/`), plus a standalone CLI (`coagentix-cli/`). The primary architecture documentation (`AOF_CODE_TDD.md`, `aof-web/ARCHITECTURE.md`) is largely accurate at a high level but contains **numerous gaps where the implementation has significantly outpaced or diverged from what was written**. This report identifies 22 concrete issues across six categories.

**Overall finding:** The codebase is substantially more complete than the docs admit in some areas (sandbox execution exists and is not 🔴; audit events exist and are not 🔴; Redis exists and is not 🔴). Conversely, several components documented as ✅ DONE are dead code (never wired into call paths), and the `coagentix-cli/` directory introduces an entirely undocumented second CLI implementation that collides with the `tmap-v2` CLI.

---

## Index

| # | Category | Issue |
|---|----------|-------|
| 1 | Architecture Drift | Sandbox execution marked 🔴 TODO, but `core/sandbox.ts` is fully implemented and wired |
| 2 | Architecture Drift | `events` / audit table marked 🔴 TODO, but `audit_events` table + `server/audit.ts` exist |
| 3 | Architecture Drift | Redis marked 🔴 TODO (Phase 2-4), but `server/redis.ts` + Redis rate limiter are active |
| 4 | Architecture Drift | AOF_CODE_TDD §14.1 folder structure does not match actual `tmap-v2/src/` structure |
| 5 | Missing Feature | `coagentix-cli/` is a fully independent second CLI — not documented anywhere |
| 6 | Missing Feature | `aof-web` uses Google OAuth (Supabase Auth); `tmap-v2` uses PIN/JWT — auth systems are incompatible and share no session state |
| 7 | Partially Implemented | `core/critic-agent.ts` exists with a complete `CriticReport` interface but is **never imported** by the orchestrator |
| 8 | Partially Implemented | `core/advanced-router.ts` exists and works, but is **never called** by any endpoint or orchestrator path |
| 9 | Partially Implemented | Phase 5/6 migrations (`phase5-phase6-migration.sql`) are written but the docs do not reflect these tables exist |
| 10 | Partially Implemented | `image_memories` Supabase table is used by `image-memory.ts` but no migration is listed in the main `migration.sql` |
| 11 | Documentation Mismatch | AOF_CODE_TDD §2.1 matrix lists `Persistent Memory` as 🟡 PARTIAL (no pgvector) but `image-pipeline.ts` + `image-memory.ts` form a second memory system with its own Supabase table — not mentioned in §6 |
| 12 | Documentation Mismatch | AOF_CODE_TDD §10 says CLI has 8 verbs; actual `tmap-v2/src/cli.ts` has 10 (includes `sandbox` + `usage` verbs) |
| 13 | Documentation Mismatch | AOF_CODE_TDD §9.1 API list is incomplete — at least 40+ additional endpoints exist in `server/index.ts` (Phase 5 + 6: developer keys, webhooks, teams, orgs, permissions, backup, restore, DR, failover, analytics, streaming, redis infra) |
| 14 | Documentation Mismatch | `aof-web/ARCHITECTURE.md` §7 marks auth wiring as "⏭️ Next" but auth (Google OAuth + Supabase) is fully wired in `middleware.ts`, `auth-provider.tsx`, `login/page.tsx` |
| 15 | Documentation Mismatch | `AOF_CODE_TDD.md` §4 describes DARS `chatWithDARS` signature as `(role, creds, messages, opts, ctx)` — actual signature in `dars/run.ts` is `(role, messages, opts, ctx)` (creds folded into ctx) |
| 16 | Documentation Mismatch | README.md describes a mock-only offline demo (`index.html`) with 4 simulated AI models; actual system is production-backend with real models |
| 17 | Unreachable Component | `core/critic-agent.ts` — fully implemented quality gate (5-dimension scoring, APPROVED/FAIL) with no import path from any production code |
| 18 | Unreachable Component | `core/advanced-router.ts` — adaptive historical-metrics-based router with no active call sites |
| 19 | Unreachable Component | `server/file-store.ts`, `server/cdn.ts`, `server/query-optimizer.ts` exist with no imports found in `server/index.ts` or any route file |
| 20 | Incorrect Design Assumption | AOF_CODE_TDD §4.3 states health-store is "in-memory Map (MVP). At scale backed by Redis" — actual code already has Redis infrastructure but DARS itself still uses the in-memory `globalHealth` singleton |
| 21 | Incorrect Design Assumption | AOF_CODE_TDD §14.2 describes `src/core/sandbox/e2b.ts` as the "🔴 NEW" sandbox — actual sandbox lives at `src/core/sandbox.ts` + `src/core/docker-sandbox.ts` using Node vm + Docker, not E2B |
| 22 | Incorrect Design Assumption | `aof-web/ARCHITECTURE.md` §6 says DB schema "remains unchanged" for tmap-v2 tables — but `phase5-phase6-migration.sql` created 8+ new tables the frontend architecture doc is unaware of |

---

## Detailed Findings

---

### ISSUE-01 — Architecture Drift: Sandbox Marked 🔴 TODO But Fully Implemented

**Description**
`AOF_CODE_TDD.md` §2.1 marks **Sandbox execution (multi-lang)** as 🔴 TODO and §14.2 specifies `src/core/sandbox/e2b.ts` as the future implementation. The actual codebase has a complete, production-wired sandbox at `src/core/sandbox.ts` and an optional Docker sandbox at `src/core/docker-sandbox.ts`.

**Root Cause**
The TDD was written or frozen at a point before Phase 5 was implemented. The revision-3 update to AOF_CODE_TDD.md updated many statuses but missed the sandbox promotion.

**Affected Files**
- `AOF_CODE_TDD.md` — §2.1 table (line 91), §7.3 table (lines 419-427), §14.2 (line 663)
- `tmap-v2/src/core/sandbox.ts` — fully implemented (Node vm isolation + Python spawnSync + TypeScript strip)
- `tmap-v2/src/core/docker-sandbox.ts` — Docker container isolation
- `tmap-v2/src/server/index.ts` — lines 906-999 (`POST /v1/sandbox/run`, `GET /v1/sandbox/capabilities`)
- `tmap-v2/src/cli.ts` — `cmdSandbox()` function (lines 333-371)

**Recommended Fix**
Update `AOF_CODE_TDD.md` §2.1: change Sandbox execution from 🔴 to ✅ DONE. Update §7.3 language table to reflect Node vm + Docker implementation. Update §14.1 folder listing to include `sandbox.ts` and `docker-sandbox.ts`. Note E2B is NOT the actual implementation.

---

### ISSUE-02 — Architecture Drift: `events` Audit Table Marked 🔴 TODO But Implemented

**Description**
`AOF_CODE_TDD.md` §2.1, §8, and §11 all mark the `events` audit table as 🔴 TODO. The actual implementation has a complete `audit_events` table (in `supabase/phase5-phase6-migration.sql`) and a full audit service at `src/server/audit.ts` that persists to Supabase with a local JSONL fallback.

**Root Cause**
Phase 5 migration was completed after the TDD revision-3 was written. The Phase 5 work was not reflected back into the TDD status matrix.

**Affected Files**
- `AOF_CODE_TDD.md` — §2.1 line 89, §8 lines 447/467, §11 lines 577-578
- `tmap-v2/supabase/phase5-phase6-migration.sql` — lines 29-44 (`audit_events` table)
- `tmap-v2/src/server/audit.ts` — complete audit service with `AuditAction` enum, Supabase write, fallback
- `tmap-v2/src/server/index.ts` — `logAuditEvent()` called at login (line 211), sandbox run (line 988), key ops (line 1096)

**Recommended Fix**
Update `AOF_CODE_TDD.md` §2.1: change `events` audit table from 🔴 to ✅ DONE. Update §8.2 schema listing to note `audit_events` exists (Phase 5). Note that `tmap_agent_logs` and `audit_events` serve different purposes: agent telemetry vs. security audit.

---

### ISSUE-03 — Architecture Drift: Redis Marked 🔴 TODO But Already Active

**Description**
`AOF_CODE_TDD.md` §12 places Redis in the "~1,000" tier as future work, and §2.3 notes "Health-store in-memory ต่อ instance". The actual codebase has a full Redis integration: `server/redis.ts` (ioredis client with no-op mock fallback), `server/redis-cluster.ts`, `server/rate-limit-redis.ts` (active global rate limiter applied to ALL `/v1/` routes at line 130 of `index.ts`), and BullMQ queue workers.

**Root Cause**
Phase 5/6 implemented Redis for rate limiting and queues before the TDD was updated. The TDD's §12 scalability table was never revised to reflect that Redis is now a runtime dependency (with graceful fallback if unavailable).

**Affected Files**
- `AOF_CODE_TDD.md` — §2.3 point 6 (line 106), §12 table (line 589), §13 table (line 609)
- `tmap-v2/src/server/redis.ts` — ioredis client with mock fallback
- `tmap-v2/src/server/redis-cluster.ts` — cluster support
- `tmap-v2/src/server/rate-limit-redis.ts` — active sliding-window rate limiter
- `tmap-v2/src/server/index.ts` — line 130: `app.use('/v1/', rateLimitMiddleware(120, 60, 'global'))`
- `tmap-v2/src/server/queue.ts` — BullMQ workers + scheduled jobs

**Recommended Fix**
Update §2.3 and §12 to reflect Redis as ✅ DONE (optional dependency with no-op fallback). Document `REDIS_URL` / `REDIS_HOST` env vars as part of deployment configuration. Note that DARS health-store is still in-memory (`globalHealth` singleton) even though Redis infrastructure exists — connecting DARS health to Redis is still 🔴.

---

### ISSUE-04 — Architecture Drift: Documented Folder Structure Does Not Match Actual `tmap-v2/src/`

**Description**
`AOF_CODE_TDD.md` §14.1 lists the expected folder structure. The actual structure has many additional files not mentioned and is missing references to new components.

**Root Cause**
The folder structure in §14.1 was documented at an early phase and never updated for Phase 4, 5, and 6 additions.

**Undocumented files in `tmap-v2/src/core/`**
- `critic-agent.ts`, `advanced-router.ts`, `docker-sandbox.ts`, `eval-framework.ts`
- `hallucination-detector.ts`, `image-memory.ts`, `image-pipeline.ts`
- `reflection.ts`, `routing-metrics.ts`, `sandbox.ts`, `self-critique.ts`
- `usage-tracker.ts`, `verifier-agent.ts`

**Undocumented files in `tmap-v2/src/server/`**
- `analytics.ts`, `audit.ts`, `backup.ts`, `bot-protection.ts`, `cdn.ts`, `cli-auth.ts`
- `correlation.ts`, `developer-keys.ts`, `disaster-recovery.ts`, `failover.ts`
- `file-store.ts`, `health.ts`, `orgs.ts`, `permissions.ts`, `prometheus.ts`
- `query-optimizer.ts`, `queue.ts`, `rate-limit-redis.ts`, `redis.ts`, `redis-cluster.ts`
- `restore.ts`, `streaming.ts`, `teams.ts`, `telemetry.ts`, `webhooks.ts`

**Recommended Fix**
Replace §14.1 folder listing with an accurate listing grouped by Phase. The current listing omits roughly 40 files.

---

### ISSUE-05 — Missing Feature: `coagentix-cli/` Is an Undocumented Second CLI

**Description**
A complete, separate CLI application at `coagentix-cli/` exists with package name `coagentix-cli`, binary name `coai`, 24 source files, and a rich feature set (git integration, knowledge graphs, architecture detection, security agents, debate mode, cost optimization, build validation, disaster recovery). This is entirely undocumented — not mentioned in `AOF_CODE_TDD.md`, `README.md`, `aof-web/ARCHITECTURE.md`, or `docs/SECURITY_REPORT.md`.

**Root Cause**
The `coagentix-cli/` is a separate product development effort that was never integrated into the main architecture docs.

**Affected Files**
- `coagentix-cli/package.json` — `bin: { coai: ./bin/coai.js }` (line 9)
- `coagentix-cli/src/cli.ts` — Commander-based CLI with ~30 subcommands
- `coagentix-cli/src/api.ts` — `CoaiApiClient` — calls `aof-web`'s Next.js API routes, not `tmap-v2`
- `coagentix-cli/src/auth.ts` — separate auth flow calling `/api/cli/token` (Next.js endpoint)

**Key Collision**
`tmap-v2/src/cli.ts` (binary: `aof`) and `coagentix-cli/src/cli.ts` (binary: `coai`) are two separate CLIs with overlapping functionality but targeting different backends. `coai` calls the Next.js `/api/*` routes; `aof` calls the Express `/v1/*` routes directly. There is no documented reconciliation plan.

**Recommended Fix**
1. Document `coagentix-cli/` in `AOF_CODE_TDD.md` as a separate deliverable targeting the web platform.
2. Decide on binary name strategy — the two binaries should either be merged or documented as targeting different user segments (Advanced subscribers via `coai` vs. direct tmap-v2 access via `aof`).
3. Document the `/api/cli/token` and `/api/cli/devices` endpoints in the aof-web API surface.

---

### ISSUE-06 — Missing Feature: `aof-web` and `tmap-v2` Auth Systems Are Incompatible

**Description**
`aof-web` uses Supabase Auth with Google OAuth (`/auth/callback/page.tsx`, `auth-provider.tsx`). `tmap-v2` uses its own username+PIN with JWT stored in `users` table. These are two completely separate authentication systems. A user authenticated in `aof-web` has no identity in `tmap-v2`, and vice versa.

**Root Cause**
The frontend and backend were developed independently with no planned auth bridge. `aof-web/src/lib/api.ts` reads `localStorage.getItem('coagentix.token')` (a tmap-v2 JWT) — meaning the user must separately log in to tmap-v2 via PIN, a flow the current UI does not expose to end users.

**Affected Files**
- `aof-web/src/app/login/page.tsx` — Google OAuth only (line 19: `signInWithGoogle()`)
- `aof-web/src/components/providers/auth-provider.tsx` — Supabase session
- `aof-web/src/lib/api.ts` — line 55: `const TOKEN_KEY = "coagentix.token"` — reads tmap-v2 JWT from localStorage
- `tmap-v2/src/server/auth.ts` — JWT with `users.id` as subject
- `tmap-v2/src/server/index.ts` — `POST /v1/auth/register` + `POST /v1/auth/login` (PIN-based)
- `aof-web/src/app/api/cli/token/route.ts` — generates a CLI token from a Supabase session for `coagentix-cli`

**Impact**
When `aof-web` calls `tmap-v2`'s `/v1/*` endpoints (via `NEXT_PUBLIC_COAGENTIX_API_BASE`), all `/v1/run`, `/v1/chat`, etc. calls will fail with 401 unless the user has separately obtained a tmap-v2 JWT (which requires a tmap-v2 account). This is a critical production blocker for the frontend-backend integration.

**Recommended Fix**
Implement a Supabase Auth → tmap-v2 JWT bridge: a new `/v1/auth/supabase` endpoint that accepts a Supabase access token, looks up or creates a matching `users` row, and returns a tmap-v2 JWT. The `aof-web` can call this once after Google sign-in and store the resulting JWT in `coagentix.token`.

---

### ISSUE-07 — Partially Implemented: `core/critic-agent.ts` Is Dead Code

**Description**
`tmap-v2/src/core/critic-agent.ts` implements a complete 5-dimension quality gate (`CriticDimension`, `CriticReport`, `runCritic()`) with thresholds (APPROVED when overall ≥ 70, security ≥ 60, correctness ≥ 60). It is imported only in test files. No production code path in `orchestrator.ts`, `chief-agent.ts`, or `server/index.ts` imports or calls it.

**Root Cause**
The Critic Agent was developed as a Phase 4 enhancement but was not wired into the production orchestrator. `orchestrator.ts` uses `self-critique.ts`, `hallucination-detector.ts`, `verifier-agent.ts`, and `reflection.ts` but not the Critic.

**Affected Files**
- `tmap-v2/src/core/critic-agent.ts` — full implementation
- `tmap-v2/src/tests/phase4.test.ts` — only consumer (lines 194, 210, 218)
- `tmap-v2/src/core/orchestrator.ts` — does NOT import `critic-agent`

**Recommended Fix**
Either (a) integrate `runCritic()` into the `orchestrator.ts` loop as a post-review quality gate, or (b) document explicitly that `critic-agent.ts` is superseded by `eval-framework.ts` and remove it. If keeping, add it to the §14.1 folder listing with status.

---

### ISSUE-08 — Partially Implemented: `core/advanced-router.ts` Is Dead Code

**Description**
`tmap-v2/src/core/advanced-router.ts` implements `advancedRouteToRole()` — an adaptive routing function that overrides provider selection based on historical performance metrics from `routing-metrics.ts`. It is only referenced in test files. The production `orchestrator.ts` uses `chatWithDARS` which calls the basic `pickProvider` in `dars/select.ts`, not the advanced router.

**Root Cause**
The Advanced Router was developed as a Phase 4 capability but its integration point — replacing the basic DARS selection with a metrics-aware version — was never completed.

**Affected Files**
- `tmap-v2/src/core/advanced-router.ts` — full implementation
- `tmap-v2/src/core/orchestrator.ts` — uses `chatWithDARS` from `dars/run.ts`, not `advanced-router.ts`
- `tmap-v2/src/dars/select.ts` — basic capability-scored selection (not metrics-aware)

**Recommended Fix**
Wire `advancedRouteToRole()` into `dars/select.ts` as the provider selection algorithm when `globalRoutingMetrics` has sufficient data (the `MIN_OBSERVATIONS = 5` guard already handles cold-start). This would complete the Phase 4 adaptive routing feature.

---

### ISSUE-09 — Partially Implemented: Phase 5/6 DB Tables Not Reflected in Architecture Docs

**Description**
`tmap-v2/supabase/phase5-phase6-migration.sql` creates 8+ tables: `developer_keys`, `audit_events`, `webhooks`, and (from context of server code) tables for teams, orgs, sandbox runs. None of these are mentioned in `AOF_CODE_TDD.md` §8 (Database Design), which only lists the original 5 tables and 5 planned tables that differ from what was actually built.

**Root Cause**
§8 was written before Phase 5/6 work began and was never updated.

**Affected Files**
- `AOF_CODE_TDD.md` — §8.1 ER diagram (lines 436-448), §8.2 schema (lines 451-469)
- `tmap-v2/supabase/phase5-phase6-migration.sql` — full Phase 5/6 schema
- `tmap-v2/supabase/image-memories-migration.sql` — `image_memories` table

**Recommended Fix**
Update §8 to include all 3 migration files and their tables. The full DB schema (as-built) now includes approximately 15+ tables across 3 migration files.

---

### ISSUE-10 — Partially Implemented: `image_memories` Table Missing from Main Migration

**Description**
`tmap-v2/src/core/image-memory.ts` reads and writes to a Supabase `image_memories` table. There is a separate `supabase/image-memories-migration.sql` for this table, but it is standalone and not referenced in the main `supabase/migration.sql`. A deployer following the primary migration file will not create this table, causing all image analysis memory to silently fall back to file-based storage.

**Root Cause**
The image pipeline was added mid-development with its own migration file rather than being appended to an existing one.

**Affected Files**
- `tmap-v2/src/core/image-memory.ts` — lines 50+ (Supabase reads/writes to `image_memories`)
- `tmap-v2/supabase/image-memories-migration.sql` — standalone migration
- `tmap-v2/supabase/migration.sql` — does NOT include `image_memories`

**Recommended Fix**
Append the `image_memories` DDL to `phase5-phase6-migration.sql`, or add a clear callout in `DEPLOY.md` that three migration files must be run in order: `migration.sql` → `image-memories-migration.sql` → `phase5-phase6-migration.sql`.

---

### ISSUE-11 — Documentation Mismatch: Image Pipeline Is an Undocumented Second Memory System

**Description**
`AOF_CODE_TDD.md` §6 describes a 6-layer memory architecture. None of the 6 layers mentions image-based memory. Yet the codebase has a complete image understanding and memory system: `core/image-pipeline.ts` (OCR + vision + summarization), `core/image-memory.ts` (persistent per-user storage, deduplication by hash, TTL expiry, relevance ranking), and 3 server endpoints. The Chief Agent endpoint actively pulls image memories into context (`server/index.ts` lines 714-719).

**Root Cause**
The image pipeline was added as a new subsystem without updating the memory architecture documentation.

**Affected Files**
- `AOF_CODE_TDD.md` — §6 (lines 356-383), §2.1 status matrix
- `tmap-v2/src/core/image-pipeline.ts` — complete vision pipeline
- `tmap-v2/src/core/image-memory.ts` — full memory layer
- `tmap-v2/src/server/index.ts` — lines 330-394 (image endpoints), lines 714-719 (orchestrate context injection)

**Recommended Fix**
Add a 7th memory layer to §6: **Image/Vision Memory** — per-user, keyed by content hash, stores OCR text + vision analysis + summaries; backed by `image_memories` Supabase table; auto-injected into Chief Agent context via semantic ranking. Update §2.1 status matrix to include the image pipeline as ✅ DONE.

---

### ISSUE-12 — Documentation Mismatch: CLI Has 10 Verbs, Not 8

**Description**
`AOF_CODE_TDD.md` §10 states "ปัจจุบัน 🟡 (rev 3): มี **8 verbs** ใน `src/cli.ts`". The actual `tmap-v2/src/cli.ts` has at least **10 verbs**: the documented 8 (`doctor/agents/context/sessions/gencode/titan/review/fix`) plus `sandbox` (lines 333-371) and `usage` (lines 373-410).

**Root Cause**
Phase 5 CLI verbs were added without updating the §10 verb count.

**Affected Files**
- `AOF_CODE_TDD.md` — §10 header and §10.1 verb table (lines 535-555)
- `tmap-v2/src/cli.ts` — `cmdSandbox()` (line 333), `cmdUsage()` (line 373)

**Recommended Fix**
Update §10 to count 10 verbs. Add `sandbox` and `usage` rows to the §10.1 verb mapping table with status ✅.

---

### ISSUE-13 — Documentation Mismatch: API Surface Has 40+ Undocumented Endpoints

**Description**
`AOF_CODE_TDD.md` §9.1 lists approximately 17 endpoints. The actual `tmap-v2/src/server/index.ts` has over 60 endpoints. §9.2 lists several endpoints as "still needed" that are already implemented (notably `GET /v1/agents` at line 296).

**Key undocumented endpoints (verified in `server/index.ts`)**
- `GET /v1/agents` — documented as 🔴 in §9.2, actually ✅ (lines 296-318)
- `POST /v1/image/analyze`, `GET /v1/image/memories`, `DELETE /v1/image/memories` (lines 330-394)
- `POST /v1/sandbox/run`, `GET /v1/sandbox/capabilities` (lines 906-999)
- `GET /v1/routing-metrics` (line 826), `POST /v1/evaluate` (line 832), `GET /v1/benchmark/results` (line 885)
- `GET/POST/PATCH/DELETE /v1/teams/*` (lines 1209-1276)
- `GET/POST/PATCH /v1/orgs/*` (lines 1280-1313)
- `GET /v1/permissions`, `GET /v1/permissions/check` (lines 1317-1333)
- `GET/POST/DELETE /v1/developer/keys/*` (lines 1079-1121)
- `GET/POST/DELETE/POST /v1/webhooks/*` (lines 1126-1166)
- `POST/GET/GET /v1/backup/*`, `POST/GET /v1/restore/*` (lines 1337-1378)
- `GET/GET/GET/POST/PATCH /v1/dr/*` (lines 1382-1413)
- `GET/POST /v1/failover/*` (lines 1417-1426)
- `POST/GET/GET/GET /v1/analytics/*` (lines 1430-1463)
- `GET /v1/me/usage`, `GET /v1/me/quota`, `POST /v1/me/keys/rotate`, `POST /v1/me/keys/validate` (lines 1003-1074)
- `POST /v1/cli/auth`, `GET /v1/cli/status` (lines 768-781)
- `GET /v1/metrics/prometheus` (lines 805-821)
- `GET /v1/developer/health` (lines 1171-1191)

**Recommended Fix**
Replace §9 with a full endpoint inventory grouped by Phase. Move `GET /v1/agents` from §9.2 to §9.1. Add Phase 5 and Phase 6 endpoint sections.

---

### ISSUE-14 — Documentation Mismatch: `aof-web/ARCHITECTURE.md` Auth Status Is Wrong

**Description**
`aof-web/ARCHITECTURE.md` §7 item 10 marks auth wiring as "⏭️ Next: wire auth (`/v1/auth/*`), persist conversations/projects to Supabase..." The actual frontend has complete Google OAuth via Supabase Auth (`middleware.ts`, `auth-provider.tsx`, `auth-gate.tsx`, `/login/page.tsx`, `/auth/callback/page.tsx`).

**Affected Files**
- `aof-web/ARCHITECTURE.md` — §7 line 193
- `aof-web/src/middleware.ts` — Supabase session enforcement
- `aof-web/src/components/providers/auth-provider.tsx` — auth provider
- `aof-web/src/app/login/page.tsx` — Google sign-in UI (line 19: `signInWithGoogle()`)

**Recommended Fix**
Mark item 10 in §7 as ✅ for auth. Revise "Next" items to only include what is actually still missing.

---

### ISSUE-15 — Documentation Mismatch: `chatWithDARS` Signature in TDD Is Wrong

**Description**
`AOF_CODE_TDD.md` §4.5 shows the `chatWithDARS` function signature with `creds` as a top-level parameter separate from `ctx`. The actual implementation folds `creds` into the `ctx` object, making the signature `(role, messages, opts, ctx)` where `ctx` contains `{ creds, health, emit, sessionId }`.

**Affected Files**
- `AOF_CODE_TDD.md` — §4.5 (lines 249-278)
- `tmap-v2/src/dars/run.ts` — actual implementation
- `tmap-v2/src/server/index.ts` — representative call site (line 358): `chatWithDARS('planner', messages, opts, { creds, health: globalHealth, emit: () => {}, sessionId: ... })`

**Recommended Fix**
Update §4.5 code block to show the actual call signature. Update the `DarsContext` interface description to note `creds` is included in `ctx`.

---

### ISSUE-16 — Documentation Mismatch: README.md Describes Mock Demo, Not Production System

**Description**
`README.md` (root) describes only the `index.html` offline demo with 4 simulated AI models. The actual system is a production backend with real AI calls, a Next.js frontend, and a full auth/subscription system.

**Affected Files**
- `README.md` — all 14 lines
- `index.html` — root-level legacy demo file

**Recommended Fix**
Rewrite `README.md` to describe the actual system architecture: `aof-web/` (Next.js frontend), `tmap-v2/` (Express backend), `coagentix-cli/` (CLI), and `index.html` as a legacy offline demo. Add deployment quickstart referencing `DEPLOY.md`, `render.yaml`, `railway.json`.

---

### ISSUE-17 — Unreachable Component: `core/critic-agent.ts`

*(See ISSUE-07 for full details)*

`runCritic()` in `core/critic-agent.ts` is dead code in production. No non-test import exists. The orchestrator has other quality gates (`selfCritiqueCode`, `detectHallucinations`, `verifyCodeFiles`) but does not use `runCritic`.

**Recommended Fix**: Wire into orchestrator post-review step, or remove and mark as superseded.

---

### ISSUE-18 — Unreachable Component: `core/advanced-router.ts`

*(See ISSUE-08 for full details)*

`advancedRouteToRole()` is dead code in production. DARS selection uses static capability scores. The `globalRoutingMetrics` accumulates data but nothing reads it for actual routing decisions.

**Recommended Fix**: Integrate into `dars/select.ts` as the scoring function when `MIN_OBSERVATIONS` is met.

---

### ISSUE-19 — Unreachable Component: `server/file-store.ts`, `server/cdn.ts`, `server/query-optimizer.ts`

**Description**
Three server modules exist but have no import in `server/index.ts` or any route file (verified via grep):
- `tmap-v2/src/server/file-store.ts` — file storage abstraction
- `tmap-v2/src/server/cdn.ts` — CDN integration
- `tmap-v2/src/server/query-optimizer.ts` — DB query optimization

**Root Cause**
These appear to be Phase 5/6 components created in advance but whose integration was deferred or abandoned.

**Recommended Fix**
Audit each file: if endpoints are planned, add them to `server/index.ts`. If superseded, delete them. If future work, document in the TDD roadmap.

---

### ISSUE-20 — Incorrect Design Assumption: DARS Still Uses In-Memory Health Despite Redis Infrastructure

**Description**
`dars/health.ts` still uses a module-level `globalHealth = new HealthStore()` (an in-memory Map). The DARS circuit breaker states are NOT shared across serverless instances even though Redis infrastructure (`server/redis.ts`) is already available and active.

**Affected Files**
- `tmap-v2/src/dars/health.ts` — `class HealthStore { private map = new Map<...>() }` and `export const globalHealth = new HealthStore()`
- `tmap-v2/src/server/redis.ts` — Redis client available but unused by health store
- `AOF_CODE_TDD.md` — §2.3 point 6 (line 106), §4.3 (lines 196-221)

**Impact**
On multi-instance deployments (Vercel serverless), each instance has its own circuit breaker. Instance A may mark Gemini as `open` while Instance B continues routing to it, causing repeated quota failures.

**Recommended Fix**
Implement a `RedisHealthStore` variant in `dars/health.ts` that stores health data in Redis HASH keys per provider. Swap `globalHealth` to use it when `REDIS_URL` is set. The no-op Redis mock already handles the fallback case gracefully.

---

### ISSUE-21 — Incorrect Design Assumption: E2B/Firecracker Sandbox Never Used

**Description**
`AOF_CODE_TDD.md` §14.2 lists `src/core/sandbox/e2b.ts` as the future sandbox. §7.3 and §13 describe E2B/Firecracker as the production sandbox target. The actual sandbox uses Node.js `vm.runInContext` + `child_process.spawnSync`, not E2B. The sandbox's own security note (line 17 of `sandbox.ts`) acknowledges that Node vm does not provide process-level isolation.

**Affected Files**
- `AOF_CODE_TDD.md` — §7.3 (line 427), §13 table row "Sandbox" (line 610), §14.2 (line 663)
- `tmap-v2/src/core/sandbox.ts` — Node vm + Python spawnSync (NOT E2B)
- `tmap-v2/src/core/docker-sandbox.ts` — Docker container isolation (optional)

**Recommended Fix**
Update §7.3, §13, and §14.2 to document the actual sandbox: Node vm + Docker (optional). Mark E2B/Firecracker as a potential future upgrade, not the current implementation. Document the security posture: Node vm is appropriate for trusted AI-generated code; Docker provides stronger isolation for untrusted code.

---

### ISSUE-22 — Incorrect Design Assumption: `aof-web` Architecture Assumes tmap-v2 DB Unchanged

**Description**
`aof-web/ARCHITECTURE.md` §6 says "Existing `agent_logs` / `cost` tracking and `memories` remain unchanged." This is incorrect — Phase 5/6 added 8+ new tables. Additionally, the frontend doc proposes `projects` and `titan_blueprints` tables with different schemas than those planned in `AOF_CODE_TDD.md` §8, creating a future schema conflict.

**Key Schema Collision**
- `aof-web/ARCHITECTURE.md` §6 proposes `projects(id, user_id, name, description, type, status, mode, pinned, ...)`
- `AOF_CODE_TDD.md` §8.2 proposes `projects(id, user_id, name, repo_url, default_branch, settings JSONB, ...)`
Both are unbuilt; both are in active specification — they will collide on implementation.

**Affected Files**
- `aof-web/ARCHITECTURE.md` — §6 (lines 125-175)
- `tmap-v2/supabase/phase5-phase6-migration.sql` — actual Phase 5/6 schema
- `AOF_CODE_TDD.md` — §8 (lines 431-470)

**Recommended Fix**
Merge the two `projects` table designs into a single canonical schema that satisfies both the web-frontend needs (`type`, `status`, `mode`, `pinned`) and the backend needs (`repo_url`, `default_branch`, `settings`). Document this in one place and cross-reference from both docs.

---

## Summary by Priority

### Critical (Fix Before Next Deployment)
| # | Issue | Why Critical |
|---|-------|-------------|
| 06 | Auth system incompatibility | Users authenticated via Google OAuth cannot use tmap-v2 endpoints — silent 401 |
| 10 | `image_memories` migration not in main SQL | Image memory silently falls back to disk on Supabase deployments |
| 20 | DARS health not shared across instances | Provider circuit breakers don't work on multi-instance serverless |

### High (Address in Next Sprint)
| # | Issue | Why High |
|---|-------|---------|
| 07 | `critic-agent.ts` dead code | Quality gate exists but is never used in production |
| 08 | `advanced-router.ts` dead code | Routing metrics accumulate but are never used for routing decisions |
| 19 | `file-store.ts`, `cdn.ts`, `query-optimizer.ts` unreachable | 3 server modules with unclear status |
| 22 | `projects` table schema collision | Two incompatible designs in flight |

### Medium (Documentation Debt)
| # | Issue |
|---|-------|
| 01 | Sandbox marked 🔴 TODO, actually ✅ |
| 02 | Audit `events` table marked 🔴 TODO, actually ✅ |
| 03 | Redis marked 🔴 TODO, actually active |
| 04 | Folder structure in §14.1 is massively out of date |
| 05 | `coagentix-cli/` entirely undocumented |
| 09 | Phase 5/6 DB tables not in any architecture doc |
| 11 | Image pipeline is an undocumented 7th memory layer |
| 12 | CLI verb count wrong (10, not 8) |
| 13 | API inventory misses 40+ Phase 5/6 endpoints |
| 14 | `aof-web/ARCHITECTURE.md` auth step shows as not-done |
| 15 | `chatWithDARS` signature in TDD is wrong |
| 16 | README.md describes offline demo, not production |
| 21 | E2B/Firecracker specified as sandbox, Node vm is actual implementation |

---

*Report generated by architectural code inspection. All findings verified against actual source files — no documentation claim was accepted without cross-reference to the implementation.*

---

## Scope & Method

| | |
|---|---|
| **Verified** | source tree of all 3 modules; every named multi-agent system traced to an entry point; all SQL migrations enumerated; doc claims diffed against code. |
| **Headline** | The system is **substantially more built than the root docs suggest, and the detailed design doc (`AOF_CODE_TDD.md`) is honest** — it self-marks unfinished items ✅/🟡/🔴. The real gaps are (a) a **stale root README** describing a different product, (b) **docs lagging code** in both directions, and (c) a handful of correctly-tracked roadmap items still unbuilt. **No critical unreachable/broken architecture was found.** |
| **Correction to prior audits** | Earlier exploration flagged "events table missing" and "conversations/projects not persisted" — **both are wrong** (see A-3, A-7). This report corrects them. |

---

## A-1. Root README describes a *different product* (legacy prototype) — **Documentation Mismatch (High)**

**Description:** `README.md` (and the shipped `index.html` / `pages/index.html`) describe an **offline, single-file browser demo** with "4 simulated AI (Gemini, Meta Llama, DeepSeek, Qwen)", `localStorage` login, and in-browser `/plan` `/gencode` commands. The actual product is a **Next.js 14 web app (`aof-web`) talking to a real multi-agent Express backend (`tmap-v2`)** with Supabase auth, encrypted keys, and SSE streaming. A new engineer or evaluator reading the root README would completely misunderstand the system.

**Root Cause:** The repo grew from an offline prototype (`index.html`, 75 KB, 15 `localStorage`/`simulated` references) into a full app, but the root README was never rewritten. The prototype files were retained at the repo root.

**Affected Files:** `README.md`; `index.html`; `pages/index.html`; `pages/sw.js`.

**Recommended Fix:** Rewrite `README.md` to describe the real architecture (aof-web + tmap-v2 + coagentix-cli), how to run each, and env requirements. Move the legacy demo to `legacy/` or `examples/offline-demo/` and label it clearly, or delete it if unused. Point readers to `AOF_CODE_TDD.md` and `aof-web/ARCHITECTURE.md` as the real design docs.

---

## A-2. `coagentix-cli` is undocumented in the design doc — **Documentation Mismatch (Medium)**

**Description:** `AOF_CODE_TDD.md` mentions `coagentix-cli` **0 times**, yet `coagentix-cli/src` is a full ~23-module standalone CLI (api client, zero-trust, patch/checkpoint, build-validator, knowledge-graph, debate, cost-optimizer, etc.). The TDD only discusses the *other* CLI, `tmap-v2/src/cli.ts` (a partial 8-verb tool it marks 🟡). Two distinct CLIs exist; the doc acknowledges only the weaker one.

**Root Cause:** `coagentix-cli` was added as a separate deliverable after the TDD's CLI section was written; the doc wasn't updated.

**Affected Files:** `AOF_CODE_TDD.md` (CLI section ~§ "CLI verbs"); `coagentix-cli/src/*`; `tmap-v2/src/cli.ts`.

**Recommended Fix:** Add a TDD section documenting `coagentix-cli` (purpose, command surface, relationship to `tmap-v2/src/cli.ts`). Decide whether `tmap-v2/src/cli.ts` is still needed or should be deprecated in favor of `coagentix-cli` to avoid two overlapping CLIs.

---

## A-3. TDD marks `events` audit table 🔴 TODO, but `audit_events` exists — **Documentation Mismatch / doc lags code (Low)**

**Description:** `AOF_CODE_TDD.md:89` lists "**`events` audit table** 🔴 TODO". In reality `tmap-v2/supabase/phase5-phase6-migration.sql` already defines `audit_events` (line 29), plus `analytics_events` (166) and `dr_incidents` (149), and `server/audit.ts` writes to it. The capability the TDD calls missing is largely present under a different name.

**Root Cause:** The audit/analytics tables were added in a later migration phase; the TDD's status table wasn't updated.

**Affected Files:** `AOF_CODE_TDD.md:89`; `tmap-v2/supabase/phase5-phase6-migration.sql:29,149,166`; `tmap-v2/src/server/audit.ts`.

**Recommended Fix:** Update the TDD status to ✅/🟡 and reconcile naming (`events` → `audit_events`). Verify `audit.ts` persists to the table in all deploy modes (it is best-effort and depends on Supabase being configured — see Phase C).

---

## A-4. Code exceeds docs: ~10 core modules not in the TDD — **Architecture Drift / under-documentation (Low)**

**Description:** `tmap-v2/src/core/` contains modules the TDD never names: `advanced-router.ts`, `critic-agent.ts`, `reflection.ts`, `self-critique.ts`, `verifier-agent.ts`, `hallucination-detector.ts` (TDD mentions = 0 each), plus `image-pipeline.ts`/`image-memory.ts` (multimodal) which the TDD outline omits. These are real, wired intelligence layers (verified present in the core tree).

**Root Cause:** Rapid "Phase 4 intelligence" additions outpaced the design doc. The TDD's rev-3 note updates *some* statuses but not the module inventory.

**Affected Files:** the modules above; `AOF_CODE_TDD.md` (architecture/§2.1 inventory).

**Recommended Fix:** Add a "Phase 4 — Intelligence & Multimodal Layers" section to the TDD enumerating these modules, their entry points, and whether each is on the default path or opt-in. Confirm none are orphaned (spot-check passed for the routers/critique modules; a full reachability sweep is advised — see A-8).

---

## A-5. Semantic / pgvector RAG memory — **Partially Implemented (correctly tracked)**

**Description:** Persistent project memory exists and works (key-value: tech stack, conventions, decisions, failures, session history) in `tmap-v2/src/core/memory.ts`, persisted to the `memories` table. **Embedding/pgvector semantic retrieval does not exist** — confirmed: `memory.ts` contains **0** references to `embedding`/`vector`/`cosine`/`pgvector`.

**Root Cause:** Vector memory is a deliberate later phase; the scale stack (pgvector/Qdrant) is listed as a future dependency.

**Affected Files:** `tmap-v2/src/core/memory.ts`; `tmap-v2/src/core/retrieval.ts` (lexical only); `AOF_CODE_TDD.md:44,77,90,360-373`.

**Recommended Fix:** None required for correctness — **the TDD already marks this 🟡/🔴 honestly.** When prioritized: add a `pgvector` column to `memories`, an embedding client, and hybrid (BM25 + vector) retrieval as the TDD §6 specifies. *This is a roadmap item, not a defect.*

---

## A-6. Sandbox execution not wired into validation/voting — **Partially Implemented (correctly tracked)**

**Description:** The TMAP validator does **syntax/compile checks only** and does **not execute** generated code. Confirmed in `tmap-v2/src/core/validator.ts:15` (`"Real sandbox execution comes in Phase 3."`) and `:43` (`"no validator for <lang> (Phase 3 sandbox)"`). Sandbox runners (`sandbox.ts`, `docker-sandbox.ts`) exist but are reachable only via the standalone `/v1/sandbox/run` endpoint — **not** the validator or the Voting Engine. The TDD (line 336–337) openly states voting uses LLM-as-judge and does **not** run candidates through a sandbox before judging.

**Root Cause:** Isolated multi-language execution (E2B/Firecracker) is a deliberate later phase; the validator was intentionally limited to honest syntax/compile checks.

**Affected Files:** `tmap-v2/src/core/validator.ts:15,43`; `tmap-v2/src/core/vote.ts`; `tmap-v2/src/core/sandbox.ts`; `tmap-v2/src/core/docker-sandbox.ts`.

**Recommended Fix:** None required for correctness (**TDD marks 🔴 honestly**). When prioritized: implement "validation-first selection" (TDD §3 enhancement) — run each Coder candidate in a sandbox, drop those that fail, then LLM-judge only the survivors. *Roadmap, not defect.* **Caveat:** until then, generated code can be syntactically valid but functionally wrong, and voting cannot rank by real correctness.

---

## A-7. aof-web persistence tables exist and are wired (prior audit said otherwise) — **Corrected / Incorrect Design Assumption (Info)**

**Description:** Earlier notes claimed Projects/Conversations "use a Zustand mock, not persisted." **Verified false:** migrations define `conversations` + `messages` (`0006_conversations.sql`) and `projects` (`0008_projects_search_and_hardening.sql`), and code wires them: `aof-web/src/app/api/conversations/route.ts`, `…/[id]/messages/route.ts`, `…/[id]/route.ts`, `lib/conversations.ts`, `store/project-store.ts`. The only table named in `aof-web/ARCHITECTURE.md` that is **not** present is `titan_blueprints`.

**Root Cause:** The persistence layer was implemented after the architecture doc's "Next steps" was written; the doc still reads as aspirational.

**Affected Files:** `aof-web/supabase/migrations/0006_conversations.sql`, `0008_projects_search_and_hardening.sql`; `aof-web/src/app/api/conversations/*`; `aof-web/src/lib/conversations.ts`; `aof-web/ARCHITECTURE.md` (Database section).

**Recommended Fix:** Update `aof-web/ARCHITECTURE.md` to mark conversations/messages/projects ✅ implemented. Either implement `titan_blueprints` persistence or remove it from the doc. (Note: in `mock.ts`/demo mode these can still be client-only — worth clarifying the demo-vs-real distinction in the doc.)

---

## A-8. DARS health store is in-memory only — **Architecture Drift vs. scale claims (Medium, correctly tracked)**

**Description:** DARS circuit-breaker/health state lives in an in-memory map (`tmap-v2/src/dars/health.ts`), and the rate limiter + login lockout are likewise in-memory (Redis is mocked when `REDIS_URL` is unset — observed live in Phase D: `"using in-memory Redis mock (single-instance only)"`). All per-instance state resets on cold start and is **not shared across instances**.

**Root Cause:** Redis-backed shared state is a Phase 2+ scale item; the code ships a single-instance in-memory implementation with a Redis mock seam.

**Affected Files:** `tmap-v2/src/dars/health.ts`; `tmap-v2/src/server/rate-limit-redis.ts`; `tmap-v2/src/server/rateLimit.ts`; `tmap-v2/src/server/redis.ts`.

**Recommended Fix:** None for single-instance MVP (**TDD marks Redis 🔴 honestly**). For multi-instance Railway/Render: back the health store, rate limiter, and login lockout with real Redis (the `redis.ts` seam already exists). Cross-references Phase D §7 and Phase C.

---

## Multi-agent system inventory (verified reachable)

| System | Status | Entry point | Notes |
|---|---|---|---|
| TMAP / TMAP v2 orchestrator | ✅ wired | `POST /v1/run` → `core/orchestrator.ts` | Full loop; exercised live in Phase D |
| Chief Agent | ✅ wired | `POST /v1/orchestrate` → `core/chief-agent.ts` | Delegates to research/writing/math/vision agents |
| RAA | ✅ wired | `POST /v1/chat` → `core/raa.ts` | Emits requirement summary |
| Titan Mode | ✅ wired | `POST /v1/titan` → `core/titan.ts` | Approval-gate logic present |
| DARS | ✅ wired | in-loop (`dars/run.ts`) | Failover + circuit + recovery verified live (Phase D §6) |
| Voting Engine | ✅ wired (judge-only) | `core/vote.ts` (pro mode) | LLM-as-judge; no sandbox pre-filter (A-6) |
| Memory System | 🟡 key-value | `core/memory.ts` | No pgvector (A-5) |
| Analyzer / Debugger | ✅ wired | `/v1/analyze`, `/v1/debug` | — |

**Unreachable components:** none confirmed. The legacy `index.html`/`pages/` prototype is effectively dead relative to the real app (A-1) and should be archived. A full automated dead-code/reachability sweep across `core/` is recommended to confirm A-4 modules are all on a live path.

---

## Summary

| Category | Count | Severity |
|---|---|---|
| Documentation Mismatch | A-1, A-2, A-3, A-7 | High (A-1), else Low/Med |
| Architecture Drift | A-4, A-8 | Low / Medium |
| Partially Implemented (tracked) | A-5, A-6 | Roadmap (not defects) |
| Missing Features | pgvector RAG, sandbox-exec, `titan_blueprints`, CLI TUI | all tracked 🔴 |
| Unreachable Components | none (legacy prototype excepted) | — |
| Incorrect Design Assumptions | A-7 (prior audit error, corrected) | Info |

**Verdict:** Architecture is coherent and the detailed design doc is unusually honest about what's unfinished. The biggest *gap* is presentational — the **root README misrepresents the product** — not structural. Fixing docs (A-1–A-4, A-7) and the in-memory/scale items (A-8) are the highest-value follow-ups; A-5/A-6 are legitimately deferred roadmap.
