# Nexora — Frontend Architecture

This document covers the deliverables for the Nexora homepage experience: folder
structure, UI & component architecture, routing, state management, database
schema recommendations, and the implementation plan.

Nexora is a **professional AI platform** — not a generic chatbot. It unifies three
products plus settings behind one premium, dark, orange-gold workspace:

| Product        | Route        | Notes                                              |
| -------------- | ------------ | -------------------------------------------------- |
| Nexora Chat  | `/`, `/chat` | The landing surface. Models: **Lite**, **Normal**. |
| Nexora Code       | `/code`      | Modes: **Lite**, **1.0**, **Pro**, **Titan**.      |
| Projects       | `/projects`  | Recent, pinned, search, create, status, type.      |
| Settings       | `/settings`  | Account, appearance, API keys, billing.            |

> **Titan is not a product.** It is the highest *mode inside Nexora Code* and never
> appears on the homepage. It is only reachable from the Nexora Code mode selector.

---

## 1. Folder structure

```
nexora-web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root: fonts, <html>, providers, metadata
│   │   ├── globals.css               # Design system (tokens, glass, utilities)
│   │   ├── not-found.tsx             # Branded 404
│   │   └── (app)/                    # Authenticated app shell route group
│   │       ├── layout.tsx            # Sidebar + mobile topbar + ambient bg
│   │       ├── page.tsx              # HOME → "Welcome to Nexora" (Chat landing)
│   │       ├── chat/page.tsx         # Chat interface (Lite / Normal)
│   │       ├── code/page.tsx         # Nexora Code workspace (+ Titan workflow)
│   │       ├── projects/page.tsx     # Projects
│   │       └── settings/page.tsx     # Settings (tabbed)
│   │
│   ├── components/
│   │   ├── ui/                       # shadcn-style primitives (Radix + cva)
│   │   ├── providers/                # Theme + tooltip + toaster providers
│   │   ├── brand/                    # Logo / wordmark
│   │   ├── layout/                   # Sidebar, mobile nav, user menu, theme toggle
│   │   ├── composer/                 # Reusable premium chat input
│   │   ├── home/                     # Welcome hero, quick actions, home prompt
│   │   ├── chat/                     # Model selector, thread, message, markdown
│   │   ├── code/                     # Mode selector, build view, Titan workflow
│   │   ├── projects/                 # Cards, new-project dialog, view
│   │   └── settings/                 # Settings tabs
│   │
│   ├── store/                        # Zustand stores (ui, chat, code, project)
│   ├── lib/                          # utils, types, constants, api, mock, titan
│   └── hooks/                        # use-mounted, use-media-query
│
├── public/                          # favicon.svg
├── tailwind.config.ts               # Theme tokens, shadows, keyframes
├── components.json                  # shadcn config
└── ARCHITECTURE.md
```

## 2. UI architecture

- **Design language:** dark-first, near-black canvas (`#0A0A0A`), orange-gold
  accent (`#F59E0B`), glass surfaces (translucent + blur + hairline border + soft
  shadow), large premium spacing, `Inter` for UI and `JetBrains Mono` for code.
- **Tokens** live as HSL CSS variables in `globals.css` and are exposed to
  Tailwind in `tailwind.config.ts`. Switching `--*` variables (via the `.dark`
  class) re-themes the whole app; `next-themes` toggles the class, default `dark`.
- **Glass / glow** are reusable component classes (`.glass`, `.glass-strong`,
  `shadow-glow`) so cards, popovers, dialogs and the composer share one look.
- **Motion** via Framer Motion: hero entrance, staggered quick-action cards,
  card hover lift, message fade-in, Titan phase transitions, sidebar width spring.
- **Ambient background** is a fixed, non-interactive radial-glow + aurora layer.

## 3. Component architecture

```
(app)/layout
├── AmbientBackground
├── Sidebar (desktop, collapsible 76 ↔ 264px)
│   ├── Logo / New Chat
│   ├── NavLink × (Chat, Projects, Nexora Code, Settings)  — tooltips when collapsed
│   └── ThemeToggle · UserMenu
├── MobileTopbar (< lg) → Radix Dialog left-sheet with the same nav
└── main
    ├── HomePage:  WelcomeHero · HomePrompt(Composer + ModelSelector) · QuickActions
    ├── ChatView:  ModelSelector · ChatThread(ChatMessage · Markdown) · Composer
    ├── CodeWorkspace: CodeModeSelector → CodeBuild | TitanWorkflow(TitanStepper)
    ├── ProjectsView:  search · ProjectCard · NewProjectDialog
    └── SettingsView:  Tabs(Account · Appearance · Keys · Billing)
```

The **Composer** is a single reusable input (auto-grow, Enter-to-send,
Shift+Enter newline, stop button while streaming) used by the homepage, chat and
Nexora Code so the core interaction feels identical everywhere.

## 4. Routing structure

App Router with a single `(app)` route group that owns the shell. The homepage
(`/`) **is** Nexora Chat — users land on a welcome + composer, never on Nexora
Code. Submitting the home composer hands the first message to the chat store and
navigates to `/chat`. `/settings` is dynamic (reads `?tab=`); the rest are static.

## 5. State management plan

Lightweight **Zustand** stores, one per domain — no provider boilerplate, easy to
swap the mock layer for live calls later:

- `ui-store` — sidebar expanded (persisted to `localStorage`), mobile nav.
- `chat-store` — conversations, active id, model, streaming, `send()`/`stop()`,
  and a `pendingFirstMessage` hand-off from the homepage composer.
- `code-store` — Nexora Code `mode`, the build runner (Lite/1.0/Pro), and the full
  **Titan workflow state machine** (phase, questions, answers, confidence, plans,
  risks, architecture, approval, generated build log).
- `project-store` — projects, search query, pin/create/delete (seeded sample data).

Server/data access is isolated in `lib/api.ts`. It speaks the existing
**tmap-v2** `/v1/*` SSE endpoints (`/v1/chat`, `/v1/run`, `/v1/titan`) when a
backend is configured, and transparently falls back to `lib/mock.ts` so the UI is
fully functional with **zero backend and zero API keys**.

## 6. Database schema recommendations

The backend already uses Supabase/Postgres (`users`, `memories`). Recommended
additions to persist the new surfaces (RLS by `user_id`):

```sql
-- Conversations (Nexora Chat)
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  title       text not null default 'New chat',
  model       text not null default 'normal',          -- 'lite' | 'normal'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null,                        -- 'user' | 'assistant'
  content         text not null,
  model           text,
  created_at      timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

-- Projects
create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  type        text not null default 'web-app',          -- web-app | mobile-app | api | game | automation | research
  status      text not null default 'active',           -- active | building | review | archived
  mode        text,                                     -- lite | 1.0 | pro | titan
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on projects (user_id, pinned, updated_at desc);

-- Titan blueprints (one per approved architect session)
create table titan_blueprints (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  prompt      text not null,
  chosen_plan text,                                     -- 'A' | 'B' | 'C'
  confidence  int,
  approved    boolean not null default false,
  blueprint   jsonb not null default '{}'::jsonb,       -- requirements, plans, risks, architecture
  created_at  timestamptz not null default now()
);
```

Existing `agent_logs` / `cost` tracking and `memories` (Titan/TMAP cross-session
memory) remain unchanged and continue to power the build pipeline.

## 7. Implementation plan (status)

1. ✅ Tooling — Next.js 14 (App Router) · TypeScript · Tailwind · shadcn-style
   primitives · Lucide · Framer Motion · Zustand · next-themes · sonner.
2. ✅ Design system — tokens, glass, glow, ambient background, fonts.
3. ✅ App shell — collapsible sidebar, mobile sheet, user menu, theme toggle.
4. ✅ Homepage — welcome hero, premium composer, 4 quick-action cards.
5. ✅ Chat — Lite/Normal selector, streaming thread, markdown, empty state.
6. ✅ Nexora Code — Lite/1.0/Pro build view + the gated **Titan** workflow.
7. ✅ Projects — pinned/recent, search, create dialog, status/type/last-edited.
8. ✅ Settings — account, appearance, API keys, billing.
9. ✅ API client with live `/v1/*` SSE + offline mock fallback.
10. ⏭️ Next: wire auth (`/v1/auth/*`), persist conversations/projects to Supabase,
    stream live Nexora Code file trees + diff view, and a one-click project export.
```
