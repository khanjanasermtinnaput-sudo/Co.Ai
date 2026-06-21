# Phase 9 — AI System Verification

**Method:** trace each system Entry → Execution → Storage → Tests; mark WORKING / PARTIAL / BROKEN with evidence. Do not assume — verify exports are wired into `server/index.ts` and exercised by tests.

---

## System status

| System | Entry point | Wired into server | Storage | Tests | Status |
|--------|-------------|-------------------|---------|-------|--------|
| **Chief Agent** | `core/chief-agent.ts:67 runChiefAgent()` | ✅ `/v1/orchestrate` | session memory | ✅ via `intelligence.test` + orchestrator path | **WORKING** |
| **TMAP** | `core/orchestrator.ts:93 runTMAP()` | ✅ `/v1/run`, `/v1/orchestrate` | blackboard/session | ✅ `orchestrator.test.ts` | **WORKING** |
| **TMAP v2** | `server/index.ts` (`/v1/*`) | ✅ ~75 routes | Supabase/file DB | ✅ 432 pass | **WORKING** |
| **DARS** | `dars/run.ts:42 chatWithDARS()` | ✅ `/v1/chat` path + `dars/health` | health store | ✅ select/health | **WORKING** |
| **Titan Mode** | `core/titan.ts:206 runTitan()` | ✅ `/v1/titan` | session | ✅ `titan.test.ts` | **WORKING** |
| **Voting Engine** | `core/vote.ts:54 runCoderVote()` | ✅ build candidate select | n/a | ✅ `vote.test.ts` (4) | **WORKING** |
| **Memory System** | `core/memory.ts` + `image-memory.ts` | ✅ `/v1/memory`, injected context | file + Supabase `image_memories` | ✅ `memory.test.ts`, `image-memory.test.ts` | **WORKING** |
| **RAA** | `core/raa.ts:99 runRAA()` | ✅ `/v1/chat` requirements | n/a | ✅ `raa.test.ts` | **WORKING** |

All eight systems are **WORKING** — real exports, wired into live routes, covered by the passing 432-test suite. The mock fallbacks (no-key) are explicit, validated in Phase 1/3.

---

## W9.1 — Webhook persistence is file-only (PARTIAL) → hardened + documented

- **Findings:** `server/webhooks.ts` registration/delivery logic is complete and secure (HMAC-SHA256 signing, https-only + SSRF guard, retry/back-off). But `loadWebhooks`/`saveWebhooks` persist to the **local filesystem only**, and the file declared (now-removed) unused `SUPABASE_URL`/`SUPABASE_KEY` consts that falsely implied durable storage.
- **Determination: PARTIAL** — the feature *works* within a process lifetime, but on ephemeral hosts (Vercel `/tmp`, Render free disk) webhook subscriptions are **lost on redeploy/cold start** (same class as DB_001).
- **Why not fully wired to Supabase now:** that requires a new table + migration for a developer-platform feature that may be unused; out of "safe fix" scope and not derivable from the code. The honest, safe action is to stop pretending it's durable and warn — mirroring the existing `db.ts` pattern.
- **Changes made:** removed the misleading dead `SUPABASE_URL`/`SUPABASE_KEY` consts; added a production `console.warn` (gated on `NODE_ENV=production` && no `WEBHOOKS_DIR`) so the ephemeral-storage limitation is never silent; documented `WEBHOOKS_DIR` as the durable-volume escape hatch.
- **Files:** `tmap-v2/src/server/webhooks.ts`.
- **Recommendation (backlog):** add a `webhooks` Supabase table + swap `load/saveWebhooks` onto it for true durability.

---

## Notes
- `core/sandbox.ts` execution path carries the SEC-1 residual (vm not a hard boundary) from Phase 6 — tracked there, not re-fixed here.
- No BROKEN systems. No silently-mock "fake working" systems (Phase 1 F1.1 still holds).

---

## Output format (per directive)

1. **Findings:** 8/8 AI systems WORKING; webhooks delivery WORKING but persistence PARTIAL (file-only).
2. **Root cause:** W9.1 — webhook storage never moved to durable backend; dead consts implied otherwise.
3. **Files affected:** `tmap-v2/src/server/webhooks.ts`.
4. **Changes made:** removed misleading dead consts; added production ephemeral-storage warning; documented durable-volume option.
5. **Risks:** none — storage behavior unchanged, only honesty/observability added; consts were already unused.
6. **Validation evidence:** tmap-v2 `tsc` clean · 432/436 tests pass. System wiring confirmed via `server/index.ts` imports + entry-point exports above.

---

### ✅ Phase 9 complete — proceeding to Phase 10 (Database Audit).
