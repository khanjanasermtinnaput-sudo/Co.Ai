# Logging Report — Phase 7

**Date:** 2026-06-22  
**Status:** COMPLETE — 19/19 tests pass, `npm run typecheck` clean

---

## Overview

Phase 7 implements a unified structured logging engine (`logger.ts`) wired into the v2
execution pipeline. Every run now produces seven distinct log streams — Node, Agent, Latency,
Cost, Failure, System, and a computed RCA summary — persisted to Supabase `execution_logs`
with a local JSONL fallback. Traces gain `executionId`, `totalCostUsd`, and `rcaSummary`
fields. Three Supabase views support Replay, Debugging, and Root Cause Analysis directly from
SQL.

---

## Log Categories

| Category | Method | Level rule | What it records |
|----------|--------|-----------|-----------------|
| `node` | `logNode()` | info (ok) / error (fail) | Node outcome, attempt count, ok flag |
| `agent` | `logAgent()` | info (ok) / warn (fail) | Provider, latencyMs, costUsd, ok/fail |
| `latency` | `logLatency()` | debug (<30s) / warn (≥30s) | Named phase latency within a node |
| `cost` | `logCost()` | info | USD cost + token counts per attempt |
| `failure` | `logFailure()` | error | Error text + auto-classified `RcaKind` |
| `system` | `logSystem()` | info | Pipeline milestones (start, memory hit, mode, complete) |

---

## Trace IDs and Execution IDs

```
TraceID     = requestId          one per user request, stable across replays
ExecutionID = traceId:uuid8      unique per run instance — two replays of the
                                 same request get distinct ExecutionIDs
```

`Logger` exposes both as readonly fields. `TraceRecorder` propagates `executionId` into
`ExecutionTrace` so every persisted trace row is uniquely identified.

---

## RCA Classification

`classifyError(error: string): RcaKind` auto-classifies failure strings:

| Pattern | Kind |
|---------|------|
| `401`, `403`, `unauthorized`, `forbidden` | `provider_auth` |
| `402`, `429`, `credit`, `quota`, `rate_limit` | `provider_quota` |
| `5xx`, `bad gateway`, `ECONNREFUSED`, `ENOTFOUND` | `provider_unavailable` |
| `timeout`, `timed out` | `timeout` |
| `low_quality`, `validation`, `bad output` | `bad_output` |
| (anything else) | `unknown` |

`logFailure()` calls this automatically. `rcaSummary()` exposes:

```ts
interface RcaSummary {
  rootCause?:    { nodeId, agentId, kind, error, ts }
  cascadeChain:  string[]   // nodes that failed downstream of root
  totalFailures: number
  recovered:     boolean    // true when a prior-failed node later succeeded
  recoveryPath:  string[]   // agentIds that succeeded after failure
}
```

---

## Replay Support

`logger.timeline()` returns all entries with an `offsetMs` field (ms since first entry).
This makes deterministic replay possible: feed entries back through the event bus in
`offsetMs` order to reconstruct any execution without re-running agents.

The Supabase `replay_log` view does the same in SQL:

```sql
SELECT * FROM replay_log WHERE trace_id = 'req-abc' ORDER BY ts;
-- → category, level, node_id, agent_id, message, meta, offset_ms
```

---

## Debugging Queries

```ts
logger.forNode('n1')          // all log events for a single node
logger.forCategory('failure') // all failures across the run
logger.forCategory('latency') // all latency measurements
logger.timeline()             // full ordered timeline with ms offsets
logger.rcaSummary()           // structured root cause + recovery state
```

SQL equivalents via Supabase views:

```sql
-- Root cause per trace
SELECT * FROM failure_summary WHERE trace_id = 'req-abc';

-- Cost breakdown
SELECT * FROM cost_by_trace WHERE trace_id = 'req-abc';

-- Latency profile per node (across all traces)
SELECT * FROM latency_by_node WHERE node_id = 'build' ORDER BY avg_latency_ms DESC;
```

---

## Files Changed / Created

| File | Change |
|------|--------|
| `tmap-v2/src/v2/logger.ts` | **NEW** — Logger class, LogEntry, RcaSummary, classifyError |
| `tmap-v2/src/v2/trace.ts` | Updated — accepts Logger; proxies node/latency/cost/failure; ExecutionTrace gains executionId, totalCostUsd, rcaSummary |
| `tmap-v2/src/v2/run.ts` | Updated — creates Logger per run, wires to TraceRecorder, exposes totalCostUsd in RunV2Result |
| `tmap-v2/supabase/v2-logging-migration.sql` | **NEW** — execution_logs table + indices + replay_log / failure_summary / cost_by_trace / latency_by_node views |
| `tmap-v2/src/tests/phase7-logging.test.ts` | **NEW** — 19 tests covering all 7 log categories + RCA + replay + integration |

---

## Integration Flow

```
runV2Inner()
  │
  ├── new Logger(requestId)            ← TraceID + unique ExecutionID assigned
  ├── new TraceRecorder(requestId, logger)
  │
  ├── executeGraph()
  │     └── runNode() → trace.node()
  │           ├── logger.logNode()      Node Log
  │           ├── logger.logLatency()   Latency Log
  │           ├── logger.logCost()      Cost Log (when costUsd present)
  │           └── logger.logFailure()   Failure Log + RcaKind (on error)
  │
  ├── trace.persist()
  │     ├── Supabase execution_traces (+ execution_id, total_cost_usd)
  │     └── logger.flush()
  │           ├── Supabase execution_logs (one row per LogEntry)
  │           └── local JSONL fallback: .aof-server/trace/log-{traceId}.jsonl
  │
  └── return RunV2Result { ..., totalCostUsd: logger.totalCost() }
```

---

## Test Coverage

| Test | What it verifies |
|------|-----------------|
| TraceID / ExecutionID | Distinct ExecutionID per Logger instance; starts with traceId |
| logNode | info on success, error on failure; attempt count in meta |
| forNode | Filters by nodeId across all categories |
| logAgent | Provider, latency, cost, ok flag stored in 'agent' entries |
| logLatency | debug for fast; warn for >30s nodes |
| logCost + totalCost() | USD aggregation across multiple cost entries |
| logFailure | auto-classifies RcaKind via classifyError |
| classifyError | All 6 RcaKind patterns (auth/quota/unavailable/timeout/bad_output/unknown) |
| rcaSummary — no failures | recovered:true, empty chains |
| rcaSummary — cascade + recovery | root identified, cascade chain, recovery path |
| rcaSummary — no recovery | recovered:false, empty recoveryPath |
| timeline() | Non-negative offsetMs, non-decreasing order |
| timeline() empty | Returns [] |
| forCategory | 1 entry per category across all 6 categories |
| TraceRecorder proxy | trace.node() populates node/latency/failure logger entries |
| TraceRecorder.get() | executionId, totalCostUsd, rcaSummary present in returned trace |
| trace.persist() → JSONL | File created, line is valid JSON with correct traceId |
| executeGraph integration | Retry logged as fail+success; RCA shows provider_unavailable + recovered |

---

## Supabase Migration

Run `tmap-v2/supabase/v2-logging-migration.sql` once. Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE VIEW`).

**New table:** `execution_logs` (19 columns + 5 indices)  
**New columns on `execution_traces`:** `execution_id TEXT`, `total_cost_usd NUMERIC`  
**New views:** `replay_log`, `failure_summary`, `cost_by_trace`, `latency_by_node`

`execution_logs` uses `resolution=ignore-duplicates` on insert so re-flushed entries
(e.g., after a crash + restart) are silently skipped.
