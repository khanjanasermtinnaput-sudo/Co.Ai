# AOF Code — Technical Design Document (TMAP v2)

> **Technology Multi-AI Agent Processing** — Production architecture
> Revision 2 · 2026-06-08 · *อิง source จริงใน `tmap-v2/` ไม่ใช่ prototype เดิม*
>
> หลักการของเอกสารนี้: **ของที่สร้างไปแล้ว = รักษาไว้ ไม่รื้อ · ของที่ยังขาด = ระบุ spec ให้สร้างต่อได้ทันที**
> ทุกหัวข้อมีป้ายสถานะ: ✅ DONE (มีในโค้ดแล้ว) · 🟡 PARTIAL (มีบางส่วน) · 🔴 TODO (ยังไม่มี)

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

AOF Code คือ AI Coding Assistant ที่ใช้สถาปัตยกรรม **TMAP (Technology Multi-AI Agent Processing)** — AI หลายตัว (Gemini, DeepSeek, Qwen, Llama) ทำงานร่วมกันโดยแต่ละตัวมีบทบาทเฉพาะ (Planner / Coder / Reviewer / Validator) และ **สลับหน้าที่กันได้อัตโนมัติเมื่อตัวใดตัวหนึ่งล่ม** เป้าหมายคือระบบที่ฉลาดกว่า AI ตัวเดียว และ **ไม่ดับแม้ provider บางเจ้าจะล่ม โควต้าหมด หรือ rate limit**

**สถานะปัจจุบัน (สำคัญ — เปลี่ยนจาก revision 1):** AOF Code **ไม่ใช่ mock อีกต่อไป** โค้ดใน `tmap-v2/` เป็น MVP ที่ทำงานจริงแล้ว: backend จริง (Express, deploy บน Vercel), เรียกโมเดลจริงผ่าน OpenAI-compatible client, TMAP loop จริง (Plan→Code→Validate→Review→critique), auth จริง (PIN+JWT, key เข้ารหัส), validation จริง (`node --check`) สิ่งที่ทำให้เอกสารนี้ revision 2 คือการ **อัปสถานะให้ตรงโค้ด** แล้วระบุ spec ของ subsystem ที่ยังขาด

**Gap ที่ใหญ่ที่สุด 5 อย่าง (เรียงตามความสำคัญ — DARS ย้ายไป ✅ DONE แล้ว ดู §4):**
1. **Memory 6 ชั้น** — ตอนนี้ persist แค่ session JSON
2. **Voting/Consensus Engine** — ออกแบบไว้ใน TDD แต่ยังไม่มีในโค้ด
3. **Project Context Engine** — ยังไม่อ่านทั้งโปรเจกต์/วิเคราะห์ dependency
4. **CLI ครบ verb** — มีแค่ `doctor/agents/gencode`
5. **DB ครบ schema** — มีแค่ตาราง `users`

**Tech stack ปัจจุบัน:** TypeScript (ESM) · Express · Supabase (มี `/tmp` fallback) · JWT · OpenAI-compatible provider client · Vercel serverless · tsx runtime
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
| Grounded validation | 🟡 PARTIAL | `core/validator.ts` | มีจริงแต่เฉพาะ JS syntax (`node --check`); ภาษาอื่น = skipped |
| Auth (username+PIN, JWT) | ✅ DONE | `server/auth.ts`, `server/index.ts` | PIN 4-8 หลัก hash, JWT 30 วัน |
| Per-account encrypted keys | ✅ DONE | `server/crypto.ts`, `server/db.ts` | 5 provider ต่อ user, เก็บเข้ารหัส |
| DB (Supabase + file fallback) | 🟡 PARTIAL | `server/db.ts` | มีแค่ตาราง `users`; ตารางอื่นยังไม่มี |
| SSE streaming `/v1/run` | ✅ DONE | `server/index.ts` | stream `{role,text,kind}` + done event |
| Static fallback (mock no-key) | ✅ DONE | `providers/client.ts` `mockReply` | รันได้แม้ไม่มี key |
| CLI | 🟡 PARTIAL | `src/cli.ts` | มี `doctor/agents/gencode` เท่านั้น |
| **DARS (runtime failover)** | ✅ DONE | `src/dars/{health,classify,select,run}.ts` | health store + circuit breaker, error taxonomy, capability-scored selection, `chatWithDARS` wrap; เสียบเข้า `orchestrator.ts`, `chief-agent.ts`, `server/index.ts` (chat/debug/analyze/titan/run/orchestrate), `cli.ts`; health snapshot ที่ `GET /v1/health` |
| **Voting / Consensus / Arbiter** | 🔴 TODO | — | orchestrator ไม่มี voting |
| **Memory (6 ชั้น)** | 🔴 TODO | — | persist แค่ session JSON |
| **Project Context Engine** | 🔴 TODO | — | ไม่อ่านทั้ง repo / dependency |
| **Agent Logs / Events / Tasks tables** | 🔴 TODO | — | ดู §8 |

### 2.2 ข้อดีของโค้ดปัจจุบัน (รักษาไว้)
- **Role decoupled จาก Model แล้วจริง** (`ROLE_PROVIDER` + `resolveRoleWith`) — เป็นรากฐานที่ทำให้ DARS เพิ่มได้ง่าย ไม่ต้องรื้อ
- **OpenAI-compatible client เดียว** — เพิ่ม provider ใหม่ = เพิ่ม entry ใน `PROVIDERS` เท่านั้น
- **Blackboard เป็น typed object** — เพิ่ม field memory/votes ได้โดยไม่ break
- **Credential injection per-request** (`resolveAllWith(creds)`) — key มาจาก account ของ user ไม่ใช่ env เดียวรวม → multi-tenant-ready

### 2.3 ข้อจำกัดเชิงสถาปัตยกรรมที่ต้องแก้
1. **ไม่มี runtime resilience** — ถ้า `chat()` throw (429/timeout/down) ระหว่าง loop, ทั้ง `/v1/run` พังทันที (ดู `orchestrator.ts` ไม่มี try/retry รอบ agent call) → **นี่คือเหตุผลหลักที่ต้องมี DARS**
2. **Validation ตื้น** — เช็คแค่ syntax JS ไฟล์เดี่ยว ไม่ compile/test/ข้ามไฟล์
3. **Memory หาย** — session JSON เขียนลง `.aof/` (บน Vercel = `/tmp` ephemeral) ไม่มี semantic retrieval
4. **ไม่มี project context** — agent ไม่เห็นโค้ดเดิมของผู้ใช้ สร้างไฟล์ใหม่ลอย ๆ
5. **Sequential ภายใน loop** — Coder ผลิตทุกไฟล์ก้อนเดียว ไม่มี parallel / ไม่มี voting เมื่อความเห็นต่าง

---

## 3. Production-Ready TMAP Architecture

### 3.1 หลักการ (ยึดของเดิม + เพิ่ม resilience layer)
```
TMAP v2 = Orchestrator + Blackboard + Typed Agents (มีแล้ว ✅)
        + DARS resilience layer        (เพิ่ม 🔴 — §4)
        + Voting/Consensus Engine      (เพิ่ม 🔴 — §5)
        + 6-layer Memory + RAG         (เพิ่ม 🔴 — §6)
        + Project Context Engine        (เพิ่ม 🔴 — §7)
        + Grounded multi-lang Validation (ขยาย 🟡 — §7.3)
```

### 3.2 Component Diagram (ปัจจุบัน + ส่วนเพิ่ม)
```
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENTS:  Web terminal (public/index.html ✅) · CLI (🟡) · Desktop(🔴) │
└───────────────┬──────────────────────────────────────────────────────┘
                │  HTTPS · SSE (/v1/run ✅)
┌───────────────▼──────────────────────────────────────────────────────┐
│ API GATEWAY (Express ✅)  Auth/JWT ✅ · per-user keys ✅ · RateLimit 🔴 │
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
│  │ CONSENSUS  │   │  LAYER (🔴 §4)     │─►│ MODEL ROUTER      │         │
│  │  (🔴 §5)   │   │  health · retry ·  │  │ resolveRoleWith ✅ │         │
│  └────────────┘   │  failover · log    │  └────────┬─────────┘         │
│                   └────────────────────┘           │                   │
│  ┌──────────────┐ ┌───────────────┐  ┌─────────────▼──────────┐       │
│  │ CONTEXT      │ │ MEMORY (6層)   │  │ Gemini DeepSeek Qwen    │       │
│  │ ENGINE (🔴§7)│ │ (🔴 §6)        │  │ Llama  (+OpenRouter ✅)  │       │
│  └──────────────┘ └───────────────┘  └────────────────────────┘       │
│  ┌──────────────────────────────────────────────────────────┐         │
│  │ VALIDATION SANDBOX  node --check ✅  → E2B/Firecracker 🔴   │         │
│  └──────────────────────────────────────────────────────────┘         │
└───────────────┬───────────────────────┬──────────────────────────────┘
        ┌───────▼──────┐        ┌────────▼─────────┐    ┌───────────────┐
        │ Supabase ✅   │        │ pgvector/Qdrant🔴 │    │ Redis 🔴       │
        │ (users)       │        │ (memory)          │    │ (queue/health)│
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

### 5.1 Flow ปัจจุบัน (✅ มีจริงใน orchestrator.ts)
```
/v1/run {task,mode}
  → createBlackboard ✅
  → Planner (chat) ✅           → bb.plan / bb.planText
  → loop (maxIter ตาม mode) ✅:
      → Coder (chat, +critique) ✅   → bb.files
      → Validator (node --check) ✅  → bb.validations
      → Reviewer (chat) ✅           → bb.review (HIGH/MED/LOW)
      → ถ้า validation fail || HIGL issue && iter<max → buildCritique → วนต่อ ✅
  → persist(bb) ✅ → SSE done {files, iterations} ✅
```

### 5.2 ส่วนเพิ่ม: Parallel + Voting (🔴 TODO)
จุดที่ควรเพิ่ม voting คือ **เฉพาะเมื่อผลตรวจสอบไม่ได้ด้วยเครื่อง** (design choice, API shape) — ไม่ใช่ทุก step (คุมต้นทุน):

```
PLAN ─► [complexity router]
         ├─ lite/normal: single Coder (เหมือนเดิม ✅)
         └─ pro + ambiguous: N-Coder ขนาน (diversity) ─► VOTING ENGINE
                                                          │
            ┌─────────────────────────────────────────────┘
            ▼
  VOTING ENGINE:
    1) Validator รันทุก candidate ใน sandbox → คัดเฉพาะตัวที่ "ผ่านจริง"
    2) ถ้าผ่านหลายตัว → weighted vote (confidence × role-weight × validation-score)
    3) ถ้าเสมอ/ขัดแย้ง verify ไม่ได้ → Arbiter (โมเดลแรงสุดที่ healthy) ชี้ขาด
    4) บันทึก votes + decision (§8 tables)
```
```ts
// packages/core/consensus/vote.ts (🔴 NEW)
interface Vote { voter: Role; choice: string; weight: number; rationale: string; validationPass: boolean; }
interface Decision { topic: string; outcome: string; method: 'validation'|'weighted_vote'|'arbiter'; }
function tally(votes: Vote[]): Decision   // validation ชนะก่อนเสมอ → แล้วค่อย weight
```
> **กฎทอง:** ถ้า validate ด้วยเครื่องได้ ใช้ผล execution ตัดสิน (objective) — Voting/Arbiter ใช้เฉพาะกรณี subjective เท่านั้น

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
| 1 | **Conversation Memory** | ต่อ session/chat | 🟡 (มี log) | `messages` table + Redis (recent), summary rollup |
| 2 | **Project Memory** | ต่อ project | 🔴 | pgvector: code chunks (AST), decisions, conventions |
| 3 | **File Memory** | ต่อไฟล์ | 🔴 | `files` table: hash, สรุป, symbols, ประวัติแก้ |
| 4 | **User Preference Memory** | ต่อ user | 🔴 | `memories(scope=user)`: style, ภาษา, framework ที่ชอบ |
| 5 | **Long-Term Memory** | ข้าม project | 🔴 | embeddings: บทเรียน/patterns ที่ใช้ซ้ำได้ |
| 6 | **Agent Memory** | ต่อ agent/provider | 🔴 | health stats, success/role, ใช้ feed DARS §4.4 |

### 6.1 Working Memory = Blackboard (✅ มีแล้ว)
`createBlackboard/logEvent/persist` ใน `core/blackboard.ts` คือ working memory ระดับ session — **เก็บไว้** แค่ย้าย `persist()` จากไฟล์ `.aof/` ไป DB/Redis (เพราะ Vercel `/tmp` หาย)

### 6.2–6.6 ที่ต้องเพิ่ม
- **Project/File Memory:** ตอน `aof init`/index repo → chunk ตาม AST (function/class) → embed → เก็บ pgvector พร้อม `source_path`, `symbols`, `hash` (incremental ตาม git diff)
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

> **สถานะ: 🔴 TODO** — ตอนนี้ agent ไม่เห็นโค้ดเดิม

### 7.1 ความสามารถ
- อ่านทั้งโปรเจกต์ (เคารพ `.gitignore`, จำกัด workspace root)
- AST parse (tree-sitter / TS compiler API) → symbols, imports
- **Dependency graph** (ไฟล์ไหน import ไฟล์ไหน) → ใช้หา "ไฟล์ที่เกี่ยว" กับ task
- **Impact analysis** — แก้ไฟล์ A กระทบไฟล์ไหนบ้าง (reverse-deps)
- ป้อน context ที่เกี่ยว (ไม่ใช่ทั้ง repo) เข้า `bb.context` ตาม token budget

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
`validateFiles()` ปัจจุบันเช็คแค่ JS syntax. แผนขยาย (เก็บ interface เดิม `ValidationResult`):
| ภาษา | MVP (ตอนนี้) | Production |
|---|---|---|
| JS/TS | `node --check` ✅ | `tsc --noEmit` + eslint + vitest ใน sandbox |
| Python | skipped | `py_compile` + ruff + pytest |
| อื่น ๆ | skipped | รันใน **E2B/Firecracker** (no-egress, จำกัด cpu/mem/time) |

---

## 8. Database Design (8 entities + ER)

> ปัจจุบันมีแค่ `users` ✅ (Supabase). เพิ่มอีก 7 entity ตาม requirement

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
-- ✅ มีแล้ว (db.ts): users
users(id PK, username UNIQUE, pin_hash, encrypted_keys JSONB, created_at)

-- 🔴 เพิ่ม
projects(id PK, user_id FK, name, repo_url, default_branch, settings JSONB, created_at)
files(id PK, project_id FK, path, lang, hash, symbols JSONB, summary,
      version INT, updated_at)                              -- File Memory §6.3
conversations(id PK, user_id FK, project_id FK NULL, title, created_at)
messages(id PK, conversation_id FK, role, content, created_at) -- Conversation Memory §6.1
memories(id PK, user_id FK, project_id FK NULL, scope, kind,    -- §6.2/6.4/6.5
         content, embedding VECTOR(1024), metadata JSONB, updated_at)
tasks(id PK, user_id FK, project_id FK NULL, mode, status,       -- = a /v1/run
      task_text, iterations INT, cost_usd, created_at, finished_at)
agent_logs(id PK, task_id FK, role, provider, model, event,      -- §4.7 DARS + billing
           tokens_in, tokens_out, latency_ms, cost_usd,
           failover_from, failure_kind, created_at)
events(id PK, user_id FK, type, target, meta JSONB, created_at)  -- audit + dars_switch + usage
CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops);
```
**เหตุผลออกแบบ:** `tasks` = หน่วยงานหลัก (1 ครั้งของ `/v1/run`) ผูกกับ blackboard; `agent_logs` ละเอียดระดับ "แต่ละ agent call" จึงรองรับทั้ง DARS analytics + billing; `events` แยกจาก agent_logs เพราะเป็น cross-cutting (audit/security/usage) `memories` ตารางเดียวคุม 4 ชั้น memory ด้วย `scope`

---

## 9. API Design

### 9.1 ที่มีแล้ว ✅ (`server/index.ts`)
```
POST /v1/auth/register     {username, pin}      → {token, username}   ✅
POST /v1/auth/login        {username, pin}      → {token, username}   ✅
GET  /v1/me                (Bearer)             → {username, keys(masked)} ✅
PUT  /v1/me/keys           {provider, key}      → {ok, masked}        ✅
DEL  /v1/me/keys/:provider                      → {ok}                ✅
POST /v1/run               {task, mode}  (SSE)  → {role,text,kind}.. done{files,iterations} ✅
```
**SSE event ที่ DARS เพิ่ม (backward-compatible):** ใช้ `role:'system'` ที่มีอยู่แล้ว → client เดิม render ได้ทันที
```json
{"role":"system","kind":"status","text":"Gemini rate-limited → switching to Qwen"}
```

### 9.2 ที่ต้องเพิ่ม 🔴
```
# Projects / Context
POST /v1/projects                {name, repoUrl?}          → project
POST /v1/projects/:id/index      → 202 {jobId}  (Context Engine §7)
GET  /v1/projects/:id/memory?q=  → relevant chunks (RAG)

# Tasks / history
GET  /v1/tasks?projectId=        → task history
GET  /v1/tasks/:id               → blackboard snapshot + agent_logs
POST /v1/tasks/:id/apply         → เขียน artifacts ลง fs (CLI/desktop)

# Agents / DARS
GET  /v1/agents                  → role→provider + health (circuit/latency) §4.3
PUT  /v1/agents/mapping          → override ROLE_PROVIDER ต่อ user/project

# Conversation (chat verb)
POST /v1/chat                    {conversationId?, message} (SSE)
```

---

## 10. CLI Design (ครบทุก verb)

> ปัจจุบัน 🟡: `doctor`, `agents`, `gencode/run` (+`--apply`) ใน `src/cli.ts` ✅
> เป้าหมาย: ครบ verbs ตาม requirement + UX ใกล้ Claude Code (Ink TUI)

### 10.1 Verb mapping
| Verb | ทำอะไร | สถานะ | เบื้องหลัง |
|---|---|---|---|
| `aof chat` | สนทนา/ถาม-ตอบ โหมด REPL | 🔴 | `/v1/chat` SSE |
| `aof code "<task>"` | สร้าง/แก้โค้ด (= gencode) | ✅ | `runTMAP` |
| `aof fix "<bug>"` | แก้ bug จาก error/test | 🔴 | TMAP + context ของไฟล์ที่ fail |
| `aof review [path]` | review โค้ดที่มีอยู่ | 🔴 | Reviewer agent + Context Engine |
| `aof explain <path>` | อธิบายโค้ด | 🔴 | single-agent + context |
| `aof build` | gen + validate + apply ครบ | 🔴 | TMAP `--apply` + sandbox |
| `aof analyze` | วิเคราะห์โปรเจกต์/dependency | 🔴 | Context Engine §7 |
| `aof project` | init/index/สลับ project | 🔴 | `/v1/projects` |
| `aof memory` | ดู/ค้น/ล้าง memory | 🔴 | `/v1/projects/:id/memory` |
| `aof agents` | role→model + **health (DARS)** | 🟡 | `resolveAll` ✅ + health §4.3 |
| `aof doctor` | เช็ค key/agent resolve | ✅ | `config.ts` |
| `aof login` | username+PIN → เก็บ token | 🔴 | `/v1/auth/login` |

### 10.2 UX ระดับ Claude Code (🔴)
- **Ink TUI** streaming agent status (busy/done/error) + **DARS switch แสดง realtime**
- **Diff review ในเทอร์มินัล** + `apply? (y/n/edit)` ก่อนเขียน fs จริง (มี `--apply` แล้วใน `code` ✅ — เพิ่ม interactive)
- `.aof/` ต่อ project (config + memory cache + conventions เทียบ `CLAUDE.md`)
- Windows-first: PowerShell, path Windows, แพ็กเป็น binary (`node --sea`) ติดตั้งผ่าน `npm i -g @aof/code` (มี `bin: aof` ใน package.json แล้ว ✅)

---

## 11. Security Design

| ภัย | สถานะ | มาตรการ |
|---|---|---|
| **API key leak** | ✅ ดี | key อยู่ server, เก็บ **encrypted** (`crypto.ts`), `/v1/me` คืนเฉพาะ masked. ห้ามส่ง raw key ออก client เด็ดขาด |
| **Auth อ่อน** | ✅ | PIN hash (`hashPassword`) + JWT 30d + refresh (`/v1/auth/refresh`). Login rate-limit/lockout มีแล้ว (`server/rateLimit.ts`: 5 ครั้งผิด/15 นาที → lock 15 นาที) |
| **Rate-limit / abuse** | 🟡 | login lockout มีแล้ว ✅ (`rateLimit.ts`); ยังไม่มี per-user token-bucket ทั่วระบบ/quota เชิงต้นทุน → เพิ่ม Redis token-bucket + ผูก `tasks.cost_usd` ตอน scale |
| **Prompt injection** (จากไฟล์/RAG) | 🔴 | แยก system vs untrusted content, fencing, tool allowlist, ตัด instruction จากไฟล์ผู้ใช้ |
| **รันโค้ดอันตราย** (validation) | 🟡 | ตอนนี้ `node --check` ไม่ execute (ปลอดภัยพอใน MVP). ตอน execute จริง → **E2B/Firecracker no-egress**, จำกัด cpu/mem/time, fs เฉพาะ workspace |
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
| Auth | **JWT + PIN hash** ✅ | + refresh rotate + lockout |
| Provider | **OpenAI-compatible client** ✅ (`client.ts`) | คงเดิม — เพิ่ม provider = เพิ่ม entry |
| Orchestration | **in-proc loop** ✅ (`orchestrator.ts`) | LangGraph.js → Temporal (durable) |
| Resilience | — | **DARS** §4 + Redis health-store |
| Cache/Queue | — | **Redis + BullMQ** |
| Sandbox | `node --check` ✅ | **E2B → Firecracker/gVisor** |
| CLI | tsx + ANSI ✅ | **Ink** (TUI) |
| Web | static terminal ✅ | แตกเป็น Next.js components (ภายหลัง) |
| Observability | — | OpenTelemetry + Langfuse (trace agent runs/cost) |

> หลักการ: **ไม่ rewrite** — ทุกอย่างที่มีต่อยอดได้ (OpenAI-compatible client, role-config, blackboard, SSE) ออกแบบมาให้เสียบของใหม่ได้

---

## 14. Project Folder Structure

### 14.1 ปัจจุบัน (✅ — ไม่รื้อ)
```
tmap-v2/
├── src/
│   ├── config.ts            ✅ providers + role mapping + credential resolve
│   ├── types.ts             ✅ Blackboard + contracts
│   ├── cli.ts               🟡 doctor/agents/gencode
│   ├── core/
│   │   ├── orchestrator.ts  ✅ TMAP loop
│   │   ├── agents.ts        ✅ planner/coder/reviewer
│   │   ├── validator.ts     🟡 node --check
│   │   └── blackboard.ts    ✅ working memory + persist
│   ├── providers/client.ts  ✅ OpenAI-compatible chat()
│   └── server/
│       ├── index.ts         ✅ Express API + SSE
│       ├── auth.ts ✅  crypto.ts ✅  db.ts 🟡(users only)
│       └── public/index.html✅ terminal UI
├── api/index.ts             ✅ Vercel entry
├── supabase/                ✅ migration (users)
└── vercel.json ✅  package.json ✅
```

### 14.2 ส่วนที่เพิ่ม (🔴 — วางใน `src/` หรือยก monorepo ภายหลัง)
```
src/
├── dars/                    🔴 §4  health.ts · select.ts · run.ts · classify.ts
├── consensus/               🔴 §5  vote.ts · arbiter.ts
├── memory/                  🔴 §6  conversation.ts · project.ts · file.ts · prefs.ts · longterm.ts · agent.ts · rag.ts
├── context-engine/          🔴 §7  index.ts · ast.ts · deps.ts · retrieve.ts
├── core/sandbox/            🔴 §7.3 e2b.ts (multi-lang validate)
└── server/                  🔴 routes: projects.ts · tasks.ts · agents.ts · chat.ts
supabase/migrations/         🔴 §8  projects, files, conversations, messages, memories, tasks, agent_logs, events
```

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

### Phase 2 — Memory + Context
- [ ] ตาราง projects/files/conversations/messages/memories (+pgvector)
- [ ] ย้าย `persist()` จาก `/tmp` → DB (tasks table)
- [ ] Context Engine: index repo (AST chunk) → RAG → เติม `bb.context`
- [ ] Validation หลายภาษา (E2B sandbox) แทน node --check เดี่ยว

### Phase 3 — Consensus + CLI เต็ม
- [ ] Voting/Arbiter (§5.2) เฉพาะ pro + ambiguous
- [ ] CLI verbs ครบ (chat/fix/review/explain/build/analyze/project/memory/login) + Ink TUI + diff-apply interactive
- [ ] `GET /v1/agents` คืน health (DARS dashboard)

### Phase 4 — Scale + Enterprise
- [ ] Redis (shared health-store ข้าม instance) + BullMQ + rate-limit/quota
- [ ] LangGraph → Temporal (durable), worker autoscale
- [ ] Org/RBAC, audit เต็ม, Firecracker sandbox pool, multi-region
- [ ] Observability (Langfuse) + cost guardrails ต่อ user
- [ ] Desktop (Tauri) + Windows installer

---

### ภาคผนวก — สรุปสิ่งที่ "เพิ่มใหม่" ใน revision 2
1. **แก้ §2 ให้ตรงความจริง** — โค้ดเป็น MVP ทำงานจริงแล้ว (ไม่ใช่ mock) + status matrix ทุก subsystem
2. **DARS (§4)** — failure taxonomy, circuit breaker, capability-scored selection (ดีกว่า fixed-pair), `chatWithDARS` wrap รอบ `chat()` ที่มีอยู่ → เพิ่ม resilience โดยไม่รื้อ orchestrator
3. **Voting Engine (§5.2)** — validation-first, vote เฉพาะ subjective, Arbiter on-conflict
4. **Memory 6 ชั้น (§6)** — map กับ blackboard ที่มี + ตาราง/pgvector ที่ต้องเพิ่ม; Agent Memory ป้อน DARS
5. **Context Engine (§7)** + validation หลายภาษา
6. **DB 8 entity + ER (§8)**, **CLI ครบ verb (§10)**, **Security** ชี้จุดเร่งด่วน (PIN lockout, rate-limit)

**หลักการตลอดเอกสาร:** ของที่ ✅ แล้ว = ไม่แตะ · ของที่ 🔴 = มี spec ระดับ interface/SQL ให้ทีมลงมือต่อได้ทันที
