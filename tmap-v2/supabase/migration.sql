-- AOF Code — Supabase migration
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

-- ── TMAP Events (DARS failover audit trail) ───────────────────────────────────
-- เก็บ DARS switch / failover / success events และ audit events ทุกประเภท
-- session_key เป็น TEXT ไม่ใช่ UUID FK เพื่อรองรับทั้ง UUID จริงและ synthetic key
-- เช่น 'raa-<userId>' ที่ไม่มีแถวใน tmap_sessions
create table if not exists tmap_events (
  id           uuid        default gen_random_uuid() primary key,
  user_id      uuid        references users (id) on delete cascade,
  session_key  text        not null,
  type         text        not null,  -- 'dars_success' | 'dars_switch' | 'dars_exhaust' | 'audit'
  meta         jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

alter table tmap_events enable row level security;
-- ไม่มี policy โดยตั้งใจ → service role เท่านั้น

create index if not exists tmap_events_session_idx on tmap_events (session_key, created_at desc);
create index if not exists tmap_events_user_idx    on tmap_events (user_id,     created_at desc);
create index if not exists tmap_events_type_idx    on tmap_events (type,        created_at desc);

-- ── Phase 2: Projects ─────────────────────────────────────────────────────────
-- โปรเจกต์ของผู้ใช้ — เชื่อม session / memory / context เข้าด้วยกัน
create table if not exists tmap_projects (
  id             uuid        default gen_random_uuid() primary key,
  user_id        uuid        not null references users (id) on delete cascade,
  name           text        not null,
  repo_url       text,
  default_branch text        not null default 'main',
  settings       jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table tmap_projects enable row level security;

create index if not exists tmap_projects_user_idx on tmap_projects (user_id, created_at desc);

-- ── Phase 2: Conversations + Messages ────────────────────────────────────────
-- Persistent chat history ต่อ user (รองรับ /v1/chat ที่ตอนนี้ stateless)
create table if not exists tmap_conversations (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        not null references users (id) on delete cascade,
  project_id  uuid        references tmap_projects (id) on delete set null,
  title       text        not null default 'Untitled',
  created_at  timestamptz not null default now()
);

alter table tmap_conversations enable row level security;

create index if not exists tmap_conversations_user_idx
  on tmap_conversations (user_id, created_at desc);

create table if not exists tmap_messages (
  id              uuid        default gen_random_uuid() primary key,
  conversation_id uuid        not null references tmap_conversations (id) on delete cascade,
  role            text        not null,   -- 'user' | 'assistant' | 'system'
  content         text        not null,
  created_at      timestamptz not null default now()
);

alter table tmap_messages enable row level security;

create index if not exists tmap_messages_conv_idx
  on tmap_messages (conversation_id, created_at asc);

-- ── Phase 4 (prep): pgvector semantic memory ──────────────────────────────────
-- uncomment หลังจากเปิด pgvector extension ใน Supabase:
--   create extension if not exists vector;
--   alter table memories add column if not exists embedding vector(1024);
--   create index if not exists memories_embedding_idx
--     on memories using hnsw (embedding vector_cosine_ops);

-- ── Phase 4 env vars (server/index.ts) ────────────────────────────────────────
-- AOF_USER_BUDGET_USD       สูงสุด (USD) ต่อผู้ใช้  (ไม่กำหนด = ไม่จำกัด)
-- AOF_LIMIT_RUN_PER_HOUR    req/hour สำหรับ /v1/run + /v1/orchestrate  (default 10)
-- AOF_LIMIT_CHAT_PER_HOUR   req/hour สำหรับ /v1/chat + debug + analyze  (default 30)
-- AOF_LIMIT_GENERAL_PER_HOUR  req/hour สำหรับ GET endpoints             (default 120)
-- E2B_API_KEY               (Phase 4+) เปิดใช้ E2B sandbox สำหรับ runtime validation
