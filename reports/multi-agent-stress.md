# Multi-Agent Stress Test — Code-Level Simulation Analysis

**Date:** 2026-06-21
**Analyst:** Claude Sonnet 4.6 (Co.Ai harness)
**Method:** Static code analysis + analytical simulation (no live server)
**Scope:** Co.Ai repository at `C:\Users\santi\Co.Ai`

---

## Methodology Disclaimer

This is a **simulated analysis**, not a measured benchmark. Every latency estimate, failure rate, and memory usage figure is derived analytically from reading the source code. Where code paths are sequential, latency is summed. Where code paths use `Promise.allSettled`, latency is the maximum across concurrent calls. No load was applied to any live system.

All line-number references point to the source files at the time of this analysis.

---

## Systems Inventory

| System | Primary File(s) | Entry Point |
|---|---|---|
| Universal Router | `aof-web/src/lib/router.ts` | `routeRequest()` |
| Chat API / Provider Chain | `aof-web/src/app/api/chat/route.ts` | `POST /api/chat` |
| TMAP v2 Orchestrator | `tmap-v2/src/core/orchestrator.ts` | `runTMAP()` |
| Chief Agent | `tmap-v2/src/core/chief-agent.ts` | `runChiefAgent()` |
| DARS | `tmap-v2/src/dars/run.ts`, `dars/health.ts`, `dars/select.ts` | `chatWithDARS()` |
| Titan Mode | `tmap-v2/src/core/titan.ts` | `runTitan()` |
| Voting Engine | `tmap-v2/src/core/vote.ts` | `runCoderVote()` |
| Memory System | `tmap-v2/src/core/memory.ts` | `loadMemory()` / `saveMemory()` |
| RAA | `tmap-v2/src/core/raa.ts`, `aof-web/src/lib/raa.ts` | `runRAA()` |
| Rate Limiter | `aof-web/src/lib/server/rate-limit.ts`, `tmap-v2/src/server/rateLimit.ts` | `checkRateLimit()` |

---

## System-by-System Analysis

---

### 1. Universal Router (aof-web/src/lib/router.ts)

**Purpose:** Classifies incoming text into 16 task categories and routes to `chat`, `code`, or `search` targets.

**Implementation summary:**
- `classifyRequest()` (line 236): iterates all 16 `CATEGORY_RULES` arrays, tests each RegExp against the lowercased input, accumulates weighted match counts, returns sorted categories.
- `routeRequest()` (line 272): checks code file attachments first, then explicit search patterns (4 regexes), then calls `classifyRequest()`.
- No I/O, no network calls, no state mutation. Fully synchronous.

**Concurrency model:** Stateless pure function. Every call is independent. No shared mutable state.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 req/s | ~0.1 ms | Negligible | High | ~0% | N/A | Instant |
| 50 req/s | ~0.1 ms | Negligible | High | ~0% | N/A | Instant |
| 100 req/s | ~0.1 ms | Negligible | High | ~0% | N/A | Instant |
| 500 req/s | ~0.2 ms | Negligible | High | ~0% | N/A | Instant |

**Findings:**

1. **Latency:** The router runs 16 category rule loops. Each loop tests 8-24 RegExp objects against the input string. For a 500-character message, each regex is O(n). Total estimated CPU time: 0.1-0.3 ms per request at any load. The router is not a bottleneck.

2. **Memory:** No heap allocations beyond per-call stack frames. The `CATEGORY_RULES` and `SEARCH_PATTERNS` arrays are module-level constants (loaded once). No caching or accumulation. Memory cost is effectively zero.

3. **Routing Accuracy Edge Cases:**
   - Ambiguous inputs (e.g., "write a Python function for data analysis") match both `coding` (weight 8) and `data_analysis` (weight 8) and `writing` (weight 6). The router returns `code` target because `data_analysis` is in the code category set (line 262). This is correct behavior but may surprise users who intended a writing request.
   - Very short inputs (< 10 chars) match no patterns and fall through to the `chat` default (line 332). Safe fallback.
   - The `isMultiStep` flag (line 240) triggers if categories >= 3 OR if the text has >= 4 sentences. A 4-sentence message with no category keywords will be flagged `multi_step` spuriously, but `multi_step` has no routing consequence (it only appends to the categories array), so this is harmless.

4. **Failure Rate:** Zero. The function cannot throw under any normal input. `lower.split(/[.!?]/).length` is always >= 1. The fallback `categories[0] ?? 'research'` prevents undefined.

5. **Provider Failover / Recovery:** Not applicable. Stateless synchronous function.

---

### 2. Chat API / Provider Chain (aof-web/src/app/api/chat/route.ts + ai-providers.ts)

**Purpose:** The main Next.js API route. Authenticates the caller, rate-limits, selects an AI provider, streams the response, and fails over between up to 6 providers.

**Implementation summary:**
- Rate limit check: `checkRateLimit()` -- Supabase RPC when configured, in-memory `Map` fallback (rate-limit.ts:29).
- Provider selection: `configuredProvidersForOrder()` -- filters to providers with API keys, ordered by task-specific priority from model-registry.
- Primary loop (route.ts lines 311-364): iterates providers sequentially. For each provider, calls `primeAndStream()`. If the provider fails before the first token, logs and tries next. If a provider emits mid-stream, the error is encoded in-band.
- OpenRouter adapter (ai-providers.ts lines 365-466): has its own model chain (up to 4 free fallback models), per-model first-token deadline of 6000ms (`firstTokenDeadlineMs()`, line 363), 3 retry attempts on transient errors.
- `primeAndStream()` (ai-providers.ts:626): blocks on the generator until the first non-empty chunk, then creates a `ReadableStream` for the rest.

**Concurrency model:** Each HTTP request is a separate async execution context. Node.js single-threaded event loop. No shared mutable state except:
- `memStore` in rate-limit.ts (line 29): a module-level `Map` with no eviction.
- Provider selection and streaming: fully independent per-request.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 req/s | 1-8s (TTFT) | Low | Very high | <1% | Transparent, ~100ms overhead | Instant per request |
| 50 req/s | 1-15s (TTFT) | Moderate | Very high | 2-5% (rate limit) | Transparent | Instant |
| 100 req/s | Variable; rate limit kicks in | Moderate | Very high | ~67% rate-limited (chat: 30 req/min/user) | Transparent | Instant |
| 500 req/s | Heavily rate-limited | High (memStore growth) | N/A -- most rejected | >90% rate-limited or provider 429 | Transparent but exhausted | Instant per request |

**Findings:**

1. **Latency:** The `primeAndStream()` call must receive the first non-empty token before a 200 is returned. TTFT for Anthropic is typically 500ms-2s. For OpenRouter free models, the first-token deadline is 6000ms per model. Worst case with 4 OpenRouter free fallbacks: 4 x 6000ms = 24s before the call gives up. This is a sequential bottleneck -- no parallelism is used across providers at the priming stage.

2. **Memory -- Rate Limiter Leak (CRITICAL):**
   - `memStore` in `aof-web/src/lib/server/rate-limit.ts` (line 29) is a module-level `Map` with **no eviction, no pruning, no TTL enforcement**.
   - Under Supabase failure (the fallback path), every unique `userId` or IP adds a permanent entry.
   - At 500 req/s with rotating IPs, 1 hour = 1.8M unique keys x ~100 bytes = ~180MB heap growth. This will grow until the process OOM-kills.
   - **Contrast:** `tmap-v2/src/server/rateLimit.ts` has `pruneExpired()` called every 30 minutes via `setInterval` (line 120). The `aof-web` rate limiter has no equivalent pruning.

3. **Routing Accuracy:** Provider selection via `configuredProvidersForOrder()` is deterministic given a fixed set of API keys. The task-based ordering from `model-registry.ts` correctly maps `coding` tasks to DeepSeek-first, `chat` tasks to Anthropic/Gemini-first. Accuracy degrades only when all configured providers are rate-limited simultaneously.

4. **Failure Rate:**
   - At 10 req/s: Very low. Per-user limit is 30 req/min = 0.5 req/s.
   - At 50 req/s: If requests concentrate on few users/IPs, hitting 30 req/min cap is very likely. ~50-60% of requests may be rejected.
   - At 100 req/s: Rate limit blocks nearly all traffic from any single user or small IP pool.
   - At 500 req/s: Server becomes a rate-limiter. `memStore` grows unboundedly if Supabase is down.

5. **Provider Failover:**
   - The failover loop (route.ts lines 311-364) is sequential. Failover adds latency equal to the first-token deadline of failed providers.
   - `ERROR_CATALOG[lastError.code].failoverWorthy` (line 354) controls whether failover proceeds. Auth errors (AOF_ERROR_001-003) are NOT failover-worthy -- if the only configured key is invalid, the system returns an error immediately.
   - The `aborted` guard (line 335) cleanly handles user Stop button during priming.

6. **Recovery:** The streaming `ReadableStream` approach means each request is fully isolated. Mid-stream failure is encoded in-band as an error frame (ai-providers.ts:670), so the UI shows the error without crashing.

---

### 3. TMAP v2 Orchestrator (tmap-v2/src/core/orchestrator.ts)

**Purpose:** The full multi-agent pipeline: Architect -> Impact Analysis -> Planner -> Coder (with optional 3-way vote in pro mode) -> Validator -> Reviewer -> Documenter.

**Implementation summary:**
- `runTMAP()` (line 93): sequential pipeline. Each stage awaits its agent call before moving to the next.
- Mode determines maximum iterations: `lite=0`, `normal=1`, `pro=3` (line 52).
- Pro mode activates `runCoderVote()` (line 289) which runs 3 coder calls via `Promise.allSettled` -- the only concurrent step in the entire pipeline.
- Context scan via `buildContextV2()` (line 115) reads the filesystem synchronously via `node:fs`.
- Sessions persisted via `persist(bb)` (line 428) -- writes to local filesystem.
- Routing metrics written to disk per LLM call via `globalRoutingMetrics.record()` -> `writeFileSync()` (routing-metrics.ts:133).

**Concurrency model:** Each TMAP run is a single async chain. Multiple concurrent TMAP runs share:
- `globalHealth` (health.ts:107): module-level `HealthStore` singleton -- shared across all runs on the same process instance.
- `globalRoutingMetrics` (routing-metrics.ts:152): module-level singleton -- calls `writeFileSync` on every LLM call.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 concurrent | 30-120s/run (normal mode) | Moderate | High | 5-10% | DARS handles transparently | Per-run isolation |
| 50 concurrent | 30-240s/run (provider queueing) | High | High | 10-25% (provider 429s) | DARS handles, may exhaust candidates | Per-run isolation |
| 100 concurrent | Severe provider rate-limiting | Very high | Degraded (quota pressure) | 30-50% | DARS partially effective | Per-run, some stuck in DARS loop |
| 500 concurrent | Process likely OOM or I/O saturated | OOM risk | Severely degraded | >70% | DARS exhausted quickly | Broken until restart |

**Findings:**

1. **Latency:**
   - Lite mode: 1 plan call + 1 coder call + validation (static) + 1 reviewer call. Each DARS call = 5-45s. Total: ~15-90s.
   - Normal mode: adds Architect + Impact + self-critique + hallucination detection + reflection. Total: ~30-120s.
   - Pro mode: Architect + Impact + Plan + self-critique + **3 coder calls in parallel** (Promise.allSettled, vote.ts:61) + reviewer-judge call + up to 3 review iterations + Documenter. Total: ~90-300s per session.
   - The sequential structure means a slow provider in any one stage delays the entire pipeline. No pipelining between stages.

2. **Memory:**
   - `Blackboard.agentRuns[]` (line 101) grows within a session. Small per-run (~20 entries max in pro mode).
   - `globalRoutingMetrics.records[]` (routing-metrics.ts:57): capped at 1000 entries (MAX_RECORDS). Safe globally, but `writeFileSync` is called on **every** agent call. At 50 concurrent runs x 10 agent calls each = 500 synchronous disk writes nearly simultaneously. This blocks the event loop.
   - `globalHealth.map` (health.ts:29): unbounded `Map`. Grows by one entry per unique provider health key seen. With 4 providers and OpenRouter variants, caps at ~8 entries. Not a leak.

3. **Routing Accuracy:**
   - DARS `pickHealthy()` (select.ts:85) scores candidates: 50% capability fit, 20% success rate EWMA, 15% speed inverse, 15% cost. Well-designed and task-appropriate.
   - If all candidates fail, DARS throws "all providers exhausted" (run.ts:104) -- correctly surfaces as an error rather than returning garbage.

4. **Failure Rate:**
   - Single-stage agent failure is non-fatal for most stages (try/catch + continue at lines 214-229, 235-243, etc.). Architect failure, Impact failure, self-critique failure all skip gracefully.
   - The Plan stage (line 253) is NOT wrapped in try/catch -- a plan failure throws and aborts the run. This is the only guaranteed failure point.

5. **Provider Failover:** DARS handles failover transparently with up to MAX_FAILOVER = 4 attempts (run.ts:64). Exponential backoff: 100ms, 200ms, 400ms, 800ms between attempts.

6. **Recovery:** Each TMAP run is fully isolated via its own `Blackboard`. The `persist(bb)` call in the `finally` block (line 428) saves partial results even on error, enabling session resume.

---

### 4. Chief Agent (tmap-v2/src/core/chief-agent.ts)

**Purpose:** The meta-orchestrator in tmap-v2's `/v1/chat` endpoint. Classifies intent, expands the prompt, creates an execution plan, dispatches to specialized agents (Research, Writing, Math, Vision, Coding), merges outputs, and runs a quality review loop.

**Implementation summary:**
- `runChiefAgent()` (line 67): sequential phases 1-7.
- Phase 5 (lines 143-198): executes agents with a `for...of` loop -- fully sequential. Research, then Writing, then Math, then Vision, then Coding, each awaited before the next.
- Phase 6 (line 216): synthesis call if > 1 agent ran.
- Phase 7 (line 233): quality review loop -- up to 3 iterations of score-then-revise, each requiring 2 LLM calls (scorer + reviser).

**Concurrency model:** Entirely sequential. Each sub-agent call blocks the next. No parallelism at any phase.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 concurrent | 20-180s/run | Moderate | High | 5% | Via DARS | Per-run |
| 50 concurrent | 30-300s/run (provider congestion) | High | High | 20-35% | Via DARS, partial | Per-run |
| 100 concurrent | 60-600s/run | Very high | Degraded | 40-60% | DARS exhausted | Per-run, cascading timeouts |
| 500 concurrent | System-level failure | OOM risk | N/A | >80% | Exhausted | Process restart needed |

**Findings:**

1. **Latency -- Sequential Bottleneck (CRITICAL):**
   - A multi-domain request triggering Research + Writing + Math agents executes them sequentially (lines 147-198 are sequential `await` statements).
   - Each agent call goes through DARS (up to 45s timeout). Three sequential agents = up to 135s before reaching the synthesis phase.
   - The quality review loop (Phase 7) adds up to 3 x 2 LLM calls = 6 more calls at ~5s average each = +30s.
   - Total worst-case for a complex Chief Agent request: **5-10+ minutes**. This is the most latency-heavy path in the system.
   - **No parallelism exists for multi-agent execution.** Research, Writing, and Math agents could trivially be parallelized with `Promise.allSettled()`.

2. **Memory:** Each agent's output is stored in `agentOutputs[]` (line 141). At 3 agents x 4096 tokens x ~4 bytes = ~48KB per run. Under 100 concurrent runs = ~4.8MB total. Not dangerous individually.

3. **Routing Accuracy:** `selectAgents()` (line 279) maps categories to agents deterministically. If the Chief Agent's planning LLM call (Phase 4, line 98) fails or returns malformed JSON, `plan` falls back to a minimal stub (lines 119-127), which retains the category-selected agents. Routing accuracy is preserved through the fallback.

4. **Failure Rate:** Each agent is wrapped in try/catch (lines 146-196). Agent failure emits an error status and continues to the next agent. If ALL agents fail, `agentOutputs.length === 0` at line 201, and a direct answer is attempted as last resort.

5. **Provider Failover:** Delegated entirely to DARS via `chatWithDARS()`.

6. **Recovery:** If the synthesis call (Phase 6) at line 220 fails, the exception bubbles up uncaught from `runChiefAgent()`. Callers must wrap `runChiefAgent()` in try/catch to avoid unhandled rejections.

---

### 5. DARS -- Distributed Agent Routing System

**Files:** `tmap-v2/src/dars/run.ts`, `dars/health.ts`, `dars/select.ts`, `dars/classify.ts`

**Purpose:** Provider selection and resilience wrapper. Scores providers per role, tracks circuit-breaker state, retries on failure, backs off on rate limits.

**Implementation summary:**
- `chatWithDARS()` (run.ts:42): picks healthy candidate, calls it with `PER_CALL_TIMEOUT = 45s` (run.ts:33), records result in `HealthStore`.
- `pickHealthy()` (select.ts:85): scores all untried, available candidates. If none available, tries half-open probes as last resort.
- `HealthStore` (health.ts:28): in-memory Map. Circuit states: `closed` -> `open` -> `half_open` -> `closed`.
- Cooldown periods: auth = 24h, quota = 1h, rate_limit = 60s, repeated transient = 30s x 2^n (max 480s at n=4).

**Concurrency model:** `globalHealth` is a module-level singleton shared across all concurrent DARS calls. JavaScript's single-threaded model means no race conditions on Map reads/writes.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 concurrent | 1-45s/call | Negligible | Very high | <5% | Automatic, sub-second overhead | 30s-60s cooldown |
| 50 concurrent | 1-45s/call, increased 429s | Low | High | 10-20% | Automatic | Per-provider circuit |
| 100 concurrent | Provider 429 cascades | Low | Moderate | 30-50% | DARS may exhaust candidates | Cooldown prevents thundering herd |
| 500 concurrent | Near total provider saturation | Low | Low | 60-80% | Mostly exhausted | 60s+ recovery after rate-limit wave |

**Findings:**

1. **Latency:** `PER_CALL_TIMEOUT = 45s` (run.ts:33). With `MAX_FAILOVER = 4` (run.ts:34) and exponential backoff between attempts (100, 200, 400ms), worst-case DARS latency is 4 x 45s + ~700ms backoff = ~181s. This timeout is not configurable per role or task type -- appropriate for code generation but excessive for chat.

2. **Memory:** `HealthStore.map` grows to at most 8 entries (4 direct + 4 OpenRouter routes). Effectively bounded. No leak.

3. **Routing Accuracy:**
   - Score weights (select.ts:80): `0.50 * capability + 0.20 * reliability + 0.15 * speed + 0.15 * cost + orPenalty`.
   - Under sustained load where all direct providers are rate-limited, DARS correctly falls back to OpenRouter variants. The -0.05 OpenRouter penalty does not override availability.
   - The EWMA for success rate (health.ts:63/70) means 5 consecutive failures decay success rate to ~0.33. Recovery is gradual and correct.

4. **Failure Rate:** DARS's own failure rate is zero unless all candidates are simultaneously circuit-open. This requires all 8 health keys to be `open` simultaneously -- possible only if a single OpenRouter key covers all 4 vendors and that key is invalid or quota-exhausted.

5. **Provider Failover:**
   - Auth failure: circuit open for 24h, no retry (health.ts:77).
   - Rate limit: circuit open for 60s (or Retry-After header value, health.ts:83).
   - Quota exhausted: circuit open for 1h (health.ts:80).
   - Transient (5xx, timeout): exponential backoff starting at 30s, max 480s (health.ts:93-98).

6. **Recovery:** Standard three-state circuit breaker. After cooldown expires, `half_open` allows one probe. Successful probe closes the circuit.

**Critical Limitation -- Single-Process State:** The comment at health.ts:5-7 explicitly notes this is an MVP in-memory implementation. On Vercel serverless, each cold-started instance has its own `globalHealth`. Provider health learned on one instance is not visible to another. Under high load with multiple Vercel instances, each instance independently learns the same failures, wasting provider quota on redundant retries.

---

### 6. Titan Mode (tmap-v2/src/core/titan.ts)

**Purpose:** The highest-level planning mode. Runs 7 sequential self-review passes plus a revision call on every plan. Enforces a confidence threshold gate before revealing plans.

**Implementation summary:**
- `runTitan()` (line 206): one primary LLM call, then confidence check, then 7 review passes (run sequentially in `runReviewPasses()`), then one revision call.
- `runReviewPasses()` (line 307): for loop over 7 `REVIEW_PASSES` -- each awaits a separate LLM call at temperature 0.2, maxTokens 350.
- Total LLM calls per Titan turn: 1 (primary) + 7 (review) + 1 (revision) = **9 LLM calls minimum** when a plan is produced.
- If confidence < 85%: +1 enforcement call (line 247). Total: up to 10 calls.
- Blueprint turns skip all review (line 229). Single call.

**Concurrency model:** Entirely sequential. Each review pass awaits before the next.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 concurrent | 45-270s/turn | Low | High | 10-20% (provider pressure) | Per call via DARS | Per-turn |
| 50 concurrent | 90-540s/turn | Moderate | Moderate | 30-50% | DARS partial | Per-turn |
| 100 concurrent | System-level congestion | High | Low | 50-70% | DARS exhausted mid-session | Long recovery |
| 500 concurrent | Not viable; all providers saturated | Very high | N/A | >90% | N/A | Full cooldown cycle needed |

**Findings:**

1. **Latency -- Most Expensive Path in System:**
   - 9 sequential LLM calls x 5s average = **~45s minimum** for one Titan planning turn.
   - With DARS retries: 9 calls x up to 45s timeout = **~405s worst case**.
   - The 7 review passes (titan.ts:309 `for` loop) are completely independent of each other and could be parallelized with `Promise.allSettled()`, reducing review latency from 7 x n to 1 x n.

2. **Memory:** Each LLM response (up to 3500 tokens each) is held in-memory during the review loop. `reviewFindings[]` accumulates bullets across passes. Memory is bounded per turn.

3. **Failure Rate:** Each review pass is wrapped in try/catch (line 317). Pass failure emits a status message and continues. The primary call (line 226) and revision call (line 272) are not individually guarded -- their failures bubble up to the caller.

4. **Provider Failover / Recovery:** Delegated to the `call` parameter (DARS). Per-call failover only. Each Titan turn is fully isolated. No global state is mutated.

---

### 7. Voting Engine (tmap-v2/src/core/vote.ts)

**Purpose:** In pro mode, generates 3 coder candidates at different temperatures in parallel, then uses a reviewer to score them on a 5-dimension rubric and pick the best.

**Implementation summary:**
- `runCoderVote()` (line 54): `Promise.allSettled()` over 3 temperatures [0.2, 0.5, 0.8] (line 61). The **only parallel multi-agent step in the entire system**.
- Reviewer judge call (line 76): single call with temperature 0.1, maxTokens 400.
- Scoring: 40% correctness, 30% completeness, 15% security, 10% efficiency, 5% clarity.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 concurrent | max(3 parallel calls) ~5-45s | Moderate | High | 10% | Per-call via DARS | Fallback to candidate A |
| 50 concurrent | max(3 parallel calls) + congestion | High | High | 20-30% | Partial | Fallback to candidate A |
| 100 concurrent | Provider saturation hits parallel calls | Very high | Moderate | 40-60% | Candidate reduction | Fallback to candidate A |
| 500 concurrent | Near total provider saturation | OOM risk | Low | >70% | N/A | Fallback to candidate A |

**Findings:**

1. **Latency:** The 3 coders run in parallel via `Promise.allSettled()`. Effective latency is `max(t1, t2, t3)`, not `t1 + t2 + t3`. This is the best-designed concurrency in the system. If all three coders go to the same provider, provider-side rate limiting can serialize them anyway.

2. **Memory:** Three full code responses held simultaneously in `candidates[]`. Each response could be several KB of code. 3 x 10KB = ~30KB per voting round. Under 100 concurrent pro-mode runs: ~3MB -- manageable.

3. **Routing Accuracy:** If 2 of 3 candidates fail (e.g., rate-limited), `candidates.length === 1` (line 72) and the single candidate is returned without a judge call. Degrades gracefully rather than failing.

4. **Failure Rate -- Judge Failure (MEDIUM):** If the reviewer judge call fails (line 96 catch block), the fallback is `candidates[0]` (candidate A, temperature 0.2). The catch is silent -- no emit, no log from within `runCoderVote()` itself. Minor observability gap.

5. **Provider Failover:** Each `runCoder()` call goes through DARS independently. Three parallel DARS calls can each fail-over independently.

6. **Recovery:** `Promise.allSettled()` means one failed coder does not fail the others. Minimum viable output is 1 successful candidate.

---

### 8. Memory System (tmap-v2/src/core/memory.ts)

**Purpose:** Cross-session persistent memory of tech stack, conventions, architecture decisions, recent sessions, and known failure patterns.

**Implementation summary:**
- `loadMemory()` (line 95): tries Supabase REST API first, falls back to local JSON file.
- `saveMemory()` (line 119): tries Supabase first, falls back to `writeFileSync`.
- `recordSessionMemory()` (line 153): loads, mutates, saves -- three I/O operations per session.
- Bounds: MAX_SESSIONS = 10, MAX_CONVENTIONS = 12, MAX_DECISIONS = 20, MAX_FAILURES = 15.

**Concurrency model:** No locks, no transactions, no optimistic concurrency. Two concurrent calls to `saveMemory()` for the same key will produce a race: the last write wins, silently dropping the other write.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 concurrent | 50-200ms/operation | Low | N/A | <1% | Supabase -> file fallback | Silent fallback |
| 50 concurrent | 50-300ms/operation | Low | N/A | 1-5% | Supabase -> file fallback | Silent fallback |
| 100 concurrent | 100-500ms/operation | Low | N/A | 5-10% (Supabase timeout) | File | File I/O contention |
| 500 concurrent | Supabase connection pool saturation | Low | N/A | 20-40% | File (I/O saturated) | Partial data loss |

**Findings:**

1. **Latency:** Memory loading adds 50-200ms per TMAP session when Supabase is healthy. Additive but not dominant compared to LLM call latency.

2. **Memory (Process Heap):** Each `ProjectMemory` object is bounded by MAX_* constants. ~5KB per user. Not a heap issue regardless of concurrent user count (data is not cached in process).

3. **Concurrency Bug -- Race Condition (HIGH SEVERITY):**
   - `recordSessionMemory()` (line 153): `load -> mutate -> save` is three non-atomic operations.
   - If two TMAP runs for the same user complete concurrently: both load the same stale memory, both mutate it independently, the second save silently overwrites the first. One session entry is lost.
   - No fix exists without adding a distributed lock (e.g., Supabase row-level locking or Redis `SET NX`).

4. **Uncaught Exception Risk (CRITICAL):**
   - `saveMemory()` file fallback at lines 131-132:
     `mkdirSync(memoryDir(), { recursive: true });`
     `writeFileSync(memoryPath(mem.key), JSON.stringify(mem, null, 2), 'utf8');`
   - Neither call is in try/catch. A full `/tmp` partition on Vercel would throw `ENOSPC` here and abort the TMAP session save with an unhandled exception.

---

### 9. RAA -- Requirements Architect Agent

**Files:** `tmap-v2/src/core/raa.ts`, `aof-web/src/lib/raa.ts`

**Purpose:** Conversational requirements gathering before code generation. Single LLM call per user message, with structured output parsing.

**Implementation summary:**
- `runRAA()` (tmap-v2/src/core/raa.ts:99): builds a message array from history (last 20 turns, line 107), calls the LLM, parses the `===REQUIREMENT SUMMARY===` block if present.
- `aof-web/src/lib/raa.ts`: browser/server-safe module containing the RAA system prompt and `parseBrief()`. No network calls.
- History truncated at 20 turns: prevents context window overflow.

**Concurrency model:** Stateless. Each call is independent. No shared mutable state.

#### Load Scenario Analysis

| Load | Latency | Memory | Routing Accuracy | Failure Rate | Provider Failover | Recovery |
|---|---|---|---|---|---|---|
| 10 req/s | 1-10s (single LLM call) | Low | Very high | <2% | Via DARS / provider chain | Per-request |
| 50 req/s | 1-15s | Moderate | Very high | 5-10% | Via DARS / provider chain | Per-request |
| 100 req/s | 2-20s | Moderate | High | 15-25% (rate limits) | Via DARS | Per-request |
| 500 req/s | Provider saturation | High | Degraded | >60% | Partially effective | Per-request |

**Findings:**

1. **Latency:** Single LLM call with maxTokens 1200 and temperature 0.5. Typically 2-8s. Lower than the orchestrator or Titan.

2. **Memory:** History bounded at 20 turns (~10KB per request). No accumulation between requests.

3. **Routing Accuracy -- Brief Parsing Robustness:** `parseSummary()` (tmap-v2/raa.ts:125) uses a line-by-line parser robust against whitespace variations. `hasBrief()` in `aof-web/src/lib/raa.ts` (line 164) simply checks for both marker strings. Cannot produce false positives under normal LLM output conditions.

4. **Failure Rate / Recovery:** Very low failure rate for RAA itself. A failed LLM call returns an error response to the client. Stateless -- a failed call requires the user to retry but no session state is mutated.

---

## Cross-Cutting Concerns

### Rate Limiting Architecture

Two separate rate limiters exist with different designs:

| System | File | Backend | Eviction | Scope |
|---|---|---|---|---|
| aof-web chat | `aof-web/src/lib/server/rate-limit.ts` | Supabase RPC or in-memory Map | **None on in-memory** | User ID or IP, per bucket |
| tmap-v2 login | `tmap-v2/src/server/rateLimit.ts` | In-memory Map only | `pruneExpired()` every 30min | Username + IP |
| tmap-v2 requests | `tmap-v2/src/server/rate-limit-redis.ts` | Redis (sliding window) or fallback | TTL-based | Configurable |

The aof-web in-memory Map is the most dangerous: no pruning means unbounded growth under a rotating-IP attack or a Supabase outage lasting more than a few hours.

### Shared Singletons Under Load

| Singleton | File | Risk Under Load |
|---|---|---|
| `globalHealth` (HealthStore) | `tmap-v2/src/dars/health.ts:107` | Correct shared circuit-breaker. Per-process only (multi-instance blind spot). |
| `globalRoutingMetrics` | `tmap-v2/src/core/routing-metrics.ts:152` | `writeFileSync` on every LLM call. Synchronous disk I/O blocks event loop under concurrency. |
| `memStore` (rate limit) | `aof-web/src/lib/server/rate-limit.ts:29` | Unbounded growth. No pruning. |
| Redis `_client` singleton | `tmap-v2/src/server/redis.ts:182` | Shared connection pool. Correct pattern. |
| Queue `_mainQueue` | `tmap-v2/src/server/queue.ts:40` | BullMQ queue is thread-safe by design. |

---

## Consolidated Load Scenario Projections

### 10 Concurrent Requests (Baseline)

- **Chat API:** All requests served within ~2-8s TTFT. Rate limiter not triggered (0.5 req/s per user is well under 30 req/min). Provider chain handles load easily.
- **TMAP v2 (lite mode):** 10 concurrent runs at ~30s each. DARS handles provider distribution. No memory issues.
- **Chief Agent:** 10 concurrent runs at ~60-120s each. Sequential agent execution means slow but stable.
- **Titan Mode:** Each turn consumes 9 LLM calls. Viable for a handful of concurrent turns.
- **Voting Engine (pro mode):** 3 parallel coder calls per run. 10 runs = 30 concurrent coder calls. Provider rate limits may start triggering.
- **Memory System:** 10 concurrent save operations. Race condition possible but low probability.
- **RAA:** Fast, stateless. No issues.

**Overall verdict at 10 req:** System operates normally. Latency is driven by LLM provider speed, not by application code.

---

### 50 Concurrent Requests (Moderate Load)

- **Chat API:** Rate limiter begins enforcing. Users exceeding 30 req/min receive HTTP 429. In-memory fallback works correctly but without pruning protection.
- **TMAP v2:** 50 concurrent sessions generate 50-150+ simultaneous DARS calls. `globalRoutingMetrics` `writeFileSync` under load: 50 sessions x 10 calls = 500 synchronous disk writes per session burst. This blocks the event loop for tens of milliseconds each time, degrading responsiveness.
- **Chief Agent:** 50 sessions with multi-agent dispatch. Sequential agents mean provider queue depth grows. Latency per run increases to 60-300s.
- **Voting Engine:** 50 pro-mode runs = 150 parallel coder calls. High provider pressure. Many candidates return 429, reducing voting to 1 viable candidate.
- **Memory System:** 50 concurrent saves. Race condition probability meaningful.

**Overall verdict at 50 req:** System is stressed. Latency increases significantly. Some requests fail with provider 429s. The `globalRoutingMetrics` synchronous disk I/O is a measurable performance issue.

---

### 100 Concurrent Requests (High Load)

- **Chat API:** Heavy rate limiting. If 100 requests arrive from the same user or IP pool, nearly all are rejected after the first 30. `memStore` grows unchecked if Supabase is down.
- **TMAP v2:** Provider saturation likely. DARS circuits begin opening under repeated 429s. `writeFileSync` is called 100+ times concurrently. Event loop blocked regularly.
- **Chief Agent:** Sequential agent execution means queue depth is very long. Effective throughput is limited by total provider tokens/minute.
- **Titan Mode:** At 100 concurrent turns x 9 calls each = 900 concurrent LLM requests outstanding. Not achievable without extensive provider capacity.
- **Memory System:** In-memory fallback (Vercel `/tmp`) fills up over time. `writeFileSync` failures (ENOSPC) propagate uncaught.

**Overall verdict at 100 req:** System becomes unreliable. Titan and pro-mode TMAP are not viable. Chat and RAA remain functional if rate limits allow.

---

### 500 Concurrent Requests (Stress)

- **Chat API:** Virtually all requests from few users are rate-limited. `memStore` grows by hundreds of entries per minute under rotating IPs. Memory leak becomes significant within hours.
- **TMAP v2:** Provider quotas exhausted within minutes. All DARS circuits open. New sessions queue indefinitely in 45s timeouts then fail.
- **Chief Agent:** Not viable. Every LLM call fails or times out.
- **Titan Mode:** Completely non-functional.
- **Voting Engine:** All 3 coders fail -> 0 candidates -> empty result (vote.ts:69).
- **Memory System:** Supabase connection pool saturated. File fallback ENOSPC uncaught exception propagates to the TMAP pipeline.
- **`globalRoutingMetrics` writeFileSync:** Under 500 concurrent sessions x 10 calls = 5000 synchronous writes continuously. The event loop is effectively blocked. Server becomes unresponsive to all async operations.

**Overall verdict at 500 req:** System fails. Primary failure modes are provider rate exhaustion, `globalRoutingMetrics` synchronous I/O bottleneck, and in-memory rate-limiter Map growing without bound.

---

## Prioritized Findings

### Critical (address before production scale)

**C1 -- `memStore` in `aof-web/src/lib/server/rate-limit.ts` has no eviction (line 29).**
Under sustained load or rotating IPs, the Map grows unboundedly, consuming heap until OOM.
Fix: add a pruning `setInterval` similar to `tmap-v2/src/server/rateLimit.ts:120`, or always require Supabase for production deployments.
File: `aof-web/src/lib/server/rate-limit.ts`, line 29.

**C2 -- `globalRoutingMetrics.record()` calls `writeFileSync` on every LLM call (routing-metrics.ts:132).**
Under concurrent load, synchronous file writes block the Node.js event loop.
Fix: make saves async (`writeFile` + fire-and-forget or debounced writes), or write to Redis/Supabase instead of the filesystem.
File: `tmap-v2/src/core/routing-metrics.ts`, line 132.

**C3 -- Memory system `saveMemory()` `writeFileSync` is not in try/catch (memory.ts:131-132).**
A full `/tmp` partition produces an uncaught `ENOSPC` exception that aborts the TMAP session.
Fix: wrap both `mkdirSync` and `writeFileSync` in try/catch and emit a warning on failure.
File: `tmap-v2/src/core/memory.ts`, lines 131-132.

### High (address before scaling beyond 50 concurrent)

**H1 -- Chief Agent executes specialized agents sequentially (chief-agent.ts:143-198).**
Research + Writing + Math = 3 x (up to 45s DARS timeout). These sub-agents are independent.
Fix: collect agent runners into an array and run concurrently with `Promise.allSettled()`.
File: `tmap-v2/src/core/chief-agent.ts`, lines 143-198.

**H2 -- Titan `runReviewPasses()` executes 7 review passes sequentially (titan.ts:308-331).**
These 7 LLM calls are independent (each reviews the same plan block).
Fix: replace `for` loop with `Promise.allSettled()`. Reduces review latency from 7 x n to 1 x n.
File: `tmap-v2/src/core/titan.ts`, lines 308-331.

**H3 -- `globalHealth` is in-memory, per-process (health.ts:107).**
On Vercel with multiple instances, each instance independently re-learns provider failures, wasting provider quota on redundant retries.
Fix: back the health store with Redis (as noted in the code comment at health.ts:5-7).
File: `tmap-v2/src/dars/health.ts`, line 107.

### Medium (address for production readiness)

**M1 -- Memory system has a write-write race condition (memory.ts:153).**
`load -> mutate -> save` is not atomic. Concurrent saves for the same user key silently lose one write.
Fix: use Supabase row-level locking or a Redis distributed lock with `SET NX`.
File: `tmap-v2/src/core/memory.ts`, line 153.

**M2 -- Chief Agent synthesis call has no explicit try/catch (chief-agent.ts:220).**
A synthesis failure produces an unhandled rejection unless callers wrap `runChiefAgent()` in try/catch.
File: `tmap-v2/src/core/chief-agent.ts`, line 220.

**M3 -- OpenRouter first-token deadline is 6000ms per model, 4 models in chain.**
Worst-case priming time before any streaming response: 24 seconds. Excessive for chat use cases.
Consider reducing the deadline for non-code tasks via a task-aware `OPENROUTER_FIRST_TOKEN_MS`.
File: `aof-web/src/lib/server/ai-providers.ts`, line 363.

### Low (quality of life)

**L1 -- Voting engine silent judge failure (vote.ts:96).**
Fallback to candidate A is silently executed. No emit/log from within `runCoderVote()` when the judge fails. Observability blind spot.
File: `tmap-v2/src/core/vote.ts`, line 96.

---

## Summary Table

| System | At 10 req | At 50 req | At 100 req | At 500 req | Biggest Risk |
|---|---|---|---|---|---|
| Universal Router | Stable | Stable | Stable | Stable | None |
| Chat API / Provider Chain | Stable | Minor 429s | Heavy rate-limiting | Rate-limit flood + OOM | memStore no eviction (C1) |
| TMAP v2 Orchestrator | Stable | Stressed | Degraded | Fails | writeFileSync event-loop block (C2) |
| Chief Agent | Stable | Slow | Very slow | Fails | Sequential agent loop (H1) |
| DARS | Stable | Stressed | Circuit-opens cascade | All exhausted | Per-instance health state (H3) |
| Titan Mode | Viable | Stressed | Not viable | Non-functional | 9 sequential LLM calls (H2) |
| Voting Engine | Stable | Stressed | Degrades gracefully | Empty results | Provider saturation |
| Memory System | Stable | Race risk | ENOSPC risk | Fails | Uncaught writeFileSync (C3) + race (M1) |
| RAA | Stable | Stable | Stressed | Degraded | Provider rate limits |
