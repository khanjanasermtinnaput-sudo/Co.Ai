-- ============================================================
-- Co.AI Phase 7 — Logging Migration
-- Run once on your Supabase project. Idempotent.
-- Adds: execution_logs table, execution_id + total_cost_usd to
-- execution_traces, and a supporting replay_sessions view.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Phase 7: Structured execution log (one row per LogEntry) ─────────────────
CREATE TABLE IF NOT EXISTS execution_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id     TEXT        NOT NULL,     -- == request_id of the parent trace
  execution_id TEXT        NOT NULL,     -- trace_id:timestamp (unique per run/replay)
  node_id      TEXT,
  agent_id     TEXT,
  level        TEXT        NOT NULL DEFAULT 'info',   -- debug|info|warn|error
  category     TEXT        NOT NULL,                  -- node|agent|latency|cost|failure|system
  message      TEXT        NOT NULL,
  meta         JSONB       NOT NULL DEFAULT '{}',
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS execution_logs_trace_idx     ON execution_logs (trace_id);
CREATE INDEX IF NOT EXISTS execution_logs_exec_idx      ON execution_logs (execution_id);
CREATE INDEX IF NOT EXISTS execution_logs_ts_idx        ON execution_logs (ts DESC);
CREATE INDEX IF NOT EXISTS execution_logs_category_idx  ON execution_logs (category);
CREATE INDEX IF NOT EXISTS execution_logs_node_idx      ON execution_logs (node_id) WHERE node_id IS NOT NULL;

-- ── Phase 7: Augment execution_traces with Phase 7 columns ───────────────────
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS execution_id   TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS execution_traces_exec_idx  ON execution_traces (execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS execution_traces_cost_idx  ON execution_traces (total_cost_usd DESC);

-- ── Replay view: orders all log entries for a trace by timestamp ──────────────
-- Usage: SELECT * FROM replay_log WHERE trace_id = 'req-abc' ORDER BY ts;
CREATE OR REPLACE VIEW replay_log AS
SELECT
  l.trace_id,
  l.execution_id,
  l.ts,
  EXTRACT(EPOCH FROM (l.ts - t.started_at)) * 1000 AS offset_ms,
  l.category,
  l.level,
  l.node_id,
  l.agent_id,
  l.message,
  l.meta
FROM execution_logs l
JOIN execution_traces t ON t.request_id = l.trace_id
ORDER BY l.ts;

-- ── Failure summary view: latest failure per node for RCA dashboard ───────────
CREATE OR REPLACE VIEW failure_summary AS
SELECT DISTINCT ON (trace_id, node_id)
  trace_id,
  execution_id,
  node_id,
  agent_id,
  meta->>'kind'  AS rca_kind,
  meta->>'error' AS error_snippet,
  ts
FROM execution_logs
WHERE category = 'failure'
ORDER BY trace_id, node_id, ts DESC;

-- ── Cost rollup view: total cost per trace ────────────────────────────────────
CREATE OR REPLACE VIEW cost_by_trace AS
SELECT
  trace_id,
  execution_id,
  SUM((meta->>'costUsd')::NUMERIC)  AS total_cost_usd,
  COUNT(*)                           AS cost_entries,
  MIN(ts)                            AS first_ts,
  MAX(ts)                            AS last_ts
FROM execution_logs
WHERE category = 'cost'
GROUP BY trace_id, execution_id;

-- ── Latency rollup: avg + p95 per node across traces ─────────────────────────
CREATE OR REPLACE VIEW latency_by_node AS
SELECT
  node_id,
  agent_id,
  AVG((meta->>'latencyMs')::NUMERIC)                             AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (meta->>'latencyMs')::NUMERIC) AS p95_latency_ms,
  COUNT(*)                                                       AS sample_count
FROM execution_logs
WHERE category = 'latency' AND node_id IS NOT NULL
GROUP BY node_id, agent_id;
