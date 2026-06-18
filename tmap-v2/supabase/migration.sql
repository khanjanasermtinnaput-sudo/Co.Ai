-- Nexora Code — Supabase migration
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งหมด → Run
--
-- ACCESS MODEL (สำคัญ):
--   เซิร์ฟเวอร์ tmap-v2 เข้าถึงทุกตารางผ่าน SERVICE ROLE KEY เท่านั้น
--   (ดู src/server/db.ts → ฟังก์ชัน sb()) ซึ่ง "bypass RLS" โดยอัตโนมัติ
--   ดังนั้นรูปแบบที่ปลอดภัยที่สุดคือ: เปิด RLS ไว้ แต่ "ไม่สร้าง policy"
--   → client ฝั่ง anon/authenticated จะถูกปฏิเสธทั้งหมด ส่วนเซิร์ฟเวอร์ยังทำงานได้
--   ห้ามใส่ policy แบบ `using (true)` เพราะจะเปิดให้ทุกคนอ่านทุกแถว (ช่องโหว่)

create table if not exists users (
  id             uuid        default gen_random_uuid() primary key,
  username       text        unique not null,       -- ชื่อผู้ใช้ (lowercase)
  pin_hash       text        not null,              -- scrypt hash ของ PIN
  encrypted_keys jsonb       default '{}'::jsonb not null, -- API keys (เข้ารหัส AES-256-GCM)
  created_at     timestamptz default now() not null
);

-- เปิด RLS และ "ลบ policy แบบเปิด" ที่เคยให้ทุกคนเข้าถึงได้ (security fix)
alter table users enable row level security;
drop policy if exists "service role full access" on users;
-- ไม่มี policy โดยตั้งใจ → เข้าถึงได้เฉพาะ service role ของเซิร์ฟเวอร์เท่านั้น

create index if not exists users_username_idx on users (username);

-- ── Project Memory (Titan + TMAP จำข้าม session ถาวร) ─────────────────────────
create table if not exists memories (
  key        text        primary key,                 -- userId (web) หรือ project key (CLI)
  data       jsonb       default '{}'::jsonb not null, -- ProjectMemory ทั้งก้อน
  updated_at timestamptz default now() not null
);

alter table memories enable row level security;
drop policy if exists "service role full access" on memories;
-- ไม่มี policy โดยตั้งใจ → service role เท่านั้น

-- ── TMAP Sessions (ประวัติการ build แต่ละครั้ง) ───────────────────────────────
-- อ้างถึงใน src/server/db.ts (createSession / updateSession / getUserSessions / getSession)
create table if not exists tmap_sessions (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        not null references users (id) on delete cascade,
  task        text        not null,
  mode        text        not null,
  status      text        not null default 'running',  -- running | done | error
  files_count integer     not null default 0,
  iterations  integer     not null default 0,
  cost_usd    numeric     not null default 0,
  tokens_used bigint      not null default 0,
  summary     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table tmap_sessions enable row level security;
-- ไม่มี policy โดยตั้งใจ → service role เท่านั้น

create index if not exists tmap_sessions_user_idx
  on tmap_sessions (user_id, created_at desc);

-- ── TMAP Agent Logs (telemetry ต่อ agent call) ───────────────────────────────
-- อ้างถึงใน src/server/db.ts (appendAgentLog / getSessionLogs)
create table if not exists tmap_agent_logs (
  id            uuid        default gen_random_uuid() primary key,
  session_id    uuid        not null references tmap_sessions (id) on delete cascade,
  role          text        not null,
  provider      text        not null,
  model         text        not null,
  attempts      integer     not null default 0,
  input_tokens  integer     not null default 0,
  output_tokens integer     not null default 0,
  cost_usd      numeric     not null default 0,
  duration_ms   integer     not null default 0,
  ts            timestamptz not null default now()
);

alter table tmap_agent_logs enable row level security;
-- ไม่มี policy โดยตั้งใจ → service role เท่านั้น

create index if not exists tmap_agent_logs_session_idx
  on tmap_agent_logs (session_id, ts);

-- ── TMAP Costs (ยอดสะสมต่อผู้ใช้) ─────────────────────────────────────────────
-- อ้างถึงใน src/server/db.ts (addCost / getUserCost)
create table if not exists tmap_costs (
  user_id        uuid        primary key references users (id) on delete cascade,
  total_cost_usd numeric     not null default 0,
  total_tokens   bigint      not null default 0,
  session_count  integer     not null default 0,
  updated_at     timestamptz not null default now()
);

alter table tmap_costs enable row level security;
-- ไม่มี policy โดยตั้งใจ → service role เท่านั้น
