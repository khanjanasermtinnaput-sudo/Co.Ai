# CO.AI / COAGENTIX — INDEPENDENT BRUTAL AUDIT

**Commit audited:** `f66abc5` · **Scope:** 478 tracked files, ~56.9k LOC across `aof-web`
(Next.js 14), `tmap-v2` (Express backend + agent pipeline), `coagentix-cli`.

Independent, evidence-only review. Every score is backed by code read at the commit above.
Self-congratulatory `*_REPORT.md` files already in the repo were treated as **unverified
claims**, not evidence.

---

## Methodology & evidence limits (read first)

**Verified with hard evidence:** full source read of critical paths; both test suites
executed (hermetic + with real keys); `tsc --noEmit` on both apps; route/dependency/schema
enumeration; security-pattern sweeps.

**NOT executable in this environment** (no deployed instance, no live browser, no load
harness): real browser rendering/hydration, axe accessibility scans, true 100/1k/10k-user
load tests, live prompt-injection against a running model, live chaos fault injection.
Those phases are assessed **statically from code** and labeled `[STATIC]`.

**Reproduced facts:**
- `npm test` (default, real `.env` keys present) → **47 failures**, HTTP 402
  "out of credits" from live OpenRouter calls. Suite is non-hermetic.
- `npm test` hermetic (keys stripped, `COAGENTIX_ALLOW_MOCK=1`) → **612 pass / 0 fail**.
- `tsc --noEmit` → **exit 0** for both `aof-web` and `tmap-v2`.

---

## 1. Executive summary

A **genuinely real system, not a Potemkin demo.** Cryptography is correct, the multi-agent
pipeline makes real LLM calls with distinct role prompts, memory is actually injected into
prompts, auth is server-verified, and 612/612 tests pass hermetically. The agents are not fake.

It is **not production-ready**, and several marketed capabilities are misleading:

1. **The "RAA v2" dynamic scoring + DAG + confidence engine is dead-by-default.** It only
   mounts when `COAGENTIX_V2=1` (`tmap-v2/src/server/index.ts:724`). The live default path is
   **regex keyword matching** (`core/classifier.ts`) + a **hardcoded category→role map**
   (`core/model-router.ts`) — exactly the "static mapping / keyword routing" this audit was
   told to hunt for.
2. **The test suite is non-hermetic and bills a real account** (47 live 402 failures observed).
3. **"Enterprise" scale features degrade to single-instance silently** (Redis/queue/rate-limit
   fall back to in-memory; login lockout fails open).
4. **Large surface, thin operational proof:** ~85 backend routes, two parallel orchestrators,
   two separate auth systems, 25 vanity reports.

**Overall: 5.7 / 10.**

---

## 2. Top 20 critical problems

1. v2 score-based RAA is opt-in only (`server/index.ts:724`); default = keyword routing
   (`core/classifier.ts`, 228 lines of RegExp rules) + static `CATEGORY_ROLE_MAP`
   (`core/model-router.ts`).
2. Non-hermetic test suite burns a real API account; 47 live failures reproduced.
3. Login brute-force lockout **fails open** without Redis (`server/rateLimit.ts:12-14`).
4. Rate limits are per-instance in-memory without Supabase RPC / Redis
   (`aof-web/src/lib/server/rate-limit.ts:30`) → bypassable across serverless instances.
5. DARS throws "all providers exhausted" with no graceful degradation (`dars/run.ts:118`).
6. Two orchestrators (`core/orchestrator.ts` + `v2/orchestrator-v2.ts`) and two auth systems
   (tmap-v2 username+PIN+JWT vs aof-web Supabase OAuth) → doubled bug/security surface.
7. Stateful JSON-file DB fallback on ephemeral Vercel `/tmp` → silent data loss without
   Supabase (`server/db.ts`).
8. User-code sandbox via `spawnSync` (`core/sandbox.ts`); safety rests on `sandbox-policy.ts`
   flags being correct.
9. No schema-validation layer (no zod/valibot) across ~85 routes; validation is hand-rolled.
10. Brand leakage in system prompts: "AOF Code", "AOF AI", "AOF TITAN", "Coagentix",
    "CoAgentix" all coexist (`core/*.ts`).
11. `tsx` + `typescript` are **runtime** dependencies in tmap-v2 → transpile-in-prod.
12. `requireAdmin` duplicated ~16× across admin routes, with already-divergent role sets
    (OWNER/ADMIN vs OWNER/ADMIN/STAFF).
13. No per-user cost ceiling on the web agent path despite token-tripling (vote×3, reflection,
    self-critique).
14. `maxDuration=60` (`aof-web/api/chat/route.ts:80`) vs multi-iteration agent loops →
    truncated long runs.
15. `queue.ts` advertises "BullMQ" but BullMQ is not a dependency — custom in-process
    reimplementation; misleading comment.
16. Redis/Prometheus/CDN/DR endpoints present with thin evidence of real backing infra.
17. Weak primary auth (username + PIN) on the paid tmap-v2 backend (`db.ts UserRecord.pinHash`).
18. Mock answers can reach prod if `COAGENTIX_ALLOW_MOCK`/`NODE_ENV` misconfigured
    (`config.ts:152`).
19. No CSP / security headers observed (`next.config.mjs`).
20. 25 contradictory vanity reports committed → repo docs can't be trusted at face value.

---

## 3. Production blockers

- [ ] Make `npm test` hermetic by default (force mock; gate live tests behind `test:live`).
- [ ] Require Redis + Supabase in prod, or refuse to start — don't silently degrade rate
      limiting and lockout to fail-open/per-instance.
- [ ] Pick one orchestrator and one auth system; delete the loser.
- [ ] Replace ephemeral JSON-file DB fallback with a fail-closed "DB required in prod" guard.
- [ ] Add graceful degradation (or a clear billed-out error contract) when providers exhaust.
- [ ] Enforce a per-user / per-request cost ceiling on the web agent path.

---

## 4. Security risks

| Risk | Severity | Evidence |
|---|---|---|
| Login lockout fails open w/o Redis | High | `server/rateLimit.ts:12-14` |
| Per-instance rate limits bypassable | High | `lib/server/rate-limit.ts:30` |
| User-code execution sandbox | High | `core/sandbox.ts` (`spawnSync`) |
| Weak PIN auth on paid backend | Med | `server/db.ts` `pinHash` |
| Mock answers reaching users | Med | `config.ts:152` |
| No CSP/security headers | Med | `next.config.mjs` |
| Crypto (positive) | — | `server/crypto.ts`: scrypt + AES-256-GCM, random IV, timing-safe — correct |
| Admin authz (positive) | — | server-side JWT + `user_roles` check on all 15 admin ops |
| No hardcoded secrets / no eval abuse (positive) | — | sweep clean; only Redis Lua `eval` |

---

## 5. Scalability risks `[STATIC]`

- **100 users:** feasible **if** Supabase + Redis provisioned.
- **1,000 users:** risky — in-memory fallbacks, no cost cap, token-tripling pro mode,
  `maxDuration=60` truncation, custom inline queue. Cost blowups likely before perf blowups.
- **10,000 users:** not supportable as-is; no proven horizontal-scaling story.

---

## 6. Technical debt

Two orchestrators, two `raa.ts` (Requirements Architect Agent vs routing/score engine — name
collision), two auth systems, two crypto modules, 16× duplicated `requireAdmin`, 25 stale
report files, transpile-in-prod, misleading infra comments, inconsistent branding. The
codebase grew by accretion (`phase1…phase11`, `round1…round3`) without consolidation passes.

---

## 7. Improvement roadmap

- **Now (1–2 wk):** hermetic CI; delete one orchestrator/auth/crypto; fail-closed DB/Redis
  guards; per-user cost cap; consolidate `requireAdmin`; purge vanity reports; fix branding.
- **Next (3–6 wk):** zod validation layer; Redis-backed rate limit verified under load;
  provider-exhaustion graceful path; move `tsx` to a build step; CSP headers; sandbox review.
- **Later:** flip `COAGENTIX_V2` on only after the score router is load- and quality-tested;
  real load tests at 1k/10k; observability that isn't an admin stub.

---

## 8. Launch readiness

- **Private/closed beta (≤100 users, Supabase+Redis provisioned, V1 path):** conditionally yes.
- **Public beta / 1k+:** no, until the 6 production blockers are closed.
- **10k:** no — no evidence of horizontal scale.

---

## 9. Final scorecard (0–10, evidence-backed)

| Area | Score | Key evidence |
|---|---:|---|
| Frontend | 6.5 | `tsc` exit 0; clean Next 14 App Router, themes, radix a11y primitives. Not browser/axe-tested `[STATIC]`. |
| Backend | 6.0 | ~85 routes, real logic; two orchestrators, transpile-in-prod, fail-open paths. |
| Auth | 6.5 | Admin authz server-verified + role table; but two auth systems + weak PIN backend. |
| API | 6.0 | Consistent auth refs, rate limit + 429s, error envelopes; no schema-validation layer. |
| Database | 6.0 | 15 migrations, 13 RLS-referencing, service-role isolation; ephemeral JSON fallback is a trap. |
| Memory | 7.0 | Genuinely injected (`memoryToContext`→`bb.context`) and persisted; ranking is recency/dedupe, not semantic. |
| RAA | 4.0 | v2 scoring engine is real but off by default; live path is keyword regex + static map. |
| TMAP | 6.5 | Real DAG/executor/retry/replan in v2; iterative pipeline real; e2e flaky on live billing. |
| Orchestrator | 5.5 | Real multi-stage (architect→plan→vote→critique→review→reflect→doc); duplicated v1/v2 + cost-unbounded. |
| Multi-Agent | 7.5 | Genuinely distinct role prompts (15+), distinct parsing, consensus vote — not fake agents. |
| Logging | 6.0 | Correlation middleware, trace recorder, Prometheus endpoint; replay unproven `[STATIC]`. |
| Security | 5.5 | Crypto + admin authz excellent; offset by fail-open limits, sandbox exec, no CSP. |
| Performance | 4.5 | Provider timeouts + failover present; token-tripling, no cost cap, `maxDuration=60`, no load proof. |
| UX | 6.0 `[STATIC]` | Coherent route structure, error-code system, streaming; not interactively tested. |
| Reliability | 4.5 | Hermetic tests green, but non-hermetic default + fail-open + single-instance fallbacks. |

### Overall: **5.7 / 10**

**Verdict:** A real, well-crafted multi-agent core wrapped in over-claimed "enterprise"
scaffolding. The agents and crypto are honest; the default routing, the test suite, and the
scale story are not. Close the 6 blockers and it's a credible closed beta.
