-- AOF Code — Supabase migration
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งหมด → Run

create table if not exists users (
  id             uuid        default gen_random_uuid() primary key,
  username       text        unique not null,       -- ชื่อผู้ใช้ (lowercase)
  pin_hash       text        not null,              -- scrypt hash ของ PIN
  encrypted_keys jsonb       default '{}'::jsonb not null, -- API keys (เข้ารหัส AES-256-GCM)
  created_at     timestamptz default now() not null
);

-- Row Level Security (เปิดไว้แต่ให้ service role ผ่านได้ทั้งหมด)
alter table users enable row level security;

create policy "service role full access"
  on users using (true) with check (true);

-- index เพื่อความเร็ว
create index if not exists users_username_idx on users (username);
