# Coagentix (Co.AI / AOF) — Architecture Memory

> Persistent repository intelligence. **Read this + the JSON maps in `.coagentix-memory/` before scanning the repo.**
> Baseline: git `247e4b5` · generated 2026-06-21.

## 1. What this repo is

A professional multi-provider AI platform with three packages in one monorepo:

| Package | Role | Stack |
|---|---|---|
| `aof-web/` | Next.js 14 App Router frontend **+** API routes (the main app) | Next 14.2, TS strict, Tailwind, Framer Motion, Zustand, Supabase, `@anthropic-ai/sdk` |
| `tmap-v2/` | Express backend — TMAP multi-agent pipeline, DARS, Titan, Chief, vision, enterprise | Express 4, TS ESM, JWT, tsx; optional Redis/BullMQ/Prometheus/Sentry |
| `coagentix-cli/` | `coai` terminal coding agent (Advanced tier) | commander, inquirer, simple-git |

Data layer: **Supabase / Postgres** with RLS. Deploy targets: Railway, Render, Vercel, Docker.

## 2. Request flow (the two brains)

**Web chat** (`POST /api/chat`, in `aof-web`): classify route → optional web search → pick agent persona (`lib/raa`) → provider chain **Anthropic → OpenRouter** with per-model failover → SSE frames (text + control: failover/model/sources) → `lib/api.streamChat` → `chat-store`. Offline `lib/mock.ts` fallback when no keys.

**TMAP backend** (`tmap-v2` `/v1/*`, optional, proxied): the heavy multi-agent work — `runTMAP`, `runChiefAgent`, `runTitan`. Every LLM call is wrapped by **DARS** (`chatWithDARS`) for failover. `aof-web/src/lib/api.ts` talks to it when `NEXT_PUBLIC_COAGENTIX_API_BASE`/proxy is configured.

## 3. Special systems (Phase 10) — where they live

| System | Primary code | Endpoint |
|---|---|---|
| **TMAP / TMAP v2** | `tmap-v2/src/core/orchestrator.ts` `runTMAP` (Plan→Code→Validate→Review→critique loop) | `/v1/run` |
| **Titan Mode** | `tmap-v2/src/core/titan.ts` `runTitan`; web `lib/titan.ts` + `components/code/titan-workflow.tsx` + `store/code-store.ts` | `/v1/titan` |
| **DARS** | `tmap-v2/src/dars/{run,select,health,classify}.ts` | wraps all agent calls |
| **Chief Agent** | `tmap-v2/src/core/chief-agent.ts` `runChiefAgent` | `/v1/orchestrate` |
| **RAA** | backend `core/raa.ts` `runRAA`; web `lib/raa.ts` prompts (agent=`requirements`) | `/api/chat` |
| **Voting Engine** | `tmap-v2/src/core/vote.ts` `runCoderVote` | inside TMAP pro mode / Chief |
| **Memory System** | project: `core/memory.ts` (`memories`); image: `core/image-memory.ts`; per-run: `core/blackboard.ts` | `/v1/memory`, `/v1/image/*` |
| **Multi-Agent Workflow** | `chief-agent` + `orchestrator` + specialists (`research/math/writing/vision/architect/...`) | `/v1/orchestrate`, `/v1/run` |
| **AI Provider Router** | web: `lib/server/{model-registry,ai-providers}.ts`; backend: `config.ts` + `core/{model-router,advanced-router}.ts` | — |
| **API Key Management** | web: `api/keys` + `lib/server/{crypto,keys-store}.ts` (AES-256-GCM); backend: `server/crypto.ts` | `/api/keys`, `/v1/me/keys` |
| **Supabase Integration** | web: `lib/supabase/client.ts`, `lib/server/supabase-admin.ts`; backend `server/db.ts` | — |
| **Railway Deployment** | `railway.toml`, `tmap-v2/railway.json` | — |
| **Authentication** | web: Supabase OAuth (`middleware.ts`, `auth-provider`); backend: JWT (`server/auth.ts`); CLI: device tokens | `/v1/auth/*`, `/api/cli/*` |
| **Conversation System** | `lib/conversations.ts`, `api/conversations/*`, tables `conversations`/`messages` | `/api/conversations` |
| **Settings System** | `components/settings/settings-view.tsx` + `lib/keys` + `lib/plans` | — |
| **Prompt System** | see `prompt-map.json` | — |
| **Tool Calling System** | `chief-agent` dispatch → core specialists | — |
| **Streaming System** | web: `lib/api.postSSE` + `ai-providers.primeAndStream`; backend: `server/streaming.ts` | — |
| **Error Handling System** | web: `lib/errors.ts` (13 codes) + `lib/errors/*` + `ai-log`; backend: `server/{logger,failover}.ts` | — |

## 4. Provider / role mapping (`tmap-v2/src/config.ts`)

planner→**gemini** (gemini-2.5-flash) · coder→**deepseek** (deepseek-chat) · reviewer→**qwen** (qwen-plus) · validator→**llama** (llama-3.3-70b via Groq). OpenRouter is the universal fallback; no keys ⇒ mock mode. Web `/api/chat` priority is Anthropic → OpenRouter (+ others by task category in `model-registry`).

## 5. Database (Supabase, RLS) — see `database-map.json`

- **Web**: `provider_keys`, `conversations`, `messages` (gin search), `projects`, `subscriptions`, `user_roles`, `redeem_codes`, `feature_flags`, `system_logs`, `announcements`, `api_usage_metrics`, `feedback`, `referral_*`, `cli_tokens`, `cli_sessions`, `error_logs`.
- **Backend**: `users`, `memories`, `tmap_sessions`, `tmap_agent_logs`, `tmap_costs`, `image_memories`, enterprise (`organizations`, `org_members`, `teams`, `team_members`, `role_assignments`, `webhooks`, `developer_keys`, `audit_events`, `backup_manifests`).

## 6. Key environment variables

`COAGENTIX_MASTER_KEY` (AES master), Supabase (`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), provider keys (`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/`GEMINI_API_KEY`/`DEEPSEEK_API_KEY`/`QWEN_API_KEY`/`LLAMA_API_KEY`), search (`TAVILY_API_KEY`/`GOOGLE_CSE_KEY`+`CX`/`GITHUB_TOKEN`), backend `JWT_SECRET`/`COAGENTIX_ADMIN_USERNAMES`. Full list: `aof-web/.env.example`, `tmap-v2/.env.example`.

## 7. Plans / tiers

`FREE / LITE / PRO / ADVANCED` (`lib/plans.ts` PLANS, PRICING_TIERS; `store/auth-store.ts` TIER_RANK). Enforcement gated by `NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS`. Admin RBAC: `OWNER/ADMIN/STAFF/BETA_TESTER/USER` (`lib/admin/permissions.ts`).

## 8. Testing

`npm test` (tsx --test) in each package. `aof-web/src/tests/*` (~15: router, provider-registry/stream, errors, plans, access, raa, search, usage, health, conversation-state, code-actions, mock-*). `tmap-v2/src/tests/*` (~23: orchestrator, agents, titan, raa, vote, memory, validator, debugger, context(-engine), image-*, db, logger, phase4/5/6, intelligence, admin-auth).

## 9. How to use this memory

1. Start with `search-index.json` (keyword → file) or `feature-map.json` (feature → files).
2. Trace impact via `dependency-map.json` (blast radius) and `knowledge-graph.json` (edges).
3. Confirm APIs in `api-map.json`, schema in `database-map.json`, prompts in `prompt-map.json`.
4. Only then open the specific file(s). Avoid re-scanning the whole repo.
5. After changes, update the affected map(s) and append to `memory-changelog.md` (see `README.md`).

## High blast-radius files (touch carefully)

`aof-web`: `lib/server/ai-providers.ts`, `lib/server/model-registry.ts`, `lib/errors.ts`, `lib/api.ts`, `lib/types.ts`, `lib/server/supabase-admin.ts`.
`tmap-v2`: `config.ts`, `providers/client.ts`, `dars/run.ts`, `core/orchestrator.ts`, `core/agents.ts`, `server/index.ts`, `server/auth.ts`, `server/db.ts`.
