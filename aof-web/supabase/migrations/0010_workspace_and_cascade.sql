-- ── Workspace isolation for conversations ──────────────────────────────────────
-- Adds a discriminator so CoChat and CoCode conversations/messages can be scoped
-- independently. All existing rows were written by CoChat only, so the default
-- backfills them correctly.

alter table public.conversations
  add column if not exists workspace text not null default 'cochat';

alter table public.conversations
  drop constraint if exists conversations_workspace_check;
alter table public.conversations
  add constraint conversations_workspace_check check (workspace in ('cochat', 'cocode'));

-- Replaces the 0006 (user_id, updated_at) index with a workspace-scoped one; the
-- list query in /api/conversations always filters by both.
drop index if exists public.conversations_updated_at_idx;
create index if not exists conversations_workspace_updated_at_idx
  on public.conversations(user_id, workspace, updated_at desc);

-- conversation_search_v (0008) needs to expose workspace so /api/search can be
-- scoped per product and never return hits from the other workspace.
create or replace view public.conversation_search_v
with (security_invoker = true) as
  select
    m.id              as message_id,
    m.conversation_id,
    m.user_id,
    m.role,
    m.content,
    m.created_at,
    c.title           as conversation_title,
    c.workspace       as workspace,
    c.updated_at      as conversation_updated_at,
    m.search_vector
  from public.messages m
  join public.conversations c on c.id = m.conversation_id;
