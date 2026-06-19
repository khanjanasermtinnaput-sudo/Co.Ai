-- ── Feedback table ────────────────────────────────────────────────────────────
-- Stores user feedback submissions from /api/feedback.
-- user_id is nullable — anonymous feedback is allowed.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  type        text not null check (type in ('bug', 'feature', 'general', 'praise')),
  message     text not null check (char_length(message) between 3 and 2000),
  page        text,
  created_at  timestamptz not null default now()
);

-- Index for admin dashboard queries (latest first, by type).
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_type_idx       on public.feedback (type);

-- RLS: browser cannot read or write directly — only the service role via /api/feedback.
alter table public.feedback enable row level security;
