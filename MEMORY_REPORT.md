# Memory Report — Phase 6 Upgrade

**Date:** 2026-06-22  
**Status:** COMPLETE — 7/7 tests pass, `npm run typecheck` clean

---

## Overview

Phase 6 upgrades the v2 memory ranking engine from a static 3-factor formula to a 5-factor
dynamic scoring system. The five new dimensions are:

| Dimension | Component | Formula |
|-----------|-----------|---------|
| `importance_score` | Dynamic (usage-boosted) | `min(1, base × (1 + 0.3 × (1 − e^{−count/3})))` |
| `recency_score` | Exponential decay from `at` | `e^{−days/30}`, neutral 0.3 when no timestamp |
| `memory_decay` | Staleness multiplier | `1.0` under 90 days; `e^{−(days−90)/45}` beyond |
| `usage_frequency` | Normalised retrieval count | `1 − e^{−count/5}` |
| `conflict_resolution` | Jaccard-based penalty | `−0.12` on lower-importance entry when overlap ≥ 0.6 |

---

## Scoring Formula

```
raw = 0.25 × dynamicImportance(base, id, freq)
    + 0.20 × recencyScore(at) × memoryDecay(at)
    + 0.35 × lexicalOverlap(query, content)
    + 0.20 × frequencyScore(id, freq)
    − conflictPenalty(id)                        ← 0 or 0.12

score = clamp(raw, 0, 1)
```

Weights sum to 1.0. `memory_decay` is a multiplier on the recency term only (not a separate
additive term), keeping the staleness effect localised without distorting other signals.

---

## Component Details

### `importance_score` (dynamic)

Category base weights are unchanged (tech=0.7, failure=0.65, decision=0.6, convention=0.5,
session=0.4). Each entry's effective importance is boosted by how often it has been recalled:

- Count = 0 → importance = base (no change)
- Count → ∞ → importance → base × 1.3 (hard-capped at 1.0)

This means frequently-confirmed knowledge rises in priority without manual curation.

### `recency_score`

30-day half-life exponential from the entry's `at` timestamp. Returns neutral 0.3 for
entries with no timestamp (tech stack, conventions) — these are treated as always-current.

### `memory_decay`

A **separate** staleness multiplier that only activates for entries older than 90 days.
Below the threshold: `memoryDecay = 1.0` (no effect). Beyond it: 45-day half-life exponential
on the excess age. Combined with `recencyScore`, a 180-day-old entry gets approximately
`recencyScore(180d) × memoryDecay(180d) = e^{−6} × e^{−2} ≈ 0.000335` on its recency
contribution — effectively zero — while still scoring on lexical and frequency.

### `usage_frequency`

Counts how many times an entry has been surfaced in `rankMemories`. Counts are persisted in
`ProjectMemory.usageFrequency` (added to the schema) and updated in `run.ts` after each
retrieval via `updateUsageFrequency`. The score is `1 − e^{−count/5}`:

| Count | frequencyScore |
|-------|---------------|
| 0     | 0.000         |
| 1     | 0.181         |
| 5     | 0.632         |
| 10    | 0.865         |
| 20    | 0.982         |

### `conflict_resolution`

After flattening all memory entries, `detectConflicts()` iterates every pair and computes
symmetric Jaccard overlap (intersection / max token-set size). Entries sharing ≥ 60% of
distinct tokens are flagged as conflicting. The lower-importance entry (the "loser") receives
a `−0.12` penalty and has `conflictsWith: [winnerId]` set on its `RankedMemory` result.

This prevents near-duplicate entries (e.g., two stale decisions that contradict each other)
from both appearing in the top results with full weight.

---

## Integration: Memory → RAA → TMAP → Orchestrator

```
loadMemory(userId)
  │
  ├── rankMemories(task, mem)         ← Phase 6 formula applied
  │     ├── dynamicImportance         uses usageFrequency
  │     ├── recencyScore × memoryDecay
  │     ├── lexicalOverlap
  │     ├── frequencyScore
  │     └── conflictPenalty
  │
  ├── contextFitFrom(ranked)          → 0..1 scalar (0.4 + 0.6 × top score, clamped)
  │     └── cfg.contextFit = () => contextFit
  │           └── score.ts rankAgents()     W.context × 0.10 per agent
  │                 └── ep.confidence       mean of top-agent scores per subtask
  │                       └── decideExecution()   ORCHESTRATOR mode (fast/balanced/deep)
  │
  ├── memoriesToContextV2(ranked)     → injected into each subtask prompt   TMAP
  │
  └── updateUsageFrequency + saveMemory  → persists counts for next session
```

### RAA influence

`contextFit` enters `scoreAgent()` in `score.ts` as the `context` factor (weight 0.10).
Higher contextFit → all agents receive a higher base context score → the highest-capability
agent benefits most → `ep.confidence` rises → orchestrator mode shifts toward `balanced`
or `fast` for well-understood tasks.

### TMAP influence

`memContext` (the bullet-list rendering of ranked entries) is prepended to every subtask
prompt in `runAgent()` (`run.ts:102-104`). This gives each specialist agent (coder, reviewer,
research, etc.) the most relevant prior knowledge without any keyword routing.

### Orchestrator influence

`decideExecution()` consumes `ep.confidence` and `ep.intent.complexity`. Memory raises
confidence (via contextFit → agent scores) and can shift the execution from `deep` to
`balanced`, reducing `maxParallel` and `maxReplans` — a cost and latency savings for
well-remembered task domains.

---

## Files Changed

| File | Change |
|------|--------|
| `tmap-v2/src/core/memory.ts` | Added `usageFrequency?: Record<string,number>` to `ProjectMemory`; initialised in `normalize()` |
| `tmap-v2/src/v2/memory-v2.ts` | Full rewrite: 5-factor formula, `detectConflicts`, `updateUsageFrequency`, exported scoring components |
| `tmap-v2/src/v2/run.ts` | Imports `updateUsageFrequency`, `saveMemory`; persists frequency counts after recall |
| `tmap-v2/src/tests/v2-orchestrator.test.ts` | 7 Phase 6 tests appended |

---

## Test Coverage

| Test | Dimension verified |
|------|--------------------|
| `phase6 importance_score` | Usage count boosts dynamic importance; high-frequency entry ranks above zero-frequency |
| `phase6 recency_score` | 5d > 30d > 120d; no-timestamp returns neutral 0.3 |
| `phase6 memory_decay` | Under 90d → 1.0; 180d → < 0.5; stale < fresh |
| `phase6 usage_frequency` | 0 at count=0; monotonically increasing; < 1 at finite count |
| `phase6 conflict_resolution` | Near-duplicate pair: loser penalised; all scores in [0,1] |
| `phase6 updateUsageFrequency` | Increments correctly; input not mutated; cumulative on repeated calls |
| `phase6 integration` | Frequent relevant memory → contextFit > 0.5 (neutral baseline) |

**Suite result:** 7/7 Phase 6 tests pass. Pre-existing failures (23) are all OpenRouter HTTP 402
(insufficient credits) — live API tests unaffected by this change.

---

## Migration Notes

- `usageFrequency` is an optional field (`?: Record<string, number>`). Existing serialised
  memories (file and Supabase) load fine without it; `normalize()` defaults it to `{}`.
- `rankMemories` signature is unchanged — existing callers that don't use the new
  `conflictsWith` field on `RankedMemory` are unaffected.
- No database migration required; the field is stored inside the `data` JSON blob in the
  `memories` table (upserted whole), not as a separate column.
