-- ── Phase 3: Security & Audit ─────────────────────────────────────────────────
-- Adds comprehensive security infrastructure:
--   audit_log        — immutable security event trail (replaces/extends system_logs)
--   user_sessions    — tracked active sessions with device info + revocation
--   user_devices     — device fingerprint registry
--   user_mfa         — TOTP secret + backup codes (AES-256-GCM at rest)
--   role_permissions — granular permission grants per role (extends user_roles)
--   security_alerts  — flagged events requiring investigation
--   csp_violations   — CSP report-uri collector
--   provider_keys    — adds expiry, last-used, key_hash columns
-- All tables: RLS enabled, service_role bypass, user-read-own where safe.

-- ── audit_log ─────────────────────────────────────────────────────────────────
-- Append-only security event trail (never updated, never deleted).
-- action naming: <category>.<verb>  e.g. auth.login, mfa.enabled, key.rotated
create table if not exists public.audit_log (
  id              uuid        not null default gen_random_uuid() primary key,
  ts              timestamptz not null default now(),
  actor_id        uuid        references auth.users(id) on delete set null,
  actor_ip        text,
  action          text        not null,
  resource_type   text,
  resource_id     text,
  outcome         text        not null default 'success'
                              check (outcome in ('success', 'failure', 'blocked')),
  severity        text        not null default 'info'
                              check (severity in ('debug', 'info', 'warn', 'critical')),
  metadata        jsonb       not null default '{}',
  correlation_id  text,
  user_agent      text
);

alter table public.audit_log enable row level security;
create policy "service_role_audit_all"  on public.audit_log for all  to service_role using (true) with check (true);
create policy "user_read_own_audit"     on public.audit_log for select to authenticated using (auth.uid() = actor_id);

create index if not exists audit_log_actor_ts_idx    on public.audit_log (actor_id, ts desc);
create index if not exists audit_log_action_ts_idx   on public.audit_log (action,    ts desc);
create index if not exists audit_log_severity_idx    on public.audit_log (severity,  ts desc) where severity in ('warn', 'critical');
create index if not exists audit_log_ts_idx          on public.audit_log (ts desc);
create index if not exists audit_log_outcome_idx     on public.audit_log (outcome,   ts desc) where outcome = 'failure';

-- ── user_sessions ─────────────────────────────────────────────────────────────
-- Companion table to Supabase's auth.sessions — adds device info + revocation.
-- session_token_hash = HMAC-SHA256 (token, JWT_SECRET); never store plaintext.
create table if not exists public.user_sessions (
  id                  uuid        not null default gen_random_uuid() primary key,
  user_id             uuid        not null references auth.users(id) on delete cascade,
  session_token_hash  text        not null unique,
  device_id           uuid,
  ip_address          text,
  user_agent          text,
  country_code        text,
  last_active_at      timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  revoke_reason       text,
  created_at          timestamptz not null default now()
);

alter table public.user_sessions enable row level security;
create policy "service_role_sessions_all"   on public.user_sessions for all    to service_role using (true) with check (true);
create policy "user_read_own_sessions"      on public.user_sessions for select to authenticated using (auth.uid() = user_id);

create index if not exists user_sessions_user_idx   on public.user_sessions (user_id, last_active_at desc);
create index if not exists user_sessions_hash_idx   on public.user_sessions (session_token_hash) where revoked_at is null;
create index if not exists user_sessions_expiry_idx on public.user_sessions (expires_at)          where revoked_at is null;

-- ── user_devices ──────────────────────────────────────────────────────────────
-- Fingerprint-based device registry. Fingerprint = SHA-256(UA+lang+platform).
create table if not exists public.user_devices (
  id              uuid        not null default gen_random_uuid() primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  fingerprint     text        not null,
  name            text,                               -- e.g. "Chrome on macOS"
  last_ip         text,
  last_seen_at    timestamptz not null default now(),
  trusted_at      timestamptz,
  revoked_at      timestamptz,
  session_count   integer     not null default 0,
  created_at      timestamptz not null default now(),
  unique (user_id, fingerprint)
);

alter table public.user_devices enable row level security;
create policy "service_role_devices_all"   on public.user_devices for all    to service_role using (true) with check (true);
create policy "user_read_own_devices"      on public.user_devices for select to authenticated using (auth.uid() = user_id);

create index if not exists user_devices_user_idx on public.user_devices (user_id, last_seen_at desc);

-- FK from user_sessions to user_devices (deferred to avoid ordering issues)
alter table public.user_sessions
  add constraint if not exists fk_user_sessions_device
  foreign key (device_id) references public.user_devices(id) on delete set null;

-- ── user_mfa ──────────────────────────────────────────────────────────────────
-- TOTP secret + one-time backup codes. Secret encrypted AES-256-GCM at rest.
-- enabled_at null = MFA in setup state (secret generated but not yet confirmed).
create table if not exists public.user_mfa (
  user_id         uuid        not null primary key references auth.users(id) on delete cascade,
  totp_secret_enc text        not null,              -- AES-256-GCM encrypted base32 secret
  backup_codes    text[]      not null default '{}', -- SHA-256 hashes of 8-char codes
  enabled_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.user_mfa enable row level security;
create policy "service_role_mfa_all" on public.user_mfa for all to service_role using (true) with check (true);

-- ── role_permissions ──────────────────────────────────────────────────────────
-- Granular permission strings per role. Checked at the API layer via RBAC helper.
-- Permissions use <resource>:<action> format.
create table if not exists public.role_permissions (
  id          uuid not null default gen_random_uuid() primary key,
  role        text not null check (role in ('OWNER', 'ADMIN', 'STAFF', 'BETA_TESTER')),
  permission  text not null,
  granted_at  timestamptz not null default now(),
  unique (role, permission)
);

alter table public.role_permissions enable row level security;
create policy "service_role_rbac_all"      on public.role_permissions for all    to service_role using (true) with check (true);
create policy "authenticated_read_rbac"    on public.role_permissions for select to authenticated using (true);

-- Seed default permissions
insert into public.role_permissions (role, permission) values
  -- OWNER: full control
  ('OWNER', 'users:read'),      ('OWNER', 'users:write'),    ('OWNER', 'users:delete'),
  ('OWNER', 'roles:read'),      ('OWNER', 'roles:write'),
  ('OWNER', 'keys:admin'),
  ('OWNER', 'sessions:revoke'), ('OWNER', 'sessions:read'),
  ('OWNER', 'devices:admin'),
  ('OWNER', 'mfa:bypass'),
  ('OWNER', 'audit:read'),
  ('OWNER', 'security:admin'),
  ('OWNER', 'metrics:read'),
  ('OWNER', 'flags:write'),     ('OWNER', 'flags:read'),
  ('OWNER', 'alerts:read'),     ('OWNER', 'alerts:resolve'),
  -- ADMIN: manage users + sessions + view audit
  ('ADMIN', 'users:read'),      ('ADMIN', 'users:write'),
  ('ADMIN', 'roles:read'),
  ('ADMIN', 'sessions:revoke'), ('ADMIN', 'sessions:read'),
  ('ADMIN', 'audit:read'),
  ('ADMIN', 'metrics:read'),
  ('ADMIN', 'flags:read'),
  ('ADMIN', 'alerts:read'),     ('ADMIN', 'alerts:resolve'),
  -- STAFF: read-only + audit view
  ('STAFF', 'users:read'),
  ('STAFF', 'audit:read'),
  ('STAFF', 'metrics:read'),
  ('STAFF', 'alerts:read'),
  -- BETA_TESTER: no elevated admin access
  ('BETA_TESTER', 'metrics:read')
on conflict do nothing;

-- ── security_alerts ───────────────────────────────────────────────────────────
-- Flagged security events (brute force, suspicious login, abuse, etc.).
create table if not exists public.security_alerts (
  id           uuid        not null default gen_random_uuid() primary key,
  ts           timestamptz not null default now(),
  alert_type   text        not null,   -- 'brute_force' | 'suspicious_login' | 'rate_limit_abuse' | 'bot_detected' | 'mfa_bypass_attempt'
  actor_ip     text,
  actor_id     uuid        references auth.users(id) on delete set null,
  severity     text        not null default 'medium'
               check (severity in ('low', 'medium', 'high', 'critical')),
  resolved_at  timestamptz,
  resolved_by  uuid        references auth.users(id) on delete set null,
  metadata     jsonb       not null default '{}'
);

alter table public.security_alerts enable row level security;
create policy "service_role_alerts_all"  on public.security_alerts for all to service_role using (true) with check (true);

create index if not exists security_alerts_ts_idx          on public.security_alerts (ts desc);
create index if not exists security_alerts_unresolved_idx  on public.security_alerts (severity, ts desc) where resolved_at is null;
create index if not exists security_alerts_actor_ip_idx    on public.security_alerts (actor_ip, ts desc);

-- ── csp_violations ────────────────────────────────────────────────────────────
-- Stores Content-Security-Policy violation reports from the browser.
create table if not exists public.csp_violations (
  id                  uuid        not null default gen_random_uuid() primary key,
  ts                  timestamptz not null default now(),
  document_uri        text,
  violated_directive  text,
  effective_directive text,
  blocked_uri         text,
  source_file         text,
  line_number         integer,
  column_number       integer,
  user_agent          text,
  actor_id            uuid        references auth.users(id) on delete set null
);

alter table public.csp_violations enable row level security;
create policy "service_role_csp_all" on public.csp_violations for all to service_role using (true) with check (true);
create index if not exists csp_violations_ts_idx         on public.csp_violations (ts desc);
create index if not exists csp_violations_directive_idx  on public.csp_violations (violated_directive, ts desc);

-- ── provider_keys enhancements ────────────────────────────────────────────────
-- Add expiry, rotation tracking, and usage auditing columns.
alter table public.provider_keys
  add column if not exists expires_at       timestamptz,
  add column if not exists last_used_at     timestamptz,
  add column if not exists rotation_due_at  timestamptz,
  add column if not exists key_hash         text,     -- HMAC-SHA256(encrypted_key) for audit lookups
  add column if not exists scopes           text[]    default '{}';

-- ── Helper stored functions ───────────────────────────────────────────────────

-- Insert a security audit event (call from service_role API routes).
create or replace function public.log_audit_event(
  p_actor_id      uuid,
  p_actor_ip      text,
  p_action        text,
  p_resource_type text  default null,
  p_resource_id   text  default null,
  p_outcome       text  default 'success',
  p_severity      text  default 'info',
  p_metadata      jsonb default '{}',
  p_corr_id       text  default null,
  p_user_agent    text  default null
) returns uuid language plpgsql security definer as $$
declare inserted_id uuid;
begin
  insert into public.audit_log
    (actor_id, actor_ip, action, resource_type, resource_id, outcome, severity, metadata, correlation_id, user_agent)
  values
    (p_actor_id, p_actor_ip, p_action, p_resource_type, p_resource_id, p_outcome, p_severity, p_metadata, p_corr_id, p_user_agent)
  returning id into inserted_id;
  return inserted_id;
end;
$$;

-- Returns all permission strings held by a user (based on their role row).
create or replace function public.get_user_permissions(p_user_id uuid)
returns text[] language sql security definer stable as $$
  select coalesce(array_agg(distinct rp.permission), '{}')
  from   public.user_roles        ur
  join   public.role_permissions  rp on rp.role = ur.role
  where  ur.user_id = p_user_id;
$$;

-- Returns true if the user has a specific permission.
create or replace function public.user_has_permission(p_user_id uuid, p_permission text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from   public.user_roles        ur
    join   public.role_permissions  rp on rp.role = ur.role
    where  ur.user_id = p_user_id
    and    rp.permission = p_permission
  );
$$;

-- Cleans up revoked/expired sessions older than N days.
create or replace function public.prune_old_sessions(p_days integer default 30)
returns integer language plpgsql security definer as $$
declare deleted integer;
begin
  delete from public.user_sessions
  where (revoked_at is not null or expires_at < now())
    and created_at < now() - (p_days || ' days')::interval;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Inserts or updates a session record on each authenticated request.
create or replace function public.upsert_session(
  p_user_id            uuid,
  p_token_hash         text,
  p_device_id          uuid,
  p_ip                 text,
  p_user_agent         text,
  p_expires_at         timestamptz
) returns uuid language plpgsql security definer as $$
declare session_id uuid;
begin
  insert into public.user_sessions
    (user_id, session_token_hash, device_id, ip_address, user_agent, expires_at, last_active_at)
  values
    (p_user_id, p_token_hash, p_device_id, p_ip, p_user_agent, p_expires_at, now())
  on conflict (session_token_hash) do update set
    last_active_at = now(),
    ip_address     = excluded.ip_address
  returning id into session_id;
  return session_id;
end;
$$;
