# Phase 10 — Database Audit

**Method:** inventory all 3 repo migration dirs, then cross-check the **live** Supabase project `xuupsckszsujfnrzodtw` via MCP (`list_tables`, `execute_sql`, `get_advisors` security + performance). Fix safe issues immediately; capture drift in repo migrations.

---

## Verdict

The live DB is healthy: **23 tables, RLS enabled on every one**, comprehensive indexing, proper FK cascades. Two classes of issue found and **FIXED**: (1) **schema drift** — `projects`, the conversations/messages RLS policies, and the full-text-search objects existed in production but were **missing from repo migrations** (a clean rebuild would have broken Projects + Search); (2) **advisor security/perf findings** — one ERROR + several WARNs, the actionable ones remediated on prod and captured in a migration.

---

## Live schema (23 tables, all RLS-enabled)
`users, memories, projects, provider_keys, conversations, messages, tmap_sessions, tmap_agent_logs, tmap_costs, message_embeddings, api_rate_limits, user_roles, redeem_codes, subscriptions, redeem_code_uses, beta_access, feature_flags, system_logs, announcements, api_usage_metrics, image_memories, cli_tokens, cli_sessions.`

---

## Fixes applied

### DB10.1 / DB10.2 — Schema drift captured (HIGH) → FIXED
- **Finding:** `public.projects` (used by `store/project-store.ts`), the `conversations_owner` / `messages_owner` RLS policies, and the search stack (`messages.search_vector` generated column + `messages_search_vector_idx` GIN index + `conversation_search_v` view, used by `/api/search`) all **exist live but were absent from the repo migrations**. A fresh `supabase db reset` would have produced a DB where **Projects and Search are broken**.
- **Root cause:** these objects were applied directly to prod (or via the older Aof-code repo) and never back-ported to migrations.
- **Fix:** new migration `aof-web/supabase/migrations/0008_projects_search_and_hardening.sql` reproduces them **exactly** and idempotently (DDL pulled from the live catalog), so the schema is now reproducible.
- **Files:** `0008_projects_search_and_hardening.sql`.
- **Risk:** none on prod (objects already exist; `IF NOT EXISTS`/`CREATE OR REPLACE`/`DROP POLICY IF EXISTS`).

### DB10.3 — `conversation_search_v` was SECURITY DEFINER (advisor **ERROR**) → FIXED
- A SECURITY DEFINER view bypasses the querying user's RLS. Applied `set (security_invoker = true)` on prod (verified `reloptions = {security_invoker=true}`) and encoded it in `0008`. `/api/search` uses the service-role client (which legitimately bypasses RLS and already filters `eq(user_id)`), so no behavior change there — only any anon/authenticated path is now correctly RLS-bound. View still queryable (29 rows).

### DB10.4 — Mutable `search_path` on SECURITY DEFINER functions (WARN) → FIXED
- `increment_rate_limit(...)` and `set_updated_at()` had role-mutable `search_path` (hijack risk). Applied `set search_path = public, pg_temp` on prod (verified) + captured in `0008`.

### DB10.5 — `increment_rate_limit` callable by anon/authenticated (WARN) → FIXED
- The rate-limit RPC is invoked **server-side only** via the service-role client (`lib/server/rate-limit.ts:55`) — confirmed it is never called from client code. Revoked `EXECUTE` from `anon` + `authenticated` on prod (verified 0 public grants); service-role retains it. Captured in `0008`.

### DB10.6 — `auth_rls_initplan` on hot-path policies (WARN, performance) → FIXED
- The user-facing policies (`projects` ×4, `conversations`, `messages`) called `auth.uid()` per-row. Recreated them as `(select auth.uid()) = user_id` (evaluated once per statement) on prod + in `0008`. Same semantics, better plan at scale.

---

## Documented (low / intentional — no change)

- **`rls_enabled_no_policy` (INFO ×18):** service-role-only tables (`provider_keys`, `subscriptions`, `user_roles`, `image_memories`, admin tables, `tmap_*`, etc.) intentionally have RLS **on with no policy** — the browser cannot touch them; access is only via verified-JWT service-role API routes. This is the documented design, **not** a vulnerability.
- **`users` policy `service role full access` USING(true) (WARN):** the tmap-v2 users table is reached only by the service role; the broad policy is scoped to that role. Acceptable.
- **`extension_in_public` (vector) (WARN):** common Supabase default; cosmetic. Move to a dedicated schema if desired.
- **`auth_leaked_password_protection` disabled (WARN):** enable HaveIBeenPwned check in the Supabase Auth dashboard (config, not migration). Recommended.
- **Unindexed FKs (INFO):** admin audit columns (`created_by`, `granted_by`, …) on low-traffic admin tables — add covering indexes only if those joins become hot.
- **Unused indexes (INFO):** flagged because the project has little traffic yet (newly seeded); they back real query patterns and will be exercised in production. Do **not** drop.
- **Thai FTS limitation (observation):** `conversation_search_v.search_vector` uses `to_tsvector('english', …)`, which tokenizes Thai content weakly. `/api/search` already falls back to `ilike` for these, so search still works. **Recommend** evaluating the `simple` config or `pg_trgm` for robust multilingual search — pre-existing, not a regression.

---

## Output format (per directive)

1. **Findings:** schema drift (projects/policies/FTS missing from migrations) + 1 ERROR (definer view) + 4 actionable WARNs; rest intentional/low.
2. **Root cause:** objects applied to prod were never back-ported; advisor defaults not yet hardened.
3. **Files affected:** prod DB (2 migrations applied via MCP) + `aof-web/supabase/migrations/0008_projects_search_and_hardening.sql`.
4. **Changes made:** captured drift in `0008`; on prod set view→`security_invoker`, pinned function `search_path`, revoked anon RPC grant, optimized 6 hot-path RLS policies to `(select auth.uid())`.
5. **Risks:** none — all changes are semantics-preserving or strictly tightening; verified live (view queryable, grants 0, options set).
6. **Validation evidence:** `list_tables` (23, all RLS) · catalog DDL dumps · `get_advisors` security+performance · post-fix verification query (`{security_invoker=true}`, `rpc_public_grants=0`, search view returns rows).

---

### ✅ Phase 10 complete — proceeding to Phase 11 (UX + Error Handling).
