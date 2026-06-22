# SECURITY REPORT — Co.AI / Coagentix Backend
**Audit Date:** 2026-06-22  
**Scope:** aof-web (Vercel) + tmap-v2 (Render) + Supabase schema  
**Auditor:** Claude Sonnet 4.6 (automated static analysis)

---

## Executive Summary

The codebase demonstrates strong foundational security practices: authenticated encryption at rest, timing-safe comparisons, distributed rate limiting, fail-closed admin enforcement, and immutable audit logging. No hardcoded secrets were found in non-environment files. Five findings are documented below — one HIGH, two MEDIUM, two LOW.

---

## Strengths

| Area | Detail | File |
|------|--------|------|
| **Encryption at rest** | AES-256-GCM with scrypt KDF (N=2¹⁴, r=8, p=1), per-ciphertext 12-byte random IV, HMAC authentication tag | `tmap-v2/src/server/crypto.ts` |
| **Timing-safe auth** | `timingSafeHexEqual()` used on developer key hash comparison; dummy scrypt compare on failed username lookup prevents username enumeration | `tmap-v2/src/server/auth.ts`, `developer-keys.ts` |
| **Distributed rate limiting** | Supabase RPC `increment_rate_limit()` with sliding window (aof-web); Redis sorted-set ZREMRANGEBYSCORE+ZADD pattern (tmap-v2); in-memory fallback on both | `aof-web/src/lib/server/rate-limit.ts`, `tmap-v2/src/server/rate-limit-redis.ts` |
| **CORS whitelist** | `COAGENTIX_ALLOWED_ORIGINS` env var required; localhost only in dev; fail-closed (empty = no origins) | `tmap-v2/src/server/index.ts:87-108` |
| **RLS enforced** | `conversations`, `messages`, `projects` all have row-level security; `security_invoker=true` on search view; `increment_rate_limit()` execute revoked from anon/authenticated | `supabase/migrations/0008` |
| **Admin fail-closed** | Missing `SUPABASE_SERVICE_ROLE_KEY` → all admin routes return 403; role check via `user_roles` table | `aof-web/src/middleware.ts:122-124` |
| **Immutable audit log** | Insert-only `audit_events` table capturing IP, user-agent, actor; JSONL fallback if Supabase down | `tmap-v2/src/server/audit.ts` |
| **Input byte limits** | MAX_TASK=10k, MAX_MESSAGE=10k, MAX_CODE=50k, MAX_CONTEXT=20k; `Buffer.byteLength()` (correct for UTF-8) | `tmap-v2/src/server/index.ts` |
| **Prompt injection** | User messages placed in `{role:'user'}` objects; never interpolated into system prompts | `tmap-v2/src/core/chief-agent.ts:110-111` |
| **No hardcoded secrets** | All keys are environment-variable configured; zero hardcoded tokens found in non-.env files | Entire codebase |
| **NEXT_PUBLIC_ safety** | All 8 NEXT_PUBLIC_ vars are non-sensitive (URLs, feature flags, anon key) | `aof-web/src/lib/api.ts`, `next.config.mjs` |
| **Deployment preflight** | Fail-fast in production if `JWT_SECRET` < 16 chars or `COAGENTIX_MASTER_KEY` < 16 chars | `tmap-v2/src/server/index.ts:1566-1602` |
| **Developer key scopes** | 8 scopes enforced (`sandbox:run`, `run`, `chat`, `keys:read`, `*`, etc.); BLAKE2 hash stored, never plaintext | `tmap-v2/src/server/developer-keys.ts` |

---

## Findings

### C1 — Image Upload: No MIME Type Validation (HIGH) ✅ FIXED

**Location:** `tmap-v2/src/server/index.ts:334-338`  
**Description:** `/v1/image/analyze` accepted up to 14MB payloads with no content-type validation. An attacker could upload arbitrary binary payloads disguised as images, potentially triggering unexpected behavior in vision pipeline processing.  
**Fix Applied (this commit):** Data URL MIME prefix is now validated against an allowlist `{image/jpeg, image/png, image/gif, image/webp}` before processing. Non-matching types return HTTP 415 Unsupported Media Type.

```typescript
const mimeMatch = data.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,/i);
if (mimeMatch) {
  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg','image/png','image/gif','image/webp']);
  if (!ALLOWED_IMAGE_TYPES.has(mimeMatch[1].toLowerCase())) {
    return res.status(415).json({ error: `unsupported image type: ${mimeMatch[1]}` });
  }
}
```

---

### C2 — CSRF: No Explicit Token (MEDIUM)

**Location:** `aof-web/src/middleware.ts:44-50`  
**Description:** CSRF protection relies on Origin/Referer header checking, which is correct for browser-based SPAs (browser enforces CORS and sends these headers). However, non-browser HTTP clients (curl, Postman, server-to-server) can forge these headers.  
**Risk Level:** MEDIUM — only exploitable by authenticated users who can obtain a valid Supabase session token, which limits the attack surface.  
**Recommendation:** For future REST API clients, add `X-Requested-With: XMLHttpRequest` requirement on state-changing endpoints, or implement CSRF tokens via the `__Host-` cookie prefix pattern. No code change in this audit — document as accepted risk for current SPA-only use.

---

### C3 — KDF Salt Hardcoded (LOW-MEDIUM)

**Location:** `tmap-v2/src/server/crypto.ts:14`  
**Description:** The scrypt KDF salt is the literal string `"aof-master-key-kdf-v2"`. This is not a secret (the salt is not required to be secret) but it cannot be rotated without re-encrypting every stored API key, as the derived key would change.  
**Impact:** Low. KDF salts are public by design; the security comes from the master key entropy, which is 256-bit if properly generated.  
**Recommendation:** Document this constraint. If a future rotation is needed, implement a migration path that decrypts with old derived key and re-encrypts with new one before updating the salt.

---

### C4 — In-Memory Login Rate Limiter (LOW)

**Location:** `tmap-v2/src/server/rateLimit.ts`  
**Description:** The login brute-force limiter (5 attempts → 15-min lockout) is in-memory per server instance. On multi-instance deployments, an attacker could distribute attempts across instances.  
**Impact:** Low — current deployment is single-instance on Render Starter. Acceptable for now.  
**Recommendation:** When scaling to multiple Render instances, promote to the existing Redis-backed rate limiter (`rate-limit-redis.ts`).

---

### C5 — Webhook Signatures Not Verified (LOW)

**Location:** `tmap-v2/src/server/webhooks.ts`  
**Description:** Webhook delivery does not include HMAC-SHA256 signatures. Inbound webhook receivers cannot verify that payloads originated from Coagentix.  
**Recommendation:** Add `X-Coagentix-Signature: sha256=<HMAC(secret, body)>` on delivery. Verify on receive using timing-safe comparison.

---

## No Findings In

- SQL injection (Supabase SDK parameterized queries throughout)
- Secrets in NEXT_PUBLIC_ namespace
- Hardcoded API keys or tokens
- Privilege escalation via Supabase search_path (pinned to `public, pg_temp`)
- Missing auth on admin routes (`requireAdminUser()` enforced)

---

## Remediation Summary

| Finding | Severity | Status |
|---------|----------|--------|
| C1: Image MIME validation | HIGH | ✅ Fixed in this commit |
| C2: CSRF token | MEDIUM | Accepted risk (SPA-only) |
| C3: Hardcoded KDF salt | LOW-MEDIUM | Document constraint |
| C4: In-memory login limiter | LOW | Fix when scaling |
| C5: Webhook signatures | LOW | Future enhancement |
