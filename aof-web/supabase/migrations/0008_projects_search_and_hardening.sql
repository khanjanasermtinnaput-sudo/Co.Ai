-- ── Phase 10: capture drifted live schema + advisor hardening ─────────────────
-- These objects EXIST in the live project (xuupsckszsujfnrzodtw) but were missing
-- from the repo migrations, so a clean rebuild would break Projects and Search.
-- This migration reproduces them exactly (idempotent) and folds in the Phase-10
-- security hardening already applied to production.

-- ── projects (used by store/project-store.ts via the browser client + RLS) ────
create table if not exists public.projects (
  id          uuid        not null default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  description text        not null default '',
  type        text        not null default 'web-app',
  status      text        not null default 'active',
  pinned      boolean     not null default false,
  mode        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.projects enable row level security;

create index if not exists projects_user_id_idx    on public.projects(user_id);
create index if not exists projects_updated_at_idx on public.projects(updated_at desc);

-- projects are read/written directly from the browser, so they need real
-- per-user policies (unlike the service-role-only tables).
drop policy if exists projects_select_own on public.projects;
drop policy if exists projects_insert_own on public.projects;
drop policy if exists projects_update_own on public.projects;
drop policy if exists projects_delete_own on public.projects;
-- auth.uid() wrapped in a scalar subquery → evaluated once per statement, not per
-- row (DB10.6 / auth_rls_initplan). Same semantics, better plan at scale.
create policy projects_select_own on public.projects for select using ((select auth.uid()) = user_id);
create policy projects_insert_own on public.projects for insert with check ((select auth.uid()) = user_id);
create policy projects_update_own on public.projects for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy projects_delete_own on public.projects for delete using ((select auth.uid()) = user_id);

-- ── conversations / messages owner policies ───────────────────────────────────
-- (tables + indexes already created in 0006; policies were applied live but not
-- captured. They allow the owner direct access; service-role bypasses RLS.)
drop policy if exists conversations_owner on public.conversations;
create policy conversations_owner on public.conversations for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists messages_owner on public.messages;
create policy messages_owner on public.messages for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── Full-text search backing for /api/search ──────────────────────────────────
-- messages.search_vector (generated) + GIN index + the view the route queries.
alter table public.messages
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists messages_search_vector_idx on public.messages using gin (search_vector);

-- DB10.3: define the view as SECURITY INVOKER so it honors the querying user's RLS
-- (service-role still bypasses RLS, which is how /api/search uses it).
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
    c.updated_at      as conversation_updated_at,
    m.search_vector
  from public.messages m
  join public.conversations c on c.id = m.conversation_id;

-- ── Advisor hardening (already applied to prod in phase10_security_hardening) ──
-- increment_rate_limit is invoked server-side only (service-role); keep it off the
-- public PostgREST surface and pin a safe search_path on the SECURITY DEFINER fns.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'increment_rate_limit') then
    execute 'revoke execute on function public.increment_rate_limit(text, timestamptz, integer) from anon, authenticated';
    execute 'alter function public.increment_rate_limit(text, timestamptz, integer) set search_path = public, pg_temp';
  end if;
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    execute 'alter function public.set_updated_at() set search_path = public, pg_temp';
  end if;
end $$;
