# Database Report — Co.AI

**Date:** 2026-06-21 · **Branch:** `audit/production-hardening`

## Migrations present

**aof-web/supabase/migrations/**
- `0002_create_provider_keys.sql` — encrypted per-user API keys
- `0003_admin_system.sql` — `user_roles`, admin tables
- `0004_feedback_table.sql`
- `0005_referral_system.sql`
- `0006_conversations.sql` — conversations + messages

**Repo root supabase/migrations/**
- `20260619_cli_tokens.sql` — CLI device tokens
- `20260620_error_logs.sql` — unified error logging

**tmap-v2/supabase/**
- `migration.sql`, `phase5-phase6-migration.sql`, `image-memories-migration.sql`

## Security posture
- **`provider_keys`**: RLS enabled with **no policies** → the browser (anon/authenticated) cannot read or write it at all. The only access path is server API routes using the service-role key, scoped to the caller's own `user.id` (documented in `lib/server/supabase-admin.ts:1-6`). This is a strong design.
- **Admin authorization** is enforced at two layers: middleware (now fail-closed — see security-report H-1) and each `/api/admin/*` route handler (`requireAdminUser`).
- Foreign keys / cascade deletes are defined in the schema (e.g. conversations → messages, projects → blueprints per `ARCHITECTURE.md` §6).

## Observations
- Migration files live in **three** locations (web, root, tmap-v2). This is workable but worth documenting which environment applies which set, to avoid drift. Not a defect.
- Indexes exist on hot paths (e.g. `messages(conversation_id, created_at)`, `projects(user_id, pinned, updated_at)` per architecture doc).

## Recommendations (not auto-applied)
- Add a short `docs/DATABASE.md` mapping each migration directory to its deploy target (aof-web vs tmap-v2 vs shared) to prevent migration drift.
- For the admin user listing scale concern, add the DB view + RPC noted in `performance-report.md` (P-1).

## Verdict
Schema, RLS, FKs, and migrations are sound. No corrective changes required.

**Database issues fixed:** 0 (none found); 2 hygiene recommendations.
