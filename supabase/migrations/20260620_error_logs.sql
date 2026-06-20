-- ── error_logs ────────────────────────────────────────────────────────────────
-- Persists client-side error events for the diagnostics panel and support.
-- RLS ensures each user can only read/write their own rows.
-- The table is write-only from the browser (insert only); reads go through
-- the diagnostics UI which is limited to the authenticated user's own rows.

create table if not exists public.error_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  error_code  text not null,
  message     text not null,
  stack       text,
  created_at  timestamptz not null default now()
);

-- Index for the diagnostics panel query (newest first per user).
create index if not exists error_logs_user_created
  on public.error_logs (user_id, created_at desc);

-- Row-level security.
alter table public.error_logs enable row level security;

-- Users may insert their own error rows.
create policy "error_logs_insert_own"
  on public.error_logs for insert
  with check (auth.uid() = user_id);

-- Users may read their own error rows (diagnostics panel).
create policy "error_logs_select_own"
  on public.error_logs for select
  using (auth.uid() = user_id);

-- Admins (service role) can read everything — no explicit policy needed because
-- the service-role key bypasses RLS.
