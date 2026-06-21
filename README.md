# Coagentix

**Professional AI platform for developers** — multi-provider chat, TMAP multi-agent coding assistant, and encrypted API key management, built on Next.js 14 + Supabase.

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-auth%20%2B%20db-green)](https://supabase.com)

---

## What's inside

| Package | Description |
|---------|-------------|
| `aof-web/` | Next.js 14 frontend + API routes (the main app) |
| `tmap-v2/` | Express backend — TMAP multi-agent pipeline, DARS routing |
| `coagentix-cli/` | `coai` CLI — run TMAP tasks from your terminal |

## Features

- **Multi-provider chat** — Anthropic, Gemini, DeepSeek, Qwen, Llama (Groq), OpenRouter; automatic failover with DARS circuit breaker
- **Coagentix Code** — TMAP pipeline: Chief → Planner → Coder → Reviewer → Validator
- **Encrypted API key storage** — AES-256-GCM + scrypt, per-user keys stored in Supabase
- **Universal search** — web search toggle backed by Tavily / Google CSE / GitHub / Wikipedia
- **Subscription tiers** — Free / Pro / Enterprise, enforced via Supabase RLS + `user_roles` table
- **13 typed error codes** — every provider failure is classified, user-visible, and actionable
- **610+ tests** — `npm test` in `aof-web/`

## Quick start

```bash
# 1. Clone
git clone https://github.com/khanjanasermtinnaput-sudo/Co.Ai
cd Co.Ai/aof-web

# 2. Install
npm install

# 3. Configure
cp .env.example .env.local
# Fill in SUPABASE_*, ANTHROPIC_API_KEY (or any other provider key), COAGENTIX_MASTER_KEY

# 4. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

See [`aof-web/.env.example`](aof-web/.env.example) for the full list with comments.

**Required for full functionality:**

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | For encrypted key storage + admin APIs |
| `COAGENTIX_MASTER_KEY` | AES master key (`openssl rand -hex 32`) |
| At least one AI provider key | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc. |

## Deploy to Railway

1. Push to GitHub
2. Create a new Railway project → connect repo
3. Railway detects `railway.toml` automatically
4. Add all environment variables from `.env.example` in the Railway dashboard
5. Set `NEXT_PUBLIC_SITE_URL` to your Railway domain (e.g. `https://coagentix.railway.app`)
6. Update Supabase → Auth → URL Configuration: add your Railway domain to allowed redirect URLs
7. Update Google Cloud Console → OAuth consent: add your Railway domain to authorised redirect URIs

## Architecture

```
Browser
  └── Next.js 14 (aof-web/)
        ├── /api/chat          → provider routing, streaming, DARS failover
        ├── /api/keys          → encrypted key CRUD (AES-256-GCM)
        ├── /api/admin/*       → admin panel (service_role only)
        └── /v1/* proxy        → rewrites to tmap-v2 backend

tmap-v2/ (Express)
  ├── TMAP pipeline            → Chief → Planner → Coder → Reviewer → Validator
  ├── DARS                     → circuit breaker, health scoring, provider routing
  └── /v1/chat, /v1/run, ...   → multi-agent endpoints
```

## Tech stack

- **Frontend**: Next.js 14 App Router, TypeScript (strict), Tailwind CSS, Framer Motion
- **State**: Zustand
- **Auth**: Supabase Auth (Google OAuth)
- **Database**: Supabase (PostgreSQL) with RLS
- **AI SDKs**: `@anthropic-ai/sdk`, fetch-based adapters for Gemini / DeepSeek / Qwen / Groq / OpenRouter
- **Testing**: Node test runner (`tsx --test`)

## License

MIT
