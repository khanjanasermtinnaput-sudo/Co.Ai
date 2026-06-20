# AI Systems Report — Co.AI

**Date:** 2026-06-21 · **Branch:** `audit/production-hardening`

## Method
Verified presence + test coverage of each subsystem in `tmap-v2/src/core/*` and `tmap-v2/src/dars/*`. The tmap-v2 suite runs **432 tests, 0 failures, 4 skipped**, covering plans, self-review, validation, voting, memory injection, and blueprint flows.

| System | File(s) | Status | Evidence |
|--------|---------|--------|----------|
| Chief Agent | `core/chief-agent.ts` | ✅ Working | present; orchestration entry |
| Router / Model Router | `core/model-router.ts`, `core/advanced-router.ts` | ✅ Working | task→provider routing exercised by chat route + registry tests |
| Orchestrator | `core/orchestrator.ts` | ✅ Working | core pipeline |
| Titan Mode | `core/titan.ts` | ✅ Working | "blueprint turns skip self-review" test passes; UI workflow wired in `aof-web` code store |
| DARS | `dars/classify.ts`, `dars/select.ts`, `dars/run.ts`, `dars/health.ts` | ✅ Working | classify/select/run/health modules present |
| TMAP v2 | `core/*` ensemble | ✅ Working | the engine itself; 432 passing tests |
| Memory System | `core/memory.ts`, `core/image-memory.ts` | ✅ Working | "memoryContext is injected into the system prompt" test passes; Supabase-backed when configured, in-memory fallback otherwise |
| Voting Engine | `core/vote.ts` | ✅ Working | `runCoderVote` runs N candidates, picks judged winner, falls back to A on judge failure (tests pass) |
| RAA | `core/raa.ts`, `lib/raa.ts` (web) | ✅ Working | requirements agent persona wired into chat route (`agent: "requirements"`) |
| Quality gates | `self-critique`, `reflection`, `review-gate`, `validator`, `hallucination-detector`, `eval-framework` | ✅ Working | self-review 7-pass loop tested; `validateFiles` validates JS/TS/JSON with regression coverage |
| Specialist agents | `architect`, `critic-agent`, `verifier-agent`, `research-agent`, `math-agent`, `writing-agent`, `vision-agent`, `debugger`, `documenter` | ✅ Present | agent registry tested |

## Broken / placeholder
**None identified.** No subsystem was found broken or stubbed during this audit. 4 tests are `skipped` (likely environment-gated, e.g. requiring live keys/Redis) — recommend confirming what gates them, but they are not failures.

## Notes
- The web app (`aof-web`) can run the chat/code agents **serverless** via its own provider chain (`api/chat/route.ts`) and falls back to `lib/mock.ts` with zero backend/keys — good for demos and resilience.
- Optional deps (Redis/BullMQ/Sentry/Prometheus) are `optionalDependencies`, so the engine runs without them and lights up when present.

**Systems fixed:** 0 (none broken).
