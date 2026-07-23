// ── Admin server utilities (server-only) ──────────────────────────────────────
// Used exclusively inside Next.js API routes and Server Actions.
// NEVER import this file from a client component — it uses the service-role key.
//
// Depends on:
//   src/lib/server/supabase-admin.ts   — getAdminSupabase(), getUserFromRequest()
//   src/lib/admin/types.ts             — AdminRole, LogAction, LogSeverity
//   src/lib/admin/permissions.ts       — meetsMinRole(), isElevatedRole()

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import type { AdminRole, LogAction, LogSeverity } from "./types";
import { meetsMinRole, isElevatedRole } from "./permissions";
import { formatError } from "@/lib/errors/api-error";

// ── requireAdmin ──────────────────────────────────────────────────────────────

/**
 * Canonical admin guard for API routes. Replaces the per-route copies that each
 * re-implemented the same "verify JWT → look up user_roles → check role" logic.
 *
 * Returns the SAME shape the routes already destructure so the swap is
 * behaviour-preserving:
 *   const { user, role, error } = await requireAdmin(req);   // default: ADMIN+
 *   if (error) return error;
 *
 * `minRole` is hierarchy-aware (OWNER > ADMIN > STAFF > BETA_TESTER > USER), so
 * requireAdmin(req, "ADMIN") admits OWNER+ADMIN and requireAdmin(req, "STAFF")
 * admits OWNER+ADMIN+STAFF — exactly matching the old explicit role lists.
 */
export type RequireAdminResult =
  | { user: { id: string; email?: string }; role: AdminRole; error?: undefined }
  | { error: NextResponse; user?: undefined; role?: undefined };

export async function requireAdmin(
  req: Request,
  minRole: AdminRole = "ADMIN",
): Promise<RequireAdminResult> {
  if (!isAdminConfigured()) {
    return { error: formatError("API_500", { detail: "admin-not-configured" }, 503) };
  }
  const result = await requireRole(req, minRole);
  if (result instanceof NextResponse) return { error: result };
  return { user: result.user, role: result.role };
}

// ── getUserRole ───────────────────────────────────────────────────────────────

/**
 * Look up the admin role for a user id.
 * Returns 'USER' as the default when there is no row in user_roles — this
 * means callers never need to handle a null/undefined role value.
 */
export async function getUserRole(userId: string): Promise<AdminRole> {
  const supabase = getAdminSupabase();

  const { data, error } = await supabase
    .from("user_roles")
    .select("role, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return "USER";

  // Treat expired role grants as USER.
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return "USER";
  }

  return data.role as AdminRole;
}

// ── isFirstUser ───────────────────────────────────────────────────────────────

/**
 * Returns true when no OWNER row exists in user_roles.
 * Used during initial setup to auto-promote the first admin.
 */
export async function isFirstUser(): Promise<boolean> {
  const supabase = getAdminSupabase();

  const { count, error } = await supabase
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "OWNER");

  if (error) return false;
  return (count ?? 0) === 0;
}

// ── getAdminFromRequest ───────────────────────────────────────────────────────

/**
 * Verifies the Bearer token from the request and fetches the caller's role.
 * Returns null when:
 *   - the token is missing or invalid
 *   - the user has no elevated role (role === 'USER')
 *
 * For routes that any authenticated user can access, use getUserFromRequest()
 * from supabase-admin.ts directly instead.
 */
export async function getAdminFromRequest(
  req: Request,
): Promise<{ user: { id: string; email?: string }; role: AdminRole } | null> {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  const { data, error } = await getAdminSupabase().auth.getUser(token);
  if (error || !data.user) return null;

  const role = await getUserRole(data.user.id);
  if (!isElevatedRole(role)) return null;

  return {
    user: { id: data.user.id, email: data.user.email },
    role,
  };
}

// ── requireRole ───────────────────────────────────────────────────────────────

/**
 * Guards an API route handler by requiring a minimum admin role.
 *
 * Returns either:
 *   - `{ user, role }` when the caller meets the requirement, or
 *   - a NextResponse (401/403) to return immediately from the route handler.
 *
 * Usage inside a route:
 *   const result = await requireRole(req, 'ADMIN');
 *   if (result instanceof NextResponse) return result;
 *   const { user, role } = result;
 */
export async function requireRole(
  req: Request,
  minRole: AdminRole,
): Promise<{ user: { id: string; email?: string }; role: AdminRole } | NextResponse> {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return formatError("AUTH_401", { detail: "missing-bearer-token" });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return formatError("AUTH_401", { detail: "empty-bearer-token" });
  }

  const { data, error } = await getAdminSupabase().auth.getUser(token);
  if (error || !data.user) {
    return formatError("AUTH_401", { detail: "invalid-token" });
  }

  const role = await getUserRole(data.user.id);

  if (!meetsMinRole(role, minRole)) {
    return formatError("AUTH_403", { detail: `forbidden: required=${minRole} actual=${role}` });
  }

  return {
    user: { id: data.user.id, email: data.user.email },
    role,
  };
}

// ── logAdminAction ────────────────────────────────────────────────────────────

/**
 * Appends a row to system_logs.
 * Non-throwing — log failures are printed to stderr but never propagate so
 * they can't break the primary operation being logged.
 *
 * @param actorId    - Supabase user id of the person performing the action.
 * @param action     - Dot-namespaced action label (see LogAction).
 * @param targetId   - Optional id of the subject being acted upon.
 * @param targetType - Optional type label, e.g. "user", "subscription".
 * @param metadata   - Any additional structured context.
 * @param severity   - Defaults to 'info'.
 */
export async function logAdminAction(
  actorId: string,
  action: LogAction | string,
  targetId?: string,
  targetType?: string,
  metadata?: Record<string, unknown>,
  severity: LogSeverity = "info",
): Promise<void> {
  try {
    const supabase = getAdminSupabase();

    const { error } = await supabase.from("system_logs").insert({
      actor_id: actorId,
      action,
      target_id: targetId ?? null,
      target_type: targetType ?? null,
      metadata: metadata ?? null,
      severity,
    });

    if (error) {
      console.error("[admin/server] logAdminAction failed:", error.message, { action, actorId });
    }
  } catch (err) {
    console.error("[admin/server] logAdminAction threw:", err, { action, actorId });
  }
}

// ── recordApiUsage ────────────────────────────────────────────────────────────

/**
 * Writes a single row to api_usage_metrics.
 * Fire-and-forget — await it inside try/catch if you need to suppress errors,
 * but typically callers do not need to await the result.
 */
export async function recordApiUsage(opts: {
  user_id?: string | null;
  provider: string;
  model: string;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
  latency_ms?: number | null;
  success: boolean;
  error_code?: string | null;
  error_message?: string | null;
  feature?: string | null;
  route_target?: string | null;
}): Promise<void> {
  try {
    const supabase = getAdminSupabase();

    const { error } = await supabase.from("api_usage_metrics").insert({
      user_id: opts.user_id ?? null,
      provider: opts.provider,
      model: opts.model,
      prompt_tokens: opts.prompt_tokens ?? null,
      completion_tokens: opts.completion_tokens ?? null,
      total_tokens: opts.total_tokens ?? null,
      cost_usd: opts.cost_usd ?? null,
      latency_ms: opts.latency_ms ?? null,
      success: opts.success,
      error_code: opts.error_code ?? null,
      error_message: opts.error_message ?? null,
      feature: opts.feature ?? null,
      route_target: opts.route_target ?? null,
    });

    if (error) {
      console.error("[admin/server] recordApiUsage failed:", error.message);
    }
  } catch (err) {
    console.error("[admin/server] recordApiUsage threw:", err);
  }
}

// ── grantSubscription ─────────────────────────────────────────────────────────

/**
 * Grants a plan subscription to a user and updates their app_metadata.tier.
 * Also writes an audit log entry.
 *
 * @param actorId    - Admin performing the grant (written to system_logs).
 * @param input      - See GrantSubscriptionInput in types.ts.
 * @returns The newly created subscription id, or null on failure.
 */
export async function grantSubscription(
  actorId: string,
  input: {
    user_id: string;
    plan: string;
    duration_days?: number;
    source?: string;
    notes?: string;
  },
): Promise<string | null> {
  const supabase = getAdminSupabase();

  const expires_at = input.duration_days
    ? new Date(Date.now() + input.duration_days * 86_400_000).toISOString()
    : null;

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .insert({
      user_id: input.user_id,
      plan: input.plan,
      source: input.source ?? "manual",
      granted_by: actorId,
      expires_at,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();

  if (subErr || !sub) {
    console.error("[admin/server] grantSubscription insert failed:", subErr?.message);
    return null;
  }

  // Mirror the plan into Supabase Auth app_metadata so the client can read it
  // from the JWT without an extra round-trip.
  const { error: metaErr } = await supabase.auth.admin.updateUserById(input.user_id, {
    app_metadata: { tier: input.plan },
  });

  if (metaErr) {
    console.error("[admin/server] grantSubscription metadata update failed:", metaErr.message);
  }

  await logAdminAction(
    actorId,
    "subscription.grant",
    input.user_id,
    "user",
    { plan: input.plan, subscription_id: sub.id, expires_at, source: input.source ?? "manual" },
  );

  return sub.id;
}
