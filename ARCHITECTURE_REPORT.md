# Coagentix (Co.Ai) — Architecture Report

> **Scope:** system understanding only. No code was modified to produce this document.
> **Basis:** direct reading of source (`tmap-v2/src/**`, `aof-web/src/**`), not README/marketing.
> **As-of:** 2026-06-22, branch `claude/v1-to-v2-migration-phase0-2` (PR #26). Reflects the live v1 engine **and** the now-wired-but-default-off v2 engine.

---

## 0. TL;DR

Coagentix is a two-tier product: a **Next.js frontend** (`aof-web`, on Vercel) and an **Express multi-agent backend** (`tmap-v2`, on Render), sharing a **Supabase** Postgres for auth, per-user encrypted provider keys, sessions, and memory. All model calls are **BYOK** (bring-your-own-key) and routed through **DARS**, a resilience layer with a circuit breaker and capability-scored failover across 5 OpenAI-compatible providers (OpenRouter, Gemini, DeepSeek, Qwen, Llama).

There are **three backend execution engines** behind separate routes:

| Engine | Route | Selector | Status |
|---|---|---|---|
| **v1 TMAP** (code build) | `POST /v1/run` | `runTMAP` — linear Plan→Code→Validate→Review→Critique | **LIVE (default)** |
| **v1 Chief** (universal chat) | `POST /v1/orchestrate` | `runChiefAgent` — keyword classify → static agent map | **LIVE (default)** |
| **v2** (score-based RAA + DAG) | `POST /v2/run` | `runV2` — cosine scoring + DAG executor | **WIRED, default-off** (flags `COAGENTIX_V2` + `NEXT_PUBLIC_COAGENTIX_V2`) |

---

## 1. Current Architecture

### 1.1 Component diagram

```mermaid
graph TB
  subgraph Client["Browser / CLI"]
    UI["aof-web UI (Next.js 14, Zustand chat-store)"]
    CLI["coagentix-cli (JWT)"]
  end

  subgraph Vercel["Vercel — aof-web"]
    API["src/lib/api.ts (SSE client, isLive/isV2Enabled)"]
    NextAPI["Next API routes /api/* (chat, health, keys, cli, admin, search)"]
    Rewrite["next.config.mjs edge rewrite /v1/* and /v2/* -> backend"]
  end

  subgraph Render["Render — tmap-v2 (Express)"]
    MW["middleware: security headers, CORS, rate-limit, bot-protection, correlation, auth"]
    Routes["routes: /v1/run /v1/orchestrate /v1/chat /v1/titan /v1/debug /v1/analyze /v2/run + admin/platform"]
    subgraph Engines
      V1T["v1 TMAP runTMAP (core/orchestrator.ts)"]
      V1C["v1 Chief runChiefAgent (core/chief-agent.ts)"]
      V2["v2 runV2 (v2/run.ts)"]
    end
    DARS["DARS chatWithDARS (dars/*) — failover + circuit breaker"]
    Mem["Memory (core/memory.ts, v2/memory-v2.ts)"]
    Trace["Trace/Logs (v2/trace.ts, server/logger.ts, routing-metrics)"]
  end

  subgraph External["External"]
    SB[("Supabase Postgres — users, provider_keys, sessions, memories, execution_traces")]
    P1["OpenRouter"]; P2["Gemini"]; P3["DeepSeek"]; P4["Qwen"]; P5["Llama/Groq"]
    Redis[("Redis (optional) — rate-limit, queue, cluster health")]
  end

  UI --> API --> Rewrite --> MW
  CLI --> MW
  API -. fallback when no backend .-> NextAPI
  MW --> Routes --> Engines
  Engines --> DARS --> P1 & P2 & P3 & P4 & P5
  Engines --> Mem --> SB
  Engines --> Trace --> SB
  MW --> SB
  NextAPI --> SB
  MW -. optional .-> Redis
```

### 1.2 Key facts (from source)
- **Auth bridge** (`server/auth.ts`): accepts a native tmap-v2 **JWT** (username/PIN + CLI) OR a **Supabase access token** (Google sign-in). Supabase users get a synthesized record whose provider keys load from the shared `provider_keys` table.
- **Secrets at rest** (`server/crypto.ts`): provider keys encrypted with **AES-256-GCM**, key derived via **scrypt** from `COAGENTIX_MASTER_KEY`. Versioned blobs (`coagentix2:` / legacy `aof2:` / pre-KDF) keep old ciphertexts decryptable.
- **Providers** (`config.ts`): 5 vendors, all called via one OpenAI-compatible client (`providers/client.ts`). Fail-closed when no key (no fabricated output in prod; mock only when `mockAllowed()`).
- **Frontend degradation** (`api.ts`): when no backend is configured (`isLive()===false`), chat/build fall back to a single-pass `/api/chat` (no multi-agent pipeline).

---

## 2. Runtime Execution

### 2.1 Build request (live default: `/v1/run` → `runTMAP`)

```mermaid
sequenceDiagram
  participant U as UI (chat-store)
  participant API as api.ts (streamCodeRun)
  participant BE as Express /v1/run
  participant TMAP as runTMAP
  participant DARS as chatWithDARS
  participant P as Provider
  participant DB as Supabase

  U->>API: build task (mode lite/normal/pro)
  API->>BE: POST /v1/run (SSE) + Supabase bearer
  BE->>BE: requireAuth, decrypt provider keys
  BE->>TMAP: runTMAP(blackboard)
  TMAP->>DB: loadMemory(userId) -> inject context
  opt smart mode (normal/pro)
    TMAP->>DARS: Architect -> Impact -> (UI guidance)
  end
  TMAP->>DARS: Planner
  loop iterations (0..maxIter)
    TMAP->>DARS: Coder (pro: 3x vote + judge)
    TMAP->>TMAP: validate + hallucination + verifier (static)
    TMAP->>DARS: Reviewer
    alt blocking issues and iter < max
      TMAP->>DARS: Reflection -> build critique -> loop
    else
      Note over TMAP: break
    end
  end
  opt smart
    TMAP->>DARS: Documenter (README)
  end
  DARS->>P: chat() (failover on error)
  TMAP->>DB: persist session + cost + record memory
  BE-->>API: SSE stream (status/output/done)
  API-->>U: tokens + final files
```

### 2.2 Chat request (live default: `/v1/orchestrate` → `runChiefAgent`)

```mermaid
sequenceDiagram
  participant U as UI
  participant API as api.ts (streamOrchestrate)
  participant BE as Express /v1/orchestrate
  participant CH as runChiefAgent
  participant CL as classifier (regex)
  participant SP as Specialists
  participant DARS as chatWithDARS

  U->>API: message + history
  API->>BE: POST /v1/orchestrate (SSE)
  BE->>CH: runChiefAgent(message)
  CH->>CL: classifyTask (KEYWORD regex -> categories)
  CH->>CH: routeToRole + selectAgents (STATIC category->agent map)
  alt short msg & no specialist
    CH->>DARS: single direct answer (fast path)
  else
    CH->>DARS: expand prompt -> plan (JSON)
    par independent agents
      CH->>SP: research / math / vision / coding (via DARS)
    end
    CH->>SP: writing (after research)
    CH->>DARS: synthesize -> quality-review loop (>=90 to pass)
  end
  BE-->>API: SSE (status/output/done: agentsUsed, qualityScore, categories)
```

### 2.3 v2 request (opt-in: `/v2/run` → `runV2`)

```mermaid
sequenceDiagram
  participant U as UI (flag on)
  participant API as api.ts (streamV2 / streamOrchestrateV2)
  participant BE as Express /v2/run (gated COAGENTIX_V2=1)
  participant RAA as raaPlan
  participant ORC as decideExecution
  participant EX as executeGraph
  participant DARS as chatWithDARS

  U->>API: task
  API->>BE: POST /v2/run (SSE)
  BE->>RAA: parseIntent -> decompose -> rank ALL agents (cosine + health)
  RAA-->>BE: ExecutionPlan (DAG + confidence)
  BE->>ORC: pick mode fast/balanced/deep + parallelism + weights
  BE->>EX: executeGraph (topo order, bounded parallel)
  loop per ready node
    EX->>DARS: run node as scored agent (specialist dispatch for research/writing/math/vision)
    alt node fails
      EX->>EX: retry -> fallback agent -> replan (bounded)
    end
  end
  EX-->>BE: sink outputs + ExecutionTrace
  BE->>BE: persist trace (Supabase / JSONL)
  BE-->>API: SSE (status/plan/event/done: output, mode, confidence, trace)
```

---

## 3. API Flow

```mermaid
graph LR
  subgraph FE["aof-web client (api.ts)"]
    f1["streamChat"]; f2["streamCodeRun / streamCodeRunV2"]; f3["streamOrchestrate / streamOrchestrateV2"]
    f4["streamRequirements"]; f5["streamAnalyze / streamDebug"]; f6["fetchHealth"]
  end

  subgraph Edge["isLive()? + isV2Enabled()?"]
    g{"backend configured?"}
  end

  subgraph BE["tmap-v2 routes (requireAuth)"]
    r1["/v1/chat"]; r2["/v1/run"]; r2b["/v2/run (gated)"]
    r3["/v1/orchestrate"]; r4["/v1/titan"]; r5["/v1/debug"]; r6["/v1/analyze"]
    r7["/v1/me, /v1/me/keys, /v1/sessions, /v1/memory"]
    r8["/v1/cli/*, /v1/health, /v1/metrics"]
    r9["admin/platform: backup, restore, dr, failover, analytics, teams, orgs, webhooks"]
  end

  subgraph NX["Next /api/* (no backend / serverless)"]
    n1["/api/chat (single-pass)"]; n2["/api/health"]; n3["/api/keys (Supabase)"]; n4["/api/cli/*"]; n5["/api/admin/* (Supabase)"]; n6["/api/search (Tavily/Google/GitHub/Wiki)"]
  end

  f1 & f2 & f3 & f4 & f5 --> g
  g -- yes --> r1 & r2 & r2b & r3 & r4 & r5 & r6
  g -- no --> n1
  f6 --> n2
  FE -. direct .-> n3 & n4 & n5 & n6

  classDef gated fill:#fde,stroke:#a36;
  class r2b gated;
```

**Auth on every `/v1/*` and `/v2/*` call:** `requireAuth` tries native JWT, then `verifySupabaseToken`. Admin/platform routes additionally require `requireAdmin` (allowlist `COAGENTIX_ADMIN_USERNAMES`, secure-by-default empty).

---

## 4. Agent Communication

```mermaid
graph TB
  subgraph V1build["v1 TMAP (sequential blackboard)"]
    A1["Architect"] --> I1["Impact"] --> Pl1["Planner"] --> Co1["Coder (pro: 3x vote)"]
    Co1 --> Va1["Validator (static)"] --> Re1["Reviewer"] --> Rf1["Reflection"]
    Rf1 -. critique loop .-> Co1
    Re1 --> Do1["Documenter"]
  end

  subgraph V1chat["v1 Chief (delegation + synthesis)"]
    Ch["Chief"] --> Rs["Research"]
    Ch --> Mt["Math"]
    Ch --> Vs["Vision"]
    Ch --> Cd["Coding"]
    Rs --> Wr["Writing"]
    Rs & Mt & Vs & Cd & Wr --> Sy["Synthesize"] --> Qg["Quality gate >=90"]
  end

  subgraph V2dag["v2 (score-assigned DAG nodes)"]
    direction LR
    N1["node A"] --> N2["node B"]
    N1 --> N3["node C"]
    N2 & N3 --> N4["sink -> output"]
    Score["score.ts: cosine(capabilities) + health + cost"] -. assigns agent .-> N1 & N2 & N3 & N4
  end

  Co1 & Re1 & Rs & Mt & Vs & Cd & Wr & N1 -->|"every call"| DARS["chatWithDARS(role)"]
  DARS --> Reg["roles: planner=gemini, coder=deepseek, reviewer=qwen, validator=llama"]
```

**Communication medium:**
- v1 build = a shared **Blackboard** object (`createBlackboard`) mutated stage-to-stage; no message bus.
- v1 chief = function calls; agent outputs collected into an array then synthesized.
- v2 = **DAG node outputs** merged into dependents' inputs (`gatherInputs`); lifecycle **EventBus** (`v2/events.ts`) emits node_start/complete/fail/replan (currently consumed mainly by the trace mirror).
- **Selection differs fundamentally:** v1 chief picks agents by **keyword category** (`classifier.ts` + `selectAgents`); v2 picks by **cosine capability score + live health** (`score.ts`), no keyword branching.

---

## 5. Memory Lifecycle

```mermaid
graph LR
  subgraph Write
    W1["session ends (runTMAP finally)"] --> W2["recordSessionMemory(userId)"]
    W2 --> W3["dedupe + cap (sessions 10, conventions 12, decisions 20, failures 15)"]
    W3 --> W4["saveMemory -> Supabase memories (merge) | file fallback"]
  end
  subgraph Read_v1["v1 read"]
    R1["loadMemory(userId)"] --> R2["memoryToContext (dump ALL)"] --> R3["prepend to Planner context"]
  end
  subgraph Read_v2["v2 read (ranked)"]
    Q1["rankMemories(query) = importance + recency-decay + lexical"] --> Q2["contextFitFrom -> 0..1 signal"]
    Q2 --> Q3["feeds score.ts contextFit (influences agent selection)"]
    Q1 --> Q4["memoriesToContextV2 -> top-5 into node prompts"]
  end
  W4 --> R1
  W4 --> Q1
```

**Critical distinction:**
- v1 memory **influences generation** (dumped into the prompt) but **not decisions**, and is **unranked**.
- v2 memory is **ranked** and feeds a `contextFit` signal that **influences agent scoring** — but only on the (default-off) v2 path.
- Storage: Supabase `memories` table when configured, else per-key JSON file; **best-effort** (never breaks a run). On Vercel/serverless, file storage is ephemeral (`/tmp`).

---

## 6. Orchestration Lifecycle

```mermaid
stateDiagram-v2
  [*] --> v1_TMAP : POST /v1/run
  state v1_TMAP {
    [*] --> Context : buildContextV2 (tree+deps+BM25 retrieval)
    Context --> SmartStages : Architect/Impact (normal/pro)
    SmartStages --> Plan
    Plan --> CriticLoop
    state CriticLoop {
      [*] --> Code
      Code --> Validate
      Validate --> Review
      Review --> Decide
      Decide --> Code : blocking & iter<max (reflection coaching)
      Decide --> [*] : clean or iter==max
    }
    CriticLoop --> Document
    Document --> Persist
  }
  v1_TMAP --> [*]

  [*] --> v2_RAA : POST /v2/run (flag)
  state v2_RAA {
    [*] --> Intent : parseIntent (LLM JSON)
    Intent --> Decompose : subtask DAG (LLM JSON)
    Decompose --> Score : rank ALL agents (cosine+health+cost)
    Score --> Decide2 : decideExecution mode/parallel/weights
    Decide2 --> Execute
    state Execute {
      [*] --> Ready : topo order
      Ready --> Run : bounded parallel
      Run --> Retry : fail
      Retry --> Fallback : retries spent
      Fallback --> Replan : fallbacks spent (bounded)
      Run --> Ready : pump next
      Run --> [*] : all terminal
    }
    Execute --> Assemble : sink outputs
    Assemble --> TracePersist
  }
  v2_RAA --> [*]
```

**Resource controls:** v1 iteration caps are fixed per mode (`lite=0, normal=1, pro=3`). v2 derives mode (fast/balanced/deep) + parallel slots + replan budget from a probabilistic score (`decideExecution`). Cost is **tracked** (`estimateCost`, provider usage or char/4 estimate) but only v2 lets cost feed back into selection weights.

---

## 7. Dependency Graph

```mermaid
graph TD
  IDX["server/index.ts (entry, all routes)"]
  IDX --> AUTH["server/auth.ts"] --> CRYPTO["server/crypto.ts"]
  AUTH --> SBA["server/supabase-auth.ts"]
  AUTH --> DB["server/db.ts (Supabase)"]
  IDX --> ORCH["core/orchestrator.ts (runTMAP)"]
  IDX --> CHIEF["core/chief-agent.ts (runChiefAgent)"]
  IDX --> V2RUN["v2/run.ts (runV2)"]
  IDX --> TITAN["core/titan.ts"]
  IDX --> RAA1["core/raa.ts"]
  IDX --> DBG["core/debugger.ts"] & ANA["core/analyze.ts"]
  IDX --> IMG["core/image-pipeline.ts + image-memory.ts"]
  IDX --> EVAL["core/eval-framework.ts"] & SBX["core/sandbox.ts + docker-sandbox.ts"] & USG["core/usage-tracker.ts"]

  ORCH --> AGENTS["core/agents.ts (planner/coder/reviewer)"]
  ORCH --> VOTE["core/vote.ts"] & SELF["core/self-critique.ts"] & REFL["core/reflection.ts"]
  ORCH --> HALL["core/hallucination-detector.ts"] & VER["core/verifier-agent.ts"] & VAL["core/validator.ts"]
  ORCH --> CTX["core/context-engine.ts"] --> RETR["core/retrieval.ts (BM25)"]
  ORCH --> ARCH["core/architect.ts"] & IMP["core/impact.ts"] & DOC["core/documenter.ts"]
  ORCH --> MEM["core/memory.ts"]

  CHIEF --> CLASS["core/classifier.ts (regex)"]
  CHIEF --> MR["core/model-router.ts"] & PE["core/prompt-engineer.ts"] & RG["core/review-gate.ts"]
  CHIEF --> RSCH["core/research-agent.ts"] & WRIT["core/writing-agent.ts"] & MATH["core/math-agent.ts"] & VIS["core/vision-agent.ts"]

  V2RUN --> REG["v2/registry.ts"] --> SCORE["v2/score.ts"]
  V2RUN --> RAA2["v2/raa.ts"] --> DAG["v2/dag.ts"]
  V2RUN --> EXEC["v2/executor.ts"] & ORC2["v2/orchestrator-v2.ts"] & MEM2["v2/memory-v2.ts"] & TRC["v2/trace.ts"] & EVT["v2/events.ts"]
  V2RUN --> RSCH & WRIT & MATH & VIS
  V2RUN --> MEM

  ORCH & CHIEF & V2RUN --> DARS["dars/run.ts"] --> SEL["dars/select.ts"] & HLTH["dars/health.ts"] & CLS["dars/classify.ts"]
  DARS --> CLIENT["providers/client.ts"] --> PROV["5 providers (OpenAI-compatible)"]
  ALLCFG["config.ts (loads .env, providers, mockAllowed)"]
  ORCH & CHIEF & V2RUN & DARS --> ALLCFG
```

### Notable graph facts
- **`config.ts` loads `.env` on import** (`import 'dotenv/config'`) — a transitive dependency of nearly everything; this makes local tests non-hermetic (they make real LLM calls).
- **Shared reuse v1↔v2:** v2 now reuses the four specialist agents and `core/memory.ts`; both engines funnel through DARS → `providers/client.ts`.
- **Recently removed:** `advanced-router.ts`, `critic-agent.ts` (orphaned). `retrieval.ts` is **kept** (live via `context-engine.ts`).

---

## 8. Bottlenecks

| # | Bottleneck | Evidence | Impact |
|---|---|---|---|
| B1 | **Call amplification** | Chief full path = 5–7 calls; pro build vote = 4; Titan = 8+ self-review passes | Latency + free-tier rate-limit exhaustion (the #1 failure cause) |
| B2 | **Sequential pipelines** | v1 TMAP stages run in order; no file-level parallelism | Slow builds; v2 DAG parallelism only on the default-off path |
| B3 | **No LLM response caching** | `providers/client.ts` posts every call fresh | Repeated/near-duplicate prompts re-billed |
| B4 | **Large context injection** | `CONTEXT_SUMMARY_CEILING = 64KB`; memory dumped wholesale (v1) | Token cost; useful-context dilution |
| B5 | **In-memory health/rate-limit** | `HealthStore` Map + in-proc rate-limit | Per-instance only; lost on cold start; inconsistent across Render replicas |
| B6 | **Per-request key decryption** | scrypt-derived key cached, but keys decrypted per request (`/v1/run`, `/v1/me`) | CPU on hot paths; mitigated by cache |

---

## 9. Risks

| # | Risk | Evidence | Severity |
|---|---|---|---|
| R1 | **Master-key cross-service coupling** | `COAGENTIX_MASTER_KEY` must be byte-identical on Vercel + Render or keys silently fail to decrypt (`auth.ts keepDecryptableKeys`) | High (silent degradation to "no key") |
| R2 | **Ephemeral storage without Supabase** | `memory.ts`/`db.ts` fall back to disk; Vercel/Render disks are ephemeral | High (data loss on redeploy; preflight warns) |
| R3 | **Non-hermetic tests** | `config.ts` loads `.env`; v1 tests hit real providers and flake on rate limits | Medium (CI safe — no `.env`; local misleading) |
| R4 | **Mock fabrication** | `mockAllowed()` true outside production; mock can emit plausible fake code/answers | Medium (fail-closed in prod by default) |
| R5 | **Prompt-injection surface** | User task flows directly into agent system/user prompts; no mitigation | Medium (inherent to product, undocumented) |
| R6 | **v2 is single-task** | `/v2/run` takes only `task` (no history); chat folds recent turns into the task | Medium (weaker conversational continuity than v1 chief) |
| R7 | **Two-engine fork** | v1 + v2 maintained in parallel until Phase 3 | Medium (double bug-fix surface) |
| R8 | **Stubbed billing / account-deletion** | frontend "coming soon" toasts | Low/compliance (no payment; manual deletion) |

---

## 10. Critical Dependencies

| Dependency | Used for | Failure mode | Resilience |
|---|---|---|---|
| **Supabase Postgres** | auth bridge, provider_keys, sessions, memory, execution_traces | auth fails / memory degrades | memory/trace fall back to file; auth has no fallback (hard dep for Google users) |
| **`COAGENTIX_MASTER_KEY`** | decrypt provider keys | all keys undecryptable | degrades to "no key" (fail-closed), not crash |
| **`JWT_SECRET`** | native sessions/CLI | login/CLI broken | preflight aborts boot in prod if missing |
| **AI providers (≥1 key)** | every model call | no key → fail-closed error | DARS failover across all candidate providers + OpenRouter routes |
| **DARS layer** | all engines' model access | single point all calls traverse | internal circuit breaker + EWMA health + retries |
| **`config.ts` / dotenv** | provider/role config | misconfig | defaults + `mockAllowed` gate |
| **Redis (optional)** | distributed rate-limit, queue, cluster health | features no-op without it | optional deps; in-memory fallbacks |
| **Vercel↔Render link** | `COAGENTIX_API_PROXY` rewrite makes `/v1`,`/v2` same-origin | frontend can't reach backend → `/api/chat` fallback | graceful degrade to single-pass chat |

---

## 11. Summary Assessment

- **Strengths:** clean separation (frontend/backend/data); strong resilience (DARS circuit breaker + scored failover); solid secrets-at-rest; genuinely distinct multi-agent prompts; a high-quality v2 engine (DAG, scoring, retry/fallback/replan, reconstructable trace) now wired in.
- **Central architectural tension:** the most advanced engine (v2) is still **default-off**, while the live path routes by **keyword** (chat) and runs a **linear** pipeline (build). The migration (PR #26, Phases 0–2) closes the wiring gap; **Phase 3 (retire v1) is deferred pending a production canary**.
- **Before scale:** move `HealthStore` + rate-limit to Redis (R/B5), guarantee Supabase durability (R2), and harden the master-key operational contract (R1).

*End of report. No source code was modified.*
