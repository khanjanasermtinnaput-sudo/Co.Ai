# CLAUDE.md — Coagentix (Co.AI / AOF)

> อ่านไฟล์นี้อัตโนมัติทุก session. นี่คือ "ความจำถาวร" ของโปรเจค co.ai

## ⚡ ก่อนแก้โค้ดทุกครั้ง — ใช้ระบบความจำก่อน (อย่าสแกนทั้ง repo ใหม่)

ความจำสถาปัตยกรรมทั้งหมดอยู่ใน **`.coagentix-memory/`** ลำดับการใช้งาน:

1. หาไฟล์ที่เกี่ยวข้อง → `.coagentix-memory/search-index.json` (keyword→file) หรือ `feature-map.json` (feature→files)
2. ดูผลกระทบ/dependency → `dependency-map.json` (blast radius) + `knowledge-graph.json` (edges)
3. ยืนยัน contract → `api-map.json` / `database-map.json` / `prompt-map.json`
4. ภาพรวม + special systems → `memory-summary.md` (**เริ่มอ่านที่นี่ถ้าจำอะไรไม่ได้**)
5. เปิดเฉพาะไฟล์ที่ระบุได้ — ไม่ต้องอ่านทั้งโปรเจค

## โปรเจคนี้คืออะไร (สรุปสั้น)

แพลตฟอร์ม AI multi-provider — monorepo 3 ตัว:

| Package | บทบาท | Stack |
|---|---|---|
| `aof-web/` | Next.js 14 frontend + API routes (แอปหลัก) | Next 14, TS strict, Tailwind, Zustand, Supabase, `@anthropic-ai/sdk` |
| `tmap-v2/` | Express backend — TMAP multi-agent, DARS, Titan, Chief | Express, TS ESM, JWT |
| `coagentix-cli/` | `coai` CLI สำหรับ terminal | commander, inquirer |

DB: Supabase/Postgres + RLS · Deploy: Railway / Render / Vercel / Docker

## ระบบสำคัญ (Special Systems) — อยู่ที่ไหน

- **TMAP pipeline** → `tmap-v2/src/core/orchestrator.ts` (`/v1/run`)
- **Titan Mode** → `tmap-v2/src/core/titan.ts` + web `lib/titan.ts` + `components/code/titan-workflow.tsx` (`/v1/titan`)
- **DARS** (failover) → `tmap-v2/src/dars/*` (ห่อหุ้มทุก LLM call)
- **Chief Agent** → `tmap-v2/src/core/chief-agent.ts` (`/v1/orchestrate`)
- **RAA / Voting / Memory** → `core/raa.ts` · `core/vote.ts` · `core/memory.ts`
- **Web chat** → `aof-web/src/app/api/chat/route.ts` (Anthropic→OpenRouter, SSE)
- **API key (เข้ารหัส AES-256-GCM)** → `aof-web/src/lib/server/crypto.ts` + `api/keys`
- รายละเอียดเต็ม: `.coagentix-memory/memory-summary.md`

## ไฟล์ที่ blast-radius สูง (แก้ด้วยความระวัง)

- `aof-web`: `lib/server/ai-providers.ts`, `lib/server/model-registry.ts`, `lib/errors.ts`, `lib/api.ts`, `lib/types.ts`, `lib/server/supabase-admin.ts`
- `tmap-v2`: `config.ts`, `providers/client.ts`, `dars/run.ts`, `core/orchestrator.ts`, `core/agents.ts`, `server/index.ts`, `server/auth.ts`, `server/db.ts`

## คำสั่งที่ใช้บ่อย

- ทดสอบ: `cd aof-web && npm test` · `cd tmap-v2 && npm test`
- typecheck: `npm run typecheck` (ในแต่ละ package)
- dev: `cd aof-web && npm run dev` · backend: `cd tmap-v2 && npm run server`

## กฎการทำงาน (เพื่อให้ความจำไม่ล้าสมัย)

1. **ก่อนแก้**: ทำ impact analysis จาก map ก่อน (affected files/features/APIs/risks)
2. **หลังแก้**: อัปเดต map ที่เกี่ยวข้องใน `.coagentix-memory/` + เพิ่ม entry ใน `memory-changelog.md`
3. หาไฟล์ที่เปลี่ยนตั้งแต่ baseline: `git diff --name-only 247e4b5 HEAD`
4. วิธีดูแลความจำเต็ม: `.coagentix-memory/README.md`

## ภาษา

ผู้ใช้สื่อสารภาษาไทยเป็นหลัก — ตอบเป็นภาษาไทยได้
