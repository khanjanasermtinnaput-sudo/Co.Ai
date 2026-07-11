-- Co.AI — scope image memory per product (CoChat vs CoCode)
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งหมด → Run
-- ต้องรัน image-memories-migration.sql มาก่อนแล้ว
--
-- เดิม image_memories กันซ้ำด้วย (user_id, image_hash) เท่านั้น ทำให้ CoChat และ
-- CoCode เห็นรูปเดียวกันที่วิเคราะห์ไว้ร่วมกัน เพิ่มคอลัมน์ product แล้วเปลี่ยน
-- unique constraint เป็น (user_id, product, image_hash) เพื่อแยกความจำของสอง
-- ผลิตภัณฑ์ออกจากกันจริง (ดู src/core/image-memory.ts)

alter table image_memories
  add column if not exists product text not null default 'cochat';

alter table image_memories
  drop constraint if exists image_memories_product_check;
alter table image_memories
  add constraint image_memories_product_check check (product in ('cochat', 'cocode'));

alter table image_memories drop constraint if exists image_memories_user_id_image_hash_key;
alter table image_memories add constraint image_memories_user_product_hash_key unique (user_id, product, image_hash);

drop index if exists image_memories_user_idx;
create index if not exists image_memories_user_product_idx
  on image_memories (user_id, product, created_at desc);
