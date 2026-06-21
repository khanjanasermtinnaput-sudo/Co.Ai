# Phase 0 — Project Inventory & Map

**Project:** Co.AI / Aof AI Platform
**Repo:** `khanjanasermtinnaput-sudo/Co.Ai` (branch `main`, clean, in sync with origin)
**Generated:** 2026-06-21
**Method:** Direct filesystem scan. Existing `reports/*.md` were **NOT trusted** — they are listed only as artifacts to re-verify in later phases.

> Scope note: this is a *map*, not a validation. No code was changed. Feature WORKING/PARTIAL/BROKEN judgments are deferred to Phase 1+.

---

## 1. High-Level Architecture

Co.AI is a **3-workspace monorepo** (no root `package.json` / no npm workspaces — each is built & deployed independently):

```
Co.Ai/
├── aof-web/        Next.js 14 App Router frontend + BFF API routes   → Vercel
├── tmap-v2/        Express multi-agent AI backend ("TMAP v2")        → Render (+ Vercel serverless)
├── coagentix-cli/  Standalone TypeScript CLI (commander/inquirer)    → npm package
├── pages/ + index.html   Static landing/marketing                    → GitHub Pages
├── supabase/migrations/  Root DB migrations (cli_tokens, error_logs)
├── docs/           Project documentation
└── reports/        Prior audit artifacts (UNTRUSTED — to re-verify)
```

### Architecture diagram

```
                          ┌─────────────────────────────┐
        Browser  ───────► │  aof-web (Next.js 14)        │
                          │  - App Router pages          │
                          │  - Zustand stores (8)        │
                          │  - /api/* route handlers     │ ◄── middleware.ts (auth gate)
                          └───────┬──────────────┬───────┘
                                  │              │
                   Supabase JS    │              │  fetch (server keys)
                                  ▼              ▼
                       ┌──────────────┐   ┌──────────────────────────────┐
                       │  Supabase    │   │  AI Providers                │
                       │  - auth      │   │  Anthropic / OpenAI-compat   │
                       │  - Postgres  │   │  Gemini / Qwen / OpenRouter  │
                       │  - RLS, RPC  │   └──────────────────────────────┘
                       └──────┬───────┘
                              │ same DB / JWT
                              ▼
        CLI ────► ┌───────────────────────────────────────┐
   (coagentix-cli)│  tmap-v2 (Express, /v1/*)              │
   (HTTP /v1)     │  - multi-agent orchestrator           │ ──► AI Providers
                  │  - TMAP / DARS / Titan / Vote / RAA    │ ──► provider/client.ts
                  │  - image pipeline, memory, sandbox     │
                  │  - teams/orgs/webhooks/backup/DR       │
                  └───────────────────────────────────────┘
```

**Two independent backends exist** — a key architectural finding:
- `aof-web/src/app/api/chat` (Next BFF, talks to providers directly via `lib/server/ai-providers.ts`)
- `tmap-v2` Express `/v1/*` (the heavy multi-agent engine, consumed by the CLI and optionally the web).

Whether the web frontend actually calls `tmap-v2` or only its own BFF is a **Phase 1 trace target**.

---

## 2. Workspace Inventory

### 2.1 `aof-web` — Frontend + BFF
- **Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind, Radix UI, Zustand, framer-motion, sonner (toasts), react-markdown.
- **Auth/data:** `@supabase/ssr` + `@supabase/supabase-js`.
- **AI SDK:** `@anthropic-ai/sdk`.
- **Size:** 207 `.ts/.tsx` files under `src/`.
- **Scripts:** `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`tsx --test src/tests/*.test.ts`).

**Route groups (`src/app/`):**
| Group | Routes |
|-------|--------|
| `(app)` | `chat`, `code`, `projects`, `projects/[id]`, `settings` |
| `(marketing)` | `about`, `blog`, `contact`, `cookies`, `privacy`, `terms` |
| `admin` | `analytics`, `api-monitoring`, `feature-flags`, `logs`, `redeem-codes`, `settings`, `subscriptions`, `users` |
| auth | `login`, `auth/callback` |

**API routes (28 `route.ts` handlers):**
- Auth/keys: `auth/check`, `keys`, `cli/token`, `cli/devices`
- Core: `chat`, `conversations`, `conversations/[id]`, `conversations/[id]/messages`, `search`, `feedback`, `referral`, `health`
- Admin (18): `admin/users`, `admin/users/[id]`, `admin/roles`, `admin/subscriptions(+[id])`, `admin/redeem(-codes/[id])`, `admin/feature-flags(+[key])`, `admin/analytics`, `admin/api-usage`, `admin/announcements(+[id])`, `admin/beta-access`, `admin/logs`

**`src/lib` (38 files) — key modules:**
- **Auth/access:** `access.ts`, `plans.ts`, `admin/permissions.ts`, `admin/server.ts`
- **Keys/crypto:** `keys.ts`, `server/keys-store.ts`, `server/crypto.ts`, `server/supabase-admin.ts`
- **AI:** `server/ai-providers.ts`, `server/model-registry.ts`, `router.ts`, `raa.ts`, `titan.ts`, `model-branding.ts`
- **Data:** `conversations.ts`, `conversation-state.ts`, `attachments.ts`, `export.ts`
- **Infra:** `server/rate-limit.ts`, `server/ai-log.ts`, `errors/{api-error,error-codes,logger}.ts`, `health.ts`
- **Search:** `server/search/{manager,providers,context-builder,types}.ts`
- ⚠️ **`mock.ts`** — to be traced (Phase 1/3).

**Stores (8):** `auth-store`, `chat-store`, `code-store`, `project-store`, `usage-store`, `ui-store`, `guest-store`, `diagnostics-store`.

**Middleware:** `src/middleware.ts` (auth gating — Phase 2 critical target).

### 2.2 `tmap-v2` — Multi-Agent Backend
- **Stack:** Express, `jsonwebtoken`, `cors`, `dotenv`, run via `tsx` (no compile step in prod — runs TS directly).
- **Entry:** `src/server/index.ts` (~1480 lines, all routes inline). Vercel adapter: `api/index.ts`. CLI: `src/cli.ts`.
- **`src/core` (40 files) — AI engine:** `orchestrator`, `chief-agent`, `architect`, `classifier`, `advanced-router`, `model-router`, `context-engine`, `blackboard`, agents (`research`, `writing`, `math`, `vision`, `critic`, `verifier`, `debugger`), `titan`, `vote`, `raa`, `reflection`, `self-critique`, `hallucination-detector`, `eval-framework`, `image-pipeline`, `image-memory`, `memory`, `retrieval`, `sandbox`, `docker-sandbox`, `validator`, `review-gate`, `usage-tracker`, `routing-metrics`.
- **`src/dars` — DARS subsystem:** `classify`, `select`, `run`, `health`.
- **`src/server` (33 files) — platform:** `auth`, `cli-auth`, `crypto`, `db`, `developer-keys`, `permissions`, `teams`, `orgs`, `webhooks`, `rate-limit-redis`, `rateLimit`, `redis(-cluster)`, `queue`, `streaming`, `failover`, `backup`, `restore`, `disaster-recovery`, `analytics`, `telemetry`, `prometheus`, `audit`, `bot-protection`, `cdn`, `correlation`, `query-optimizer`, `file-store`, `logger`, `health`.
- **Tests:** 23 `*.test.ts` files (run via `tsx --test`).

**Express API surface (`/v1/*`, ~75 endpoints)** — major groups:
- Auth: `register`, `login`, `refresh`, `me`, `me/keys` (PUT/DELETE), `me/keys/rotate`, `me/keys/validate`, `me/cost`, `me/usage`, `me/quota`, `cli/auth`, `cli/status`
- AI exec: `chat`, `debug`, `analyze`, `titan`, `run`, `orchestrate`, `agents`, `evaluate`, `sandbox/run`, `sandbox/capabilities`
- Memory/image: `memory` (GET/DELETE), `image/analyze`, `image/memories` (GET/DELETE)
- Sessions: `sessions`, `sessions/:id`
- Observability: `health`, `metrics`, `metrics/prometheus`, `routing-metrics`, `benchmark/results`, `streaming/connections`, `infra/redis`
- Developer platform: `developer/keys`, `developer/health`, `webhooks(+/:id/test)`
- Collaboration: `teams(+members)`, `orgs`, `permissions(+check)`
- Admin/ops (requireAdmin): `backup`, `restore`, `dr/*`, `failover/circuits`, `analytics/*`

### 2.3 `coagentix-cli` — CLI
- **Stack:** `commander`, `inquirer`, `chalk`, `ora`, `simple-git`, `glob`, `ignore`. Compiled with `tsc`.
- **Modules (24):** `cli`, `interactive`, `auth`, `api`, `repo`, `git`, `files`, `terminal`, `ui`, `safety`, plus the V3 systems: `zero-trust`, `patch`, `build-validator`, `knowledge-graph`, `arch-detector`, `ownership`, `test-generator`, `security-agent`, `debate`, `cost-optimizer`, `reliability`, `background`, `docs-agent`, `disaster-recovery`.

---

## 3. Subsystem → File Map (verification targets)

| Subsystem | Primary location | Notes |
|-----------|------------------|-------|
| **Frontend** | `aof-web/src/app`, `components` (20 dirs), `store` (8) | Next 14 App Router |
| **Backend (BFF)** | `aof-web/src/app/api` (28 routes) | Next route handlers |
| **Backend (engine)** | `tmap-v2/src/server/index.ts` + `core` | Express `/v1/*` |
| **Database** | Supabase (`xuupsckszsujfnrzodtw`); migrations in `supabase/migrations`, `aof-web/supabase`, `tmap-v2/supabase` | 3 migration dirs — possible drift |
| **Authentication** | `aof-web/src/middleware.ts`, `lib/access.ts`, `lib/supabase/client.ts`, `store/auth-store.ts`; `tmap-v2/src/server/auth.ts`, `cli-auth.ts` | Two auth systems |
| **AI / Agents** | `tmap-v2/src/core/*` (orchestrator, chief-agent, agents) | Multi-agent core |
| **TMAP / TMAP v2** | `tmap-v2` whole; `core/orchestrator.ts` | |
| **DARS** | `tmap-v2/src/dars/*` | |
| **Titan Mode** | `tmap-v2/src/core/titan.ts`, `aof-web/src/lib/titan.ts` | Both layers |
| **Voting Engine** | `tmap-v2/src/core/vote.ts` | |
| **Memory** | `tmap-v2/src/core/{memory,image-memory,retrieval}.ts` | |
| **RAA** | `tmap-v2/src/core/raa.ts`, `aof-web/src/lib/raa.ts` | |
| **Image analysis** | `tmap-v2/src/core/{image-pipeline,vision-agent}.ts` | |
| **File upload** | `aof-web/src/lib/attachments.ts`, `tmap-v2/src/server/file-store.ts` | |
| **Search** | `aof-web/src/lib/server/search/*`, `api/search` | |
| **API keys** | `aof-web/src/lib/{keys,server/keys-store,server/crypto}.ts`; `tmap-v2 /v1/me/keys*` | Phase 2 critical |
| **Providers** | `aof-web/src/lib/server/ai-providers.ts`; `tmap-v2/src/providers/client.ts` | |
| **PWA** | `aof-web/src/components/pwa`, `public/` (SW) | |
| **Deployment** | `.github/workflows`, `render.yaml`, `vercel.json` (×2) | |

---

## 4. Dependency Inventory (top-level)

- **aof-web:** next, react, react-dom, @supabase/{ssr,supabase-js}, @anthropic-ai/sdk, zustand, framer-motion, @radix-ui/*, lucide-react, sonner, react-markdown, remark-gfm, jszip, clsx/cva/tailwind-merge. Dev: typescript, tsx, eslint, tailwind, postcss.
- **tmap-v2:** express, jsonwebtoken, cors, dotenv, tsx, typescript. Dev: @types/*. (⚠️ Redis/queue code exists but **no redis client dependency** declared — Phase 7/9 target.)
- **coagentix-cli:** commander, inquirer, chalk, ora, simple-git, glob, ignore.

---

## 5. Deployment Infrastructure

| Target | Source | Config | Trigger |
|--------|--------|--------|---------|
| **Vercel** | `aof-web` | `aof-web/.vercel`, `vercel-deploy.yml` | push → main |
| **Render** | `tmap-v2` | `render.yaml` (rootDir tmap-v2, `npm run server`, free plan) | push → main |
| **Vercel (fn)** | `tmap-v2` | `tmap-v2/vercel.json` (`/v1/* → api/index`, maxDuration 60) | — |
| **GitHub Pages** | `index.html` / `pages/` | `pages.yml`, `enable-pages.yml` | push |

**CI workflows:** `ci.yml`, `render-deploy.yml`, `vercel-deploy.yml`, `pages.yml`, `enable-pages.yml`.

**Render env (from `render.yaml`):** `JWT_SECRET` (generated), `COAGENTIX_MASTER_KEY` (generated), `COAGENTIX_MODE=normal`, `NODE_ENV=production`. ⚠️ Generated secrets mean **the CLI's JWTs won't validate across redeploys** unless pinned — Phase 2/7 target.

---

## 6. High-Risk Areas (preliminary — for deep audit in later phases)

| # | Area | Risk | Phase |
|---|------|------|-------|
| R1 | **Dual backend / dual auth** (aof-web BFF vs tmap-v2 Express, two auth stacks) | Inconsistent authz, unclear source of truth, possible dead backend | 1, 2, 6 |
| R2 | **API keys & crypto** (`keys.ts`, `keys-store.ts`, `crypto.ts`, `/v1/me/keys`) | Encryption correctness, key leakage, save/update/delete integrity | 2, 6 |
| R3 | **`render.yaml` generates JWT_SECRET/MASTER_KEY** | Secrets rotate on redeploy → session/keys break; possible FAIL-OPEN if unset | 2, 6, 7 |
| R4 | **203 mock/placeholder/stub markers** across src | Fake "working" features; `lib/mock.ts` present | 1, 3 |
| R5 | **3 separate supabase migration dirs** | Schema drift; unclear applied state | 10 |
| R6 | **Redis/queue/cluster code with no redis dependency** | Reliability features may be stubs / non-functional | 7, 9 |
| R7 | **tmap-v2 runs via `tsx` in prod (no build/typecheck gate)** | Type errors ship to runtime | 5, 12 |
| R8 | **`tmap-v2/src/server/index.ts` ~1480 lines, all routes inline** | Maintainability, hard to audit authz per-route | 6, 11 |
| R9 | **Admin surface is large (18 web routes + requireAdmin Express)** | Role-escalation / auth-bypass surface | 2, 6 |
| R10 | **11 `any`/`as any` casts** (low but present) | Type-safety holes at boundaries | 5 |
| R11 | **AOF_*/COAGENTIX_* env fallbacks + DEMO/ENFORCE_PLANS flags (13 hits)** | Possible FAIL-OPEN plan enforcement in demo mode | 1, 6 |

---

## 7. Prior Reports Found (UNTRUSTED — to re-verify, not rely on)

`reports/` already contains: `ai-systems-report.md`, `bug-fixes.md`, `cleanup-report.md`, `database-report.md`, `final-production-report.md`, `performance-report.md`, `project-audit.md`, `provider-audit.md`, `security-report.md`, `typescript-report.md`. Also a 65 KB `AOF_CODE_TDD.md` at root. Per the audit directive, **none of these are trusted**; they will be independently re-derived from source.

---

## 8. Phase 0 Deliverable Summary

- ✅ All files scanned (3 workspaces, ~250+ source files).
- ✅ Dependency inventory built.
- ✅ Feature map built (§3).
- ✅ Architecture map built (§1).
- ✅ Frontend / Backend / API / DB / Auth / AI / Memory / Agents / Providers / Deployment all identified.
- ✅ 11 high-risk areas flagged for later phases.

**No code changed in Phase 0.**

---

### ⏸ STOP — awaiting approval to begin Phase 1 (Real Feature Validation).
