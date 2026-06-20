# CoAgentix Code — TMAP v2 (MVP core)

Multi-agent coding assistant ที่ทำงานจริง: **Planner → Coder → Validator → Reviewer + critique loop**
อิงสถาปัตยกรรมใน [`AOF_CODE_TDD.md`](./AOF_CODE_TDD.md). โค้ดทั้งหมดเรียกโมเดลจริงด้วย API key ของคุณ
ถ้าไม่ใส่ key จะรันใน **mock mode** (เดโมออฟไลน์) ได้

## ความต้องการ
- Node.js ≥ 18 (ทดสอบบน 24)

## ติดตั้ง
```powershell
cd C:\Users\khanj\aof-code
npm install
```

---

## 🔑 วิธีใส่ API Key (สำคัญ)

### ขั้นที่ 1 — สร้างไฟล์ `.env`
บน PowerShell:
```powershell
copy .env.example .env
notepad .env
```

### ขั้นที่ 2 — ใส่ key (เลือก 1 ใน 2 วิธี)

**วิธี A — ง่ายสุด: key เดียวครบ 4 agent (แนะนำ)**
สมัคร OpenRouter → https://openrouter.ai/keys แล้วใส่:
```
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
```
เท่านี้ทั้ง Planner/Coder/Reviewer/Validator จะใช้งานได้หมด (route ผ่าน OpenRouter อัตโนมัติ)

**วิธี B — ใส่แยกราย provider (คุมโมเดล/ต้นทุนแต่ละตัวเอง)**
ใส่ตัวไหนก็ได้ ใส่ครบยิ่งดี (ถ้าใส่ไม่ครบ ตัวที่ขาดจะ fallback ไปใช้ key ที่มี):

| ตัวแปรใน `.env` | Agent | สมัคร key ที่ |
|------------------|-------|---------------|
| `GEMINI_API_KEY`    | Planner   | https://aistudio.google.com/apikey |
| `DEEPSEEK_API_KEY`  | Coder     | https://platform.deepseek.com/api_keys |
| `DASHSCOPE_API_KEY` | Reviewer (Qwen) | https://dashscope.console.aliyun.com |
| `GROQ_API_KEY`      | Validator (Llama) | https://console.groq.com/keys |

> key อยู่ในไฟล์ `.env` ฝั่งเครื่องคุณเท่านั้น — `.gitignore` กันไม่ให้หลุดขึ้น git แล้ว

### ขั้นที่ 3 — ตรวจสอบว่า key ใช้ได้
```powershell
npm run doctor
```
จะแสดงว่าแต่ละ key `SET` หรือไม่ และแต่ละ agent ถูก map ไปโมเดลไหน (`direct` / `openrouter` / `fallback` / `mock`)

---

## ⬢ Titan Mode — AI System Architect (ใหม่)

โหมดวางแผนระดับสูงสุด: **Think First, Build Later** — Titan ไม่รีบเขียนโค้ด
แต่จะถามจนเข้าใจ ≥85% → วิเคราะห์ลึก → เสนอแผน A (เร็วสุด) / B (สมดุล) / C (ดีระยะยาว)
พร้อม Devil's Advocate, Architecture, Risk Prediction และ Planning Score
แล้ว**หยุดรอ Approval** ก่อนปล่อย Blueprint ให้ TMAP สร้างโค้ด

```powershell
# CLI — คุยกับ Titan แบบ interactive จนแผนผ่าน approval แล้วสร้างโค้ดต่อได้เลย
npm run aof -- titan "อยากได้ระบบจองคิวร้านตัดผม"
```

บนเว็บ: พิมพ์ `/titan` ในหน้า terminal แล้วคุยตามขั้นตอน
เมื่อ Titan แสดง `APPROVAL REQUIRED` ให้ตอบ `1` เพื่ออนุมัติ จากนั้นพิมพ์ `/gencode`

ขั้นตอนของ Titan: Discovery → Smart Questions → Confidence Check (<85% ถามต่อ) →
Multi-Plan → Devil's Advocate → Self Review 5 รอบ → Architecture → Risks →
Planning Score → **Approval Gate** → Blueprint → TMAP

---

## ใช้งาน
```powershell
# รัน pipeline เต็ม แล้วได้ไฟล์ออกมาที่ ./aof-output
npm run aof -- gencode "build a REST API for a todo app in Node.js"

# เขียนไฟล์ลงโปรเจกต์จริง (ไม่ใช่ aof-output)
npm run aof -- gencode "..." --apply

# ดู role -> model
npm run aof -- agents
```

### โหมด (คุมจำนวนรอบ critique loop / ต้นทุน)
ตั้งใน `.env`: `AOF_MODE=lite|normal|pro`
- `lite` = ไม่วน (เร็ว/ถูก) · `normal` = วนแก้ได้ 1 รอบ · `pro` = วนได้ถึง 3 รอบ

### override ชื่อโมเดล (ถ้าต้องการ)
ใน `.env`:
```
DEEPSEEK_MODEL=deepseek-chat
GEMINI_MODEL=gemini-2.0-flash
QWEN_MODEL=qwen-plus
LLAMA_MODEL=llama-3.3-70b-versatile
```

---

## โครงสร้างโค้ด
```
src/
  config.ts            role→provider→model resolver (Role แยกจาก Model)
  types.ts             AgentMessage / Blackboard contracts
  providers/client.ts  OpenAI-compatible client (พูดได้ทุก vendor)
  core/
    blackboard.ts      shared working memory + persist (.aof/sessions)
    agents.ts          planner / coder / reviewer (prompts + parsing)
    validator.ts       grounded validation (รัน node --check จริง)
    orchestrator.ts    TMAP loop: plan→code→validate→review→critique
  cli.ts               CLI (doctor / agents / gencode)
```

## ทำงานอย่างไร (สั้น ๆ)
1. **Planner** แตกงานเป็น plan
2. **Coder** เขียนไฟล์ (parse จาก fenced block `path=...`)
3. **Validator** รันตรวจจริง (MVP: `node --check` สำหรับ JS; ภาษาอื่นแจ้ง skipped อย่างซื่อสัตย์ — sandbox เต็มอยู่ Phase 3)
4. **Reviewer** หา issue (HIGH/MED/LOW)
5. ถ้า validation fail หรือมี HIGH → วนกลับให้ Coder แก้ (ตามโหมด) = **collaboration จริง ไม่ใช่ pipe**

> นี่คือ Phase 1 MVP. ส่วน web/desktop/Temporal/sandbox-cluster/RAG memory อยู่ใน roadmap ของ TDD
