# CoCode — TMAP v2 (MVP core)

Multi-agent coding assistant ที่ทำงานจริง: **Planner → Coder → Validator → Reviewer + critique loop**
(นี่คือ pipeline เดิม/`core/` — ดู `src/v2/` สำหรับ engine ใหม่ที่ orchestration ใช้จริงบน `/v2/run`,
รายละเอียดอยู่ใน "โครงสร้างโค้ด" ด้านล่าง). โค้ดทั้งหมดเรียกโมเดลจริงด้วย API key ของคุณ
ถ้าไม่ใส่ key จะรันใน **mock mode** (เดโมออฟไลน์) ได้

> **ขอบเขต & การ deploy.** `tmap-v2` คือ **backend ของ `coagentix-cli`** (CLI เรียก
> `/v1/*` ที่ `coagentix.onrender.com` ตาม `render.yaml` — override ได้ด้วย
> `COAI_API_BASE`) — จงใจแยกออกจาก `aof-web` ซึ่งรัน pipeline
> multi-agent เอง inline (`aof-web/src/lib/server/`) และ **ไม่** พึ่ง service นี้ตอน
> deploy จริง โมดูลที่ชื่อชนกันระหว่างสอง repo (`crypto`, `budget-enforcer`,
> `telemetry`, `orchestrator`) เป็นสำเนาที่ตั้งใจแยก ไม่ใช่ workspace ร่วม —
> ดูเหตุผลใน `aof-web/CLAUDE.md`. service นี้ deploy บน **Render ที่เดียว** ผ่าน
> blueprint `render.yaml` ที่ **root ของ repo** (ตัวที่ตั้ง `COAGENTIX_MASTER_KEY`
> ด้วย `sync: false` — ห้าม regenerate ไม่งั้น provider key ที่เข้ารหัสไว้ถอดไม่ได้).

## ความต้องการ
- Node.js ≥ 18 (ทดสอบบน 24)

## ติดตั้ง
```powershell
cd tmap-v2
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
  cli.ts               CLI (doctor / agents / gencode / server)

  core/                pipeline เดิม — runTMAP (legacy /build, mode lite/normal),
                        ypertatos.ts (mode pro, wrap runTMAP), agents.ts, validator.ts,
                        cost-budget.ts/budget-enforcer.ts (สอง layer งบ), memory.ts, ฯลฯ

  v2/                  engine ใหม่ — orchestrator-v2.ts (decideExecution, คนละงานกับ
                        core/orchestrator.ts คนละ route กัน ไม่ทับซ้อน), raa.ts (plan/
                        replan), executor.ts, dag.ts, memory-v2.ts, quality-gate-loop.ts,
                        kernel/ (process lifecycle), recovery/ (dead-letter + recovery
                        engine), certification/ (npm run certify, แยกจาก npm test)

  server/               Express entrypoint (index.ts) — /build (core), /v2/run (v2),
                        auth, teams/orgs/webhooks/entitlements, preflight boot-gate

  dars/                 provider/model health + selection ที่ core และ v2 ใช้ร่วมกัน
```

## ทำงานอย่างไร (สั้น ๆ)
1. **Planner** แตกงานเป็น plan
2. **Coder** เขียนไฟล์ (parse จาก fenced block `path=...`)
3. **Validator** รันตรวจจริง (MVP: `node --check` สำหรับ JS; ภาษาอื่นแจ้ง skipped อย่างซื่อสัตย์ — sandbox เต็มอยู่ Phase 3)
4. **Reviewer** หา issue (HIGH/MED/LOW)
5. ถ้า validation fail หรือมี HIGH → วนกลับให้ Coder แก้ (ตามโหมด) = **collaboration จริง ไม่ใช่ pipe**

> ส่วนบนอธิบาย pipeline เดิม (`core/`, mode lite/normal/pro) เท่านั้น — engine ใหม่ (`v2/`,
> รวม kernel/recovery/certification) มี test suite และ invariant ของตัวเองแยกต่างหาก
> ดู header comment ของแต่ละไฟล์ใน `src/v2/` สำหรับรายละเอียด ("Deliberately NOT built"
> list บอกขอบเขตของแต่ละส่วนชัดเจน)
