// ── /api/admin/roles ──────────────────────────────────────────────────────────
// GET    - List all admin role assignments.
// POST   - Grant a role to a user (OWNER only for ADMIN role).
// DELETE - Remove elevated role from a user (?userId=xxx).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { logAdminAction, getUserRole } from "@/lib/admin/server";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOwnerOrAdmin(req: Request) {
  if (!isAdminConfigured()) {
    return { error: formatError("API_500", { detail: "admin-not-configured" }, 503) };
  }
  const user = await getUserFromRequest(req);
  if (!user) return { error: formatError("AUTH_401") };
  const role = await getUserRole(user.id);
  if (!["OWNER", "ADMIN"].includes(role)) {
    return { error: formatError("AUTH_403") };
  }
  return { user, role };
}

export async function GET(req: Request) {
  const { error } = await requireOwnerOrAdmin(req);
  if (error) return error;

  const supabase = getAdminSupabase();
  const { data: roles, error: dbErr } = await supabase
    .from("user_roles")
    .select("*")
    .order("granted_at", { ascending: false });

  if (dbErr) return formatError("DB_500", { detail: dbErr.message });

  // Enrich with email addresses
  const userIds = (roles ?? []).map((r) => r.user_id as string);
  const emailMap = new Map<string, string>();
  await Promise.all(userIds.map(async (uid) => {
    const { data } = await supabase.auth.admin.getUserById(uid);
    if (data?.user?.email) emailMap.set(uid, data.user.email);
  }));

  const enriched = (roles ?? []).map((r) => ({
    ...r,
    email: emailMap.get(r.user_id as string) ?? null,
  }));

  return NextResponse.json({ roles: enriched });
}

export async function POST(req: Request) {
  const { user: caller, role: callerRole, error } = await requireOwnerOrAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON in request body.", detail: "invalid-json" }, 400);
  }

  const { userId, role, expiresAt, notes } = body as {
    userId?: string; role?: string; expiresAt?: string; notes?: string;
  };

  if (!userId) return formatError("SYSTEM_500", { message: "userId is required.", detail: "userId-required" }, 400);

  const VALID_ROLES = ["OWNER", "ADMIN", "STAFF", "BETA_TESTER"];
  if (!role || !VALID_ROLES.includes(role)) {
    return formatError("SYSTEM_500", { message: "Invalid role.", detail: `invalid-role; valid: ${VALID_ROLES.join(", ")}` }, 400);
  }

  // Only OWNER can grant ADMIN or OWNER roles
  if (["OWNER", "ADMIN"].includes(role) && callerRole !== "OWNER") {
    return formatError("AUTH_403", { detail: "only-owner-can-grant-admin" });
  }

  const supabase = getAdminSupabase();
  const { data: targetUser, error: userErr } = await supabase.auth.admin.getUserById(userId);
  if (userErr || !targetUser?.user) return formatError("DB_500", { message: "User not found.", detail: "user-not-found" }, 404);

  const { data: grant, error: upsertErr } = await supabase
    .from("user_roles")
    .upsert({
      user_id: userId,
      role,
      granted_by: caller.id,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt ?? null,
      notes: notes ?? null,
    }, { onConflict: "user_id" })
    .select().single();

  if (upsertErr) return formatError("DB_500", { detail: upsertErr.message });

  await logAdminAction(caller.id, "admin.role_grant", userId, "user", { role, expiresAt });
  return NextResponse.json({ ok: true, grant }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { user: caller, role: callerRole, error } = await requireOwnerOrAdmin(req);
  if (error) return error;

  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId) return formatError("SYSTEM_500", { message: "userId is required.", detail: "userId-required" }, 400);

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!existing) return formatError("DB_500", { message: "Role assignment not found.", detail: "not-found" }, 404);

  // Only OWNER can remove ADMIN roles
  if (["OWNER", "ADMIN"].includes(existing.role) && callerRole !== "OWNER") {
    return formatError("AUTH_403", { detail: "only-owner-can-remove-admin" });
  }

  const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (delErr) return formatError("DB_500", { detail: delErr.message });

  await logAdminAction(caller.id, "admin.role_revoke", userId, "user", { previousRole: existing.role });
  return NextResponse.json({ ok: true });
}
