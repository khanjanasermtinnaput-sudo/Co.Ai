# Co.AI — Frontend Architecture

This document is a structural map — folder layout, component tree, state
management, routing — kept intentionally light on behavior. For the actual
engineering invariants (Kanon's single-provider-call rule, Ypertatos's 2+N
workflow, the Prompt Compiler/Token Manager/Budget Enforcer/Security Manager
pipeline, the CLI's safety pipeline, etc.), **`CLAUDE.md` is the authoritative,
actively-maintained source** — it's updated per shipped phase; this file
historically was not, and drifted. If the two ever disagree, trust `CLAUDE.md`
and treat this file as needing a fix.

Co.AI is a **professional AI platform** — not a generic chatbot. It unifies
three products plus settings behind one workspace:

| Product   | Route(s)                          | Notes                                                              |
| --------- | ---------------------------------- | ------------------------------------------------------------------- |
| Co.AI     | `/`, `/chat`                      | The landing surface. Tiers: **Mikros** (lite), **Kanon** (normal). |
| CoCode    | `/code`                           | Tiers: Mikros, Kanon, **Ypertatos** (pro), **Titan**.               |
| Projects  | `/projects`, `/projects/[id]`     | Recent, pinned, search, create, open a project's CoCode workspace.  |
| Activity  | `/activity`                       | Cross-conversation/build activity feed.                             |
| Settings  | `/settings`                       | Tabbed: Account, Appearance, API Keys, Usage, Diagnostics, Billing.  |
| Admin     | `/admin/*`                        | Separate route tree (own layout), gated by admin role.              |

> **Titan is not a product.** It is the highest *tier inside CoCode* and never
> appears on the homepage. It is only reachable from CoCode's mode selector.
> Tier display names (`model-branding.ts`: lite→Mikros, normal→Kanon,
> pro→Ypertatos, titan→Titan) are the single source of truth for what the UI
> ever shows — see `CLAUDE.md` for what each tier actually does.

---

## 1. Folder structure

```
aof-web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root: fonts, <html>, providers, metadata
│   │   ├── globals.css               # Design system (tokens, glass, utilities)
│   │   ├── global-error.tsx          # App-wide error boundary page
│   │   ├── not-found.tsx             # Branded 404
│   │   ├── login/                    # Standalone login page
│   │   ├── auth/callback/            # OAuth callback handler
│   │   ├── admin/                    # Admin console — own layout, role-gated
│   │   ├── (marketing)/              # Public pages: about, blog/[slug], privacy, terms
│   │   ├── (app)/                    # Authenticated app shell route group
│   │   │   ├── layout.tsx            # Sidebar + mobile topbar + ambient bg
│   │   │   ├── page.tsx              # HOME → "Welcome to Co.AI" (Chat landing)
│   │   │   ├── chat/page.tsx         # Chat interface (Mikros / Kanon)
│   │   │   ├── code/page.tsx         # CoCode workspace (+ Ypertatos / Titan)
│   │   │   ├── activity/page.tsx     # Cross-conversation activity feed
│   │   │   ├── projects/[id]/page.tsx
│   │   │   └── settings/page.tsx     # Settings (tabbed)
│   │   └── api/                      # ~50 Next.js Route Handlers — see below
│   │
│   ├── components/
│   │   ├── ui/                       # shadcn-style primitives (Radix + cva)
│   │   ├── providers/                # Theme, auth, tooltip, toaster, smart-keyboard
│   │   ├── brand/                    # Logo / wordmark
│   │   ├── layout/                   # Sidebar, mobile nav, history panels, user menu
│   │   ├── composer/                 # Reusable premium chat input
│   │   ├── command-palette/          # Global ⌘K command palette (Radix Dialog-based)
│   │   ├── chat/                     # Model selector, thread, message, markdown
│   │   ├── code/                     # Mode selector, conversation, preview, Titan workflow
│   │   ├── cocode/                   # CoCode workspace: panel-host/panel-tab-strip
│   │   │                             #   (the shared shell) + ~20 domain panels
│   │   ├── mascot/                   # TAOTAO — pixel-art mascot, confined to chat/
│   │   ├── projects/                 # Cards, new-project dialog, open-project
│   │   ├── settings/                 # settings-view.tsx delegates to tabs/*
│   │   ├── admin/                    # Admin console components
│   │   ├── auth/, billing/, diagnostics/, error/, pwa/
│   │
│   ├── store/                        # Zustand stores — see §5 for the current list
│   ├── lib/
│   │   ├── server/                   # The real engineering pipeline (see CLAUDE.md):
│   │   │                             #   prompt-compiler, token-manager, budget-enforcer,
│   │   │                             #   orchestrator, security-manager, ai-providers, etc.
│   │   ├── cocode/                   # CoCode-specific logic (virtual FS, deployment, diff…)
│   │   ├── admin/                    # Admin permissions/types
│   │   ├── errors/                   # Typed API error registry (api-error.ts, error-codes.ts)
│   │   ├── smart-keyboard/           # Thai/English layout-mistake detection
│   │   └── (api.ts, types.ts, utils.ts, constants.ts, effort.ts, errors.ts, …)
│   └── hooks/                        # use-mounted, use-plan, use-smart-keyboard
│
├── public/                          # favicon, manifest
├── tailwind.config.ts               # Theme tokens, shadows, keyframes
├── components.json                  # shadcn config
├── CLAUDE.md                        # Governance — the accurate, per-phase-updated doc
├── DESIGN.md                        # Visual design system reference
└── ARCHITECTURE.md                  # This file
```

## 2. UI architecture

- **Design language:** dark-first canvas with an orange-gold accent, glass
  surfaces (translucent + blur + hairline border + soft shadow), `Inter` for UI
  and a monospace face for code.
- **Tokens** live as HSL CSS variables in `globals.css` and are exposed to
  Tailwind in `tailwind.config.ts`. Switching `--*` variables (via the `.dark`
  class) re-themes the whole app; `next-themes` toggles the class, default dark.
- **Glass / glow** are reusable component classes (`.glass`, `.glass-strong`,
  `.console-surface`, `shadow-glow`) so cards, popovers, dialogs, the composer,
  and CoCode's console-style panels each share one look. See `CLAUDE.md`'s "UI
  contrast rule" for the hard requirement every custom surface utility follows
  (a light base rule + `.dark` override — `.console-surface` is a documented,
  deliberate exception, since it's meant to stay dark regardless of app theme).
- **Motion** via Framer Motion: hero entrance, card hover lift, message
  fade-in, Titan phase transitions, sidebar width spring, Smart Keyboard's
  suggestion banner.
- **Ambient background** is a fixed, non-interactive radial-glow layer.

## 3. Component architecture

```
(app)/layout
├── AmbientBackground
├── Sidebar (desktop, collapsible) — New Chat/Code, NavLinks, ChatHistoryPanel,
│                                     CocodeHistoryPanel, ThemeToggle · UserMenu
├── MobileTopbar (< lg) → Radix Dialog left-sheet with the same nav
├── CommandPalette (⌘K, global)
└── main
    ├── ChatView:      ChatModelSelector · ChatThread(ChatMessage · Markdown)
    │                  · ComposerMascot(Composer) · WorkflowProgress
    ├── CocodeGate → CocodeWorkspace:
    │      PanelTabStrip (+ CollapsedRail) — the shared switcher/shell for
    │      ~20 domain panels, each rendered through PanelHost's lazy-load
    │      registry. Most panels share one PanelHeader component for their
    │      title/icon/action-row chrome (file-explorer.tsx, build-panel.tsx,
    │      and github-panel.tsx are the deliberate exceptions — structurally
    │      different headers, not drift).
    ├── ActivityView
    ├── ProjectsView:  search · ProjectCard · NewProjectDialog · OpenProject
    └── SettingsView:  Tabs(Account · Appearance · Keys · Usage · Diagnostics · Billing)
```

The **Composer** is the single reusable chat input (auto-grow, Enter-to-send,
Shift+Enter newline, stop-while-streaming, Smart Keyboard live-suggestion
banner) used by chat and CoCode so the core interaction feels identical
everywhere.

## 4. Routing structure

App Router with an `(app)` route group owning the authenticated shell and a
separate `(marketing)` group for public pages. The homepage (`/`) **is**
Co.AI — users land on a welcome + composer. `/admin` is a fully separate
route tree with its own layout and role gate. `/settings` reads `?tab=`.

## 5. State management

Zustand stores, one per domain (`src/store/`, 10 files):

- `ui-store` — sidebar/mobile-nav state, mascot-animation toggle, developer-mode.
- `chat-store` — conversations, active id, model/effort, streaming, `send()`/
  `stop()`, `loadMessages()` (hydrates a conversation's messages from Supabase
  on open — see §6), per-conversation `messagesStatus`.
- `code-store` — CoCode conversational build mode + Titan workflow state.
- `cocode-ide-store` — the CoCode IDE proper: virtual file system, open tabs,
  panel layout, GitHub connection state.
- `project-store` — projects, search, pin/create/delete.
- `auth-store` — Supabase session/user, tier.
- `guest-store` — anonymous/guest usage tracking (message limits pre-signup).
- `usage-store` — per-user usage/quota display.
- `diagnostics-store` — system-diagnostics panel state.
- `smart-keyboard-store` — Smart Keyboard enabled/mode, persisted.

Server access for the chat/CoCode pipeline is `src/lib/api.ts` + the
`src/lib/server/*` modules `CLAUDE.md` documents in detail — not a thin proxy
to `tmap-v2`. `tmap-v2` remains a separate, real Express backend used by
`coagentix-cli` and its own `/v2` surfaces; it is not aof-web's primary
request path.

## 6. Conversation persistence

`conversations` and `messages` tables in Supabase, RLS'd by `user_id`.
`chat-store.ts`'s `loadRemoteConversations()` seeds the sidebar with
metadata only; opening a conversation triggers `loadMessages()`, which calls
`GET /api/conversations/[id]/messages` and merges the result into the store.
This two-step load (metadata first, messages on open) is what lets a
conversation started on one device show up — with its real messages, not an
empty thread — when opened from another.

## 7. API routes

~50 Next.js Route Handlers under `src/app/api/`. Error responses are
standardized on `src/lib/errors/api-error.ts` + `error-codes.ts`'s typed
registry (`formatError(code, …)`) — `chat/route.ts` and `refactor/route.ts`
are the deliberate exception, using the separate `src/lib/errors.ts` system
built specifically for the AI-provider streaming-failure envelope, a
different concern from a general REST error shape.

Not every route has a caller inside `aof-web` today — a cluster tagged with
sequential "Phase N" comments (`ai/learning`, `ai/memory`, `tasks`,
`plugins`, `queue`, and others) were built ahead of any UI wiring. Treat an
unreferenced route as worth confirming with whoever owns that surface before
assuming it's dead.

## 8. Database schema (representative)

The backend uses Supabase/Postgres. Core tables (see `supabase/migrations/`
for the authoritative, current schema):

```sql
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New chat',
  model       text not null default 'normal',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null,
  content         text not null,
  model           text,
  created_at      timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  status      text not null default 'active',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

## 9. Status

The build-out described in earlier drafts of this document (tooling, design
system, app shell, chat, CoCode, projects, settings, Supabase persistence) is
complete and live. Open structural items, tracked as ongoing cleanup rather
than a roadmap:

- `core/orchestrator.ts` (tmap-v2, legacy) and `v2/orchestrator-v2.ts`
  (tmap-v2, newer) both run in production on different routes — confirmed
  intentional, not drift, but still two engines to reason about.
- A cluster of orphan `aof-web` API routes (§7) need a product decision:
  wire them to UI, confirm an external caller, or remove them.
