// ── /api/admin/roles ──────────────────────────────────────────────────────────
// GET    - List all admin role assignments.
// POST   - Grant a role to a user (OWNER only for ADMIN role).
// DELETE - Remove elevated role from a user (?userId=xxx).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { logAdminAction, getUserRole } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOwnerOrAdmin(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "admin-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = await getUserRole(user.id);
  if (!["OWNER", "ADMIN"].includes(role)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
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

  if (dbErr) return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });

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
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { userId, role, expiresAt, notes } = body as {
    userId?: string; role?: string; expiresAt?: string; notes?: string;
  };

  if (!userId) return NextResponse.json({ error: "userId-required" }, { status: 400 });

  const VALID_ROLES = ["OWNER", "ADMIN", "STAFF", "BETA_TESTER"];
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "invalid-role", validRoles: VALID_ROLES }, { status: 400 });
  }

  // Only OWNER can grant ADMIN or OWNER roles
  if (["OWNER", "ADMIN"].includes(role) && callerRole !== "OWNER") {
    return NextResponse.json({ error: "only-owner-can-grant-admin" }, { status: 403 });
  }

  const supabase = getAdminSupabase();
  const { data: targetUser, error: userErr } = await supabase.auth.admin.getUserById(userId);
  if (userErr || !targetUser?.user) return NextResponse.json({ error: "user-not-found" }, { status: 404 });

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

  if (upsertErr) return NextResponse.json({ error: "grant-failed", detail: upsertErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.role_grant", userId, "user", { role, expiresAt });
  return NextResponse.json({ ok: true, grant }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { user: caller, role: callerRole, error } = await requireOwnerOrAdmin(req);
  if (error) return error;

  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId) return NextResponse.json({ error: "userId-required" }, { status: 400 });

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "not-found" }, { status: 404 });

  // Only OWNER can remove ADMIN roles
  if (["OWNER", "ADMIN"].includes(existing.role) && callerRole !== "OWNER") {
    return NextResponse.json({ error: "only-owner-can-remove-admin" }, { status: 403 });
  }

  const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (delErr) return NextResponse.json({ error: "delete-failed", detail: delErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.role_revoke", userId, "user", { previousRole: existing.role });
  return NextResponse.json({ ok: true });
}
