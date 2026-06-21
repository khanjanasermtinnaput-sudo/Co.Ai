# Phase 3 — Placeholder + TODO Audit

**Scan terms:** `TODO`, `FIXME`, `XXX`, `placeholder`, `mock`, `coming soon`, `not implemented`, `temporary`, `stub`, `dummy`, `fakeData`, `hardcoded`, `for now`.
**Scope:** `aof-web/src`, `tmap-v2/src`, `coagentix-cli/src` (excluding tests, node_modules).
**Classification:** Dead → remove · Placeholder → implement · Mock → replace · Impossible → document.

---

## Verdict

The codebase is **exceptionally clean of placeholder/dead code**. There are **zero real TODO/FIXMEs in production code**, **zero unimplemented function bodies**, and **zero "not implemented" throws**. The only reachable placeholders are **3 deliberate "coming soon" billing toasts** (product decision: checkout not launched). Mock paths are all opt-in fallbacks already validated in Phase 1.

**No code changes required in Phase 3.**

---

## Occurrence Classification

| Match | Location | Reality | Action |
|-------|----------|---------|--------|
| `TODO` / `placeholder` | `core/agents.ts:53`, `core/eval-framework.ts:236-256` | **Prompt text / lint rules** — instructions to the LLM ("no TODOs") and `forbiddenPatterns` lists that *reject* TODO-containing AI output. The opposite of a placeholder. | Keep |
| `TODO` | `tests/phase4.test.ts:331-332` | Test fixture verifying the forbidden-pattern detector. | Keep |
| `coming soon` ×3 | `billing/pricing-table.tsx:31`, `settings-view.tsx:721,914` | **Reachable, intentional.** Upgrade/checkout & docs not yet launched; UI shows an honest toast instead of a broken flow. | **Document** (see D3.1) |
| `stub` | `server/prometheus.ts:1,77` | No-op metrics stub **only when optional `prom-client` is absent** (graceful optional-dep degradation). | Keep |
| `stub`/`mock` | `core/image-pipeline.ts:151` | Mock vision read only when **no vision key configured** (validated Phase 1, by design). | Keep |
| `stub` | `lib/titan.ts:102` | Word inside an AI planning prompt ("even if you stub the provider"). | Keep |
| `temporary` | `core/image-memory.ts:6` | Comment describing the 30-day TTL cache table — accurate. | Keep |
| `hardcoded` | `self-critique.ts:51`, `vote.ts:39` | Prompt text asking the model to flag hardcoded secrets. | Keep |
| `not-configured`/`not-signed-in` throws | `settings-view.tsx:587-590`, `conversations.ts:35`, `keys.ts:59` | **Real error handling**, caught upstream and surfaced as toasts/401s. | Keep |
| `mock` (≈200 hits) | `lib/mock.ts`, `providers/client.ts`, demo paths | **Opt-in offline engine** — gated by `isDemoMode()` / no-key fallback; never masquerades as live (Phase 1 F1.1). | Keep |

---

## D3.1 — "Coming soon" billing toasts (Documented, intentional)

**Findings:** three UI affordances show a "coming soon" toast:
- `pricing-table.tsx:31` — plan checkout button
- `settings-view.tsx:721` — "Upgrade" button
- `settings-view.tsx:914` — "Documentation" link

**Determination: Reachable + Intentional (not Dead, not a defect).** Billing/checkout is deliberately not enabled — there is no payment provider wired (consistent with `entitlementsEnforced()` being dormant in `lib/plans.ts`, seen in Phase 1's `access.ts` trace). Showing an honest toast is the correct interim behavior; the alternative (a dead checkout form) would be worse.

**Why not "Implement" now:** implementing checkout requires a payment-provider integration (Stripe/etc.) and pricing/product decisions that are outside an automated repair pass and not derivable from the code. Recorded as a product backlog item, not an auto-fix.

**Disposition:** Document. No change.

---

## Output format (per directive)

1. **Findings:** 0 dead placeholders, 0 unimplemented bodies, 0 TODO/FIXME in prod code; 3 intentional "coming soon" toasts; all `mock`/`stub` matches are by-design fallbacks or prompt text.
2. **Root cause:** n/a — nothing defective.
3. **Files affected:** none.
4. **Changes made:** none.
5. **Risks:** none.
6. **Validation evidence:** full grep sweeps above; cross-referenced with Phase 1 mock-gating evidence; `prom-client` optional-dep and image-pipeline vision-key fallbacks confirmed graceful.

---

### ✅ Phase 3 complete — proceeding automatically to Phase 4 (Dead Code Elimination).
