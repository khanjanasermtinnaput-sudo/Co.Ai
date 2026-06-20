# Co.AI (CoAgentix) — Production Audit

**Date:** 2026-06-21
**Branch:** `audit/production-hardening`
**Scope:** Full monorepo — `aof-web` (Next.js 14), `tmap-v2` (agent engine + Express), `coagentix-cli`, Supabase migrations, static demo.
**Method:** Grounded in real tool output — `tsc --noEmit`, `next lint`, both `npm test` suites, and targeted security/dead-code static analysis. No findings were invented; every claim below is backed by a command result or a `file:line` reference.

---

## Executive summary

This is a **mature, well-engineered codebase**, not the bug-ridden one the audit brief assumed. Baseline health is strong:

| Check | aof-web | tmap-v2 |
|-------|---------|---------|
| `tsc --noEmit` (strict) | ✅ clean | ✅ clean |
| `eslint` / `next lint` | ✅ clean | n/a (no eslint config) |
| Unit tests | ✅ 178 pass / 0 fail | ✅ 432 pass / 0 fail / 4 skipped |
| `any` usage | minimal (9 total repo-wide) | — |
| Hardcoded secrets | none (only `.env.example` placeholders + env refs) | none |

The codebase already implements many things a typical audit *recommends*: CSRF origin checks, defense-in-depth admin authorization, AES-256-GCM key encryption at rest with a scrypt KDF, structured error classification, rate limiting, provider failover, and safe markdown rendering.

**Net result of this audit:** 1 verified authorization hardening fix applied; no other Critical/High issues found. Production readiness is high (see `final-production-report.md`).

---

## Findings by severity

### Critical
None found.

### High

**H-1 — Admin middleware failed open when service-role key absent** ✅ FIXED
`aof-web/src/middleware.ts`
The admin-role gate was wrapped in `if (serviceKey)`. When `SUPABASE_SERVICE_ROLE_KEY` was unset, the entire role check was skipped and any *authenticated* user fell through to the admin surface. Mitigating factor: every `/api/admin/*` route handler independently re-checks the role and fails closed (`requireAdminUser` → 503/403), so the practical exposure was the admin **page shell** under a misconfiguration, not the data APIs.
**Fix:** the gate is now fail-closed — a missing service key, a query error, or any non-elevated role denies access (403 for `/api/*`, redirect for pages). Verified: `tsc` + `lint` clean.

### Medium

**M-1 — Middleware allows all traffic when Supabase is unconfigured** (by design, document the risk)
`aof-web/src/middleware.ts:60` — `if (!supabaseUrl || !supabaseAnonKey) return NextResponse.next();` lets protected routes through so local dev works without Supabase. This is intentional and safe for dev, but in any deployed environment the env vars must be present or the auth layer is a no-op. *Recommendation:* gate this bypass on `NODE_ENV !== "production"`, or fail closed in production. Not changed automatically because it could break an intended keyless preview deployment — this is a deployment-policy decision.

**M-2 — Static KDF salt for key encryption** (accepted, documented)
`aof-web/src/lib/server/crypto.ts:17` and the tmap-v2 mirror use a fixed `KDF_SALT`. This is a deliberate, documented trade-off (a per-record salt would require schema changes and a migration; per-record randomness already comes from the GCM IV). Acceptable; noted for completeness.

### Low

**L-1 — `console.*` noise** — 410 occurrences, but ~90% are in `coagentix-cli` (where console *is* the UI) and test files. The server/web `console.warn/error` calls are intentional structured auth/diagnostic logs. No action; see `cleanup-report.md`.

**L-2 — Admin user listing loads all users into memory** `aof-web/src/app/api/admin/users/route.ts:49-68` — paginates Supabase in 1000-row batches then filters in-memory. The code already flags this with a `TODO`-style comment recommending a DB view + RPC for very large user bases. Fine at current scale; see `performance-report.md`.

---

## Phase coverage map

| Brief phase | Where covered | Outcome |
|-------------|---------------|---------|
| 1 Full scan | this file | healthy baseline |
| 2 Bug detection | `bug-fixes.md` | no runtime/type/test failures found |
| 3 Cleanup | `cleanup-report.md` | minimal dead code |
| 4 TypeScript hardening | `typescript-report.md` | already strict; 9 `any` total |
| 5 Security | `security-report.md` | 1 fix (H-1); rest clean |
| 6 Performance | `performance-report.md` | one scaling note (L-2) |
| 7 AI systems | `ai-systems-report.md` | systems present + tested |
| 8 Providers/keys | `security-report.md` §providers | env-driven, fails soft |
| 9 Database | `database-report.md` | RLS-by-design, migrations present |
| 10 Production readiness | `final-production-report.md` | scored |

---

## Changes applied in this audit
- `aof-web/src/middleware.ts` — admin gate made fail-closed (H-1).

All other phases were **investigated and found clean**; no speculative edits were made to a passing codebase.
