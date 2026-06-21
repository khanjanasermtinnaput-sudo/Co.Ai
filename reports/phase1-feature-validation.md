# Phase 1 — Real Feature Validation

**Method:** Direct source tracing (UI → store → API route → service → DB → response), **not** trusting prior reports. Backed by **hard execution evidence**:

- `aof-web`: `tsc --noEmit` **clean** · tests **178/178 pass**
- `tmap-v2`: `tsc --noEmit` **clean** · tests **432 pass / 4 skipped / 0 fail** (436 total, 75 suites)

**Definitions:** WORKING = full execution path exists end-to-end. PARTIAL = a layer is missing/degraded. BROKEN = execution impossible.

**Key architectural fact confirmed:** the app has **two real execution modes**, chosen at runtime:
- **Same-origin mode** (default): web UI → Zustand store → `/api/chat` (Next BFF) → real providers via `lib/server/ai-providers.ts`.
- **Live backend mode** (`NEXT_PUBLIC_COAGENTIX_API_BASE` set): web UI → store → `tmap-v2 /v1/*` → `runTMAP`/`runChiefAgent`/etc.
- **Mock** (`mock.ts`, `providers/client.ts mode:'mock'`) is an **explicit opt-in offline fallback** (demo flag, or *no key configured*). It never masquerades as a live answer — every real failure surfaces a structured `AOF_ERROR_xxx`. Verified in `api.ts` (`isDemoMode()` gating) and `providers/client.ts` (`if provider.mode === 'mock'`).

---

## Validation Table

| Feature | Frontend | Backend | Database | Tests | Status | Evidence (files) |
|---------|----------|---------|----------|-------|--------|------------------|
| **Chat** | ✅ composer → `chat-store.send()` | ✅ `/api/chat` + `/v1/chat` | ✅ `conversations`/`messages` | ✅ errors,frames,usage | **WORKING** | `store/chat-store.ts`, `app/api/chat/route.ts`, `lib/api.ts` |
| **Multi-Agent** | ✅ status frames in chat | ✅ `/v1/orchestrate`→`runTMAP` | n/a | ✅ orchestrator.test | **WORKING** | `tmap-v2/core/orchestrator.ts`, `server/index.ts:685` |
| **Chief Agent** | ✅ `streamOrchestrate` | ✅ `runChiefAgent` wired | n/a | ✅ intelligence.test | **WORKING** | `core/chief-agent.ts`, `server/index.ts:43` |
| **TMAP** | ✅ build flows | ✅ `/v1/run`→pipeline | n/a | ✅ orchestrator/validator | **WORKING** | `core/orchestrator.ts`, `server/index.ts:582` |
| **TMAP v2** | ✅ (whole `/v1` surface) | ✅ Express ~75 routes | ✅ `server/db.ts` | ✅ 432 pass | **WORKING** | `tmap-v2/src/server/index.ts` |
| **DARS** | ✅ via chat routing | ✅ `chatWithDARS` + health | n/a | ✅ (health/select) | **WORKING** | `dars/{run,select,classify,health}.ts`, `server/index.ts:44` |
| **Titan Mode** | ✅ `stream* mode:pro/titan` | ✅ `/v1/titan`→`runTitan` | n/a | ✅ titan.test | **WORKING** | `core/titan.ts`, `lib/titan.ts`, `server/index.ts:521` |
| **Voting Engine** | ✅ (build candidate select) | ✅ `runCoderVote` | n/a | ✅ vote.test (4) | **WORKING** | `core/vote.ts` |
| **Memory System** | ✅ (injected context) | ✅ `/v1/memory` GET/DELETE | ✅ file+supabase | ✅ memory/image-memory | **WORKING** | `core/memory.ts`, `core/image-memory.ts` |
| **RAA** | ✅ `streamRequirements` | ✅ `runRAA` + same-origin | n/a | ✅ raa.test | **WORKING** | `lib/raa.ts`, `core/raa.ts` |
| **File Upload** | ✅ `fileToAttachment` (FileReader) | ✅ image route 14MB limit | n/a | n/a | **WORKING** | `lib/attachments.ts`, `server/index.ts:333` |
| **Image Analysis** | ✅ attachment → pipeline | ✅ `/v1/image/analyze` | ✅ `image_memories` | ✅ image-pipeline.test | **WORKING\*** | `core/image-pipeline.ts`, `core/vision-agent.ts` |
| **Search** | ✅ `searchMessages()` | ✅ `/api/search` Postgres FTS | ✅ `conversation_search_v` | ✅ search frame test | **WORKING\*\*** | `app/api/search/route.ts`, `lib/conversations.ts` |
| **Projects** | ✅ `project-store` | ✅ Supabase direct (RLS) | ✅ `projects` table | n/a | **WORKING\*\*** | `store/project-store.ts` |
| **Conversations** | ✅ store sync | ✅ `/api/conversations(+/[id])` | ✅ `conversations`,`messages` | n/a | **WORKING** | `app/api/conversations/*`, `lib/conversations.ts` |
| **Authentication** | ✅ Supabase OAuth + guest | ✅ `middleware.ts` fail-closed | ✅ `auth.users`,`user_roles` | ✅ admin-auth.test | **WORKING** | `middleware.ts`, `lib/supabase/client.ts`, `store/auth-store.ts` |
| **API Keys** | ✅ Settings UI → `lib/keys.ts` | ✅ `/api/keys` AES-256-GCM | ✅ `provider_keys` (RLS) | n/a | **WORKING** | `lib/keys.ts`, `api/keys/route.ts`, `server/crypto.ts` |
| **Settings** | ✅ settings page/components | ✅ keys/plan/usage routes | ✅ per-feature | n/a | **WORKING** | `app/(app)/settings`, `components/settings` |
| **PWA** | ✅ installer + SW + manifest | ✅ static | n/a | n/a | **WORKING** | `components/pwa/pwa-installer.tsx`, `public/sw.js`, `manifest.webmanifest` |

> `*` Image Analysis: full path exists; vision steps require a multimodal key (Gemini/OpenRouter) or they return a clearly-labeled mock read — by design, not a break.
> `**` Search & Projects: code paths complete and correct; **runtime correctness depends on DB objects** (`conversation_search_v` view + FTS index; `projects` table RLS) — verified for existence in **Phase 10**, not here.

---

## Findings

### F1.1 — No BROKEN features found
Every one of the 19 audited features has a complete, real execution path. The codebase does **not** fake "working" features: the chat route (`api/chat/route.ts`) is explicitly built to *never fabricate an answer* and to surface every provider failure as a structured error; mock mode is opt-in and clearly labeled.

### F1.2 — `streamOrchestrate` non-live fallback skips frame decoding (latent, LOW)
`lib/api.ts:562-584`: the `!isLive()` fallback inside `streamOrchestrate` reads raw bytes and pipes them straight to `onToken` **without `decodeFrames()`**, unlike `readAofStream`. If reached, model/source/error control frames would render as literal text.
- **Root cause:** fallback added later, didn't reuse `readAofStream`.
- **Reachability:** `chat-store.send()` only calls `streamOrchestrate` when `isLive()` is true (`chat-store.ts:352`), so the buggy branch is **not currently reachable** from the UI. No user impact today.
- **Disposition:** flagged for **Phase 7/11** (reliability/UX) cleanup — not fixed in Phase 1 since it is unreachable and changing it now would be outside the "validate" scope. Recorded so it isn't lost.

### F1.3 — Two auth stacks, intentional and isolated
`aof-web` uses Supabase JWT (Google OAuth) verified server-side via service-role; `tmap-v2` uses its own `jsonwebtoken` HS256 for CLI/`/v1`. They are independent and each fail-closed. Not a defect; noted for Phase 2/6 cross-checks (esp. R3: `render.yaml` generating `JWT_SECRET` per deploy).

---

## Output format (per directive)

1. **Findings:** 0 BROKEN, 0 PARTIAL-by-defect, 1 latent-unreachable issue (F1.2), all 19 features WORKING.
2. **Root cause:** F1.2 — fallback didn't reuse the frame decoder.
3. **Files affected:** `lib/api.ts` (latent only).
4. **Changes made:** **none** — Phase 1 is validation; F1.2 is unreachable and deferred to Phase 7.
5. **Risks:** none introduced (read-only phase).
6. **Validation evidence:** typecheck clean ×2; 610 tests pass across both suites; per-feature file traces in table above.

---

### ✅ Phase 1 complete — proceeding automatically to Phase 2 (Auth + API-Key Audit).
