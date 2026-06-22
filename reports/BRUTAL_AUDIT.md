# CO.AI — BRUTAL FULL-PLATFORM AUDIT
**Date:** 2026-06-22  
**Auditor stance:** Adversarial. Goal = find failures, fakes, and overstatements.  
**Repo:** `C:\Users\santi\Co.Ai` (aof-web + tmap-v2 + coagentix-cli + supabase)

---

## METHOD & HONESTY DISCLOSURE (read this first)

This is a **static code-evidence audit**. I did **not** stand up the full stack or drive a browser, and I did **not** throw abuse/chaos traffic at your live production (Render/Vercel) because that is disruptive and outward-facing.

Therefore every phase below is tagged:
- **[CODE-VERIFIED]** — claim is backed by a specific file:line I read.
- **[NOT RUNTIME-VERIFIED]** — requires a running app/DB/browser I did not execute. I will **not** pretend otherwise. Any "test" of these phases is a code reading, not an executed test.

The previous `FINAL_EVALUATION.md` in this repo scored **7.25 / 10 "Advanced System."** That number was generated partly from sub-agent summaries and was **too generous**. After reading the actual agent-dispatch and provider-resolution code, this audit revises it **down to 5.9 / 10**. The correction is explained in Phase 9 and Performance.

---

## PHASE 0 — DISCOVERY

**Two codebases, two app generations, partially overlapping:**

| Layer | Path | Role |
|-------|------|------|
| Frontend | `aof-web/` | Next.js 14 App Router, 24 pages, 28 API routes |
| Backend v1 (DARS/TMAP) | `tmap-v2/src/core/`, `dars/` | Planner→Coder→Reviewer→Validator pipeline |
| Backend v2 (score-based) | `tmap-v2/src/v2/` | RAA→DAG→executor, behind `COAGENTIX_V2=1` |
| CLI | `coagentix-cli/` | Separate CLI product |
| DB | `supabase/migrations/` | Postgres schema + RLS |

**Critical files:** `aof-web/src/lib/api.ts` (client routing), `aof-web/src/app/api/chat/route.ts` (serverless chat), `tmap-v2/src/dars/run.ts` (provider resilience), `tmap-v2/src/config.ts` (provider/mock resolution), `tmap-v2/src/v2/run.ts` (v2 orchestration), `tmap-v2/src/v2/raa.ts` (planning), `tmap-v2/src/core/agents.ts` (v1 agents).

**Duplication / dead-weight findings:**
- **Two parallel agent systems.** v1 (`core/agents.ts` + `core/*-agent.ts`) and v2 (`v2/`) coexist. v2 *re-dispatches* into v1 specialists (`v2/run.ts:117-126`). This is significant surface area and cognitive load for one product.
- **Two error-code registries.** `aof-web/src/lib/errors.ts` (AOF_ERROR_001-013) **and** `aof-web/src/lib/errors/error-codes.ts` (AUTH-/API-/DB- codes). Overlapping, unreconciled.
- **`coagentix-cli/` is a third product** (debate.ts, reliability.ts, etc.) that the memory notes as "V3" — orphaned relative to the web/backend audit scope; unclear if shipped.
- **62 TODO/placeholder/stub markers across 36 files** (grep). Most are benign prompt strings ("no placeholders" in the Coder system prompt), but the density warrants the flag.

---

## PHASE 1 — FRONTEND  **[NOT RUNTIME-VERIFIED]**

24 `page.tsx` files exist and are wired (chat, code, projects, settings, admin×9, marketing×7, login, auth callback). I can confirm they **exist and compile** (tsc clean). I **cannot** confirm rendering, hydration, mobile, dark mode, accessibility, loading/empty/error states, or console warnings without running the app.

**Honest verdict:** Structure present; **zero runtime evidence.** Marketing pages (`blog/`, `blog/[slug]`, `about`, `contact`) exist as files but their content/SEO/real-vs-lorem status is unverified. No automated frontend tests exist (no `*.test.tsx` under aof-web). **a11y and responsiveness are completely unevidenced.**

**Score: 5/10** (exists, compiles; no runtime/test evidence at all).

---

## PHASE 2 — AUTH  **[CODE-VERIFIED for logic, NOT RUNTIME-VERIFIED for flows]**

- Supabase session + native JWT bridge — `tmap-v2/src/server/auth.ts`.
- Timing-safe password compare with dummy-hash anti-enumeration — `auth.ts`.
- Admin **fail-closed**: missing `SUPABASE_SERVICE_ROLE_KEY` → 403 — `aof-web/src/middleware.ts:122-124`. **[CODE-VERIFIED]**
- Token auto-refresh ≤60s before expiry — `aof-web/src/lib/api.ts:101-104`.

**Gaps:** CSRF relies on Origin/Referer only (no token) — `middleware.ts:44-50`. Login brute-force limiter is **in-memory per instance** — `tmap-v2/src/server/rateLimit.ts` (bypassable across instances). Actual login/logout/expired-token/unauthorized-access flows were **not executed**.

**Score: 6/10.**

---

## PHASE 3 — API  **[CODE-VERIFIED for handlers, NOT RUNTIME-VERIFIED for behavior]**

28 routes mapped. Input byte-limits enforced (MAX_MESSAGE=10k etc.) — `tmap-v2/src/server/index.ts`. Rate limiting present (Supabase RPC + Redis). Image MIME validation **added this session** (was missing) — `index.ts` `/v1/image/analyze`.

**Not done:** I did not fire malformed/oversized/missing-field payloads at a running server. Status-code and validation *correctness under attack* is **unproven**.

**Score: 6/10.**

---

## PHASE 4 — DATABASE  **[LARGELY NOT VERIFIED]**

RLS policies exist on `conversations`, `messages`, `projects` (`supabase/migrations/0008`), `security_invoker=true` on search view, `increment_rate_limit()` execute revoked from anon. **[CODE-VERIFIED]**

**But:** schema consistency, foreign-key integrity, index coverage, orphan/duplicate records, and migration drift were **NOT checked against a live database.** I have migration files, not a DB. Claims about "no orphan records" cannot be made.

**Score: 5/10** (RLS present in code; integrity unverified).

---

## PHASE 5 — MEMORY  **[CODE-VERIFIED design, NOT RUNTIME-VERIFIED behavior]**

5-factor ranking (importance·recency·lexical·frequency·conflict) — `tmap-v2/src/v2/memory-v2.ts`. Memory **does** influence decisions: `v2/run.ts:87-91` loads+ranks memory, feeds `contextFit` into agent scoring and injects `memContext` into every agent prompt (`run.ts:112-135`). So memory→decision wiring is **real**.

**Brutal weaknesses:**
- Retrieval is **lexical overlap only** — no embeddings/pgvector. "Relevance" is keyword Jaccard; semantically-related memories with no shared tokens are invisible.
- **"Conflict resolution" is a 0.12 score penalty** on near-duplicates (`memory-v2.ts:132-146`), not actual reconciliation. Two contradictory memories both survive; the engine just slightly down-weights one. Calling this "conflict resolution" overstates it.
- No TTL on Supabase memory rows → unbounded growth.
- Ranked results are recomputed every request (no cache).

**Score: 6/10.**

---

## PHASE 6 — RAA: IS IT FAKE?  **[CODE-VERIFIED]**

**Verdict: RAA is genuinely dynamic, NOT keyword routing.** Evidence:
- `tmap-v2/src/v2/registry.ts:1-9` — explicit "this is DATA the scorer ranks over, NOT a routing table. There is no `if intent === X → agent Y` logic." Confirmed by reading: no such branching exists.
- `v2/raa.ts:81-82` — LLM intent parse + LLM decompose → DAG.
- Agent assignment is cosine-similarity scoring over capability vectors — `v2/score.ts`, called at `raa.ts:100`.

**But two real problems:**
1. **"Confidence" is mislabeled.** `raa.ts:127` `confidence = scoreSum / subtasks.length` — that's the **mean agent-match score**, not any measure of plan correctness or the model's certainty. The UI surfaces it as quality/confidence. Misleading.
2. The decomposition quality depends entirely on the LLM; on parse failure it silently collapses to a **single-node DAG** (`raa.ts:210-221`) — i.e., "planning" degenerates to "one model, one prompt" without telling the user the plan failed.

**Score: 7/10** (real engine, mislabeled confidence, silent degradation).

---

## PHASE 7 — TMAP / DAG  **[CODE-VERIFIED]**

Real Kahn topological sort with cycle + dangling-dependency detection (`v2/dag.ts:55-83`). Per-node retry+exponential backoff, fallback-agent chain, bounded replan, cascade-skip of dependents, deadlock detection (`v2/executor.ts`). This is **genuine** DAG execution.

**Weaknesses:** `readyNodes()` is O(n²) per pump tick (`dag.ts:86-92`). **No test exercises replan-exhaustion** or mid-execution partial failure (test files confirm only cycle/scoring/normalization are covered). "Partial reruns" claim = the replan/revive path; real but **untested under failure**.

**Score: 7/10.**

---

## PHASE 8 — ORCHESTRATOR  **[CODE-VERIFIED]**

Mode selection (fast/balanced/deep) from complexity+confidence, cost-optimizer weight adjustment, live health read — `v2/orchestrator-v2.ts`. Real.

**Weaknesses:** Chief-agent quality loop runs **up to 3 extra LLM passes with no early-exit** when the score is already high (`core/chief-agent.ts:276-298`) — pure token waste. v2 does **not stream** — output only arrives on the terminal `done` frame (`aof-web/src/lib/api.ts:411-412`), so the user stares at a blank screen for the whole run. No stress test was executed.

**Score: 6/10.**

---

## PHASE 9 — MULTI-AGENT: THE HEADLINE FINDING  **[CODE-VERIFIED]**

**Claim under test:** "independent multi-agent system."  
**Reality:** *Partially real, materially overstated.*

**What IS real:**
- v1 agents have genuinely distinct system prompts: Planner / Coder / Reviewer (`core/agents.ts:9, 49, 128`) and 4 specialists Research/Writing/Math/Vision are real, separately-implemented modules with detailed distinct prompts (e.g. `core/research-agent.ts:6-22`).

**What is FAKE / overstated:**
1. **Generic v2 agents share ONE prompt.** In `v2/run.ts:127-142`, the `default` dispatch for planner/coder/reviewer/validator uses the **identical** system prompt: `You are agent "${agentId}". Complete the subtask precisely and concisely.` They differ **only by which model** they route to. There is no behavioral specialization — it's the same instruction with a different name label.

2. **Under the common single-key deployment, all agents collapse to ONE model.** `config.ts:96-103` (`resolveRole`): if only one provider key is set (e.g. only `OPENROUTER_API_KEY` — explicitly documented as a supported single-key setup, `config.ts:105-117`), **every role resolves to the same OpenRouter model.** Combined with finding (1), the entire "multi-agent DAG" becomes **one model talking to itself with different agentId strings.** The multi-vendor differentiation (planner→Gemini, coder→DeepSeek, reviewer→Qwen, validator→Llama, `config.ts:58-63`) only materializes if the operator has **4 separate direct keys** — which the docs treat as optional.

**This is the single most overstated part of the platform.** It is "multi-agent" by architecture and "single-model role-play" in the default deployment.

**Score: 4/10.**

---

## PHASE 10 — TOOLS  **[CODE-VERIFIED, limited]**

"Tools" here = web-search providers (`aof-web/src/lib/server/search/providers.ts`: Tavily, Google CSE, GitHub, Wikipedia, Reddit) and the vision pipeline. Selection is sequential fallthrough with silent degradation on failure (`chat/route.ts:271-283`). There is **no general tool-calling framework** (no function-calling/tool-use loop with the LLM). Calling these "tool integrations" is generous — they are hardcoded search-provider adapters. Malformed-tool-output and timeout handling exist for the search path but were **not executed**.

**Score: 5/10.**

---

## PHASE 11 — LOGGING  **[CODE-VERIFIED]**

Genuinely strong. TraceId==requestId, executionId for replay, per-node attempt logs, RCA summary, cost aggregation, dual Supabase+JSONL persistence — `v2/trace.ts`, `v2/logger.ts`, tests in `phase7-logging.test.ts`. Replay/reconstruction is real (serialized graph + node states in `v2/checkpoint.ts`).

**Caveat:** trace persistence has a 3s timeout → traces can be silently dropped under slow Supabase. No external observability sink unless `SENTRY_DSN` set.

**Score: 7/10.**

---

## PHASE 12 — SECURITY  **[CODE-VERIFIED, NOT pen-tested]**

**Strong:** AES-256-GCM + scrypt for keys at rest (`tmap-v2/src/server/crypto.ts`); timing-safe compares; RLS; immutable audit log; fail-closed admin; **mock fails CLOSED in production** (`dars/run.ts:51-57` throws unless `mockAllowed()` — and `config.ts:152-159` gates mock off when `NODE_ENV==='production'`).

**Real risks:**
- **Mock-leak by misconfiguration:** if `NODE_ENV` is NOT set to `production` on Render, `mockAllowed()` returns true and **users receive fabricated AI answers that look real** (`config.ts:158`, `providers/client.ts:115-137`). This is a config-dependent integrity hole — verify `NODE_ENV=production` on Render.
- Prompt injection: LOW (user text isolated in `{role:'user'}`), but **memory is injected into agent prompts** (`v2/run.ts:133`) → a poisoned memory row becomes persistent injection. There is **no sanitization of memory content** before prompt injection. Memory-poisoning is a real, unmitigated vector.
- CSRF token absent; webhooks unsigned; KDF salt hardcoded (`crypto.ts:14`).
- C1 (image MIME) — **fixed this session.**

**Score: 6/10.**

---

## PHASE 13 — PERFORMANCE  **[ESTIMATES ONLY — NO REAL MEASUREMENTS]**

**Brutal honesty: there are no real benchmarks.** The prior `PERFORMANCE_REPORT.md` "before/after" numbers are **static estimates, not measured latencies.** No load test, no profiler output, no p50/p95 data exists in this repo.

What's structurally true: bounded parallelism, exponential backoff, failover chains, no obvious N+1. What's structurally bad: 2 mandatory sequential LLM calls before any work (`raa.ts:81-82`), quality loop up to 3 extra calls, per-instance in-memory caches, **Render free-tier cold start (15-min idle → 30-60s spin-up)** which is the actual cause of the AOF_ERROR_006 502s you saw.

**Score: 5/10** (claims unbacked by measurement; known cold-start problem).

---

## PHASE 14 — CHAOS  **[CODE-VERIFIED mechanisms, NOT injected]**

Recovery mechanisms are real and well-built (three-tier storage fallback, circuit breaker with failure-type cooldowns `dars/health.ts`, all 9 client stream fns now fall through to `/api/chat` — fixed earlier this session). **But no chaos was actually injected** — I read the recovery code, I did not kill a provider mid-stream. The replan-exhaustion and memory-corruption paths have **no test coverage**.

**Score: 7/10** (strong design; unproven under real injection).

---

## PHASE 15 — UX  **[NOT RUNTIME-VERIFIED]**

Genuinely good: the error model is structured and honest — `AofProviderError` tells the user what failed, why, which provider, and how to fix it, and the system refuses to fake answers (`errors.ts` design principle). That's better than most. Everything else (onboarding, settings usability, chat flow feel, mobile) is **unevidenced** — no runtime, no user testing.

**Score: 5/10.**

---

## PHASE 16 — PRODUCTION READINESS

| Scale | Verdict | Blockers |
|-------|---------|----------|
| Public beta | **Conditional GO** | Need: `NODE_ENV=production` + Render Starter (no cold-start 502) + ≥1 provider key + master-key parity |
| 100 users | **Conditional GO** | Same. `/api/chat` serverless fallback carries load even if backend hiccups |
| 1,000 users | **RISKY** | Per-instance rate limiters + in-memory caches + single Render instance; Supabase connection limits unverified; no load test |
| 10,000 users | **NO** | No horizontal-scaling validation, no distributed cache/rate-limit, no measured capacity, cold-start architecture, single backend instance |

---

## FINAL SCORECARD (brutal, evidence-tagged)

| Dimension | Score | Basis |
|-----------|------|-------|
| Frontend | 5 | 24 pages compile; **zero** runtime/a11y/test evidence |
| Backend | 7 | Real Express, preflight, error handling [CODE] |
| Auth | 6 | Solid logic, fail-closed admin; flows not executed; in-mem limiter |
| API | 6 | 28 routes, byte limits, rate limit; not attack-tested |
| Database | 5 | RLS in code; integrity/indexes/orphans **unverified** |
| Memory | 6 | Real influence; lexical-only, weak "conflict" handling |
| RAA | 7 | Genuinely score-based; "confidence" mislabeled |
| TMAP | 7 | Real DAG/retry/replan; failure paths untested |
| Orchestrator | 6 | Real modes; wasteful quality loop; no streaming |
| Multi-Agent | 4 | **Collapses to one model under single-key deploy** |
| Logging | 7 | Strong trace/replay/RCA |
| Security | 6 | Strong crypto/RLS; memory-poisoning + mock-leak-on-misconfig |
| Performance | 5 | **No real measurements**; cold-start 502s |
| UX | 5 | Excellent error honesty; rest unevidenced |
| Reliability | 7 | Strong fallback design; chaos not injected |

### OVERALL: **5.9 / 10 — Functional Prototype with advanced architecture**
(Down from the repo's prior self-assessed 7.25. The correction is driven by Phase 9 multi-agent collapse, Performance having no real measurements, and the large NOT-RUNTIME-VERIFIED surface.)

---

## TOP 20 CRITICAL PROBLEMS

1. **Multi-agent collapses to a single model** under single-provider-key deployment (`config.ts:96-103` + `v2/run.ts:127-142`).
2. **Generic v2 agents share one identical prompt** — no behavioral specialization.
3. **Mock answers can leak to users** if `NODE_ENV !== 'production'` on Render (`config.ts:158`).
4. **Memory poisoning is unmitigated** — memory content injected raw into prompts (`v2/run.ts:133`), no sanitization.
5. **No real performance measurements exist** — all benchmark numbers are estimates.
6. **Render free-tier cold start** is the root cause of production 502/AOF_ERROR_006.
7. **"Confidence" metric is mislabeled** (mean agent-match score, not plan quality) (`raa.ts:127`).
8. **RAA silently degrades to a single-node DAG** on decompose failure with no user signal (`raa.ts:210-221`).
9. **Database integrity entirely unverified** — no live FK/index/orphan checks possible from code.
10. **Zero frontend tests / a11y evidence** across 24 pages.
11. **"Conflict resolution" is a 0.12 penalty**, not reconciliation (`memory-v2.ts`).
12. **Quality loop wastes up to 3 LLM calls** with no early-exit (`chief-agent.ts:276-298`).
13. **v2 has no token streaming** — blank screen for entire run.
14. **Per-instance rate limiters + caches** block horizontal scaling.
15. **CSRF has no token** — header-only protection (`middleware.ts:44-50`).
16. **Webhooks unsigned** — no HMAC verification.
17. **Two unreconciled error-code registries** (`errors.ts` vs `errors/error-codes.ts`).
18. **Two parallel agent systems** (v1 + v2) — maintenance/clarity debt.
19. **Replan-exhaustion & memory-corruption paths untested.**
20. **`isLowQuality` is crude** — a valid coder reply without ``` triggers needless failover (`dars/run.ts:137`).

## PRODUCTION BLOCKERS (must fix before public beta)
- Set `NODE_ENV=production` on Render (kills mock-leak + matches mockAllowed gate).
- Render Starter tier (kills cold-start 502s).
- Confirm `COAGENTIX_MASTER_KEY` identical on Vercel + Render (else stored keys undecryptable).
- ≥1 verified provider key on both Vercel (`/api/chat`) and Render (`/v1/*`).

## SECURITY RISKS
Memory-poisoning (unmitigated), mock-leak-on-misconfig, CSRF token gap, unsigned webhooks, hardcoded KDF salt, in-memory login limiter.

## SCALABILITY RISKS
Single Render instance, per-instance rate/cache state, cold-start architecture, unverified Supabase connection ceiling, no load test.

## TECHNICAL DEBT
Two agent systems, two error registries, mislabeled confidence, orphan CLI product, 62 placeholder markers, no frontend test suite.

## IMPROVEMENT ROADMAP
1. **Honesty fix:** rename "confidence" → "agentMatchScore"; surface "plan-degraded" when single-node fallback fires.
2. **Make multi-agent real or stop claiming it:** give generic v2 agents distinct system prompts, OR document clearly that without 4 keys it's single-model.
3. **Sanitize memory before prompt injection** (strip instruction-like content).
4. **Real benchmarks:** add a load test (k6/autocannon) and publish p50/p95.
5. **Distributed rate-limit + cache via Redis** before 1k users.
6. **Frontend test suite + a11y pass.**
7. **Stream v2 output.** Early-exit the quality loop.
8. **Reconcile the two error registries.**

## LAUNCH READINESS
**Closed beta: yes**, once the 4 blockers are cleared. **Public/scale: no**, until multi-agent claims are corrected, real load testing exists, and state is externalized for horizontal scaling.
