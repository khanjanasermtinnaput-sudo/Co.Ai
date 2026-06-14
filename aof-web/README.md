# Aof — Web

The homepage experience for **Aof**, a professional AI platform that unifies
**Chat with Aof**, **Aof Code**, and **Projects** in one premium dark workspace.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**,
shadcn-style **Radix** primitives, **Lucide** icons, **Framer Motion**, and
**Zustand**. Dark-first with an orange-gold (`#F59E0B`) identity.

> Design goal: feel as polished as Claude, Cursor, Linear and Notion — with its
> own identity. Users land on **Chat with Aof** and understand "I can chat" and
> "I can start building" within 5 seconds.

## Quick start

```bash
cd aof-web
npm install
npm run dev          # http://localhost:3000
```

The app runs **fully standalone in mock mode** — no backend or API keys needed.
Responses stream from a local mock engine so every surface is interactive.

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

When a backend is reachable, Chat → `/v1/chat`, Aof Code → `/v1/run`, and Titan
maps onto `/v1/titan`. If a call fails, the UI gracefully falls back to mock so
the experience never breaks.

## Scripts

| Script              | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Start the dev server                 |
| `npm run build`     | Production build                     |
| `npm start`         | Serve the production build           |
| `npm run lint`      | ESLint (next/core-web-vitals)        |
| `npm run typecheck` | `tsc --noEmit`                       |

## Multimodal chat

Chat with Aof is now a multimodal, auto-routed surface — users never pick a model.

- **Attachments** — upload **images**, **PDFs** and **code files** straight from
  the composer (`+` menu). Images preview inline; code/text is decoded for
  analysis. See `src/lib/attachments.ts`.
- **Auto-router** — every request is classified by `src/lib/router.ts` and sent to
  the right system: general questions → **Aof Chat**, engineering/file analysis →
  **Aof Code**, live look-ups → **Search Agent**. Each reply shows a "Routed to …"
  badge.
- **Response style** — a **Short / Normal / Detailed** selector controls verbosity
  (persisted in `localStorage`). Verbosity, not the model, is the user-facing dial.
- **Math & Learning mode** — math/science/step problems render a structured
  **Answer · Steps · Concept** card you can toggle inline without re-asking.

## Product map

- **Chat with Aof** (`/`, `/chat`) — multimodal & auto-routed; **Short / Normal /
  Detailed** response styles.
- **Aof Code** (`/code`) — modes **Lite**, **1.0**, **Pro**, **Titan**.
  - **Titan** is the highest mode *inside* Aof Code (never on the homepage). It
    runs Discovery → Clarify → Requirements → Analysis → Plans → Risk →
    Architecture → **Approval gate** → Generate, and writes no code until approved.
- **Projects** (`/projects`) — recent, pinned, search, status, type, last edited.
- **Settings** (`/settings`) — account, appearance, API keys, billing.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for folder structure, component and
routing architecture, state management, and database schema recommendations.
