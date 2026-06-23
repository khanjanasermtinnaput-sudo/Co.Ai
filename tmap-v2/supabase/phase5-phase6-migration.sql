-- ============================================================
-- Co.AI Phase 5 + Phase 6 Migration
-- Run once on your Supabase project.
-- Tables are idempotent (CREATE TABLE IF NOT EXISTS).
-- ============================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── PHASE 5: Developer Platform ──────────────────────────────────────────────

-- Developer API keys (long-lived scoped keys, secret stored as HMAC hash)
CREATE TABLE IF NOT EXISTS developer_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,   -- HMAC-SHA256(MASTER_KEY, rawKey)
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS developer_keys_user_id_idx ON developer_keys (user_id);
CREATE INDEX IF NOT EXISTS developer_keys_hash_idx    ON developer_keys (key_hash);

-- Audit events (append-only log)
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      TEXT,                   -- NULL for anonymous
  actor_ip      TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  outcome       TEXT NOT NULL DEFAULT 'success',
  severity      TEXT NOT NULL DEFAULT 'info',
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx  ON audit_events (actor_id);
CREATE INDEX IF NOT EXISTS audit_events_action_idx    ON audit_events (action);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);

-- Webhook registrations
CREATE TABLE IF NOT EXISTS webhooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  url              TEXT NOT NULL,
  events           TEXT[] NOT NULL DEFAULT '{}',
  encrypted_secret TEXT NOT NULL,        -- AES-256-GCM ciphertext
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delivered_at TIMESTAMPTZ,
  delivery_failures INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS webhooks_user_id_idx ON webhooks (user_id);
CREATE INDEX IF NOT EXISTS webhooks_active_idx  ON webhooks (active) WHERE active = TRUE;

-- ── PHASE 6: Scale & Enterprise ──────────────────────────────────────────────

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  owner_id     TEXT NOT NULL,
  sso_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  sso_domain   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS organizations_owner_id_idx ON organizations (owner_id);
CREATE INDEX IF NOT EXISTS organizations_slug_idx     ON organizations (slug);

-- Organization members
CREATE TABLE IF NOT EXISTS org_members (
  org_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_user_id_idx ON org_members (user_id);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS teams_org_id_idx ON teams (org_id);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
  team_id    UUID NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);

-- RBAC role assignments
CREATE TABLE IF NOT EXISTS role_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  scope       TEXT NOT NULL,   -- 'system' | 'org:<id>' | 'team:<id>'
  role        TEXT NOT NULL,   -- 'viewer' | 'member' | 'team_admin' | 'org_admin' | 'superadmin'
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by  TEXT NOT NULL,
  UNIQUE (user_id, scope)
);

CREATE INDEX IF NOT EXISTS role_assignments_user_id_idx ON role_assignments (user_id);
CREATE INDEX IF NOT EXISTS role_assignments_scope_idx   ON role_assignments (scope);

-- Backup manifests
CREATE TABLE IF NOT EXISTS backup_manifests (
  id             TEXT PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  size_bytes     BIGINT NOT NULL DEFAULT 0,
  tables         TEXT[] NOT NULL DEFAULT '{}',
  record_counts  JSONB NOT NULL DEFAULT '{}',
  checksum       TEXT NOT NULL DEFAULT '',
  encrypted      BOOLEAN NOT NULL DEFAULT TRUE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  error          TEXT,
  requested_by   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS backup_manifests_status_idx     ON backup_manifests (status);
CREATE INDEX IF NOT EXISTS backup_manifests_created_at_idx ON backup_manifests (created_at DESC);

-- Disaster recovery incidents
CREATE TABLE IF NOT EXISTS dr_incidents (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'mitigated', 'resolved')),
  affected_services TEXT[] NOT NULL DEFAULT '{}',
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  notes             TEXT[] NOT NULL DEFAULT '{}',
  opened_by         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dr_incidents_status_idx   ON dr_incidents (status);
CREATE INDEX IF NOT EXISTS dr_incidents_severity_idx ON dr_incidents (severity);
CREATE INDEX IF NOT EXISTS dr_incidents_opened_at_idx ON dr_incidents (opened_at DESC);

-- Analytics events (time-series, partitioned by month in production)
CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,
  user_id     TEXT,
  team_id     TEXT,
  org_id      TEXT,
  properties  JSONB NOT NULL DEFAULT '{}',
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analytics_events_ts_idx         ON analytics_events (ts DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_type_idx ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx    ON analytics_events (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS analytics_events_org_id_idx     ON analytics_events (org_id) WHERE org_id IS NOT NULL;

-- ── Row-level security ────────────────────────────────────────────────────────

-- Enable RLS on sensitive tables
ALTER TABLE developer_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- developer_keys: users can only see/manage their own keys
-- (service role bypasses RLS — use service role for admin operations)
CREATE POLICY IF NOT EXISTS developer_keys_owner
  ON developer_keys FOR ALL
  USING (user_id = auth.uid()::TEXT);

-- webhooks: users can only see/manage their own webhooks
CREATE POLICY IF NOT EXISTS webhooks_owner
  ON webhooks FOR ALL
  USING (user_id = auth.uid()::TEXT);

-- audit_events: read-only for the actor, service role for writes
CREATE POLICY IF NOT EXISTS audit_events_read_own
  ON audit_events FOR SELECT
  USING (actor_id = auth.uid()::TEXT OR actor_id IS NULL);

-- analytics_events: read own events
CREATE POLICY IF NOT EXISTS analytics_events_read_own
  ON analytics_events FOR SELECT
  USING (user_id = auth.uid()::TEXT);

-- ── Retention helper: purge old analytics events ──────────────────────────────

-- Optional: call this from a cron job to enforce retention
-- DELETE FROM analytics_events WHERE ts < NOW() - INTERVAL '30 days';

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Apply with:
--   supabase db push  (local dev)
--   or paste into the Supabase SQL editor
