# AOF Code — Technical Design Document (TMAP v2)

> Senior AI Architect / Principal Engineer review
> อิงจากการวิเคราะห์ source จริง: repo มี `index.html` (static prototype), `README.md`, `pages.yml`
> สถานะปัจจุบัน = UI prototype ที่ "จำลอง" AI ไม่ใช่ระบบ AI จริง

---

## 1. Executive Summary

AOF Code ตั้งเป้าเป็น AI Coding Assistant ที่ใช้แนวคิด **TMAP (Technology Multi-Agent Processing)** — ให้ AI หลายตัวทำงานร่วมกันเพื่อให้ได้ผลลัพธ์คุณภาพสูงกว่าตัวเดียว

**ข้อค้นพบสำคัญจากโค้ดจริง:** ปัจจุบัน AOF Code ยัง*ไม่ใช่*ระบบ AI — เป็น HTML ไฟล์เดียวที่ `simulateLocalAgent()` คืนข้อความ hardcode ตาม keyword. ไม่มี backend, ไม่มีการเรียกโมเดลจริง, "multi-agent" คือ animation ของ dot 4 จุดที่รันเรียงกัน. ดังนั้นงานนี้คือการสร้าง "ของจริง" จาก mockup ที่ออกแบบ UX ไว้ดีแล้ว

**ข้อเสนอหลัก:** เปลี่ยน TMAP จาก "เรียก API เรียงกัน" เป็น **Orchestrated Graph + Shared Blackboard + Generator–Critic–Validator loop + Consensus Engine** บน LangGraph/Temporal. แยก **Role ออกจาก Model** (role เป็น logical, model เป็น config) และใช้ **adaptive routing** เพื่อคุมต้นทุน (ไม่เรียกครบ 4 โมเดลทุกครั้ง)

**Tech stack แนะนำ:** TypeScript monorepo (Turborepo/pnpm) — Next.js (web), Ink (CLI แบบ Claude Code), Tauri (desktop), NestJS/Fastify (backend), LangGraph.js (orchestration), PostgreSQL + pgvector, Redis + BullMQ, Temporal (durable workflows ที่ scale ใหญ่), E2B/Firecracker (sandbox รันโค้ด)

**Roadmap:** MVP (8–10 สัปดาห์) → Beta → Production → Enterprise

---

## 2. Current Project Analysis

### 2.1 สิ่งที่มีอยู่จริง (จากการอ่านโค้ด)

| ส่วน | Implementation จริง | บรรทัดอ้างอิง |
|------|--------------------|----------------|
| โครงสร้าง | `index.html` ไฟล์เดียว ~1,770 บรรทัด (HTML+CSS+JS inline) | ทั้งไฟล์ |
| "AI engine" | `callClaude()` → `simulateLocalAgent()` คืน string hardcode ตาม `systemPrompt.includes(...)` | 1280–1327 |
| Multi-agent | รัน sequential: Gemini→Llama→DeepSeek→Qwen, แค่เปลี่ยนสี dot | 1554–1644 |
| Auth | `btoa(password)` เก็บใน `localStorage['aof-code:users']` | 1066–1096 |
| Rate limit | counter ฝั่ง client `maxCommandsPerMinute: 12` | 1098–1112 |
| Memory | `state.projectMemory` object ใน localStorage | 1244–1254 |
| File gen | `generateProjectFiles()` template ตายตัว ไม่ขึ้นกับ input | 1189–1230 |
| Export | JSZip ฝั่ง client | 1232–1242 |
| Collaboration | "room" = localStorage key เดียวกัน (ไม่ realtime) | 1120–1153 |
| Deploy | GitHub Pages (static) | pages.yml |

### 2.2 ข้อดี (ของจริง)

- **UX/UI ออกแบบดีมาก** — terminal aesthetic, command palette (Ctrl+K), workflow steps, agent status, multi-file tabs. นี่คือทรัพย์สินที่ใช้ต่อได้ทันที
- **Command model ชัดเจน** — `/plan /gencode /review /fix /export /agents` เป็น mental model ที่ดี ตรงกับ Claude Code
- **3 tiers (Lite/Normal/Pro)** — แนวคิด adaptive cost มีอยู่แล้ว ต่อยอดเป็น routing ได้
- **role mapping ชัด** — PM / Coordinator / Developer / Reviewer

### 2.3 ข้อเสีย / ข้อจำกัด (ของจริง)

1. **ไม่มี AI จริง** — ทั้งหมดเป็น mock. นี่คือ gap ที่ใหญ่ที่สุด
2. **ไม่มี backend** — ทุกอย่างอยู่ฝั่ง browser → API key ของโมเดลจะ leak ทันทีถ้าเรียกตรง
3. **ความปลอดภัยเป็นศูนย์** — base64 ไม่ใช่การ hash, rate limit bypass ได้, ไม่มี server validation
4. **Memory ปลอม** — ผูกกับ browser, ไม่ persist ข้าม device, ไม่มี semantic retrieval
5. **TMAP เป็น sequential pipeline ไม่ใช่ collaboration** — agent ไม่เห็นงานกัน, ไม่ critique, ไม่มี voting/consensus, validation เป็นแค่ข้อความ "Validation passed"
6. **ไม่อ่าน/แก้ไฟล์จริง** — generate template ตายตัว, ไม่มี project context engine
7. **ไม่มี CLI/desktop** — มีแต่ web mockup
8. **Scale ไม่ได้** — static page ไม่มี state server-side

### 2.4 ข้อผิดพลาดเชิงแนวคิดของ TMAP ปัจจุบัน

> **สำคัญ — ต้องแก้ก่อนสร้าง**

- **(A) "4 โมเดล = 4 บทบาท" สับสนระหว่าง model diversity กับ role specialization.** การ ensemble จะให้คุณภาพเพิ่มเฉพาะตอน output *เปรียบเทียบ/ตรวจสอบได้* (เช่น โค้ดที่รัน test ผ่าน) ไม่ใช่แค่ "เอาความเห็นมารวม". ผูกตายตัว 1 role = 1 vendor ทำให้เปลี่ยนโมเดล/fallback ยาก และเปราะเมื่อ provider ล่ม
- **(B) Sequential ≠ collaboration.** การส่งต่อ output เป็นทอด ๆ ไม่ทำให้เกิด error-correction. การ "ทำงานร่วมกันจริง" ต้องมี **shared state ที่ทุก agent อ่าน/เขียนได้** + **loop วิจารณ์-แก้ไข** + **กลไกชี้ขาดเมื่อเห็นไม่ตรงกัน**
- **(C) Validation ที่ไม่ verify อะไร.** Validator ที่เป็น LLM พิมพ์ "passed" ไม่มีค่า. Validation จริงต้อง **execute** (compile, lint, test, type-check) ใน sandbox
- **(D) ต้นทุน.** เรียกครบ 4 โมเดลทุกคำสั่ง = แพง + ช้า. ต้อง route ตามความยากของงาน

---

## 3. Production-Ready TMAP v2 Architecture

### 3.1 หลักการออกแบบใหม่

```
TMAP v2 = Orchestrator + Shared Blackboard + Typed Agent Messages
          + Generator–Critic–Validator loop + Consensus Engine
          + Tool-grounded Validation (real execution)
          + Adaptive Model Router
```

**5 หลักการ:**
1. **Role ≠ Model** — role เป็น interface, model เป็น config (สลับ/ fallback ได้)
2. **Blackboard pattern** — agent สื่อสารผ่าน shared state ไม่ใช่ pipe ตรง ๆ → เกิด collaboration จริง
3. **Critique loop** — Coder ↔ Reviewer วน refine จนผ่านเกณฑ์หรือครบ N รอบ
4. **Grounded validation** — Validator รันจริง (lint/type/test) ไม่ใช่เดา
5. **Adaptive routing** — เลือกจำนวน agent/โมเดลตาม task complexity (ต่อยอด 3 tiers เดิม)

### 3.2 Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  CLIENTS: Web(Next.js) · CLI(Ink) · Desktop(Tauri)                 │
└───────────────┬──────────────────────────────────────────────────┘
                │  HTTPS / WSS (SSE streaming)
┌───────────────▼──────────────────────────────────────────────────┐
│  API GATEWAY (NestJS)  ─ Auth/RBAC · RateLimit · Quota · Routing   │
└───────────────┬──────────────────────────────────────────────────┘
                │  enqueue job
┌───────────────▼──────────────────────────────────────────────────┐
│  TMAP ORCHESTRATOR  (LangGraph.js state graph / Temporal workflow) │
│                                                                    │
│   ┌─────────────┐   reads/writes   ┌──────────────────────────┐    │
│   │  BLACKBOARD │◄────────────────►│  AGENTS (role workers)   │    │
│   │ (session    │                  │  Planner · Coder ·       │    │
│   │  working    │                  │  Reviewer · Validator    │    │
│   │  memory)    │                  └──────────┬───────────────┘    │
│   └─────────────┘                             │                    │
│         ▲                          ┌──────────▼───────────────┐    │
│         │                          │  MODEL ROUTER            │    │
│   ┌─────┴──────┐                   │  (provider abstraction)  │    │
│   │ CONSENSUS  │                   └──────────┬───────────────┘    │
│   │  ENGINE    │                              │                    │
│   └────────────┘                   ┌──────────▼──────────┐         │
│                                    │ Gemini DeepSeek      │         │
│                                    │ Qwen Llama (+OpenAI) │         │
│                                    └─────────────────────┘         │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐       │
│   │ TOOL LAYER   │   │ CONTEXT      │   │ SANDBOX          │       │
│   │ fs/git/search│   │ ENGINE (RAG) │   │ (E2B/Firecracker)│       │
│   └──────────────┘   └──────────────┘   └──────────────────┘       │
└────────────────────────────────────────────────────────────────────┘
        │                    │                  │
┌───────▼──────┐   ┌─────────▼────────┐  ┌──────▼─────────┐
│ PostgreSQL   │   │ pgvector / Qdrant│  │ Redis (queue/  │
│ (+ pgvector) │   │ (long-term mem)  │  │ cache/pubsub)  │
└──────────────┘   └──────────────────┘  └────────────────┘
                                          ┌────────────────┐
                                          │ Object Storage │
                                          │ (artifacts)    │
                                          └────────────────┘
```

### 3.3 Roles (logical) และ default model mapping

| Role | หน้าที่ | Default model | Fallback |
|------|---------|---------------|----------|
| **Planner** | แตกงาน, วาง task graph, เลือกไฟล์ที่เกี่ยว | Gemini | Llama |
| **Coder** | เขียน/แก้โค้ดหลายไฟล์ (diff) | DeepSeek V4 | Qwen-Coder |
| **Reviewer** | critique, หา bug, ให้ structured feedback | Qwen | Gemini |
| **Validator** | รัน lint/type/test ใน sandbox + ตีความผล | Llama (+ tools) | DeepSeek |
| **Arbiter** (เกิดเฉพาะตอน conflict) | ชี้ขาดเมื่อ agent ไม่ตรงกัน | โมเดลที่แรงสุดที่ config ไว้ | — |

> mapping นี้เป็น **config** (`agents.config.ts`) ไม่ใช่ hardcode — เปลี่ยนได้ต่อ org/project

---

## 4. Multi-Agent Workflow (Flow จริง)

ตัวอย่าง `/gencode "add JWT auth"` ใน mode Pro:

```
1. INTAKE        Gateway รับคำสั่ง → สร้าง Session + Job → enqueue
2. CONTEXT       Context Engine: index/embed โปรเจกต์, ดึงไฟล์ที่เกี่ยว (RAG) + git state
                 → เขียนลง Blackboard.context
3. PLAN          Planner อ่าน Blackboard → ออก task graph (JSON):
                 [{file, action, intent, deps}] → Blackboard.plan
4. ROUTE         Router ประเมิน complexity → ตัดสินว่าใช้กี่ agent / โมเดลไหน / กี่ loop
5. CODE          Coder อ่าน plan+context → ผลิต **unified diff** ต่อไฟล์
                 (หลายไฟล์ขนานกันได้) → Blackboard.patches[v1]
6. VALIDATE      Validator apply patch ใน sandbox → รัน tsc/eslint/test
                 → Blackboard.validation (machine result: pass/fail + logs)
7. REVIEW        Reviewer อ่าน diff + validation logs → structured critique
                 (severity, file, line, suggestion) → Blackboard.review
8. CRITIQUE LOOP ถ้า validation fail หรือ review มี blocking issue:
                 Coder อ่าน critique+logs → patch v2 → กลับ step 6
                 (วนจน pass หรือครบ maxIterations เช่น 3)
9. CONSENSUS     ถ้ามี conflict ที่ verify ไม่ได้ (เช่น design choice):
                 Consensus Engine รวบ vote / เรียก Arbiter ชี้ขาด
10. MERGE        รวม patches → เตรียม changeset, gen diff preview
11. STREAM       ตลอดทาง: stream token + agent status ผ่าน SSE/WS ไป client
12. PERSIST      เก็บ session, agent_runs, votes, artifacts; อัปเดต long-term memory
13. PRESENT      Client แสดง diff ต่อไฟล์ + ปุ่ม apply (CLI/desktop เขียนลง fs จริง)
```

**จุดที่ทำให้ "ร่วมงานจริง" ไม่ใช่ pipeline:**
- ทุก agent อ่าน/เขียน **Blackboard เดียวกัน** → เห็นบริบทกันครบ
- **Critique loop** = error correction จริง (Coder ได้ feedback + test logs กลับมาแก้)
- **Validation = execution** ไม่ใช่ข้อความ
- **Consensus** ใช้เฉพาะเรื่องที่ verify ไม่ได้ (คุมต้นทุน)

### 4.1 Typed Agent Message (contract)

```ts
interface AgentMessage {
  id: string;
  sessionId: string;
  iteration: number;
  from: Role;                 // 'planner' | 'coder' | ...
  type: 'plan' | 'patch' | 'review' | 'validation' | 'vote' | 'note';
  payload: PlanPayload | PatchPayload | ReviewPayload | ValidationPayload;
  refs: string[];             // ids ของ message ที่อ้างถึง
  confidence: number;         // 0..1 (ใช้ใน weighted vote)
  modelUsed: string;
  tokensIn: number; tokensOut: number; latencyMs: number;
  createdAt: string;
}
```

---

## 5. Memory Architecture

3 ชั้น — ต่างจากเดิมที่มีแค่ localStorage:

### 5.1 Working Memory (Blackboard) — ระดับ session
- เก็บใน **Redis** (TTL ตาม session) + snapshot ลง Postgres
- โครงสร้าง: `context, plan, patches[], reviews[], validations[], votes[], decisions[]`
- ทุก agent อ่าน/เขียนผ่าน orchestrator (มี optimistic locking กัน race)

### 5.2 Project Memory — ระดับ project (persistent)
- **Postgres + pgvector**: code chunks (AST-aware), เอกสารโปรเจกต์, decision log, conventions ที่เรียนรู้
- อัปเดตทุกครั้งที่ index repo (incremental ตาม git diff)
- ใช้ทำ RAG: "โปรเจกต์นี้ใช้ pattern อะไร, ไฟล์ไหนเกี่ยว"

### 5.3 Long-Term / User Memory — ระดับ user/org
- preferences, coding style, คำสั่งที่ใช้บ่อย, feedback ที่ผ่านมา
- เก็บ Postgres + embeddings; ใช้ personalize prompts

### 5.4 Retrieval pipeline
```
query → hybrid search (BM25 + vector) → rerank → token-budget pack
      → inject เข้า agent context (พร้อม citation ของ chunk)
```

> **Embedding/chunking:** chunk ตาม AST (function/class) ไม่ใช่ตัดดิบ → retrieval แม่นกว่ามากสำหรับโค้ด

---

## 6. Database Design (PostgreSQL)

```sql
-- IDENTITY
organizations(id PK, name, plan, created_at)
users(id PK, org_id FK, email UNIQUE, password_hash /*argon2id*/, role, created_at)
api_credentials(id PK, org_id FK, provider, encrypted_key /*KMS*/, created_at)
                                  -- ไม่เก็บ raw key เด็ดขาด

-- PROJECTS & SESSIONS
projects(id PK, org_id FK, name, repo_url, default_branch, settings_jsonb, created_at)
sessions(id PK, project_id FK, user_id FK, mode /*lite|normal|pro*/, status, created_at)
messages(id PK, session_id FK, role /*user|assistant|system*/, content, created_at)

-- TMAP RUNTIME
agent_runs(id PK, session_id FK, role, model_used, iteration, status,
           tokens_in, tokens_out, latency_ms, cost_usd, created_at)
agent_messages(id PK, session_id FK, run_id FK, from_role, type,
               payload_jsonb, refs_jsonb, confidence, created_at)   -- = blackboard log
votes(id PK, session_id FK, topic, voter_role, choice, weight, rationale, created_at)
decisions(id PK, session_id FK, topic, outcome, method /*loop|vote|arbiter*/, created_at)
validations(id PK, session_id FK, kind /*lint|type|test|build*/,
            passed BOOL, logs_text, created_at)

-- ARTIFACTS / FILES
artifacts(id PK, session_id FK, path, change_type /*create|modify|delete*/,
          diff_text, blob_url /*object storage*/, applied BOOL, created_at)

-- MEMORY (pgvector)
memory_chunks(id PK, project_id FK, scope /*project|user|org*/, source_path,
              kind /*code|doc|decision|pref*/, content, embedding VECTOR(1024),
              metadata_jsonb, updated_at)
CREATE INDEX ON memory_chunks USING hnsw (embedding vector_cosine_ops);

-- GOVERNANCE
usage_events(id PK, org_id FK, user_id FK, kind, tokens, cost_usd, created_at)
audit_log(id PK, org_id FK, actor, action, target, meta_jsonb, created_at)
```

**ความสัมพันธ์:** org 1—N users/projects/credentials · project 1—N sessions/memory_chunks · session 1—N messages/agent_runs/agent_messages/votes/validations/artifacts · agent_run 1—N agent_messages

---

## 7. API Design

REST สำหรับ CRUD/control + WebSocket/SSE สำหรับ streaming

```
# Auth
POST   /v1/auth/register
POST   /v1/auth/login            -> {access, refresh}
POST   /v1/auth/refresh

# Projects
POST   /v1/projects
GET    /v1/projects/:id
POST   /v1/projects/:id/index    -> index/embed repo (async job)

# Sessions / commands  (หัวใจระบบ)
POST   /v1/sessions              {projectId, mode}
POST   /v1/sessions/:id/commands {verb:/gencode, args, contextRefs}
                                 -> 202 {jobId}
GET    /v1/sessions/:id/stream   (SSE)  events: token, agent_status,
                                 validation, review, diff, done, error
WS     /v1/sessions/:id/ws       (bi-directional: interrupt, approve, answer)

# Artifacts
GET    /v1/sessions/:id/artifacts
POST   /v1/artifacts/:id/apply   (desktop/CLI confirm-apply)
GET    /v1/sessions/:id/export    -> zip (ย้าย JSZip มาทำ server-side)

# Memory
GET    /v1/projects/:id/memory?q=
POST   /v1/projects/:id/memory   (เพิ่ม note/decision)

# Agents / config
GET    /v1/agents                (status + role→model mapping)
PUT    /v1/projects/:id/agents   (override mapping/mode)

# Admin
GET    /v1/usage  ·  GET /v1/audit
```

**SSE event ตัวอย่าง** (ให้ client เดิมต่อได้ตรง ๆ กับ UI dot/workflow ที่มีอยู่):
```json
{"type":"agent_status","role":"coder","state":"busy","model":"deepseek-v4"}
{"type":"token","role":"coder","text":"export function..."}
{"type":"validation","kind":"test","passed":false,"summary":"2 failed"}
{"type":"diff","path":"src/auth.ts","change":"modify"}
{"type":"done","sessionId":"...","cost_usd":0.0123}
```

---

## 8. CLI Design (ระดับเดียวกับ Claude Code)

**Stack:** Node.js + TypeScript + **Ink** (React for terminal) + commander — แบบเดียวกับ Claude Code → ได้ UX ใกล้เคียง

```
aof                       # เปิด interactive REPL (TUI)
aof login
aof init                  # สร้าง .aof/ + index โปรเจกต์
aof "add JWT auth"        # one-shot
aof /plan | /gencode | /review | /fix | /export
aof agents                # ดู role→model + status
aof config set mode pro
```

**คุณสมบัติที่ต้องมีให้เทียบ Claude Code:**
- **Streaming TUI** — แสดง agent status (busy/done/error) แบบ realtime จาก SSE, สอดคล้อง UI prototype เดิม
- **Diff review ในเทอร์มินัล** — แสดง unified diff สีต่อไฟล์ + ถาม `apply? (y/n/edit)` ก่อนเขียน fs จริง
- **อ่าน/แก้หลายไฟล์จริง** — ผ่าน Tool Layer (fs sandbox จำกัด workspace)
- **Git integration** — `aof` สร้าง branch, commit message อัตโนมัติ, ไม่ commit เว้นแต่สั่ง
- **`.aof/` ในโปรเจกต์** — config, project memory cache, conventions (เทียบ `CLAUDE.md`)
- **Ctrl+K palette / slash menu**, history, resume session
- **Windows-first:** binary ผ่าน `pkg`/`node --sea`, รองรับ PowerShell, path Windows, ติดตั้งด้วย `winget`/`npm i -g @aof/cli`

**โครง CLI:**
```
packages/cli/
  src/
    commands/{plan,gencode,review,fix,export,login}.ts
    tui/{App.tsx, AgentPanel.tsx, DiffView.tsx, Prompt.tsx}
    transport/{sse.ts, ws.ts, apiClient.ts}
    fs/{workspace.ts, applyDiff.ts, gitClient.ts}
    config/aofrc.ts
```

---

## 9. Security Design

| ภัย | มาตรการ |
|-----|---------|
| **API key leak** (ปัญหาใหญ่สุดของ design เดิม) | key อยู่ฝั่ง server เท่านั้น, เก็บแบบ encrypted ด้วย KMS/Vault, client ไม่เคยเห็น |
| **Auth อ่อน** (base64 เดิม) | Argon2id hashing, JWT access(15m)+refresh(rotat.), bcrypt→argon2 migration, หรือใช้ Clerk/Supabase Auth |
| **Rate limit bypass** (client เดิม) | บังคับฝั่ง server (Redis token bucket) ต่อ user/org + quota เชิงต้นทุน |
| **Prompt injection** (จากไฟล์/RAG) | แยก system vs untrusted content, content fencing, ตัด tool-call ที่ออกนอก workspace, allowlist tools |
| **รันโค้ดอันตราย** (validation) | **sandbox จริง**: E2B/Firecracker/gVisor — no network egress by default, จำกัด CPU/mem/time, FS เฉพาะ workspace |
| **Path traversal** | จำกัด fs ops ภายใต้ project root, ปฏิเสธ `..`/absolute |
| **Multi-tenant isolation** | RBAC + row-level security (org_id), แยก vector namespace ต่อ project |
| **PII / secrets ในโค้ด** | secret scanning ก่อน embed/ส่งโมเดล, redaction |
| **Audit** | audit_log ทุก action ที่เปลี่ยน state/แตะ credential |

---

## 10. Scalability Design (100 → 100,000 users)

| ระดับ | สถาปัตยกรรม |
|-------|-------------|
| **~100** | 1 API + 1 worker + Postgres + Redis (single VM/Fly.io). pgvector พอ. ใช้ provider API ตรง |
| **~1,000** | API stateless x2–3 หลัง LB · worker pool autoscale · Postgres + read replica · Redis managed · BullMQ queue · cache prompt/embeddings |
| **~10,000** | แยก service: gateway / orchestrator / context-indexer / sandbox-pool · Temporal สำหรับ durable workflow · vector → Qdrant cluster · per-provider rate-limit & failover routing · CDN |
| **~100,000** | multi-region · DB sharding ตาม org · sandbox เป็น pool แยก (Firecracker microVM autoscale) · semantic cache · cost guardrails ต่อ org · เจรจา dedicated capacity กับ model provider · queue priority tiers |

**คอขวดสำคัญ = ต้นทุน/throughput ของ model provider** → จึงต้อง: adaptive routing (ใช้ครบ 4 โมเดลเฉพาะ Pro), prompt caching, semantic cache, batch embeddings, และ 3-tier mode ที่มีอยู่แล้วเป็นกลไกคุมโหลด

---

## 11. Recommended Tech Stack

| ชั้น | เลือก | เหตุผล |
|------|------|--------|
| Monorepo | **pnpm + Turborepo** | แชร์ types/logic ข้าม web/cli/desktop/server |
| ภาษา | **TypeScript** ทั่วระบบ | ทีมเดียวดูแลทุก client + server; (Python microservice เฉพาะ ML หนัก ถ้าจำเป็น) |
| Web | **Next.js (App Router)** | ต่อยอด UI prototype เดิม, SSR, streaming |
| CLI | **Ink + commander** | TUI ระดับ Claude Code |
| Desktop | **Tauri** | เบากว่า Electron, Windows-friendly, reuse web UI |
| Backend | **NestJS** (หรือ Fastify) | โครงสร้างชัด, DI, modular |
| Orchestration | **LangGraph.js** (+ **Temporal** ตอน scale) | state graph = collaboration จริง; Temporal = durable/retry |
| Model access | **Vercel AI SDK** / provider SDKs ผ่าน abstraction layer | สลับ Gemini/DeepSeek/Qwen/Llama + fallback |
| DB | **PostgreSQL + pgvector** | relational + vector ในที่เดียว (เริ่มต้น) |
| Vector (scale) | **Qdrant** | เมื่อ embedding โต |
| Cache/Queue/PubSub | **Redis + BullMQ** | rate-limit, blackboard, jobs, streaming fan-out |
| Sandbox | **E2B** (เริ่ม) → **Firecracker/gVisor** | รันโค้ด validation ปลอดภัย |
| Object storage | **S3 / Cloudflare R2** | artifacts/zip |
| Auth | **Clerk/Supabase Auth** (เร็ว) หรือ self JWT+Argon2 | |
| Observability | **OpenTelemetry + Langfuse** | trace agent runs, token/cost, eval |
| Infra | Docker + (Fly.io เริ่ม → K8s ตอนใหญ่) | |

---

## 12. Project Folder Structure (monorepo)

```
aof-code/
├── apps/
│   ├── web/                 # Next.js (เอา index.html มาแตกเป็น components)
│   ├── cli/                 # Ink CLI
│   ├── desktop/             # Tauri
│   └── server/              # NestJS API gateway
├── packages/
│   ├── core/                # TMAP engine (framework-agnostic)
│   │   ├── orchestrator/    # LangGraph graph definition
│   │   ├── blackboard/      # shared state store
│   │   ├── agents/          # planner/coder/reviewer/validator
│   │   ├── consensus/       # voting + arbiter
│   │   ├── router/          # adaptive model router
│   │   ├── tools/           # fs/git/search/sandbox adapters
│   │   └── memory/          # working/project/long-term + RAG
│   ├── providers/           # gemini/deepseek/qwen/llama adapters + fallback
│   ├── context-engine/      # repo index, AST chunking, embeddings
│   ├── shared/              # types, AgentMessage contract, zod schemas
│   └── ui/                  # shared React components (web+desktop)
├── services/
│   ├── worker/              # BullMQ/Temporal workers
│   └── sandbox/             # code execution service
├── infra/                   # docker, terraform, migrations
├── docs/                    # นี่คือ TDD + ADRs
└── turbo.json  pnpm-workspace.yaml
```

---

## 13. Development Roadmap

### Phase 1 — MVP (8–10 สัปดาห์) — "ทำให้เป็นของจริง"
- Monorepo + `packages/shared` (AgentMessage contract)
- NestJS gateway + Postgres + Redis + real auth (Argon2/JWT) + server-side rate limit
- **Provider abstraction + เรียกโมเดลจริง** (เริ่ม Gemini + DeepSeek)
- TMAP แบบ minimal: **Planner → Coder → Validator (1 critique loop)** บน LangGraph
- Sandbox validation (E2B) — lint/type/test จริง
- SSE streaming → ต่อกับ **web UI ที่ย้ายมาจาก index.html**
- CLI พื้นฐาน (`login/init/gencode`, diff apply)
- **เลิกใช้ `simulateLocalAgent` ทั้งหมด**

### Phase 2 — Beta (8–12 สัปดาห์)
- ครบ 4 roles + Reviewer + **Consensus/Arbiter**
- Context Engine (AST chunking + pgvector RAG) + Project Memory
- Git integration เต็ม, multi-file edit, `.aof/`
- CLI TUI ระดับ Claude Code (Ink), resume session
- Adaptive Router (Lite/Normal/Pro → จำนวน agent/loop)
- Observability (Langfuse) + cost tracking

### Phase 3 — Production (ต่อเนื่อง)
- Temporal durable workflows, worker autoscale, read replica
- Desktop (Tauri) release, Windows installer (winget)
- Long-term/User memory + personalization
- Hardening security (sandbox egress policy, secret scanning, audit), eval harness
- Billing/quota, SLA, multi-region readiness

### Phase 4 — Enterprise
- Org/RBAC/SSO (SAML/OIDC), row-level isolation
- **Plugin system** (ดู §14)
- Self-hosted / BYO-key / BYO-model, on-prem sandbox
- DB sharding, dedicated provider capacity, compliance (SOC2)

---

## 14. Future Plugin System (เตรียมโครงตั้งแต่ต้น)

- **Plugin = (tools + agent-role + prompt-pack)** ลงทะเบียนผ่าน manifest (`aof-plugin.json`)
- รันใน sandbox/permission model เดียวกับ tool layer (จำกัด fs/network)
- Hook points: `onPlan`, `onPatch`, `onReview`, custom `/command`
- ออกแบบ Tool Layer และ AgentMessage contract ให้ extensible ตั้งแต่ Phase 1 (เพิ่ม role/tool โดยไม่แก้ core)

---

## 15. Migration Strategy (จาก index.html → TMAP v2)

แบบ **incremental, ไม่ rewrite ทีเดียว**:

1. **Freeze prototype** เป็น `apps/web-legacy` (เก็บ UX อ้างอิง)
2. **Strangler ชั้นแรก:** สร้าง `apps/server` + endpoint `/v1/sessions/:id/commands` แล้วชี้ `callClaude()` ในหน้าเดิมไปยัง backend แทน `simulateLocalAgent` (เปลี่ยน 1 ฟังก์ชัน, UI ไม่ต้องแก้)
3. **เปิดโมเดลจริง** ทีละ provider หลัง abstraction
4. **ย้าย state ออกจาก localStorage:** auth/rate-limit/memory → server (เก่ายังทำงานได้ระหว่างทาง)
5. **แตก index.html → React components** ลง `apps/web` (reuse CSS tokens/theme เดิมทั้งหมด — มันดีอยู่แล้ว)
6. **เปิด TMAP loop จริง** (Planner→Coder→Validator) แทน animation 4 dot
7. **เพิ่ม CLI/desktop** ที่ใช้ `packages/core` + API เดียวกัน
8. ปลด `web-legacy` เมื่อ `apps/web` ครบ feature

**ผลลัพธ์:** UX ที่ออกแบบไว้ดีถูกรักษาไว้ 100% ขณะที่ "สมอง" ถูกเปลี่ยนจาก mock เป็น TMAP จริงทีละชั้นโดยระบบไม่ดับ

---

### ภาคผนวก — ทำไม TMAP v2 ดีกว่าแนวคิดเดิม (สรุปเชิงเทคนิค)
- เดิม: 4 โมเดลผูกตาย, sequential, validation ปลอม, ไม่มี shared state, key รั่ว, scale ไม่ได้
- ใหม่: role/model แยกกัน + blackboard (collaboration จริง) + critique loop (error correction) + grounded validation (execution จริง) + consensus เฉพาะที่ verify ไม่ได้ + adaptive routing (คุมต้นทุน) + backend ปลอดภัย scale ได้
```
