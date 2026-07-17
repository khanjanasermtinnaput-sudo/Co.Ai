# Audit: `/v1/orchestrate` (Chief Agent) route

**Scope:** investigation only. No `.ts` file was modified, no route removed, no
enforcement added. This report is the sole output; the decision at the end is
deferred to the reviewer.

**Date:** 2026-07-17 · **Branch:** `claude/chief-agent-route-audit-00mw3f`

---

## 1. Budget-enforcement gap (confirmed)

`/v1/orchestrate` is the only paid-model route in `src/server/index.ts` with no
cost or quota protection of any kind:

| Protection | `/v1/run` (L646) | `/v2/run` (L792) | `/v1/orchestrate` (L874) |
|---|---|---|---|
| `checkQuota(u.id)` pre-flight | ✅ L677 | ✅ L821 | ❌ none |
| Pre-flight cost estimate | ❌ | ✅ L830–833 | ❌ none |
| `recordUsage` after run | ✅ L734 | ✅ L839 | ❌ none |
| `addCost` / session record | ✅ L708, L731 | partial (usage only) | ❌ none |
| API-key / mock-mode gate (`bagHasAnyKey`) | ✅ L684–691 (fails closed in prod) | ✅ L814–817 | ❌ none |

The only post-run bookkeeping `/v1/orchestrate` does is best-effort
`recordSessionMemory` (L947) — which feeds memory, not quota. Spend through this
route never accumulates against the user's daily/monthly limits. This matches
`aof-web/CLAUDE.md`, which documents the Budget Enforcer as wired into `runTMAP`
and `runYpertatosNormal` but not `chief-agent.ts`.

**Aggravating factor — the PRO gate is a no-op by default.**
`requireSubscription('PRO', 'Multi-agent orchestration')` short-circuits to
`next()` unless `COAGENTIX_ENFORCE_PLANS` is truthy
(`src/server/entitlements.ts:51-61` — "off by default until billing goes live").
So in a default deployment the route is reachable by **any authenticated user of
any tier**, with neither tier gating (in practice) nor budget enforcement.
`/v1/run` at least keeps its quota gate in that configuration; `/v1/orchestrate`
has nothing. Verified live in §5.

## 2. Frontend callers (Finding 1)

**Zero live UI surfaces call `/v1/orchestrate`.**

- A fully-built client wrapper exists: `streamOrchestrate` at
  `aof-web/src/lib/api.ts:660-719` (calls `postSSE("/v1/orchestrate", …)` at
  `api.ts:669`, includes typed `OrchestrationHandlers` and an `/api/chat`
  fallback). It is **exported but never imported or called anywhere** in
  `aof-web` — no store, hook, component, page, or test references it. Its v2
  sibling `streamOrchestrateV2` (`api.ts:729`, → `/v2/run`) is likewise uncalled.
- Contrast — `/v1/run` is **live**: `streamCodeRun` (`api.ts:345`) and
  `streamPlan` (`api.ts:532`) are consumed via `store/code-store.ts` by the
  CoCode conversation panel (`components/code/code-conversation.tsx`) and the
  Titan panel (`components/code/titan-workflow.tsx`).
- `/v2/run` is reachable only as a flag-gated (`isV2Enabled()`) branch inside
  `streamCodeRun` (`api.ts:363,401`) — same UI surfaces, opt-in.
- Searches performed: literal path strings, `orchestrate` (case-insensitive)
  across `aof-web/src`, and every `import … from "@/lib/api"` site. Remaining
  hits are descriptive text/marketing copy only.

## 3. Test coverage (Finding 2)

**None.** Across all 52 test files in `tmap-v2/src/tests` (the only test
location in the project), nothing references `/v1/orchestrate`, imports
`chief-agent`, or calls `runChiefAgent` — not happy-path, not auth, not the PRO
gate, not error cases. The single "chief" hit is an unrelated comment at
`v2-engine.test.ts:84`.

Contrast: `runTMAP` is tested directly (`orchestrator.test.ts`, ~20 call sites;
`e2e.live.test.ts`) and `runV2` is tested directly
(`v2-conversation-layer.test.ts`, `raa-default-routing.test.ts`,
`e2e.live.test.ts`, plus v2 internals suites). Note the house style tests
engines, not HTTP handlers (`e2e.live.test.ts:13-14` explains why:
`server/index.ts` calls `app.listen()` at module load) — but `runChiefAgent`
lacks even engine-level coverage.

## 4. Git history (Finding 3)

- `core/chief-agent.ts`: added (382 lines) in the repo's root/baseline commit
  `7f614d3` (2026-07-02). **Never edited since** — exactly 1 commit touches it
  (`git log --follow` confirms). The repo itself is active (69 commits, latest
  2026-07-16).
- The `/v1/orchestrate` route: originates in the same baseline. Touched **once**
  since — `0a78d34` (2026-07-11, "feat(web,tmap): isolate CoChat/CoCode
  workspaces, true hard delete, memory scoping"), which added product-scoping
  (`parseProduct`, `scopedKey(u.id, product)`) **and** the comment at L878-880:
  *"Not yet wired to a specific frontend surface … scoped once something does
  call it (Req 5)."*
- No commit ever wires the route to a frontend. Commit-message searches for
  orchestrate/chief intent surface only the *different* orchestrator work on
  `/api/chat`, not this route.

## 5. Live verification (2026-07-17, local run)

Server launched locally (`npm run server`, port 8787, mock mode — no billed
provider calls; throwaway local `JWT_SECRET`/`COAGENTIX_MASTER_KEY`, file-store
DB, in-memory Redis mock). Fresh FREE-tier user registered via
`POST /v1/auth/register`. Observed:

| Probe | Result |
|---|---|
| `POST /v1/orchestrate`, no auth | **401** `{"error":"missing token"}` — `requireAuth` works |
| `POST /v1/orchestrate`, FREE-tier user, default env | **200 SSE** — chief agent ran end-to-end (`agentsUsed:["chief"]`, `qualityScore:90`). Stream contained **no quota check, no cost estimate, no API-key/mock gate** — it went straight to `analyzing request…` |
| `POST /v1/run`, same token | 200 SSE — opened with the mock-mode/API-key gate message; `checkQuota` ran pre-stream |
| `POST /v2/run`, same token | 200 SSE — **first event:** `"estimated cost ~$0.0001 (70 tokens)"`, then RAA plan/routing events |
| `POST /v1/orchestrate` with `COAGENTIX_ENFORCE_PLANS=1` | **403** `{"error":"Multi-agent orchestration requires the PRO plan or higher.","requiredTier":"PRO","currentTier":"FREE"}` |

Every static claim reproduced exactly: the route is live and functional at the
HTTP layer, the PRO gate only exists when the env flag is set, and the budget
gap is real and observable. (Infra note: first launch failed registration with
`JWT_SECRET missing or too short` — the server requires 32+ char secret even in
dev; relaunched with local throwaway secrets. Server shut down after probes.)

## 6. Verdict (Finding 4)

**(b) An in-progress feature waiting for a frontend — but parked/stalled, not
actively progressing.**

Why (b) and not (a) "genuinely dead code": a client wrapper was deliberately
built (`streamOrchestrate`), the route was deliberately *maintained* nine days
after the baseline (product-scoping in `0a78d34`), and a code comment plus a
ticket-style reference ("Req 5") explicitly state it awaits a caller. That is
the signature of an unfinished feature, not abandoned code.

The honest caveat: **in practice today it behaves as dead** — zero callers, zero
tests of any kind, no wiring progress in the ~2 weeks since the last touch — and
it is live-verified to be the one model-invoking endpoint with neither effective
tier gating (by default) nor any budget/quota enforcement. The evidence does not
support a stronger claim in either direction; whether "Req 5" is still on a
roadmap is not answerable from this repo.

## 7. Decision pending

Two options — this audit deliberately makes no recommendation:

1. **Kill the route** — remove `POST /v1/orchestrate` (index.ts:873-959), the
   `runChiefAgent` import (index.ts:50), `core/chief-agent.ts`, and the dead
   `streamOrchestrate` wrapper (`aof-web/src/lib/api.ts:660-719`, and its
   uncalled sibling `streamOrchestrateV2` at 729-… if desired).
2. **Finish wiring it** — add `checkQuota` / cost-estimate / `recordUsage` /
   `bagHasAnyKey` parity with `/v2/run`, add engine-level tests for
   `runChiefAgent`, and connect `streamOrchestrate` to a real UI surface
   (resolving "Req 5").

No further action is taken until the reviewer chooses.
