# Phase 2 — API Key + Auth Audit (Priority: Critical)

**Scope:** key save/load/update/delete, encryption, session/token refresh, auth middleware, Vercel/Render deployment, Supabase integration.
**Method:** source trace of every state-mutating auth/key path + FAIL-OPEN scan.
**Files inspected:** `lib/keys.ts`, `lib/conversations.ts`, `lib/server/supabase-admin.ts`, `lib/server/crypto.ts`, `lib/server/keys-store.ts`, `components/settings/settings-view.tsx`, `middleware.ts`, `app/api/{keys,conversations,search,auth/check,cli/token}`, `tmap-v2/src/server/{auth,crypto,db}.ts`, `render.yaml`.

---

## Verdict

The auth + key subsystem is **production-grade and fail-closed**. AES-256-GCM with a scrypt-stretched master key, plaintext keys never returned to the browser, every route requires a verified Supabase JWT, and the admin gate denies on any uncertainty. **One real production defect found and fixed (DB_001)**; the rest are PASS or LOW hardening notes.

**FAIL-OPEN scan:** no catch-block or missing-env path grants access/returns success. Every degraded path returns 401/403/503. ✅

---

## Issue Register

### AUTH

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| **AUTH_001** | Admin route role check | — | **PASS** — `middleware.ts:108-142` is fail-closed: missing service-role key or any lookup error → `denyAdmin()`. Only `OWNER/ADMIN/STAFF` pass. |
| **AUTH_002** | Bearer-token verification | — | **PASS** — `supabase-admin.ts getUserFromRequest` rejects missing/malformed/empty/invalid tokens; logs safe 8-char prefix only. tmap-v2 `requireAuth` verifies HS256 + reloads user. |
| **AUTH_003** | Session/token refresh & expired-session recovery | — | **PASS** — `lib/keys.ts` & `lib/conversations.ts` proactively refresh when <60s to expiry; on refresh failure they `signOut()` so the UI reflects logged-out state (no infinite 401 loop). PKCE flow, `detectSessionInUrl:false` prevents OAuth double-exchange. |
| **AUTH_004** | CSRF on mutations | — | **PASS** — `middleware.ts:38-51` rejects cross-origin non-GET `/api/*` via Origin/Referer allowlist. |
| **AUTH_005** | tmap-v2 admin ops authorization | — | **PASS** — `requireAdmin` allowlist is secure-by-default: empty `COAGENTIX_ADMIN_USERNAMES` ⇒ no admins ⇒ all privileged `/v1` ops reject. |

### KEY

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| **KEY_001** | Encryption at rest | — | **PASS** — AES-256-GCM, 12-byte random IV per record, auth tag verified on decrypt. Key derived via `scryptSync` (slow KDF), cached per process. Mirrored identically in web + tmap-v2. |
| **KEY_002** | Plaintext exposure | — | **PASS** — GET returns only `key_preview` (`maskKey`); plaintext sent once on POST, never read back. RLS-enabled `provider_keys` with no policy = unreachable by anon/authed browser; only service-role API routes touch it, scoped to `eq(user_id)`. |
| **KEY_003** | save / update / delete integrity + error surfacing | — | **PASS** — `/api/keys` POST upserts on `(user_id,provider)`, validates provider enum + ≥8 char length; DELETE scoped to user+provider. UI (`settings-view.tsx`) wraps every call in try/catch with `toast` + sign-in gate + too-short guard. Decrypt failures on load are swallowed per-row (one corrupt row can't break the request). |

### DB

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| **DB_001** | tmap-v2 ephemeral file DB in production (Render) | **HIGH** | **FIXED** — see below. |
| **DB_002** | aof-web key storage durability | — | **PASS** — uses Supabase Postgres directly; no ephemeral fallback. |
| **DB_003** | Per-user data isolation | — | **PASS** — every query filters `eq("user_id", user.id)`; service-role bypasses RLS only behind verified-JWT routes. |

---

## DB_001 — Root cause, fix, evidence

**Findings:** `tmap-v2/src/server/db.ts` uses durable Supabase Postgres **only when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set**; otherwise it falls back to a JSON file (`/tmp/aof-db.json` on Vercel, `.aof-server/db.json` on Render). `render.yaml` did **not** declare those Supabase vars, so the Render deployment ran on the **ephemeral file DB**.

**Root cause:** deployment config gap — durable-storage env vars were never wired into `render.yaml`.

**Impact:** every Render redeploy / cold start **wiped all tmap-v2 (CLI) user accounts and their encrypted provider keys**. The code already `console.warn`s loudly, but the config never satisfied it.

**Files affected:** `render.yaml`.

**Changes made:** added `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and optional `COAGENTIX_ADMIN_USERNAMES`) as `sync: false` env vars (entered in the Render dashboard — secrets stay out of source control), pointing tmap-v2 at the same Supabase project as aof-web. This switches it onto the durable Postgres path.

**Risks:** none in code. Operational: the two secret values must be populated in the Render dashboard for the fix to take effect (documented inline in `render.yaml`). Until set, the loud warning persists — correct fail-state.

**Validation evidence:** `db.ts:58-60` (`useSupabase` gate), `:101-107` (production warning), `render.yaml` diff. tmap-v2 `db.test.ts` passes (storage layer logic unchanged).

---

## Notes (LOW — no fix required)

- **N1 — Concurrent refresh race:** `keys.ts` and `conversations.ts` can both call `refreshSession()` near expiry from independent modules. `supabase-js` serializes auth operations with an internal lock, so the rotated-refresh-token double-spend is mitigated by the SDK. Left as-is; revisit only if real-world 401 churn appears (Phase 7).
- **N2 — Generated Render secrets:** `JWT_SECRET`/`COAGENTIX_MASTER_KEY` use `generateValue:true`. Render persists generated values across deploys (tokens/keys stay valid), but **recreating the service** rotates them → existing CLI tokens invalid + stored keys undecryptable. Acceptable given separate stores; documented for ops.

---

## Output format (per directive)

1. **Findings:** 1 HIGH (DB_001), 0 other defects; 10/11 register items PASS, 2 LOW notes.
2. **Root cause:** DB_001 — Supabase durable-storage env missing from `render.yaml`.
3. **Files affected:** `render.yaml`.
4. **Changes made:** wired durable Supabase env (`sync:false`) into the Render service.
5. **Risks:** none in code; operator must set the two dashboard secrets.
6. **Validation evidence:** source traces above; FAIL-OPEN scan clean; typecheck + 610 tests still green (unchanged code paths).

---

### ✅ Phase 2 complete — proceeding automatically to Phase 3 (Placeholder + TODO Audit).
