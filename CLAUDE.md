# Aof — Project Intelligence

> Memory-first: always read this file before reading any source file.
> Load the smallest level necessary. Read source only if a level is insufficient.

---

## L1 — Project Summary (always load · ~600 tokens)

**Aof** is a professional AI coding platform built on **TMAP** (Technology Multi-AI Agent
Processing) — multiple AI models collaborate in fixed roles and auto-failover via DARS.

| Product      | Route        | Mode options                        |
|--------------|--------------|-------------------------------------|
| Chat with Aof | `/`, `/chat` | Lite · Normal                       |
| Aof Code     | `/code`      | Lite · 1.0 · Pro · **Titan** (gated)|
| Projects     | `/projects`  | —                                   |
| Settings     | `/settings`  | Account · Appearance · Keys · Billing|

**Stack:**
- Frontend: `aof-web/` — Next.js 14 (App Router) · TypeScript · Tailwind · Radix UI · Zustand · Framer Motion · shadcn-style primitives
- Backend: `tmap-v2/` — Express · TypeScript ESM (`.js` imports required) · tsx runtime · JWT + PIN auth · SSE streaming
- Database: Supabase (PostgreSQL) — currently only `users` table
- Deployment: Vercel (`aof-web`) · Render (`tmap-v2`)
- AI Providers: Gemini · DeepSeek · Qwen · Llama · OpenRouter (unified via OpenAI-compat client)

**Current status gaps (prioritised):**
1. 🔴 DARS — runtime agent failover (`src/dars/`)
2. 🔴 Memory 6 layers — only session JSON persists now
3. 🔴 Voting/Consensus Engine (`src/consensus/`)
4. 🔴 Project Context Engine (`src/context-engine/`)
5. 🔴 DB schema — only `users` exists; 7 more tables needed
6. 🟡 CLI — only `doctor/agents/gencode`; needs 9 more verbs

**Key spec files:**
- `AOF_CODE_TDD.md` — full architecture spec (DARS §4, Memory §6, DB §8, CLI §10)
- `aof-web/ARCHITECTURE.md` — frontend component/routing/state spec

---

## L2 — Feature Summaries (load by area)

### [TMAP Backend — tmap-v2]

**TMAP Loop** (`src/core/orchestrator.ts` ✅):
```
/v1/run {task, mode} → Planner → loop(maxIter: lite=0, normal=1, pro=3):
  Coder → Validator (node --check) → Reviewer → critique if fail → persist(bb) → SSE done
```
Modes: `lite` (0 iter) · `normal` (1 iter) · `pro` (3 iter)

**Agent roles & default providers** (`src/config.ts` ✅):
| Role | Default | Fallback chain (DARS) |
|---|---|---|
| Planner | Gemini | → Qwen → Llama → DeepSeek |
| Coder | DeepSeek | → Qwen → Gemini → Llama |
| Reviewer | Qwen | → Gemini → Llama → DeepSeek |
| Validator | Llama | → DeepSeek → Gemini → Qwen |

**Provider abstraction** (`src/providers/client.ts` ✅): Single OpenAI-compatible
`chat(provider, messages, opts)` function — adding a new provider = new entry in `PROVIDERS`.

**Auth model** (`server/auth.ts` ✅): PIN (4–8 digits) + bcrypt hash → JWT 30d.
Keys stored per-user encrypted in `users.encrypted_keys JSONB`. `CredentialBag` injected
per-request (multi-tenant ready). ⚠️ Needs login rate-limit (PIN entropy low).

**Blackboard** (`src/core/blackboard.ts` ✅): Typed shared state for one `/v1/run`.
`persist()` writes to `/tmp/.aof/sessions/` (Vercel ephemeral — must move to DB).

**SSE event format** (backward-compatible, never change shape):
```json
{"role":"system|planner|coder|reviewer|validator", "kind":"status|code|review", "text":"..."}
```

---

### [DARS — Dynamic Agent Replacement System 🔴]

**Goal:** When any agent call fails during `/v1/run`, DARS detects → selects best healthy
replacement → continues — **without failing the job or surfacing an error to the user**.

**Files to create:** `src/dars/health.ts` · `src/dars/select.ts` · `src/dars/run.ts` · `src/dars/classify.ts`

**Entry point:** `chatWithDARS(role, creds, messages, opts, ctx)` wraps existing `chat()`.
Change only: in `src/core/agents.ts`, replace `chat()` calls with `chatWithDARS()`.

**Failure taxonomy:**
| Error | Detection | Action |
|---|---|---|
| API Down | network/5xx | failover immediately |
| Timeout | AbortController > 30s | retry once same → failover |
| Rate limit | HTTP 429 | failover + cooldown (Retry-After) |
| Quota exhausted | 402/403 + body match | mark provider 1h cooldown |
| High latency | ewmaLatency > SLO × N | degrade score (no fail current) |
| Low quality | empty/parse fail/confidence low | retry with different provider |

**Circuit breaker states:** `CLOSED` → `OPEN` → `HALF_OPEN` → `CLOSED`

**Scoring algorithm** (capability × reliability × speed × cost × diversity):
```ts
score = 0.45*cap + 0.20*successRate + 0.15*speedScore + 0.10*costScore + 0.10 + diversityBonus
```

---

### [Memory Architecture 🔴]

6 layers planned (TDD §6):
| # | Layer | Scope | Backing store |
|---|---|---|---|
| 1 | Conversation | per session | messages table + Redis recent + rollup |
| 2 | Project | per project | pgvector: code chunks, decisions, conventions |
| 3 | File | per file | files table: hash, summary, symbols, history |
| 4 | User Preference | per user | memories(scope=user): style, lang, framework |
| 5 | Long-Term | cross-project | embeddings: reusable patterns/lessons |
| 6 | Agent | per agent/provider | health stats → feeds DARS scoring |

Currently only Working Memory (Blackboard) exists ✅. Files to create: `src/memory/`.
RAG pipeline: `query → hybrid(BM25+vector) → rerank → token-budget pack → bb.context`

---

### [aof-web Frontend]

**Design language:** dark-first `#0A0A0A` canvas · orange-gold `#F59E0B` accent · glass
surfaces (blur + hairline border) · Inter (UI) + JetBrains Mono (code).

**Design tokens:** HSL CSS vars in `globals.css` → exposed via `tailwind.config.ts`.
Reusable classes: `.glass`, `.glass-strong`, `shadow-glow`.

**State stores** (`src/store/`):
- `ui-store` — sidebar expanded (localStorage persisted)
- `chat-store` — conversations, streaming, `send()`/`stop()`, pendingFirstMessage handoff
- `code-store` — mode, build runner, **Titan workflow state machine** (phase/questions/plans/approval)
- `project-store` — projects, search, pin/create/delete

**API client** (`src/lib/api.ts`): calls `tmap-v2 /v1/*` SSE; transparently falls back to
`src/lib/mock.ts` when no backend configured.

**Composer** (`src/components/composer/`): single reusable input (auto-grow, Enter=send,
Shift+Enter=newline, stop while streaming) — used in Home, Chat, and Aof Code.

**Next steps for aof-web:**
- Wire auth (`/v1/auth/*`)
- Persist conversations + projects to Supabase
- Live Aof Code file tree + diff view
- One-click project export

---

### [Database Schema]

**Exists ✅:** `users(id, username, pin_hash, encrypted_keys JSONB, created_at)`

**Needs adding 🔴** (see TDD §8 for full SQL):
```
projects · files · conversations · messages
memories (scope: project|user|long_term, embedding VECTOR(1024))
tasks · agent_logs · events
```
`memories` uses pgvector HNSW index: `CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops)`
All tables have `user_id FK` with RLS by `user_id`.

---

## L3 — Module Summaries (load by subsystem)

### tmap-v2 key files
| File | Purpose |
|---|---|
| `src/config.ts` | `PROVIDERS` catalogue, `ROLE_PROVIDER` mapping, `resolveRoleWith(role, CredentialBag)`, `bagFromEnv()` |
| `src/types.ts` | `Blackboard`, `AgentEvent`, `Role`, `Mode`, `ResolvedProvider`, `CredentialBag` |
| `src/core/orchestrator.ts` | TMAP loop: createBlackboard → plan → code→validate→review × N → persist → SSE done |
| `src/core/agents.ts` | `planWith()`, `codeWith()`, `reviewWith()` — each calls `chat()` + parses role-specific output |
| `src/core/blackboard.ts` | `createBlackboard()`, `logEvent()`, `persist()` (→ /tmp/.aof), `loadSession()` |
| `src/core/validator.ts` | `validateFiles(files)` → `node --check` (JS only); returns `ValidationResult[]` |
| `src/providers/client.ts` | `chat(provider, messages, opts)` — OpenAI-compat HTTP call + `mockReply()` fallback |
| `src/server/index.ts` | Express routes: `/v1/auth/*`, `/v1/me`, `/v1/me/keys`, `/v1/run` (SSE), `/v1/agents` |
| `src/server/auth.ts` | `hashPassword()`, `verifyPassword()`, `signToken()`, `verifyToken()` |
| `src/server/crypto.ts` | AES-256-GCM encryption/decryption for stored API keys |
| `src/server/db.ts` | Supabase client + `/tmp` JSON fallback; `getUser()`, `saveUser()`, `updateKeys()` |
| `api/index.ts` | Vercel serverless entry — imports Express app from server/index.ts |

### aof-web key files
| File | Purpose |
|---|---|
| `src/app/layout.tsx` | Root: fonts, `<html>`, providers, metadata |
| `src/app/(app)/layout.tsx` | Sidebar + mobile topbar + ambient bg |
| `src/app/api/chat/route.ts` | Chat API route → Anthropic SDK streaming |
| `src/app/api/conversations/route.ts` | CRUD conversations → Supabase |
| `src/app/api/keys/route.ts` | API key management |
| `src/components/code/code-build.tsx` | Aof Code workspace (Lite/1.0/Pro) |
| `src/components/chat/chat-view.tsx` | Full chat interface with streaming |
| `src/lib/api.ts` | Client-side API helper → tmap-v2 or mock |
| `src/lib/mock.ts` | Full offline mock for all tmap-v2 endpoints |

---

## L4 — Component Summaries (load on demand)

> Query Serena or Greptile before loading L4. Load only the component being modified.

Key component relationships:
- `(app)/layout.tsx` → `Sidebar` → `NavLink`, `ThemeToggle`, `UserMenu`
- `code/page.tsx` → `CodeModeSelector` → `CodeBuild | TitanWorkflow → TitanStepper`
- `chat/page.tsx` → `ModelSelector` · `ChatThread` → `ChatMessage` → `Markdown`
- `Composer` shared across: HomePage · ChatView · CodeWorkspace

---

## L5 — File Content (read on demand only)

> Only read source files when L1–L4 are insufficient for the task.
> Always prefer `serena` semantic query or `greptile` search first.

---

## Coding Conventions

**tmap-v2:**
- TypeScript strict mode, ESM — imports MUST use `.js` extension (e.g., `from './types.js'`)
- No comments unless WHY is non-obvious
- Preserve existing architecture — additive only, never rewrite working subsystems
- Status markers: ✅ DONE · 🟡 PARTIAL · 🔴 TODO (match AOF_CODE_TDD.md)
- `CredentialBag` is always the key source — never read from `process.env` inside agents
- New agent features wrap `chat()`, never replace it

**aof-web:**
- App Router conventions (`"use client"` only where required)
- Zustand stores are the single source of truth — no local state for shared data
- CSS variables for all design tokens — no hardcoded colours
- Framer Motion for all animations — no CSS-only transitions on interactive elements
- shadcn-style components: Radix primitive + `cva` variants + `cn()` utility

---

## Architecture Rules (never violate)

1. `ROLE_PROVIDER` is config — never hardcode model name inside agent functions
2. All agent calls use `CredentialBag` injected per-request (multi-tenant)
3. `Blackboard` is shared state — all agents read/write through it only
4. SSE event shape `{role, text, kind}` is backward-compatible — never change it
5. DARS wraps `chat()` via `chatWithDARS()` — does not replace or modify `chat()`
6. Security: no raw API key ever leaves the server; `/v1/me` returns masked only
7. Supabase row-level security: all new tables must have RLS by `user_id`
8. Vercel `/tmp` is ephemeral — never use it for persistent data (use Supabase)

---

## Memory-First Workflow

```
Task received
    │
    ▼
1. Check CLAUDE.md L1 — do I know the area? (yes → skip to step 4)
    │
    ▼
2. Check L2 feature summary for the relevant area
    │
    ▼
3. Check L3 module summary for the specific file
    │
    ▼
4. Query Serena: "find symbol X" or Greptile: "where is Y implemented?"
    │
    ▼
5. Read source file ONLY if steps 1-4 are insufficient
    │
    ▼
6. After task: update this file if architecture decisions changed
```

---

## Quick Reference — API Endpoints

**tmap-v2 (live):**
```
POST /v1/auth/register    {username, pin}          → {token, username}
POST /v1/auth/login       {username, pin}          → {token, username}
GET  /v1/me               Bearer                   → {username, keys(masked)}
PUT  /v1/me/keys          {provider, key}          → {ok, masked}
DEL  /v1/me/keys/:prov                             → {ok}
POST /v1/run              {task, mode} → SSE       → {role,text,kind}* + done{files,iter}
GET  /v1/agents                                    → role→provider mapping
```

**tmap-v2 (planned 🔴):**
```
POST /v1/projects · POST /v1/projects/:id/index · GET /v1/projects/:id/memory
GET  /v1/tasks · GET /v1/tasks/:id · POST /v1/tasks/:id/apply
PUT  /v1/agents/mapping · POST /v1/chat (SSE)
```

**aof-web API routes:**
```
POST /api/chat                → Anthropic SDK streaming
GET  /api/conversations       → list
POST /api/conversations       → create
GET  /api/conversations/:id   → get with messages
POST /api/conversations/:id/messages → add message
GET  /api/keys · POST /api/keys → key management
GET  /api/search              → search
GET  /api/health              → health check
```

---

## Development Roadmap (condensed from TDD §15)

**Phase 1 — DARS + Security** ← Current priority
- `src/dars/` (health, select, run, classify)
- Login rate-limit/lockout (5 attempts / 5 min / username+IP)
- `agent_logs` + `events` Supabase tables

**Phase 2 — Memory + Context**
- 6-layer memory (`src/memory/`)
- Context Engine (`src/context-engine/` — AST chunk → embed → RAG)
- Move `persist()` from `/tmp` → Supabase `tasks` table
- 7 new DB tables + pgvector

**Phase 3 — Consensus + CLI**
- Voting/Arbiter (`src/consensus/`)
- CLI verbs: chat, fix, review, explain, build, analyze, project, memory, login
- Ink TUI + interactive diff-apply

**Phase 4 — Scale**
- Redis (health-store + rate-limit + cache) + BullMQ
- E2B/Firecracker (multi-lang validation sandbox)
- LangGraph → Temporal (durable orchestration)
- Observability: OpenTelemetry + Langfuse

---

_Last updated: 2026-06-15 | Update this file after every significant architecture decision._
