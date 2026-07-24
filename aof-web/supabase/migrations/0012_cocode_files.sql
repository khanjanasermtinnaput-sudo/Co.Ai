-- ── CoCode workspace files — real per-project persistence ─────────────────────
-- Until now the CoCode virtual FS (store/cocode-ide-store.ts) only ever lived in
-- the browser (in-session state + a localStorage partialize that explicitly
-- excludes `fs` as "too large for localStorage") — lib/cocode/open-project.ts's
-- own header comment tracked "real per-project file storage" as follow-up work.
-- This table is that follow-up: every file the workspace holds for a project is
-- persisted here, scoped to the signed-in user, so CoCode work survives a reload
-- or a different device and is never visible across accounts.
--
-- RLS is enabled with NO policies: all access goes through /api/projects/[id]/files
-- using the service-role key, the same pattern as ai_memory_v2 (0011) and
-- provider_keys (0002) — never queried directly from the browser client.

create table if not exists public.cocode_files (
  id          uuid        not null default gen_random_uuid() primary key,
  project_id  uuid        not null references public.projects(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  path        text        not null,
  content     text        not null default '',
  sha         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, path)
);

alter table public.cocode_files enable row level security;

-- The files route always loads/saves a whole project's file set at once,
-- ordered by path.
create index if not exists cocode_files_project_id_idx on public.cocode_files(project_id, path);
-- Lets a future "delete this user's CoCode data" admin action (mirroring
-- deleteAllProjects's user_id-scoped delete) find every row without a
-- cross-project scan.
create index if not exists cocode_files_user_id_idx on public.cocode_files(user_id);
