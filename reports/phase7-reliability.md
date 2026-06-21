# Phase 7 — Reliability Audit

**Audited:** promises, async ops, streaming, provider calls, DB calls, memory ops.
**Looking for:** unhandled promises, missing try/catch, race conditions, infinite retry, double-submit, state corruption. **Adding:** retry, timeout, abort, circuit-breaker, fallback where missing.

---

## Verdict

The platform already has strong reliability infrastructure (circuit breaker, retry-with-backoff, abort plumbing, double-submit guards). The audit found **3 real gaps**, all **FIXED** this phase. Both suites remain green (web 178, tmap 432).

---

## Existing infra confirmed sound (no change)

| Mechanism | Location | Status |
|-----------|----------|--------|
| Circuit breaker | `tmap-v2/server/failover.ts` `class CircuitBreaker` | ✅ present |
| Retry + exponential backoff | `failover.ts` `withRetry<T>()` | ✅ present |
| Provider failover chain | `aof-web/api/chat/route.ts` (priority loop + `failoverWorthy`) | ✅ present |
| Double-submit guard | `chat-store.send()` early-returns while `streaming` | ✅ present |
| Abort propagation | `AbortController` threaded through stores → `api.ts` → routes → provider | ✅ present |
| Best-effort isolation | search/sync failures `.catch()` to local state, never block the turn | ✅ present |
| Memory ops | `image-memory.ts` dedup + file fallback, decrypt errors swallowed per-row | ✅ present |

---

## Fixes applied

### R7.1 — Provider calls had no timeout (HIGH) → FIXED
- **Finding:** `tmap-v2/providers/client.ts` `chat()` did `fetch(url, { signal: opts.signal })` with **no timeout**. If a provider stalled and the caller passed no abort signal, the request could hang until the platform killed the whole invocation — blocking failover.
- **Root cause:** missing per-call deadline.
- **Fix:** wrap the fetch in an `AbortController` that aborts on `PROVIDER_TIMEOUT_MS` (default 60 000 ms) **and** mirrors the caller's `opts.signal` (so user-Stop still works). Timer/listener cleaned up in `finally`; a timeout is reported distinctly (`timed out after Nms`) so the failover loop treats it as failover-worthy.
- **Files:** `tmap-v2/src/providers/client.ts`.
- **Risk:** none — abort logic is additive; default 60s ≥ existing route `maxDuration`.

### R7.2 — No process-level rejection/exception handlers (MEDIUM) → FIXED
- **Finding:** the tmap-v2 server registered no `unhandledRejection` / `uncaughtException` handlers. A stray rejection was silently dropped; an uncaught throw left the process in an undefined state.
- **Root cause:** missing safety net at bootstrap.
- **Fix:** in `server/index.ts` (inside the `!process.env.VERCEL` bootstrap), log `unhandledRejection` via the existing structured `logger`, and on `uncaughtException` log + `process.exit(1)` so Render restarts cleanly rather than running degraded. Minimal — a net, not control flow.
- **Files:** `tmap-v2/src/server/index.ts`.
- **Risk:** none on Vercel (guarded out); on Render it only changes behavior in the already-fatal uncaught-exception case (clean restart vs. zombie).

### R7.3 — `streamOrchestrate` fallback skipped frame decoding (LOW, latent) → FIXED
- **Finding:** (carried from Phase 1 F1.2) `aof-web/lib/api.ts` `streamOrchestrate` non-live fallback read raw bytes and piped them straight to `onToken`, bypassing `decodeFrames()`. In-band control frames (model/source/error) would have rendered as literal text.
- **Reachability:** not reachable from `chat-store` today (it only calls `streamOrchestrate` when `isLive()`), but a defect nonetheless.
- **Fix:** route the fallback through the existing `readAofStream()` helper (same decoder used by every other `/api/chat` consumer), forwarding `onToken`/`onError`/`signal`.
- **Files:** `aof-web/src/lib/api.ts`.
- **Risk:** none — reuses the already-tested decode path; AbortError still handled.

---

## Items reviewed, no action

- **Concurrent token refresh** (`keys.ts`/`conversations.ts`): mitigated by supabase-js's internal auth lock (Phase 2 N1). Left as-is.
- **`chat-store.appendToken` per-token `set()`**: a re-render/perf concern, not a correctness one → handed to **Phase 8**.
- **Infinite retry:** none found — `withRetry` is bounded; failover loop iterates a finite provider list once.

---

## Output format (per directive)

1. **Findings:** 3 gaps (no provider timeout; no process handlers; latent frame-decode), strong existing infra otherwise.
2. **Root cause:** missing per-call deadline; missing process safety net; fallback not reusing the shared decoder.
3. **Files affected:** `tmap-v2/src/providers/client.ts`, `tmap-v2/src/server/index.ts`, `aof-web/src/lib/api.ts`.
4. **Changes made:** added provider timeout, process-level handlers, and frame-decoding in the orchestrate fallback.
5. **Risks:** none — all additive/guarded; behavior unchanged on healthy paths.
6. **Validation evidence:** aof-web `tsc` clean · `next lint` clean · 178/178 tests; tmap-v2 `tsc` clean · 432/436 tests (4 pre-existing skips). Green after all three fixes.

---

### ✅ Phase 7 complete — proceeding to Phase 8 (Performance).
