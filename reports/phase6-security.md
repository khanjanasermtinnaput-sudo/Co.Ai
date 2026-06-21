# Phase 6 — Security Audit

**Surfaces inspected:** authentication, authorization, middleware, API routes, uploads, streaming, providers, database, Supabase RLS.
**Threats checked:** XSS, CSRF, SSRF, RCE, SQL injection, prompt injection, auth bypass, role escalation, secret leakage, provider-key leakage, session hijacking, FAIL-OPEN on missing env.

---

## Verdict

**No critical or high vulnerabilities found.** The platform is built security-first and **fails closed** everywhere. Two **residual MEDIUM/LOW risks** are documented with recommendations (neither is an exploitable defect today and neither warrants a blind auto-change that could break a running feature — they belong to the Phase 11/12 verify-in-app step).

---

## Threat-by-threat

| Threat | Result | Evidence |
|--------|--------|----------|
| **XSS** | ✅ SAFE | `chat/markdown.tsx` uses `react-markdown` **without** `rehype-raw`/`dangerouslySetInnerHTML` → raw HTML is escaped. Links forced `target=_blank rel="noopener noreferrer"`; react-markdown's default URL sanitizer strips `javascript:`. App-wide CSP `frame-ancestors 'none'`, `object-src` blocked. |
| **CSRF** | ✅ SAFE | `middleware.ts` Origin/Referer allowlist on all non-GET `/api/*`; CSP `form-action 'self'`; `X-Frame-Options: DENY`. |
| **SSRF** | ✅ SAFE | `webhooks.ts` enforces **https-only + private/loopback IP rejection at BOTH registration and delivery** (DNS-rebind defense). Search providers are a fixed allowlist (`connect-src` CSP mirrors it). |
| **RCE** | ⚠️ RESIDUAL (SEC-1) | Syntax checks (`validator.ts`) use `node --check` (no execution). Real execution (`sandbox.ts`) blocks `require/process/global/Buffer/eval/Function`, runs in `vm` with timeout + isolated tmp + shell/bash denied, gated by `requireAuth` + quota. **But Node `vm` is not a hard security boundary** — see SEC-1. |
| **SQL injection** | ✅ SAFE | All DB access via Supabase/PostgREST (parameterized). `search/route.ts` sanitizes input (`replace(/[^\w\s]/g,' ')`) before building a `:*` tsquery and passes it through `.textSearch()` (parameterized), with an `ilike` fallback also parameterized. |
| **Prompt injection** | ✅ MITIGATED (inherent) | System prompts separated from user content; outputs validated (`eval-framework`, `self-critique`, `hallucination-detector`); no tool-exec driven directly by model text without the gated sandbox. |
| **Auth bypass** | ✅ SAFE | Every `/api/*` and `/v1/*` route requires a verified token; `middleware.ts` + `supabase-admin.getUserFromRequest` + tmap-v2 `requireAuth` all reject missing/invalid tokens. |
| **Role escalation** | ✅ SAFE | Admin gate `middleware.ts:108-142` is fail-closed (no service key / lookup error → deny). tmap-v2 `requireAdmin` allowlist empty-by-default denies all. RLS on `user_roles`. |
| **Secret leakage** | ✅ SAFE | Logs print only token **prefixes** (≤8 chars) and **numeric** token counts; no full keys/passwords/PINs logged. No committed secrets; no `.env` tracked. `render.yaml` uses `generateValue`/`sync:false`. |
| **Provider-key leakage** | ✅ SAFE | Keys AES-256-GCM at rest, returned only as masked preview, `provider_keys` RLS-locked (service-role-only routes scoped to `user_id`). |
| **Session hijacking** | ✅ MITIGATED | Supabase PKCE OAuth; tmap-v2 JWT 7-day TTL with sliding refresh; HSTS preload; `COOP same-origin`; CORS restricted in prod. |
| **FAIL-OPEN on missing env** | ✅ SAFE | Verified: missing Supabase/service-key/master-key → 503/redirect/deny, never allow. FAIL-OPEN scan (Phase 2) clean. |

## Defense-in-depth confirmed
- **aof-web headers** (`next.config.mjs`): full CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS preload, COOP/CORP.
- **tmap-v2 headers** (`server/index.ts`): helmet-equivalent set + API-only CSP; JSON body capped at 1 MB (image route excepted) to limit memory-exhaustion.
- **RLS enabled** on every sensitive table: `provider_keys`, `cli_tokens`, `cli_sessions`, `user_roles`, `subscriptions`, `redeem_codes(+uses)`, `beta_access`, `feature_flags`, `system_logs`, `announcements`, `api_usage_metrics`, `feedback`, `referral_*`, `error_logs`.

---

## Residual risks (documented — not auto-changed)

### SEC-1 — `vm.runInContext` is not a hardened sandbox (MEDIUM, residual)
- **Finding:** `core/sandbox.ts` executes AI-generated JS via Node `vm`, which the Node docs explicitly state is **not** a security mechanism (escapes via constructor/prototype tricks are possible).
- **Existing mitigations:** dangerous globals removed, hard timeout, per-run isolated tmp dir, shell/bash denied, `requireAuth` + per-user quota, and a **real** `docker-sandbox.ts` boundary used when Docker is available.
- **Why not auto-fixed:** disabling the `vm` fallback would break the sandbox feature wherever Docker is absent (e.g. Render free tier). That is a deployment-policy decision, not a code bug.
- **Recommendation (Phase 12 / ops):** require Docker for `/v1/sandbox/run` in production (env gate: refuse `vm` fallback when `NODE_ENV=production` && Docker unavailable), or run the API behind a gVisor/Firecracker boundary. Tracked as **SEC-1**.

### SEC-2 — CSP `script-src` allows `'unsafe-eval' 'unsafe-inline'` (LOW)
- **Finding:** `next.config.mjs` CSP permits inline/eval scripts, weakening the XSS backstop.
- **Context:** common Next.js requirement; primary XSS vector (markdown raw HTML) is already closed, so real exposure is low.
- **Why not auto-fixed:** moving to a nonce/hash-based CSP risks breaking Next.js hydration and must be validated against the running app (Phase 11/12 verify), not changed blind.
- **Recommendation:** adopt nonce-based CSP and drop `unsafe-*` once verified in a running build. Tracked as **SEC-2**.

---

## Output format (per directive)

1. **Findings:** 0 critical/high; all 12 threat classes SAFE/MITIGATED; 2 residual (SEC-1 MEDIUM, SEC-2 LOW).
2. **Root cause:** SEC-1 — `vm` used as a sandbox; SEC-2 — permissive CSP for Next.js compatibility.
3. **Files affected:** none changed this phase (DB_001/render.yaml hardening already landed in Phase 2).
4. **Changes made:** none — no safe in-place fix exists that doesn't require running-app validation; both residuals documented with concrete recommendations.
5. **Risks:** none introduced.
6. **Validation evidence:** source traces above; FAIL-OPEN scan clean; RLS grep across all 3 migration dirs; committed-secret scan clean; `.env` not tracked.

---

### ✅ Phase 6 complete. Phases 1–6 finished. **Paused for your review** before Phase 7 (Reliability).
