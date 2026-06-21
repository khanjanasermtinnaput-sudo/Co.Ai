-- ============================================================
-- Co.AI v2 Orchestration Migration
-- Run once on your Supabase project. Idempotent.
-- Adds: execution traces, per-node logs, ranked-memory columns.
-- Also fixes the audit_events schema mismatch (audit.ts wrote columns the
-- table never had, so every cloud audit insert was 400-ing).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── v2: Execution trace (one row per request) ────────────────────────────────
CREATE TABLE IF NOT EXISTS execution_traces (
  request_id  TEXT PRIMARY KEY,
  trace       JSONB NOT NULL DEFAULT '{}',  -- full ExecutionTrace (dag, scores, logs, replans)
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS execution_traces_started_idx ON execution_traces (started_at DESC);

-- ── v2: Per-node execution log (one row per node attempt) ────────────────────
CREATE TABLE IF NOT EXISTS trace_nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  TEXT NOT NULL REFERENCES execution_traces (request_id) ON DELETE CASCADE,
  node_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  attempt     INT  NOT NULL DEFAULT 0,
  ok          BOOLEAN NOT NULL,
  latency_ms  INT,
  cost_usd    NUMERIC,
  confidence  NUMERIC,
  error       TEXT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trace_nodes_request_idx ON trace_nodes (request_id);
CREATE INDEX IF NOT EXISTS trace_nodes_node_idx    ON trace_nodes (node_id);

-- ── v2: Ranked-memory columns (Phase 5; embeddings added later) ──────────────
ALTER TABLE memories ADD COLUMN IF NOT EXISTS importance_score REAL        NOT NULL DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS usage_count      INT         NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_used_at     TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS conflict_tags    TEXT[]      NOT NULL DEFAULT '{}';
-- Later, when an embeddings provider is wired:
--   CREATE EXTENSION IF NOT EXISTS vector;
--   ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(768);

-- ── Fix: audit_events matches src/server/audit.ts writes ─────────────────────
-- audit.ts inserts `user_agent` and `ts`. On the live DB this table did not even
-- exist (phase5-phase6 migration was never run), so cloud audit silently fell
-- back to local files. Create it self-contained with the columns the code writes.
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      TEXT,
  actor_ip      TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  outcome       TEXT NOT NULL DEFAULT 'success',
  severity      TEXT NOT NULL DEFAULT 'info',
  metadata      JSONB NOT NULL DEFAULT '{}',
  user_agent    TEXT,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS ts         TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx   ON audit_events (actor_id);
CREATE INDEX IF NOT EXISTS audit_events_action_idx     ON audit_events (action);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);

-- ── Security: these are BACKEND-ONLY tables, written with the service_role key
-- (which bypasses RLS). Enabling RLS with no policies blocks anon/authenticated
-- client access entirely — the secure default for tables clients must not touch.
ALTER TABLE execution_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE trace_nodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events     ENABLE ROW LEVEL SECURITY;
