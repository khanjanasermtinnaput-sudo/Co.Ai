-- ── AI Memory Engine V2 (Master Prompt Part 6.2 — Unified Memory System) ──────
-- Backs /api/ai/memory (route.ts's MemorySchema): typed, TTL'd, per-user memory
-- entries (project, repository, conversation, architecture, deployment, testing,
-- user-preference, decision, lessons-learned). Until this table existed, every
-- handler in that route silently caught Postgres 42P01 (undefined table) and
-- returned "table pending migration" — memories were accepted by the API but
-- never actually persisted.
--
-- RLS is enabled with NO policies: all access goes through the Next.js
-- /api/ai/memory routes using the service-role key, the same pattern as
-- provider_keys (0002) and conversations (0006).

create table if not exists public.ai_memory_v2 (
  user_id     uuid         not null references auth.users(id) on delete cascade,
  type        text         not null check (type in (
                 'project', 'repository', 'conversation', 'architecture',
                 'deployment', 'testing', 'user-preference', 'decision', 'lessons-learned'
               )),
  key         text         not null,
  value       jsonb        not null default '{}'::jsonb,
  tags        text[]       not null default '{}',
  confidence  numeric(3,2) not null default 0.8 check (confidence >= 0 and confidence <= 1),
  expires_at  timestamptz  not null,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  primary key (user_id, type, key)
);

alter table public.ai_memory_v2 enable row level security;

-- The GET handler filters `expires_at > now()` and orders by `updated_at desc`
-- on every call — an index keyed the same way keeps that a cheap index scan
-- instead of a full-table filter as memory volume grows.
create index if not exists ai_memory_v2_user_expiry_idx
  on public.ai_memory_v2(user_id, expires_at, updated_at desc);

-- Lets a scheduled purge (mirroring tmap-v2's purgeExpiredImageMemories) find
-- expired rows across all users without a per-user scan.
create index if not exists ai_memory_v2_expires_at_idx
  on public.ai_memory_v2(expires_at);
