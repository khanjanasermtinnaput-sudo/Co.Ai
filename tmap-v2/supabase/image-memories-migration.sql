-- Coagentix — Image Memory (TMAP image understanding pipeline)
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งหมด → Run
--
-- ACCESS MODEL: เหมือนตารางอื่น — เปิด RLS แต่ "ไม่สร้าง policy"
--   → เข้าถึงได้เฉพาะ service role ของเซิร์ฟเวอร์ tmap-v2 เท่านั้น (ดู src/core/image-memory.ts)
--
-- เก็บผลวิเคราะห์รูป (OCR + summary + entities) ไว้ใช้ตอบคำถามภายหลังโดยไม่อ่านรูปซ้ำ
-- หมดอายุอัตโนมัติหลัง 30 วัน (expires_at) และกันซ้ำด้วย (user_id, image_hash)

create table if not exists image_memories (
  id               uuid        default gen_random_uuid() primary key,
  user_id          uuid        not null references users (id) on delete cascade,
  image_hash       text        not null,                 -- sha256 ของ bytes รูป (dedup key)
  mime_type        text        not null default '',
  short_summary    text        not null default '',
  detailed_summary text        not null default '',
  reusable_context text        not null default '',      -- knowledge block สำหรับ inject เข้า prompt
  ocr_text         text        not null default '',
  entities         jsonb       not null default '[]'::jsonb,
  key_points       jsonb       not null default '[]'::jsonb,
  scene            text        not null default '',
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '30 days'),
  unique (user_id, image_hash)                           -- กันรูปซ้ำต่อผู้ใช้
);

alter table image_memories enable row level security;
-- ไม่มี policy โดยตั้งใจ → service role เท่านั้น

create index if not exists image_memories_user_idx
  on image_memories (user_id, created_at desc);
create index if not exists image_memories_hash_idx
  on image_memories (image_hash);
create index if not exists image_memories_expiry_idx
  on image_memories (expires_at);
