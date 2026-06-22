# SECURITY_REPORT.md — Co.Ai / Coagentix
**Date:** 2026-06-22 · **Base:** `main` @ `e3f5a1f` + Rounds 1–3 remediation
**Method:** Code-evidence review + executable tests. Status reflects the working tree after this remediation.

Legend: ✅ fixed/strong · ⚠️ partial / config-dependent · ❌ open

---

## Authentication ⚠️→✅ (with deprecation)
- **JWT signing:** `JWT_SECRET` enforced ≥32 chars at startup; 7-day sliding sessions. ✅
- **Two auth systems remain** (Supabase OAuth in aof-web; PIN+JWT in tmap-v2). Decision taken: **Supabase is canonical**; PIN+JWT deprecated. Admin/entitlement now key off the Supabase identity (`user_roles`, `subscriptions`). ⚠️ (full PIN removal is a follow-up)
- **PIN brute force:** min 6 digits + Redis-backed cross-instance login lockout (Round 2 #2) + fail-closed global auth limiter. ✅ (mitigated; deprecate PIN to close fully)
- **JWT revocation:** ❌ still none — a leaked token is valid until expiry (≤7 days). **Recommendation:** maintain a Redis denylist of revoked `jti` and check in `requireAuth`.

## Authorization ✅
- **Admin:** DB-backed RBAC from `user_roles` (OWNER/ADMIN/STAFF), **fail-closed**, fully audited; env-username escalation vector removed (Round 3 #1). ✅
- **Entitlement:** server-side `requireSubscription` honoring expiry/revocation (Round 3 #6). ✅ (enforcement flag off until billing live)
- **aof-web admin middleware:** already fail-closed via `user_roles` + service role. ✅

## Secrets ✅/⚠️
- **At rest:** AES-256-GCM + scrypt KDF; per-secret random IV; auth tag. ✅
- **`.env.example`:** no real secrets; server-only vars correctly un-prefixed. ✅
- **Log hygiene:** key material is masked (`maskKey`); decryption failures log provider name only. ⚠️ Recommend a log-scrubbing pass + secret-detection in CI to be certain nothing leaks at error paths.
- **Master-key rotation:** three legacy cipher formats supported; no rotation endpoint. ⚠️ follow-up.

## API keys ✅
- Per-user provider keys encrypted at rest; GET returns masked previews only, never plaintext. ✅
- Developer keys: BLAKE2/HMAC-hashed, shown once, timing-safe compare, scoped. ✅

## JWT ⚠️
- Strong secret enforcement ✅; **no revocation/rotation** ❌ (see Authentication).

## Cookies ✅ (delegated)
- Session handling is via Supabase SSR (httpOnly/secure cookies managed by `@supabase/ssr`). No custom cookie auth in tmap-v2 (Bearer tokens). ✅
- **Recommendation:** confirm `Secure`/`SameSite=Lax|Strict` on Supabase cookies in the aof-web deployment.

## CSRF ✅
- Both aof-web middleware and the Express server validate `Origin` on state-mutating requests; fail-closed in production. tmap-v2 APIs are Bearer-token (not cookie) so are not CSRF-prone. ✅

## XSS ⚠️
- React JSX auto-escaping; no `dangerouslySetInnerHTML` found in audited code. Markdown via `react-markdown` (+`rehype-katex`). ⚠️ **Recommendation:** confirm no `rehype-raw`/raw-HTML passthrough is enabled and that link `href`s are sanitized; add a CSP (the server already sets security headers — verify `script-src`).

## Prompt injection ⚠️
- Memory injection mitigated by `sanitizeMem()` (strips "ignore previous"/role markers) + "reference only" framing. ⚠️ Regex-based; bypassable via paraphrase/Unicode/encoding. **Recommendation:** keep memory strictly in a separate, clearly-delimited context block (done) and treat all retrieved memory as untrusted data; consider an allowlist/structured-memory format rather than free text.

## SSRF ✅
- Webhook URLs: HTTPS-only, private/loopback IP ranges blocked, **re-validated at delivery** (DNS-rebinding defense). Verified by tests (Round 2 #7). ✅
- **Recommendation:** for defense-in-depth, resolve+pin the IP at delivery and block link-local/metadata ranges (169.254.0.0/16) explicitly.

## Rate limiting / abuse ✅
- Global limiter fail-closed in prod with real Redis; login lockout cross-instance; quota enforced atomically on `/v1/run` (Rounds 2 #2/#3). ✅ (requires `REDIS_URL`)

## Sandbox / RCE ✅
- Node-vm fallback disabled in production; Docker-or-fail-closed (Round 1 #5). ✅

---

## Priority recommendations (next security round)
1. **JWT revocation denylist** (HIGH) — close the leaked-token window.
2. **Complete Supabase-only auth** (HIGH) — remove deprecated PIN+JWT path.
3. **CSP + markdown sanitization audit** (MEDIUM) — confirm no raw-HTML/XSS sink.
4. **Log secret-scrubbing + CI secret scanning** (MEDIUM).
5. **Key rotation endpoint + legacy-cipher migration** (MEDIUM).
6. **Structured/allowlisted memory** to harden prompt-injection (MEDIUM).

All Round 1–3 security fixes are backed by executable tests (`npm test`, 528 passing). Items marked ❌/⚠️ are explicitly **not** claimed as fixed.
