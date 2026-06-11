-- AOF Code — Supabase migration
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งหมด → Run
-- จากนั้นตั้ง SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ใน .env เพื่อให้ server ใช้ Postgres

create table if not exists users (
  id             uuid        default gen_random_uuid() primary key,
  username       text        unique not null,       -- ชื่อผู้ใช้ (lowercase)
  pin_hash       text        not null,              -- scrypt hash ของ PIN
  encrypted_keys jsonb       default '{}'::jsonb not null, -- API keys (เข้ารหัส AES-256-GCM)
  created_at     timestamptz default now() not null
);

create table if not exists sessions (
  id           uuid        default gen_random_uuid() primary key,
  user_id      uuid        not null references users (id) on delete cascade,
  task         text        not null,
  mode         text        not null,
  status       text        not null default 'running',  -- running | done | error
  files_count  int         not null default 0,
  iterations   int         not null default 0,
  cost_usd     double precision not null default 0,
  tokens_used  bigint      not null default 0,
  summary      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists agent_logs (
  id            uuid        default gen_random_uuid() primary key,
  session_id    uuid        not null references sessions (id) on delete cascade,
  role          text        not null,
  provider      text        not null,
  model         text        not null,
  attempts      int         not null default 0,
  input_tokens  int         not null default 0,
  output_tokens int         not null default 0,
  cost_usd      double precision not null default 0,
  duration_ms   int         not null default 0,
  ts            timestamptz not null default now()
);

create table if not exists costs (
  user_id         uuid        primary key references users (id) on delete cascade,
  total_cost_usd  double precision not null default 0,
  total_tokens    bigint      not null default 0,
  session_count   int         not null default 0,
  updated_at      timestamptz not null default now()
);

-- Row Level Security (เปิดไว้แต่ให้ service role ผ่านได้ทั้งหมด)
alter table users      enable row level security;
alter table sessions   enable row level security;
alter table agent_logs enable row level security;
alter table costs       enable row level security;

create policy "service role full access" on users      using (true) with check (true);
create policy "service role full access" on sessions   using (true) with check (true);
create policy "service role full access" on agent_logs using (true) with check (true);
create policy "service role full access" on costs       using (true) with check (true);

-- index เพื่อความเร็ว
create index if not exists users_username_idx     on users (username);
create index if not exists sessions_user_idx      on sessions (user_id, created_at desc);
create index if not exists agent_logs_session_idx on agent_logs (session_id, ts);
