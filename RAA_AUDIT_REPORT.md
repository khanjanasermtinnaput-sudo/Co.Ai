# RAA Audit Report

> **Goal:** determine whether RAA (the requirement/routing/assignment layer) is a real decision engine or simulated.
> **Method:** source-only, adversarial. No code modified for this audit.
> **Key finding up front:** there are **two distinct things both called "RAA"** in this repo. One is a keyword router (live). One is a genuine score-based decision engine (default-off). Conflating them is how the system reads as "intelligent routing" while shipping `if/else`.

---

## 0. The two RAAs

| | "RAA" #1 — live | "RAA" #2 — real engine |
|---|---|---|
| File | `core/raa.ts` + `core/chief-agent.ts` | `v2/raa.ts` (+ `v2/score.ts`, `v2/registry.ts`, `v2/dag.ts`) |
| What it is | `core/raa.ts` is a **requirements-clarification chat agent** (produces a `===REQUIREMENT SUMMARY===`). Actual agent routing for chat is in `chief-agent.ts`. | Intent → decompose → score ALL agents → select → ExecutionPlan (DAG). |
| Routing mechanism | **Keyword regex** (`classifier.ts`) + **static category→agent map** (`chief-agent.ts:selectAgents`) | **Cosine capability score + live health** (`score.ts`) — no keywords |
| Status | **LIVE** (serves `/v1/orchestrate`) | **Wired, default-off** (`/v2/run`, flag `COAGENTIX_V2`) |

---

## 1. Every RAA execution path (traced)

### Path A — `core/raa.ts` (requirements chat, NOT routing)
`server/index.ts` (`/v1/chat` requirements turns) → `runRAA(call, history, userMessage)` → single LLM call with `RAA_SYS` prompt → regex-parses a `===REQUIREMENT SUMMARY===` block (`parseSummary`).
**Verdict:** this is a *prompted conversation agent*, not a router. It makes **no agent-selection decision**. The name "RAA" here is misleading.

### Path B — `core/chief-agent.ts` (the live universal router)
`server/index.ts` `/v1/orchestrate` → `runChiefAgent(message)`:
1. `classifyTask(message)` → **`classifier.ts`** (regex rules → categories).
2. `routeToRole(categories, …)` → **`model-router.ts`** (category → DARS role).
3. `selectAgents(categories)` → **static `if/else`** mapping category → agent (`chief-agent.ts:319`).
4. Execute selected specialists in parallel → synthesize → quality-gate loop.
**Verdict:** agent selection = **keyword categories → hardcoded agent set**. This is the canonical "fake RAA" pattern.

### Path C — `v2/raa.ts` (the real decision engine)
`server/index.ts` `/v2/run` (gated) → `runV2` → `raaPlan(task, …)`:
1. `parseIntent(task)` → LLM JSON `{goal, complexity, requiredCapabilities}` (`llmIntentParser`).
2. `decompose(task, intent)` → LLM JSON subtask **DAG** (`llmDecomposer`).
3. For each subtask: `rankAgents(req, listAgents(), {health, contextFit})` → **`score.ts`** scores **every** registered agent; top = primary, next = fallbacks.
4. Emits `ExecutionPlan` (DAG + `confidence`).
**Verdict:** intent-driven, score-based, **no keyword branching anywhere in the path**.

---

## 2. Keyword routing — detection

| Location | Keyword routing? | Evidence |
|---|---|---|
| `core/classifier.ts` | **YES** | ~190 lines of `RegExp` rules with weights; `classifyTask` counts pattern hits → categories |
| `core/chief-agent.ts` | **YES (consumes it)** | routes on `categories` from the classifier |
| `v2/raa.ts` | **NO** | assignment comes only from `rankAgents` |
| `v2/score.ts` | **NO** | `capabilityMatch` is cosine similarity of numeric vectors — "pure data, no branching on task text" (and the code says so, verifiably) |

**RAA_KEYWORD_ROUTING = TRUE for the live path (`classifier.ts`/`chief-agent.ts`); FALSE for v2.**

---

## 3. Hardcoded agent selection — detection

- **`core/chief-agent.ts:319 selectAgents()`** — explicit `if (cat === 'coding'…) agents.add('coding')` … static category→agent table. **Hardcoded: YES.**
- **`v2/raa.ts:plan()`** — `primary = ranked[0]` from the scorer. **Hardcoded: NO.**

---

## 4. Static mappings — detection

| Mapping | File | Nature |
|---|---|---|
| category → agent | `chief-agent.ts:selectAgents` | **Static routing table** (the problem) |
| category → DARS role | `model-router.ts:routeToRole` | Static role hint (live path) |
| role × provider fitness | `dars/select.ts:ROLE_CAPABILITY` | Static **seed** weights, but used inside a *scored* selection (capability+health+cost+latency) — provider selection, not agent routing |
| agent → capability vector | `v2/registry.ts:AGENT_REGISTRY` | **Data the scorer ranks over**, explicitly *not* a routing table; runtime-extensible (`registerAgent`) |

**Conclusion:** the live path contains a true static routing table; v2 contains only *data* consumed by a scoring function.

---

## 5. Memory influence — verification

- **Live (v1):** `core/memory.ts:memoryToContext` dumps **all** memory into the Planner prompt. It influences **generation**, not **selection**, and is **unranked**. → `MEMORY_LIMITED`.
- **v2:** `v2/memory-v2.ts:rankMemories` (importance + recency-decay + lexical) → `contextFitFrom` → a 0..1 `contextFit` signal that **feeds `score.ts`** (the `context` weight). So memory **influences the agent-selection decision** — a genuine, if modest (0.15 weight), influence. → **REAL** on v2.

---

## 6. Confidence scoring — verification

- **v2 `ExecutionPlan.confidence`** = mean of selected nodes' top scores (`raa.ts:127`). Used by `decideExecution` to pick mode (low confidence → `deep`). **Real and consequential.**
- **v1 chief `qualityScore`** = from the review-gate loop (`review-gate.ts`), a post-hoc quality measure, not a routing confidence.
- **Titan** (`core/titan.ts`) has an *enforced* confidence gate (`parseConfidence` < `minConfidence` → withhold plan) — real, but that's the planning mode, not RAA.

**Confidence scoring exists and is real in v2; in v1 it's a quality metric, not decision confidence.**

---

## 7. Dynamic planning — verification

- **v2:** `llmDecomposer` produces a **task-specific subtask DAG** at runtime (variable nodes + dependencies), validated by `topoOrder`. With a single-node fallback. → **DYNAMIC.**
- **v1 TMAP:** fixed stage pipeline (Architect→Plan→Code→Validate→Review→Document); the *plan content* is dynamic but the *graph of stages* is hardcoded. → **STATIC structure.**
- **v1 chief:** LLM produces a `subtasks` list, but agents are still chosen by the static map. → **partially dynamic.**

---

## 8. Scores (RAA subsystem, 0–10)

Scored against the **v2 engine** (the actual decision engine Phase 3 targets), with the live-path caveat noted.

| Dimension | Score | Evidence / caveat |
|---|---|---|
| **Architecture** | **8** | Clean Intent→Decompose→Pool→Score→Select→Plan separation (`raa.ts`/`score.ts`/`registry.ts`/`dag.ts`); no keyword coupling. Caveats: single-task (no history), default-off. |
| **Runtime** | **6** | Verified to produce real output + real DAG (live E2E test). But adds 2 LLM calls (intent+decompose) before any work; serial pre-amble adds latency. |
| **Scalability** | **5** | In-memory `HealthStore`; per-instance; no run-level queue; registry seeded in-process (extensible but not yet DB-loaded). |
| **Reliability** | **7** | DARS-backed failover + node retry/fallback/replan + fail-closed; trace persisted. Weakness: no checkpoint/resume across process restart. |

**Live-path (`chief-agent`) scores would be markedly lower** (Architecture ~4) because selection is keyword/static.

---

## 9. Exact files involved

**Live "RAA" (keyword/static):**
- `tmap-v2/src/core/raa.ts` (requirements chat — misnamed)
- `tmap-v2/src/core/chief-agent.ts` (router + `selectAgents` static map)
- `tmap-v2/src/core/classifier.ts` (regex keyword rules)
- `tmap-v2/src/core/model-router.ts` (category→role)
- `tmap-v2/src/core/review-gate.ts` (quality loop)

**Real RAA (score-based, v2):**
- `tmap-v2/src/v2/raa.ts` (intent→decompose→plan)
- `tmap-v2/src/v2/score.ts` (cosine + weighted scoring)
- `tmap-v2/src/v2/registry.ts` (candidate pool as data)
- `tmap-v2/src/v2/dag.ts` (execution graph)
- `tmap-v2/src/v2/memory-v2.ts` (ranked memory → contextFit)
- `tmap-v2/src/v2/orchestrator-v2.ts` (confidence → mode)
- `tmap-v2/src/dars/health.ts`, `tmap-v2/src/dars/select.ts` (reliability/latency/provider scoring)
- `tmap-v2/src/v2/run.ts` (wires it together)

**Tests:** `tmap-v2/src/tests/v2-engine.test.ts`, `v2-orchestrator.test.ts`, `raa.test.ts`.

---

## 10. Verdict

- **Live RAA = SIMULATED routing** (keyword regex + static agent map). `RAA_FAIL` for the production path.
- **v2 RAA = REAL decision engine** (intent → decomposition → scored candidate pool → selection → plan), with genuine memory influence and confidence scoring — but **default-off** and missing an explicit **latency** scoring factor and **checkpoint/resume**.
- **Phase 3 target:** promote v2 to the canonical RAA and close its two real gaps (latency factor, historical-success separation) — addressed in `RAA_V2_REPORT.md`.
