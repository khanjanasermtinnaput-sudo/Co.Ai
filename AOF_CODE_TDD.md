# Nexora Code — Technical Design Document (TMAP v2)

> **Technology Multi-AI Agent Processing** — Production architecture
> Revision 3 · 2026-06-17 · *อิง source จริงใน `tmap-v2/` — sync ให้ตรงโค้ดที่เดินหน้าไปไกลกว่า rev 2 มาก*
>
> หลักการของเอกสารนี้: **ของที่สร้างไปแล้ว = รักษาไว้ ไม่รื้อ · ของที่ยังขาด = ระบุ spec ให้สร้างต่อได้ทันที**
> ทุกหัวข้อมีป้ายสถานะ: ✅ DONE (มีในโค้ดแล้ว) · 🟡 PARTIAL (มีบางส่วน) · 🔴 TODO (ยังไม่มี)
>
> **เปลี่ยนแปลงหลักใน rev 3:** ตั้งแต่ rev 2 โค้ดสร้างเพิ่มจำนวนมาก — Voting/Consensus, Project Context Engine,
> Persistent Memory, multi-language validation, DB 5 ตาราง, CLI 8 verbs **ถูก implement แล้ว** และมี subsystem
> ใหม่ที่ rev 2 ไม่ได้กล่าวถึงเลย: **Chief Agent** (universal orchestrator + specialized agents), **RAA**
> (planning chat), **Debugger**, **Analyzer**, **Titan Mode**, cost/metrics tracking, structured logger

---

## สารบัญ

1. Executive Summary
2. Current Architecture Analysis (สถานะจริง + matrix)
3. Production-Ready TMAP Architecture
4. **DARS — Dynamic Agent Replacement System** ⭐ (ส่วนหลักที่เพิ่มใหม่)
5. Multi-Agent Workflow + Voting Engine
6. Memory Architecture (6 ชั้น)
7. Project Context Engine
8. Database Design (8 entities + ER)
9. API Design
10. CLI Design (ครบทุก verb)
11. Security Design
12. Scalability Design
13. Recommended Tech Stack
14. Project Folder Structure
15. Development Roadmap

---

## 1. Executive Summary

Nexora Code คือ AI Coding Assistant ที่ใช้สถาปัตยกรรม **TMAP (Technology Multi-AI Agent Processing)** — AI หลายตัว (Gemini, DeepSeek, Qwen, Llama) ทำงานร่วมกันโดยแต่ละตัวมีบทบาทเฉพาะ (Planner / Coder / Reviewer / Validator) และ **สลับหน้าที่กันได้อัตโนมัติเมื่อตัวใดตัวหนึ่งล่ม** เป้าหมายคือระบบที่ฉลาดกว่า AI ตัวเดียว และ **ไม่ดับแม้ provider บางเจ้าจะล่ม โควต้าหมด หรือ rate limit**

**สถานะปัจจุบัน (rev 3):** Nexora Code **ไม่ใช่ mock อีกต่อไป** และเดินหน้าไกลกว่า MVP มาก — backend จริง (Express, deploy Vercel), เรียกโมเดลจริงผ่าน OpenAI-compatible client + **DARS failover**, TMAP loop จริง (Architect→Plan→Code→Validate→Review→critique→Document) พร้อม **voting** ใน pro mode, **Context Engine** อ่านทั้งโปรเจกต์, **persistent memory** ข้าม session, validation จริงหลายภาษา (JS/TS/Python/Go/Rust/JSON), auth จริง (PIN scrypt + JWT 7d + refresh + lockout), DB 5 ตาราง, และ surface เพิ่ม (Chief Agent, Titan, RAA, Debugger, Analyzer) งานของ revision 3 คือ **sync เอกสารให้ตรงโค้ดที่ทำเกินกว่า rev 2 ระบุ** แล้วชี้ gap ที่เหลือจริง

**Gap ที่เหลือจริง (rev 3 — หลายข้อใน rev 2 ปิดไปแล้ว):**
1. **Sandbox execution หลายภาษา** — validation รัน syntax/compile check จริงแล้ว (JS/TS/Python/Go/Rust/JSON) แต่ยังไม่ execute โค้ดใน isolated sandbox (E2B/Firecracker) — ดู §7.3
2. **Vector/RAG memory** — มี persistent project memory (tech stack, conventions, decisions, failures, session history) แล้ว แต่ยังไม่มี pgvector/embedding-based semantic retrieval — ดู §6
3. **`events` audit table** — มี `tmap_sessions` + `tmap_agent_logs` แล้ว แต่ยังไม่มีตาราง events รวม audit/security/usage — ดู §8
4. **CLI verbs ที่เหลือ** — มี 8 verbs แล้ว ขาด `chat/explain/build/analyze/project/memory/login` + Ink TUI — ดู §10
5. **Redis / durable orchestration** — health-store ยัง in-memory ต่อ instance; ยังไม่มี Redis/Temporal สำหรับ scale ข้าม instance — ดู §12

> **หมายเหตุ rev 3:** Voting, Context Engine, Persistent Memory, DB schema (5 ตาราง), CLI หลาย verb ที่ rev 2 ระบุเป็น 🔴 — **ทำเสร็จแล้ว** สถานะอัปเดตใน §2.1

**Tech stack ปัจจุบัน:** TypeScript (ESM) · Express · Supabase (มี `/tmp` file fallback) · JWT · OpenAI-compatible provider client · `typescript` compiler API (TS validation) · Vercel serverless · tsx runtime
**Tech stack เป้าหมายเมื่อ scale:** + Redis (queue/cache/health-store) · pgvector/Qdrant (memory) · LangGraph/Temporal (durable orchestration) · E2B/Firecracker (sandbox validation จริงหลายภาษา) · Ink (CLI TUI)

---

## 2. Current Architecture Analysis

### 2.1 Status Matrix — สิ่งที่มีจริงในโค้ด (อ่านจาก source)

| Subsystem | สถานะ | ไฟล์จริง | หมายเหตุ |
|---|---|---|---|
| Backend HTTP API | ✅ DONE | `src/server/index.ts` | Express, deploy Vercel `api/index.ts` |
| Provider abstraction (4 vendor + OpenRouter) | ✅ DONE | `src/providers/client.ts`, `src/config.ts` | OpenAI-compatible client เดียวคุยทุกเจ้า |
| Role ≠ Model (เป็น config) | ✅ DONE | `config.ts` → `ROLE_PROVIDER` | เปลี่ยน mapping ได้โดยไม่แตะ core |
| Blackboard (shared state) | ✅ DONE | `types.ts` `Blackboard`, `core/blackboard.ts` | ทุก agent อ่าน/เขียนผ่าน object เดียว |
| TMAP loop (Plan→Code→Validate→Review→critique) | ✅ DONE | `core/orchestrator.ts` | maxIter: lite 0 / normal 1 / pro 3 |
| Planner / Coder / Reviewer agents | ✅ DONE | `core/agents.ts` | prompt + parser เฉพาะ role |
| Grounded validation | ✅ DONE (multi-lang) | `core/validator.ts` | รันเช็คจริง: JS (`node --check`) · TS (`typescript` compiler) · Python (`py_compile`) · Go · Rust · JSON; ภาษาอื่น = skipped อย่างซื่อสัตย์ — sandbox execution อยู่ Phase 3 |
| Auth (username+PIN, JWT) | ✅ DONE | `server/auth.ts`, `server/index.ts`, `server/rateLimit.ts` | PIN 4-8 หลัก scrypt hash, JWT 7 วัน + sliding refresh (`/v1/auth/refresh`), login lockout |
| Per-account encrypted keys | ✅ DONE | `server/crypto.ts`, `server/db.ts` | 5 provider ต่อ user, เก็บเข้ารหัส |
| DB (Supabase + file fallback) | ✅ DONE (5 tables) | `server/db.ts`, `supabase/migration.sql` | `users` · `memories` · `tmap_sessions` · `tmap_agent_logs` · `tmap_costs` — RLS เปิดแบบไม่มี policy (service-role only); file fallback ใน `.nexora-server/db.json` / `/tmp` |
| SSE streaming `/v1/run` | ✅ DONE | `server/index.ts` | stream `{role,text,kind}` + done event |
| Static fallback (mock no-key) | ✅ DONE | `providers/client.ts` `mockReply` | รันได้แม้ไม่มี key |
| CLI | 🟡 PARTIAL (8 verbs) | `src/cli.ts` | `doctor/agents/context/sessions/gencode(run)/titan/review/fix` (+`--apply`/`--mode`); ขาด `chat/explain/build/analyze/project/memory/login` + Ink TUI |
| **DARS (runtime failover)** | ✅ DONE | `src/dars/{health,classify,select,run}.ts` | health store + circuit breaker, error taxonomy, capability-scored selection, `chatWithDARS` wrap; เสียบเข้า `orchestrator.ts`, `chief-agent.ts`, `server/index.ts` (chat/debug/analyze/titan/run/orchestrate), `cli.ts`; health snapshot ที่ `GET /v1/health` |
| **Voting / Consensus** | ✅ DONE | `core/vote.ts` | pro mode: รัน Coder 3 candidate ขนานที่ temp ต่างกัน (0.2/0.5/0.8) → Reviewer เป็น judge ให้คะแนน rubric เลือกตัวชนะ; fallback เป็น candidate แรกถ้า judge ล่ม. Arbiter แยกยังไม่มี (judge ทำหน้าที่แทน) |
| **Persistent Memory** | 🟡 PARTIAL | `core/memory.ts`, table `memories` | จำข้าม session ต่อ user/project: tech stack, conventions, decisions, failure patterns, session history → inject เข้า `bb.context`. ยังไม่มี pgvector/embedding RAG (ดู §6) |
| **Project Context Engine** | ✅ DONE | `core/context-engine.ts`, `retrieval.ts`, `impact.ts` | file tree + dependency graph (imports/importers, ts/js/py) + project-type detection + task-relevant file selection (TF scoring, no LLM) + convention detection + impact analysis |
| **Sessions / Agent Logs / Cost tables** | ✅ DONE | `server/db.ts` | `tmap_sessions` (ประวัติ build) + `tmap_agent_logs` (telemetry ต่อ agent call รวม failover) + `tmap_costs` (ยอดสะสมต่อ user). ตาราง `events` audit รวม ยังเป็น 🔴 (ดู §8) |
| **Chief Agent (universal orchestrator)** | ✅ DONE | `core/chief-agent.ts` + classifier/prompt-engineer/model-router/review-gate | meta-orchestrator: intent → plan → decompose → assign → specialized agents (research/writing/math/vision) → quality-gate review loop → synthesis; endpoint `/v1/orchestrate` |
| **RAA (planning chat)** | ✅ DONE | `core/raa.ts` | requirement-analysis chat, endpoint `/v1/chat` |
| **Debugger** | ✅ DONE | `core/debugger.ts` | senior-engineer debug (root cause/analysis/solution/patch), endpoint `/v1/debug` |
| **Analyzer** | ✅ DONE | `core/analyze.ts` | ประเมิน feasibility/risks/recommendations ก่อน build, endpoint `/v1/analyze` |
| **Titan Mode (AI System Architect)** | ✅ DONE | `core/titan.ts` | Discovery → confidence gate (<85% ถามต่อ) → multi-plan → devil's advocate → architecture → risks → approval gate → blueprint → TMAP; endpoint `/v1/titan` + CLI `titan` |
| **Architect / Impact / Documenter stages** | ✅ DONE | `core/architect.ts`, `impact.ts`, `documenter.ts` | normal/pro: ออกแบบสถาปัตยกรรม + เลือก new/modify ก่อน plan, วิเคราะห์ impact, gen README อัตโนมัติ |
| **Cost & metrics tracking** | ✅ DONE | `orchestrator.ts`, `server/logger.ts`, table `tmap_costs` | ประมาณ token/cost ต่อ call, `GET /v1/me/cost`, `GET /v1/metrics` |
| **Structured logger** | ✅ DONE | `server/logger.ts` | request/error/tmap/agent counters + leveled logging |
| **Login rate-limit / lockout** | ✅ DONE | `server/rateLimit.ts` | 5 ครั้งผิด/15 นาที → lock 15 นาที (per username+IP) |
| **`events` audit table** | 🔴 TODO | — | cross-cutting audit/security/usage (ดู §8) |
| **pgvector / RAG retrieval** | 🔴 TODO | — | semantic memory ด้วย embeddings (ดู §6) |
| **Sandbox execution (multi-lang)** | 🔴 TODO | — | E2B/Firecracker isolated run (ดู §7.3) |

### 2.2 ข้อดีของโค้ดปัจจุบัน (รักษาไว้)
- **Role decoupled จาก Model แล้วจริง** (`ROLE_PROVIDER` + `resolveRoleWith`) — เป็นรากฐานที่ทำให้ DARS เพิ่มได้ง่าย ไม่ต้องรื้อ
- **OpenAI-compatible client เดียว** — เพิ่ม provider ใหม่ = เพิ่ม entry ใน `PROVIDERS` เท่านั้น
- **Blackboard เป็น typed object** — เพิ่ม field memory/votes ได้โดยไม่ break
- **Credential injection per-request** (`resolveAllWith(creds)`) — key มาจาก account ของ user ไม่ใช่ env เดียวรวม → multi-tenant-ready

### 2.3 ข้อจำกัดเชิงสถาปัตยกรรมที่ต้องแก้ (อัปเดต rev 3)
1. ~~**ไม่มี runtime resilience**~~ — ✅ แก้แล้วด้วย **DARS** (`src/dars/`): `chatWithDARS` ห่อ `chat()` พร้อม timeout/retry/circuit-breaker/failover เสียบทุก endpoint
2. ~~**Validation ตื้น (JS เดี่ยว)**~~ — 🟡 ดีขึ้น: เช็ค syntax/compile จริง 6 ภาษา แต่ **ยังไม่ execute** ในsandbox (ไม่รัน test ข้ามไฟล์)
3. ~~**Memory หาย / ไม่มี semantic retrieval**~~ — 🟡 ดีขึ้น: persistent memory ลง Supabase `memories` (รอด cold start) แต่ยังเป็น key-value ต่อ user/project **ยังไม่มี vector retrieval**
4. ~~**ไม่มี project context**~~ — ✅ แก้แล้วด้วย **Context Engine v2** (`context-engine.ts`): อ่าน tree + dep graph + เลือกไฟล์ที่เกี่ยวเข้า `bb.context`
5. ~~**Sequential / ไม่มี voting**~~ — ✅ แก้แล้ว (pro mode): Coder รัน 3 candidate ขนาน + Reviewer judge เลือก (`vote.ts`)
**ข้อจำกัดที่ยังเหลือจริง:**
6. **Health-store in-memory ต่อ instance** — DARS ยังไม่แชร์ health ข้าม serverless instance (ต้องใช้ Redis ตอน scale — §12)
7. **ไม่มี durable orchestration** — loop รันใน-process; ถ้า process ตายกลางคัน job หาย (Temporal/queue ตอน scale — §12)
8. **ไม่มี `events` audit table** — failover/usage log อยู่ใน `tmap_agent_logs` แต่ไม่มี audit รวม cross-cutting (§8)

---

## 3. Production-Ready TMAP Architecture

### 3.1 หลักการ (ยึดของเดิม + เพิ่ม resilience layer)
```
TMAP v2 = Orchestrator + Blackboard + Typed Agents (✅)
        + DARS resilience layer        (✅ — §4)
        + Voting/Consensus Engine      (✅ — §5, pro mode)
        + Project Context Engine        (✅ — §7)
        + Multi-lang Validation         (✅ — §7.3, syntax/compile)
        + Persistent Project Memory     (🟡 — §6, ยังไม่มี vector RAG)
        + Chief Agent + specialized agents (✅ — universal orchestrator, ไม่อยู่ใน rev 2)
        + sandbox execution / pgvector / Redis (🔴 — Phase 2-4)
```

### 3.2 Component Diagram (ปัจจุบัน + ส่วนเพิ่ม)
```
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENTS:  Web terminal (public/index.html ✅) · CLI (🟡) · Desktop(🔴) │
└───────────────┬──────────────────────────────────────────────────────┘
                │  HTTPS · SSE (/v1/run ✅)
┌───────────────▼──────────────────────────────────────────────────────┐
│ API GATEWAY (Express ✅)  Auth/JWT ✅ · per-user keys ✅ · RateLimit 🟡 │
└───────────────┬──────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────┐
│ TMAP ORCHESTRATOR (orchestrator.ts ✅)                                  │
│                                                                        │
│  ┌────────────┐  read/write  ┌────────────────────────────┐           │
│  │ BLACKBOARD │◄────────────►│ AGENTS: Planner Coder       │           │
│  │ (types.ts✅)│              │ Reviewer Validator (✅)      │           │
│  └────────────┘              └──────────────┬─────────────┘           │
│        ▲                                     │ chat()                  │
│  ┌─────┴──────┐   ┌────────────────────┐    ▼                         │
│  │  VOTING /  │   │  DARS RESILIENCE   │  ┌──────────────────┐         │
│  │ CONSENSUS  │   │  LAYER (✅ §4)     │─►│ MODEL ROUTER      │         │
│  │  (✅ §5)   │   │  health · retry ·  │  │ resolveRoleWith ✅ │         │
│  └────────────┘   │  failover · log    │  └────────┬─────────┘         │
│                   └────────────────────┘           │                   │
│  ┌──────────────┐ ┌───────────────┐  ┌─────────────▼──────────┐       │
│  │ CONTEXT      │ │ MEMORY         │  │ Gemini DeepSeek Qwen    │       │
│  │ ENGINE (✅§7)│ │ (🟡 §6 kv)     │  │ Llama  (+OpenRouter ✅)  │       │
│  └──────────────┘ └───────────────┘  └────────────────────────┘       │
│  ┌──────────────────────────────────────────────────────────┐         │
│  │ VALIDATION  multi-lang syntax/compile ✅ → sandbox exec 🔴  │         │
│  └──────────────────────────────────────────────────────────┘         │
└───────────────┬───────────────────────┬──────────────────────────────┘
        ┌───────▼──────┐        ┌────────▼─────────┐    ┌───────────────┐
        │ Supabase ✅   │        │ pgvector/Qdrant🔴 │    │ Redis 🔴       │
        │ (5 tables)    │        │ (vector memory)   │    │ (queue/health)│
        └───────────────┘        └──────────────────┘    └───────────────┘
```

### 3.3 Roles & default mapping (มีในโค้ดแล้ว — `config.ts`)
| Role | หน้าที่ | Default | Fallback chain (DARS §4) |
|---|---|---|---|
| **Planner** | วิเคราะห์/วางแผน/แตกงาน | Gemini | → Qwen → Llama → DeepSeek |
| **Coder** | เขียน/แก้/refactor | DeepSeek | → Qwen → Gemini → Llama |
| **Reviewer** | ตรวจคุณภาพ/หา bug | Qwen | → Gemini → Llama → DeepSeek |
| **Validator** | รัน lint/test + ตีความ | Llama | → DeepSeek → Gemini → Qwen |
| **Arbiter** (on-conflict) | ชี้ขาดเมื่อ vote ไม่ลงตัว | โมเดลแรงสุดที่ healthy | dynamic |

> mapping = config (`ROLE_PROVIDER`). DARS จะ override ตัวเลือกตาม health แบบ runtime (§4.4)

---

## 4. DARS — Dynamic Agent Replacement System ⭐

> **สถานะ: ✅ DONE** — implement แล้วครบใน `src/dars/{health,classify,select,run}.ts` ห่อ (`wrap`) รอบ `chat()` ตามที่ออกแบบไว้ โดยไม่ต้องแก้ orchestrator มาก เสียบใช้งานจริงแล้วใน `orchestrator.ts`, `chief-agent.ts`, ทุก SSE endpoint ใน `server/index.ts` (chat/debug/analyze/titan/run/orchestrate) และ `cli.ts`

### 4.1 เป้าหมาย
เมื่อ agent ตัวใดมีปัญหา ระบบต้อง (1) ตรวจจับ (2) เลือกตัวสำรองที่เหมาะ (3) สลับ (4) ทำงานต่อแบบ user ไม่รู้สึก (5) บันทึกลง memory — **ภายใน request เดียว ไม่ fail ทั้ง job**

### 4.2 Failure Taxonomy + วิธีตรวจจับ
| ปัญหา | สัญญาณตรวจจับ (จาก `chat()`) | Action |
|---|---|---|
| **API Down** | network error / DNS / HTTP 5xx | failover ทันที + mark provider `open` |
| **Timeout** | เกิน `PER_CALL_TIMEOUT` (เช่น 30s) → `AbortController` | retry ครั้งเดียวกับตัวเดิม → failover |
| **Rate Limit** | HTTP 429 (+ อ่าน `Retry-After`) | failover ทันที (ไม่รอ) + cooldown ตาม header |
| **Quota Exhausted** | 402/403 + body match `quota|insufficient|billing` | mark provider `quota_exhausted` (cooldown ยาว เช่น 1 ชม.) + failover |
| **High Latency** | latency > `LATENCY_SLO` (เช่น p95) ติดกัน N ครั้ง | degrade score → ครั้งหน้าเลือกตัวอื่นก่อน (ไม่ fail ปัจจุบัน) |
| **Low Quality** | output ว่าง / parse ไม่ได้ / validation fail ซ้ำจาก coder เดิม / confidence ต่ำ | retry กับ provider อื่น (diversity) แล้วเทียบผล |

### 4.3 Health Store + Circuit Breaker (per provider)
เก็บใน Redis (prod) หรือ in-memory Map (MVP). 3 สถานะแบบ circuit breaker:
```
CLOSED      ─(failures ≥ threshold)→  OPEN
OPEN        ─(หลัง cooldown)→          HALF_OPEN
HALF_OPEN   ─(probe สำเร็จ)→           CLOSED
HALF_OPEN   ─(probe ล้มเหลว)→          OPEN (cooldown ×2, exponential)
```
```ts
// packages/core/dars/health.ts  (🔴 NEW)
type Circuit = 'closed' | 'open' | 'half_open';
interface ProviderHealth {
  provider: string;            // 'gemini' | ...
  circuit: Circuit;
  consecutiveFails: number;
  ewmaLatencyMs: number;       // exponential moving avg
  successRate: number;         // sliding window
  cooldownUntil?: number;      // epoch ms (rate-limit / quota)
  lastError?: string;
  updatedAt: number;
}
interface HealthStore {
  get(provider: string): ProviderHealth;
  recordSuccess(provider: string, latencyMs: number): void;
  recordFailure(provider: string, kind: FailureKind, retryAfterMs?: number): void;
  isAvailable(provider: string): boolean;   // closed | (half_open & probe slot)
}
```

### 4.4 อัลกอริทึมเลือกตัวสำรอง (ดีกว่า fixed-pair)
ผู้ใช้เสนอ mapping ตายตัว (Gemini→Qwen ฯลฯ). ข้อเสนอที่ดีกว่า: **capability-scored candidate pool** — เลือกจาก candidate ที่ healthy โดยให้คะแนนตาม fit ของ role + ราคา + latency + ความหลากหลาย:

```ts
// packages/core/dars/select.ts  (🔴 NEW)
interface Candidate { provider: string; model: string; }

function score(role: Role, c: Candidate, h: ProviderHealth, used: Set<string>): number {
  if (!healthAvailable(h)) return -Infinity;          // ตัด open/quota ออก
  const cap   = ROLE_CAPABILITY[role][c.provider] ?? 0.5; // 0..1 เหมาะกับ role แค่ไหน
  const speed = 1 / (1 + h.ewmaLatencyMs / 1000);        // เร็ว = ดี
  const rel   = h.successRate;                            // เสถียร = ดี
  const cost  = 1 - (PROVIDER_COST[c.provider] ?? 0.5);   // ถูก = ดี
  const div   = used.has(c.provider) ? 0 : 0.15;          // โบนัสความหลากหลาย (low-quality case)
  return 0.45*cap + 0.20*rel + 0.15*speed + 0.10*cost + 0.10 + div;
}

// เลือก provider ที่ healthy คะแนนสูงสุดสำหรับ role นั้น
function pickProvider(role: Role, exclude: Set<string>, health: HealthStore): ResolvedProvider | null
```
`ROLE_CAPABILITY` = ตารางความถนัด เช่น coder: deepseek 0.9, qwen 0.85, gemini 0.7, llama 0.6 — ปรับได้จาก eval/telemetry จริง (เก็บใน Agent Memory §6.6)

### 4.5 จุดเสียบเข้ากับโค้ดเดิม — `chatWithDARS()` wrap รอบ `chat()`
ไม่แก้ `agents.ts`/`orchestrator.ts` มาก — แค่เปลี่ยน agent ให้เรียก wrapper:
```ts
// packages/core/dars/run.ts  (🔴 NEW)
export async function chatWithDARS(
  role: Role, creds: CredentialBag, messages: ChatMessage[],
  opts: ChatOpts, ctx: { health: HealthStore; emit: Emit; sessionId: string },
): Promise<{ text: string; provider: ResolvedProvider }> {
  const tried = new Set<string>();
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt < MAX_FAILOVER; attempt++) {
    const provider = pickProviderResolved(role, creds, tried, ctx.health);   // §4.4
    if (!provider) break;
    tried.add(providerKeyOf(provider));
    const t0 = Date.now();
    try {
      const text = await withTimeout(chat(provider, messages, opts), PER_CALL_TIMEOUT); // ✅ reuse chat()
      const dt = Date.now() - t0;
      ctx.health.recordSuccess(providerKeyOf(provider), dt);
      if (!isLowQuality(role, text)) {                  // §4.2 low-quality gate
        return { text, provider };
      }
      ctx.health.recordFailure(providerKeyOf(provider), 'low_quality');
      ctx.emit('system', `low-quality from ${provider.providerName} → trying another model`, 'status');
    } catch (e) {
      const kind = classifyError(e as Error);            // §4.2 taxonomy
      ctx.health.recordFailure(providerKeyOf(provider), kind, retryAfterMs(e));
      logAgentEvent(ctx.sessionId, { role, provider: provider.providerName, kind, err: String(e) }); // §6.6 / §8
      ctx.emit('system', `${provider.providerName} ${kind} → switching agent`, 'status'); // user เห็นว่า "สลับแล้ว"
      lastErr = e as Error;
    }
  }
  throw new Error(`all providers exhausted for ${role}: ${lastErr?.message ?? 'no healthy provider'}`);
}
```
**ผลลัพธ์ที่ user เห็น:** stream ยังไหลต่อ มี event `system: "Gemini rate-limited → switching agent"` แล้ว Planner ทำงานต่อด้วย Qwen — ไม่มี error หยุด job

### 4.6 ความสัมพันธ์กับ static fallback ที่มีอยู่
`resolveRoleWith()` เดิม (config.ts) ทำ fallback **ตอน config-time** (ไม่มี key เจ้านี้ → ใช้เจ้าอื่น). DARS ทำ fallback **ตอน runtime** (มี key แต่เจ้านั้นล่ม/ช้า/quota หมด). สองชั้นนี้เสริมกัน ไม่ทับกัน — เก็บของเดิมไว้ทั้งหมด

### 4.7 บันทึกเหตุการณ์ (requirement ข้อ 5)
ทุกการสลับเขียนลง `agent_logs` + `events` (§8) และอัปเดต Agent Memory (§6.6) เพื่อให้รอบถัด ๆ ไปเลือกฉลาดขึ้น (เช่น Gemini ล่มบ่อยช่วงนี้ → ลดคะแนนชั่วคราว)

---

## 5. Multi-Agent Workflow + Voting Engine

### 5.1 Flow ปัจจุบัน (✅ มีจริงใน orchestrator.ts — rev 3 มี smart stages เพิ่ม)
```
/v1/run {task,mode,planOnly?}
  → createBlackboard ✅ (+ inject memory + Context Engine v2 summary)
  → [normal/pro] Architect ✅      → bb.architect (approach, new/modify files, risks)
  → [normal/pro] Impact analysis ✅ → bb.impact (reverse-deps ของไฟล์ที่จะแก้)
  → [UI projects] inject UI guidance ✅
  → Planner (chatWithDARS) ✅      → bb.plan / bb.planText
  → ถ้า planOnly → หยุดที่นี่ (Nexora Code "Create Plan") ✅
  → loop (maxIter: lite 0 / normal 1 / pro 3) ✅:
      → Coder ✅   → bb.files   (pro+iter0 = Voting: 3 candidate ขนาน → judge เลือก)
      → Validator (multi-lang grounded) ✅  → bb.validations
      → Reviewer (chatWithDARS) ✅           → bb.review (HIGH/MED/LOW)
      → เก็บ failureNotes → memory ✅
      → ถ้า validation fail || HIGH issue && iter<max → buildCritique → วนต่อ ✅
  → [normal/pro] Documenter ✅ → gen README
  → persist(bb) ✅ + onSessionEnd (update session, cost, memory) ✅
  → SSE done {files, iterations, sessionId} ✅
```

### 5.2 Parallel + Voting (✅ DONE — `core/vote.ts`)
Voting ทำงานเฉพาะ **pro mode รอบแรก** (คุมต้นทุน) ตามหลักที่วางไว้ — ใช้กับงานที่ตัดสินด้วยเครื่องล้วนไม่ได้:

```
PLAN ─► [mode router]
         ├─ lite/normal: single Coder (เหมือนเดิม ✅)
         └─ pro (iter 0): 3 Coder ขนานที่ temp ต่างกัน (0.2/0.5/0.8 = diversity จริง) ─► VOTING ENGINE
                                                          │
            ┌─────────────────────────────────────────────┘
            ▼
  VOTING ENGINE (vote.ts → runCoderVote) ✅:
    1) Promise.allSettled รัน Coder ทุก temp → คัดเฉพาะ candidate ที่มีไฟล์ (>0)
    2) ถ้าเหลือ 0 → คืน empty · ถ้าเหลือ 1 → ใช้ตัวนั้นเลย
    3) ถ้าเหลือ ≥2 → Reviewer เป็น "judge" ให้คะแนน rubric:
       accuracy 40% · completeness 30% · logic 20% · efficiency/clarity 10%
       → ตอบ PICK: <letter> + REASON → เลือก candidate ชนะ
    4) judge ล่ม → fallback เป็น candidate A (ไม่ทำให้ job พัง)
```
```ts
// src/core/vote.ts (✅ IMPLEMENTED — ต่างจาก spec เดิมเล็กน้อย)
interface VoteResult { files: CodeFile[]; winnerIndex: number; candidateCount: number; reason: string; }
async function runCoderVote(coderCall, reviewerCall, bb, critique?, temps?): Promise<VoteResult>
```
> **หมายเหตุ implementation:** ของจริงใช้ **LLM-as-judge** (Reviewer ให้คะแนน) แทน weighted-vote + Arbiter แยกที่ spec เดิมวางไว้ และยังไม่ได้รัน candidate ผ่าน sandbox ก่อน vote.
> **Enhancement ที่เหลือ (🔴):** validation-first selection — รันทุก candidate ใน sandbox คัดตัวที่ผ่านจริงก่อน แล้วค่อย judge เฉพาะกรณี subjective (objective ใช้ผล execution ตัดสิน)

### 5.3 Typed Agent Message (เพิ่ม field ลง Blackboard เดิม)
`Blackboard` ปัจจุบันมี `log: AgentEvent[]` แล้ว ✅ — เพิ่ม `votes`, `decisions`, `agentRuns` (เพื่อ DARS/billing):
```ts
// ขยาย types.ts (เพิ่ม field, ไม่ลบของเดิม)
interface Blackboard {
  /* ...ของเดิมทั้งหมด... */
  votes?: Vote[];
  decisions?: Decision[];
  agentRuns?: AgentRun[];   // {role, provider, model, tokensIn/Out, latencyMs, costUsd, failoverFrom?}
}
```

---

## 6. Memory Architecture (6 ชั้น)

> requirement ระบุ 6 ชนิด — map กับของที่มี (`blackboard.persist` ✅) + ที่ต้องเพิ่ม

| # | ชนิด | ขอบเขต | สถานะ | Backing store |
|---|---|---|---|---|
| 1 | **Conversation Memory** | ต่อ session/chat | 🟡 | blackboard log + `tmap_sessions`/`tmap_agent_logs`; ยังไม่มี summary rollup ต่อ chat |
| 2 | **Project Memory** | ต่อ project/user | ✅ (key-value) | `memories` table (`core/memory.ts`): techStack, conventions, decisions, failures, session history. ยังไม่มี AST chunk/pgvector |
| 3 | **File Memory** | ต่อไฟล์ | 🟡 | Context Engine v2 อ่าน tree + dep graph + conventions runtime (ไม่ persist ต่อไฟล์); ยังไม่มี `files` table + hash/symbols |
| 4 | **User Preference Memory** | ต่อ user | 🟡 | `conventions` ใน `memories` จับ indent/quote/semicolon ได้; ยังไม่สรุป style จาก feedback |
| 5 | **Long-Term Memory** | ข้าม project | 🔴 | embeddings: บทเรียน/patterns ที่ใช้ซ้ำได้ |
| 6 | **Agent Memory** | ต่อ agent/provider | 🟡 | DARS health store (in-memory `globalHealth`: circuit/EWMA latency/success-rate) feed การเลือก §4.4; ยังไม่ persist เป็นตาราง/ข้าม instance |

> **สรุป rev 3:** memory **มีจริงและ persist ข้าม cold start แล้ว** (Supabase `memories`) — สิ่งที่เหลือคือยกระดับเป็น
> **semantic/vector** (AST chunk → embed → pgvector hybrid retrieval) และแยก File Memory เป็นตารางถาวร

### 6.1 Working Memory = Blackboard (✅ มีแล้ว)
`createBlackboard/logEvent/persist` ใน `core/blackboard.ts` คือ working memory ระดับ session — **เก็บไว้** แค่ย้าย `persist()` จากไฟล์ `.nexora/` ไป DB/Redis (เพราะ Vercel `/tmp` หาย)

### 6.2–6.6 ที่ต้องเพิ่ม
- **Project/File Memory:** ตอน `nexora init`/index repo → chunk ตาม AST (function/class) → embed → เก็บ pgvector พร้อม `source_path`, `symbols`, `hash` (incremental ตาม git diff)
- **User Preference:** สรุปจาก feedback + การ apply/reject diff → ใช้ปรับ prompt (เช่น "ผู้ใช้ชอบ TS strict, ไม่เอา comment เยอะ")
- **Long-Term:** decision log ที่ promote ขึ้นเป็น org-level pattern
- **Agent Memory (เชื่อม DARS):** ตาราง `agent_logs` สะสมสถิติ provider×role → คำนวณ `ROLE_CAPABILITY`/`successRate` แบบ data-driven

### 6.7 Retrieval pipeline (RAG)
```
query → hybrid (BM25 + vector) → rerank → token-budget pack → inject เข้า bb.context
        (พร้อม citation: source_path#symbol)
```
`bb.context` มีอยู่แล้วใน Blackboard ✅ — Context Engine แค่เติมค่าให้มันก่อนเรียก Planner

---

## 7. Project Context Engine

> **สถานะ: ✅ DONE** — `core/context-engine.ts` (Context Engine v2) + `retrieval.ts` + `impact.ts` เสียบเข้า `orchestrator.ts` แล้ว ทำงานเป็น pure Node (ไม่มี network/ค่า API)

### 7.1 ความสามารถ (ของจริงใน context-engine.ts)
- ✅ อ่านทั้งโปรเจกต์ (`readProjectTree`, skip `node_modules/.git/dist/.next/...`, จำกัด ≤400 ไฟล์)
- ✅ **Dependency graph** — parse import/require (ts/js/py) เป็น `imports` + `importers` (reverse)
- ✅ **Project-type detection** แบบ granular (`node-express-ts`, `react-ts`, ...)
- ✅ **Task-relevant file selection** — TF scoring (`retrieval.ts` buildIndex/rank, ไม่มี LLM call)
- ✅ **Convention detection** — indent / quotes / semicolons
- ✅ **Impact analysis** (`impact.ts`) — แก้ไฟล์ไหนกระทบ dependent ตัวไหน (reverse-deps) → จัดระดับ risk
- ✅ ป้อน summary ที่เกี่ยวเข้า `bb.context` พร้อม **ceiling 64KB** (กัน monorepo ใหญ่ท่วม context window)
> **ที่เหลือ (🔴):** AST parse แบบ symbol-level (tree-sitter/TS compiler) + embed → pgvector hybrid retrieval (ตอนนี้เป็น lexical TF scoring) + incremental re-index ตาม git diff

### 7.2 Pipeline
```
index:   walk → filter → AST chunk → embed → store (Project/File Memory §6)
query:   task → retrieve top-k chunks + dep-neighbors → pack → bb.context
apply:   diff → update File Memory + re-embed เฉพาะไฟล์ที่เปลี่ยน (incremental)
```
```ts
// packages/context-engine/index.ts (🔴 NEW)
interface ContextEngine {
  indexProject(root: string): Promise<IndexStats>;
  retrieve(task: string, budgetTokens: number): Promise<ContextPack>; // → bb.context
  impactOf(filePath: string): Promise<string[]>;                       // reverse deps
}
```

### 7.3 ยกระดับ Validation ให้ grounded หลายภาษา (ขยายจาก validator.ts ✅)
`validateFiles()` ตอนนี้เช็ค syntax/compile จริงหลายภาษาแล้ว (เก็บ interface เดิม `ValidationResult`):
| ภาษา | ปัจจุบัน (rev 3) | Production ที่เหลือ |
|---|---|---|
| JS | ✅ `node --check` | + eslint + vitest ใน sandbox |
| TS | ✅ `typescript` compiler API | + `tsc --noEmit` ข้ามไฟล์ + eslint |
| Python | ✅ `py_compile` | + ruff + pytest |
| Go | ✅ compile check | + `go vet` + `go test` |
| Rust | ✅ compile check | + clippy + `cargo test` |
| JSON | ✅ parse check | — |
| อื่น ๆ | skipped (ซื่อสัตย์) | รันใน **E2B/Firecracker** (no-egress, จำกัด cpu/mem/time) |
> **ที่เหลือจริง (🔴):** ทั้งหมดเป็น single-file syntax/compile — **ยังไม่ execute** โค้ด/รัน test ใน isolated sandbox

---

## 8. Database Design (8 entities + ER)

> rev 3: มี **5 ตารางจริง** ใน `supabase/migration.sql` + file fallback ใน `db.ts` — `users`, `memories`, `tmap_sessions`, `tmap_agent_logs`, `tmap_costs` ทุกตารางเปิด RLS แบบ **ไม่มี policy** (เข้าถึงเฉพาะ service-role ของเซิร์ฟเวอร์)

### 8.1 ER (logical)
```
organizations(🔴 ภายหลัง)
   └─1:N─ users ✅
            ├─1:N─ projects 🔴
            │         ├─1:N─ files 🔴
            │         ├─1:N─ memories 🔴 (scope: project|user|long_term)
            │         └─1:N─ conversations 🔴
            │                   └─1:N─ messages 🔴
            ├─1:N─ tasks 🔴 (= run ของ /v1/run; map กับ session/blackboard)
            │         ├─1:N─ agent_logs 🔴 (รวม DARS failover events)
            │         └─1:N─ artifacts/files-generated 🔴
            └─1:N─ events 🔴 (audit + DARS switch + usage)
```

### 8.2 Schema (PostgreSQL / Supabase)
```sql
-- ✅ มีจริงแล้ว (migration.sql + db.ts):
users(id PK, username UNIQUE, pin_hash, encrypted_keys JSONB, created_at)
memories(key PK, data JSONB, updated_at)                       -- Project Memory §6 (key = userId/projectRoot)
tmap_sessions(id PK, user_id FK→users, task, mode, status,     -- = 1 ครั้งของ /v1/run (= "tasks" เดิม)
      files_count, iterations, cost_usd, tokens_used, summary, created_at, updated_at)
tmap_agent_logs(id PK, session_id FK→tmap_sessions, role,      -- §4.7 telemetry ต่อ agent call
      provider, model, attempts, input_tokens, output_tokens, cost_usd, duration_ms, ts)
tmap_costs(user_id PK→users, total_cost_usd, total_tokens,     -- ยอดสะสมต่อ user (billing)
      session_count, updated_at)

-- 🔴 ยังไม่มี (ตาม requirement เดิม):
projects(id PK, user_id FK, name, repo_url, default_branch, settings JSONB, created_at)
files(id PK, project_id FK, path, lang, hash, symbols JSONB, summary, version INT, updated_at) -- File Memory §6.3
conversations(id PK, user_id FK, project_id FK NULL, title, created_at)
messages(id PK, conversation_id FK, role, content, created_at)  -- Conversation Memory §6.1
events(id PK, user_id FK, type, target, meta JSONB, created_at)  -- audit + dars_switch + usage
-- vector memory: ALTER memories ADD embedding VECTOR(1024); CREATE INDEX ... USING hnsw (...)
```
**สถานะ vs requirement:** `tmap_sessions` = "tasks" (หน่วยงานหลัก ผูกกับ blackboard) ✅ · `tmap_agent_logs` = "agent_logs" (DARS analytics + billing ระดับ call) ✅ · `tmap_costs` รองรับ billing ต่อ user ✅ · `memories` ตอนนี้เป็น key-value (1 row ต่อ user/project) ยังไม่แตกเป็น scope/embedding ✅(partial). ที่ยังขาด: `projects`/`files`/`conversations`/`messages` (multi-project + conversation persistence) และ `events` (audit รวม) + pgvector

---

## 9. API Design

### 9.1 ที่มีแล้ว ✅ (`server/index.ts` — rev 3 มีมากกว่า rev 2 เยอะ)
```
# Auth
POST /v1/auth/register     {username, pin}      → {token, username}   ✅
POST /v1/auth/login        {username, pin}      → {token, username}   ✅ (rate-limit/lockout)
POST /v1/auth/refresh      (Bearer)             → {token, username}   ✅ (sliding session)

# Account + keys
GET  /v1/me                (Bearer)             → {username, keys(masked)} ✅
PUT  /v1/me/keys           {provider, key}      → {ok, masked}        ✅
DEL  /v1/me/keys/:provider                      → {ok}                ✅
GET  /v1/me/cost           (Bearer)             → {totalCostUsd, totalTokens, sessionCount} ✅

# Sessions / history
GET  /v1/sessions          ?limit=              → {sessions[]}        ✅
GET  /v1/sessions/:id                           → {session, logs[]}   ✅ (agent_logs snapshot)

# Memory
GET  /v1/memory            (Bearer)             → ProjectMemory       ✅
DEL  /v1/memory            (Bearer)             → {ok}                ✅

# AI surfaces (ทุกตัว SSE + ผ่าน DARS)
POST /v1/run         {task, mode, context?, planOnly?} → role/text/kind.. done{files,iterations,sessionId} ✅
POST /v1/chat        {message, history?}    → RAA planning chat (requirement analysis)   ✅
POST /v1/titan       {message, history?}    → Titan architect: confidence/plan/blueprint ✅
POST /v1/debug       {error, code?, context?} → rootCause/analysis/solution/patch         ✅
POST /v1/analyze     {brief}                → feasibility/risks/recommendations           ✅
POST /v1/orchestrate {message, history?, qualityGate?} → Chief Agent multi-agent          ✅

# Ops
GET  /v1/health                              → DARS health snapshot (circuit/latency)     ✅
GET  /v1/metrics                             → request/error/tmap/token counters          ✅
```
> SSE ทุก endpoint ใช้ shape `{role, kind, text}` (+ event `kind:'done'` ที่มี payload เฉพาะแต่ละ surface). DARS emit `role:'system', kind:'status'` ตอนสลับ provider — client เดิม render ได้ทันที
**SSE event ที่ DARS เพิ่ม (backward-compatible):** ใช้ `role:'system'` ที่มีอยู่แล้ว → client เดิม render ได้ทันที
```json
{"role":"system","kind":"status","text":"Gemini rate-limited → switching to Qwen"}
```

### 9.2 ที่ต้องเพิ่ม 🔴 (rev 3 — chat/history ทำเสร็จแล้ว ตัดออก)
```
# Projects / Context (multi-project — ยังไม่มี)
POST /v1/projects                {name, repoUrl?}          → project
POST /v1/projects/:id/index      → 202 {jobId}  (Context Engine §7 index → persist)
GET  /v1/projects/:id/memory?q=  → relevant chunks (RAG, ต้องมี pgvector ก่อน)

# Tasks / apply
POST /v1/sessions/:id/apply      → เขียน artifacts ลง fs (CLI/desktop)

# Agents / DARS mapping
GET  /v1/agents                  → role→provider + health  (มี /v1/health แล้วบางส่วน — ขาด role→provider mapping)
PUT  /v1/agents/mapping          → override ROLE_PROVIDER ต่อ user/project
```
> **ทำเสร็จแล้ว (ย้ายขึ้น §9.1):** `POST /v1/chat` (RAA), `GET /v1/sessions` + `/v1/sessions/:id` (= tasks history + blackboard/agent_logs snapshot), `GET /v1/health` (DARS snapshot)

---

## 10. CLI Design (ครบทุก verb)

> ปัจจุบัน 🟡 (rev 3): มี **8 verbs** ใน `src/cli.ts` — `doctor/agents/context/sessions/gencode(run)/titan/review/fix` (+`--apply`/`--mode`)
> เป้าหมายที่เหลือ: `chat/explain/build/analyze/project/memory/login` + Ink TUI + diff-apply interactive

### 10.1 Verb mapping
| Verb | ทำอะไร | สถานะ | เบื้องหลัง |
|---|---|---|---|
| `nexora doctor` | เช็ค key/agent resolve + project context | ✅ | `config.ts` + `gatherProjectContext` |
| `nexora agents` | role→model mapping | ✅ | `resolveAll` (ยังไม่โชว์ health — มี `/v1/health` ฝั่ง server) |
| `nexora context` | สแกน dir แสดง type/stack/deps/scripts/files | ✅ | `gatherProjectContext` |
| `nexora gencode(code/run) "<task>"` | รัน TMAP เต็มแล้ว gen ไฟล์ | ✅ | `runTMAP` (+`--apply` เขียนลง root, `--mode`) |
| `nexora titan ["<idea>"]` | Titan interactive: discovery→plan→approval→build | ✅ | `runTitan` → `blueprintToBuild` → `runTMAP` |
| `nexora review [dir]` | review โค้ดที่มีอยู่ (read-only, lite) | ✅ | `runTMAP` + Context Engine |
| `nexora fix [dir]` | gen fixes ให้ codebase เดิม | ✅ | `runTMAP` (+`--apply` overwrite in place) |
| `nexora sessions` | list local `.nexora/sessions` ล่าสุด | ✅ | อ่าน session JSON |
| `nexora chat` | สนทนา/ถาม-ตอบ REPL | 🔴 | `/v1/chat` (RAA) SSE — server มีแล้ว ขาดฝั่ง CLI |
| `nexora explain <path>` | อธิบายโค้ด | 🔴 | single-agent + context |
| `nexora analyze` | ประเมิน brief/feasibility | 🔴 | `/v1/analyze` (server มีแล้ว) |
| `nexora build` | gen + validate + apply ครบ | 🔴 | TMAP `--apply` + sandbox |
| `nexora project` | init/index/สลับ project | 🔴 | `/v1/projects` (ยังไม่มี) |
| `nexora memory` | ดู/ค้น/ล้าง memory | 🔴 | `loadMemory`/`clearMemory` (server มี `/v1/memory`) |
| `nexora login` | username+PIN → เก็บ token | 🔴 | `/v1/auth/login` |

### 10.2 UX ระดับ Claude Code (🔴)
- **Ink TUI** streaming agent status (busy/done/error) + **DARS switch แสดง realtime**
- **Diff review ในเทอร์มินัล** + `apply? (y/n/edit)` ก่อนเขียน fs จริง (มี `--apply` แล้วใน `code` ✅ — เพิ่ม interactive)
- `.nexora/` ต่อ project (config + memory cache + conventions เทียบ `CLAUDE.md`)
- Windows-first: PowerShell, path Windows, แพ็กเป็น binary (`node --sea`) ติดตั้งผ่าน `npm i -g @nexora/code` (มี `bin: nexora` ใน package.json แล้ว ✅)

---

## 11. Security Design

| ภัย | สถานะ | มาตรการ |
|---|---|---|
| **API key leak** | ✅ ดี | key อยู่ server, เก็บ **encrypted** (`crypto.ts`), `/v1/me` คืนเฉพาะ masked. ห้ามส่ง raw key ออก client เด็ดขาด |
| **Auth อ่อน** | ✅ | PIN scrypt hash (`hashPassword`) + JWT **7d** + sliding refresh (`/v1/auth/refresh`) → จำกัด blast radius ของ token ที่หลุด. Login rate-limit/lockout มีแล้ว (`server/rateLimit.ts`: 5 ครั้งผิด/15 นาที → lock 15 นาที) |
| **Rate-limit / abuse** | 🟡 | login lockout มีแล้ว ✅ (`rateLimit.ts`); ยังไม่มี per-user token-bucket ทั่วระบบ/quota เชิงต้นทุน → เพิ่ม Redis token-bucket + ผูก `tasks.cost_usd` ตอน scale |
| **Prompt injection** (จากไฟล์/RAG) | 🔴 | แยก system vs untrusted content, fencing, tool allowlist, ตัด instruction จากไฟล์ผู้ใช้ |
| **รันโค้ดอันตราย** (validation) | 🟡 | ตอนนี้เป็น syntax/compile check หลายภาษา **ไม่ execute** โค้ด (ปลอดภัยพอ). ตอน execute จริง → **E2B/Firecracker no-egress**, จำกัด cpu/mem/time, fs เฉพาะ workspace |
| **Path traversal** | 🔴 | เมื่อ apply diff → จำกัดใต้ project root, ปฏิเสธ `..`/absolute |
| **Multi-tenant isolation** | 🟡 | key แยกต่อ user ✅; เพิ่ม row-level security ตาม `user_id` + vector namespace ต่อ project |
| **Secrets ในโค้ด** | 🔴 | secret scanning ก่อน embed/ส่งโมเดล |
| **Audit** | 🔴 | `events` table (§8) ทุก action ที่แตะ credential/state |
| **JWT_SECRET** | 🟡 | `auth.ts` บังคับ ≥16 ตัว ✅ — ต้องตั้งใน Vercel env จริง (ไม่ commit) |

> **เร่งด่วน:** PIN เป็น 4-8 หลัก = entropy ต่ำมาก → **ต้อง** rate-limit/lockout ที่ `/v1/auth/login` (เช่น 5 ครั้ง/5 นาที/username+IP) ก่อนเปิดใช้จริงวงกว้าง

---

## 12. Scalability Design

| ระดับ | สถาปัตยกรรม | สถานะ |
|---|---|---|
| **~100** | Vercel serverless + Supabase (ตอนนี้) | ✅ พอแล้ว |
| **~1,000** | + Redis (health-store DARS + rate-limit + cache) · prompt/embedding cache · read replica | 🔴 |
| **~10,000** | แยก service: gateway / orchestrator-worker / context-indexer / sandbox-pool · job queue (BullMQ) · vector → Qdrant · per-provider failover routing (DARS แชร์ health ข้าม instance ผ่าน Redis) | 🔴 |
| **~100,000** | multi-region · DB sharding ตาม user/org · Firecracker microVM pool (sandbox) · semantic cache · cost guardrails ต่อ user · queue priority ตาม mode (lite/normal/pro) · เจรจา dedicated capacity กับ provider | 🔴 |

**คอขวดหลัก = throughput/quota ของ model provider** → DARS (§4) คือกลไก scale สำคัญ: กระจายโหลดข้าม provider, เลี่ยงตัวที่ 429/quota หมด, และ 3-tier mode ที่มีอยู่แล้ว ✅ คุมจำนวน agent call ต่อ task

---

## 13. Recommended Tech Stack

| ชั้น | ปัจจุบัน (รักษาไว้) | เพิ่มเมื่อ scale |
|---|---|---|
| ภาษา | **TypeScript (ESM)** ✅ | คงเดิมทั้งระบบ |
| Backend | **Express** ✅ (Vercel fn) | NestJS/Fastify เมื่อ service เยอะ |
| Runtime | **tsx** ✅ | tsup/esbuild build เป็น JS prod |
| DB | **Supabase (Postgres)** ✅ | + **pgvector** → Qdrant ตอนโต |
| Auth | **JWT 7d + scrypt PIN + lockout** ✅ | + refresh rotate (มี refresh แล้ว) |
| Provider | **OpenAI-compatible client** ✅ (`client.ts`) | คงเดิม — เพิ่ม provider = เพิ่ม entry |
| Orchestration | **in-proc loop** ✅ (`orchestrator.ts`) | LangGraph.js → Temporal (durable) |
| Resilience | **DARS** ✅ (`src/dars/`, in-mem health) | + Redis shared health-store ข้าม instance |
| Cache/Queue | — | **Redis + BullMQ** |
| Sandbox | multi-lang syntax/compile ✅ | **E2B → Firecracker/gVisor** (execute จริง) |
| CLI | tsx + ANSI ✅ (8 verbs) | **Ink** (TUI) + verbs ที่เหลือ |
| Web | static terminal ✅ + **Next.js 14 (`nexora-web/`)** ✅ | — |
| Observability | structured logger + /v1/metrics ✅ | OpenTelemetry + Langfuse (trace cost/runs) |

> หลักการ: **ไม่ rewrite** — ทุกอย่างที่มีต่อยอดได้ (OpenAI-compatible client, role-config, blackboard, SSE) ออกแบบมาให้เสียบของใหม่ได้

---

## 14. Project Folder Structure

### 14.1 ปัจจุบัน (✅ — ไม่รื้อ)
```
tmap-v2/
├── src/
│   ├── config.ts            ✅ providers + role mapping + credential resolve
│   ├── types.ts             ✅ Blackboard + contracts
│   ├── cli.ts               🟡 doctor/agents/context/sessions/gencode/titan/review/fix
│   ├── core/
│   │   ├── orchestrator.ts  ✅ TMAP loop (+ architect/impact/documenter/voting stages)
│   │   ├── agents.ts        ✅ planner/coder/reviewer
│   │   ├── validator.ts     ✅ multi-lang syntax/compile (JS/TS/Py/Go/Rust/JSON)
│   │   ├── blackboard.ts    ✅ working memory + persist
│   │   ├── memory.ts        ✅ §6 persistent project memory (Supabase memories)
│   │   ├── context.ts       ✅ flat project context (v1)
│   │   ├── context-engine.ts✅ §7 tree + dep graph + relevant-file selection
│   │   ├── retrieval.ts     ✅ TF/lexical ranking (no LLM)
│   │   ├── impact.ts        ✅ reverse-deps impact analysis
│   │   ├── architect.ts     ✅ design + new/modify decision
│   │   ├── documenter.ts    ✅ auto README
│   │   ├── vote.ts          ✅ §5 consensus voting (pro mode)
│   │   ├── titan.ts         ✅ Titan architect workflow
│   │   ├── raa.ts           ✅ planning chat
│   │   ├── debugger.ts      ✅ debug surface
│   │   ├── analyze.ts       ✅ feasibility analyzer
│   │   ├── chief-agent.ts   ✅ universal orchestrator
│   │   ├── classifier.ts · prompt-engineer.ts · model-router.ts · review-gate.ts  ✅ (chief)
│   │   └── research-agent.ts · writing-agent.ts · math-agent.ts · vision-agent.ts ✅ (specialized)
│   ├── dars/                ✅ §4  health.ts · classify.ts · select.ts · run.ts
│   ├── providers/client.ts  ✅ OpenAI-compatible chat()
│   └── server/
│       ├── index.ts         ✅ Express API + SSE (11+ endpoints)
│       ├── auth.ts ✅  crypto.ts ✅  rateLimit.ts ✅  logger.ts ✅
│       ├── db.ts            ✅ 5 tables (Supabase + file fallback)
│       └── public/index.html✅ terminal UI
├── api/index.ts             ✅ Vercel entry
├── supabase/migration.sql   ✅ users + memories + tmap_sessions/agent_logs/costs
└── vercel.json ✅  package.json ✅
```

### 14.2 ส่วนที่เพิ่ม (🔴 — วางใน `src/` หรือยก monorepo ภายหลัง)
```
src/
├── core/sandbox/            🔴 §7.3 e2b.ts — isolated execution (รัน test จริง แทน syntax check)
├── memory/rag.ts            🔴 §6  AST chunk → embed → pgvector hybrid retrieval (เสริม memory.ts เดิม)
├── consensus/arbiter.ts     🔴 §5  validation-first selection + Arbiter (ตอนนี้ vote.ts เป็น LLM-as-judge)
└── server/routes/           🔴 projects.ts · agents.ts (mapping+health) · apply
supabase/migrations/         🔴 §8  projects, files, conversations, messages, events + ALTER memories ADD embedding
```
> **หมายเหตุ:** rev 2 วาง dars/consensus/memory/context-engine เป็นโฟลเดอร์แยก — ของจริง implement รวมไว้ใน `src/core/*` (ยกเว้น `src/dars/` ที่แยกจริง) เพื่อไม่ยก monorepo ก่อนเวลา

---

## 15. Development Roadmap

> ยึดของที่มี (✅) เป็นฐาน เพิ่มทีละชั้นโดยระบบไม่ดับ

### Phase 1 — Resilience (DARS) ⭐ — *เร่งด่วนสุด*
- [x] `src/dars/` : health store (in-mem ก่อน), classify error, `chatWithDARS` wrap รอบ `chat()` (§4.5)
- [x] เสียบ `chatWithDARS` เข้าจุดเรียก agent (`orchestrator.ts`, `chief-agent.ts`, `server/index.ts`, `cli.ts`)
- [x] เพิ่ม timeout (`AbortController`) + retry + circuit breaker
- [x] SSE emit `system: "X → switching agent"` (UI เดิมรองรับแล้ว)
- [x] **Security เร่งด่วน:** rate-limit/lockout `/v1/auth/login` (PIN entropy ต่ำ) — `server/rateLimit.ts`
- [ ] ตาราง `agent_logs` + `events` (§8) บันทึก failover ลง DB ถาวร (ตอนนี้ log ผ่าน `onLog` callback ในหน่วยความจำ/logger เท่านั้น ยังไม่มีตาราง persist)

### Phase 2 — Memory + Context (ส่วนใหญ่เสร็จแล้ว)
- [x] ตาราง memories + tmap_sessions + tmap_agent_logs + tmap_costs (Supabase + file fallback)
- [x] session metadata persist ลง DB (`tmap_sessions`) — `bb` ยัง persist JSON ด้วย
- [x] Context Engine v2: index repo (tree + dep graph) → TF retrieval → เติม `bb.context`
- [x] Validation หลายภาษา (JS/TS/Python/Go/Rust/JSON syntax/compile)
- [ ] pgvector + AST chunk → semantic RAG (ตอนนี้ retrieval เป็น lexical TF)
- [ ] ตาราง projects/files/conversations/messages (multi-project + conversation persistence)
- [ ] E2B/Firecracker sandbox execution (รัน test จริง แทน syntax check)

### Phase 3 — Consensus + CLI เต็ม (เริ่มแล้ว)
- [x] Voting (§5.2) ใน pro mode — 3 candidate ขนาน + Reviewer judge (`vote.ts`)
- [x] CLI verbs ส่วนหนึ่ง: context/sessions/titan/review/fix (เพิ่มจาก doctor/agents/gencode)
- [x] `GET /v1/health` คืน DARS health snapshot (circuit/latency)
- [ ] CLI verbs ที่เหลือ (chat/explain/build/analyze/project/memory/login) + Ink TUI + diff-apply interactive
- [ ] `GET /v1/agents` คืน role→provider mapping พร้อม health (รวม dashboard)
- [ ] validation-first selection ใน voting + Arbiter แยก (ตอนนี้เป็น LLM-as-judge)

### Phase 4 — Scale + Enterprise
- [ ] Redis (shared health-store ข้าม instance) + BullMQ + rate-limit/quota
- [ ] LangGraph → Temporal (durable), worker autoscale
- [ ] Org/RBAC, audit เต็ม, Firecracker sandbox pool, multi-region
- [ ] Observability (Langfuse) + cost guardrails ต่อ user
- [ ] Desktop (Tauri) + Windows installer

---

### ภาคผนวก ก — สรุปสิ่งที่ "sync ตรงโค้ด" ใน revision 3
> rev 2 ระบุหลาย subsystem เป็น 🔴 TODO — rev 3 อ่าน source จริงแล้วพบว่าทำเสร็จไปมาก จึงอัปสถานะ:
1. **Voting/Consensus** (§5) 🔴→✅ — `vote.ts`, pro mode, 3 candidate + LLM-as-judge
2. **Project Context Engine** (§7) 🔴→✅ — `context-engine.ts`: tree + dep graph + relevant-file selection + impact
3. **Persistent Memory** (§6) 🔴→🟡 — `memory.ts` + table `memories` (key-value ข้าม session); เหลือ pgvector RAG
4. **Multi-lang Validation** (§7.3) 🟡→✅ — JS/TS/Python/Go/Rust/JSON; เหลือ sandbox execution
5. **DB schema** (§8) 🟡→✅ — 5 ตาราง (users/memories/tmap_sessions/tmap_agent_logs/tmap_costs); เหลือ projects/files/conversations/messages/events
6. **CLI** (§10) — 3→8 verbs (เพิ่ม context/sessions/titan/review/fix)
7. **API** (§9) — 6→17 endpoints (chat/titan/debug/analyze/orchestrate/sessions/cost/memory/health/metrics/refresh)
8. **JWT** — แก้ 30d→7d + sliding refresh ให้ตรง `auth.ts`
9. **Subsystem ใหม่ที่ rev 2 ไม่มี** — Chief Agent (universal orchestrator + research/writing/math/vision agents), RAA, Debugger, Analyzer, Titan, Architect/Impact/Documenter stages, cost/metrics/logger
**Gap จริงที่เหลือ:** sandbox execution · pgvector/RAG · `events` audit table · multi-project tables · CLI verbs ที่เหลือ+TUI · Redis/Temporal สำหรับ scale ข้าม instance

### ภาคผนวก ข — สรุปสิ่งที่ "เพิ่มใหม่" ใน revision 2
1. **แก้ §2 ให้ตรงความจริง** — โค้ดเป็น MVP ทำงานจริงแล้ว (ไม่ใช่ mock) + status matrix ทุก subsystem
2. **DARS (§4)** — failure taxonomy, circuit breaker, capability-scored selection (ดีกว่า fixed-pair), `chatWithDARS` wrap รอบ `chat()` ที่มีอยู่ → เพิ่ม resilience โดยไม่รื้อ orchestrator
3. **Voting Engine (§5.2)** — validation-first, vote เฉพาะ subjective, Arbiter on-conflict
4. **Memory 6 ชั้น (§6)** — map กับ blackboard ที่มี + ตาราง/pgvector ที่ต้องเพิ่ม; Agent Memory ป้อน DARS
5. **Context Engine (§7)** + validation หลายภาษา
6. **DB 8 entity + ER (§8)**, **CLI ครบ verb (§10)**, **Security** ชี้จุดเร่งด่วน (PIN lockout, rate-limit)

**หลักการตลอดเอกสาร:** ของที่ ✅ แล้ว = ไม่แตะ · ของที่ 🔴 = มี spec ระดับ interface/SQL ให้ทีมลงมือต่อได้ทันที
