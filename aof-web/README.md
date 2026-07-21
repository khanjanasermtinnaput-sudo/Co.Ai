# Co.AI — Web

The homepage experience for **Co.AI**, a professional AI platform that unifies
**Co.AI**, **CoCode**, and **Projects** in one premium dark workspace.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**,
shadcn-style **Radix** primitives, **Lucide** icons, **Framer Motion**, and
**Zustand**. Dark-first with an orange-gold (`#F59E0B`) identity.

> Design goal: feel as polished as Claude, Cursor, Linear and Notion — with its
> own identity. Users land on **Co.AI** and understand "I can chat" and
> "I can start building" within 5 seconds.

## Quick start

```bash
cd aof-web
npm install
cp .env.example .env.local   # add GEMINI_API_KEY or OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

Set at least one AI provider key (`GEMINI_API_KEY` or `OPENROUTER_API_KEY`).
**Co.AI never fakes AI** — with no key it surfaces a clear `AOF_ERROR_001` panel
telling you exactly what to add. For a keyless local UI demo, opt in explicitly
with `NEXT_PUBLIC_AOF_DEMO=1` (clearly-labelled simulated responses).

### Connect the real backend (tmap-v2)

The UI talks to the existing `tmap-v2` Express server (`/v1/*` SSE endpoints).
Copy `.env.example` → `.env.local` and set one of:

```bash
# Same-origin via Next rewrite (recommended for prod):
AOF_API_PROXY=http://localhost:8787
NEXT_PUBLIC_AOF_SAME_ORIGIN=1

# …or call the backend directly (dev / cross-origin):
NEXT_PUBLIC_AOF_API_BASE=http://localhost:8787
```

When a backend is reachable, Chat → `/v1/chat`, CoCode → `/v1/run`, and Titan
maps onto `/v1/titan`. If a call fails, the UI surfaces a structured error (see
below) — it never fabricates a reply.

## AI provider error handling

Co.AI prioritises **transparency over appearance**: it never pretends AI is working
when it isn't. Every provider failure is detected, classified, logged server-side
and shown to the user as a structured panel — never a fake answer, never a silent
fallback.

- **Error model** — `src/lib/errors.ts` classifies any failure into one of 13
  codes (`AOF_ERROR_001`–`AOF_ERROR_013`: missing/invalid/expired key, quota,
  rate-limit, provider-unavailable, network, timeout, invalid-model, auth, empty
  response, unknown, configuration). Each carries **Provider · Problem · Details ·
  Solution · Timestamp**.
- **Server route** — `src/app/api/chat/route.ts` "primes" the provider (pulls the
  first token) before committing to a 200 stream, so an auth/quota/model/network
  failure becomes a clean error envelope instead of a half-rendered fake. Failures
  are logged as `[AOF ERROR]` blocks with request id, status, stack and body.
- **Failover** — if the primary provider fails and a backup key is configured, the
  route fails over **and announces it**: the reply is prefixed with a "Primary
  provider failed — switched to …" notice. Failovers are never hidden.
- **Health + diagnostics** — `GET /api/health` runs a cheap auth check per provider
  and reports `CONNECTED / DEGRADED / DISCONNECTED / UNKNOWN` plus an aggregate
  system status. **Settings → Diagnostics** renders the live Provider Status panel
  and a **Developer Mode** toggle that reveals raw status, response body, stack
  trace and request metadata on error panels (secrets always redacted).

## Scripts

| Script              | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Start the dev server                 |
| `npm run build`     | Production build                     |
| `npm start`         | Serve the production build           |
| `npm run lint`      | ESLint (next/core-web-vitals)        |
| `npm run typecheck` | `tsc --noEmit`                       |

## Multimodal chat

Co.AI is now a multimodal, auto-routed surface — users never pick a model.

- **Attachments** — upload **images**, **PDFs** and **code files** straight from
  the composer (`+` menu). Images preview inline; code/text is decoded for
  analysis. See `src/lib/attachments.ts`.
- **Auto-router** — every request is classified by `src/lib/router.ts` and sent to
  the right system: general questions → **Co.AI**, engineering/file analysis →
  **CoCode**, live look-ups → **Search Agent**. Each reply shows a "Routed to …"
  badge.
- **Response style** — a **Short / Normal / Detailed** selector controls verbosity
  (persisted in `localStorage`). Verbosity, not the model, is the user-facing dial.
- **Math & Learning mode** — math/science/step problems render a structured
  **Answer · Steps · Concept** card you can toggle inline without re-asking.

## Product map

- **Co.AI** (`/`, `/chat`) — multimodal & auto-routed; **Short / Normal /
  Detailed** response styles.
- **CoCode** (`/code`) — modes **Lite**, **1.0**, **Pro**, **Titan**.
  - **Titan** is the highest mode *inside* CoCode (never on the homepage). It
    runs Discovery → Clarify → Requirements → Analysis → Plans → Risk →
    Architecture → **Approval gate** → Generate, and writes no code until approved.
- **Projects** (`/projects`) — recent, pinned, search, status, type, last edited.
- **Settings** (`/settings`) — account, appearance, API keys, **diagnostics**
  (live provider status + Developer Mode), billing.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for folder structure, component and
routing architecture, state management, and database schema recommendations.
