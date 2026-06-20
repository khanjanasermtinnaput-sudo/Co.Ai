-- ── Conversations & Messages ──────────────────────────────────────────────────
-- Persists per-user chat conversations and their messages.
-- All access goes through the Next.js /api/conversations routes using the
-- service-role key — RLS is enabled with NO policies so the browser cannot
-- read or write these tables directly.

-- ── conversations ─────────────────────────────────────────────────────────────
create table if not exists public.conversations (
  id         text        not null primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  title      text        not null default 'New chat',
  model      text        not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

create index if not exists conversations_user_id_idx on public.conversations(user_id);
create index if not exists conversations_updated_at_idx on public.conversations(user_id, updated_at desc);

-- ── messages ──────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id              text        not null primary key,
  conversation_id text        not null references public.conversations(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  role            text        not null check (role in ('user', 'assistant', 'system', 'tool')),
  content         text        not null default '',
  model           text,
  route_target    text,
  route_label     text,
  style           text,
  created_at      timestamptz not null default now()
);

alter table public.messages enable row level security;

create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);
create index if not exists messages_user_idx         on public.messages(user_id);
