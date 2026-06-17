// ── /api/admin/users/[id] ─────────────────────────────────────────────────────
// GET    - Fetch a single user's full profile.
// PATCH  - Update user (ban, suspend, change role, update metadata).
// DELETE - Delete user (OWNER only).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getCallerRole(userId: string): Promise<string> {
  const { data } = await getAdminSupabase()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();
  return data?.role ?? "USER";
}

async function requireAdmin(req: Request, minRoles: string[] = ["OWNER", "ADMIN"]) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "admin-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const role = await getCallerRole(user.id);
  if (!minRoles.includes(role)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user, role };
}

async function logAction(
  actorId: string,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
  severity = "info"
) {
  await getAdminSupabase().from("system_logs").insert({
    actor_id:    actorId,
    action,
    target_id:   targetId,
    target_type: "user",
    metadata,
    severity,
  });
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { user: caller, error } = await requireAdmin(req, ["OWNER", "ADMIN", "STAFF"]);
  if (error) return error;

  const supabase = getAdminSupabase();
  const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(params.id);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "user-not-found" }, { status: 404 });
  }

  const u = userData.user;

  const [rolesRes, subsRes, betaRes] = await Promise.all([
    supabase.from("user_roles").select("*").eq("user_id", params.id).single(),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", params.id)
      .order("granted_at", { ascending: false }),
    supabase.from("beta_access").select("*").eq("user_id", params.id),
  ]);

  return NextResponse.json({
    id:           u.id,
    email:        u.email ?? null,
    name:         (u.user_metadata?.name as string | null) ?? null,
    avatarUrl:    (u.user_metadata?.avatar_url as string | null) ?? null,
    appMetadata:  u.app_metadata ?? {},
    userMetadata: u.user_metadata ?? {},
    role:         rolesRes.data ?? null,
    subscriptions: subsRes.data ?? [],
    betaAccess:   betaRes.data ?? [],
    bannedUntil:  (u as { banned_until?: string }).banned_until ?? null,
    createdAt:    u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    emailConfirmedAt: u.email_confirmed_at ?? null,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { user: caller, role: callerRole, error } = await requireAdmin(req, ["OWNER", "ADMIN"]);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  // Verify target user exists
  const { data: targetData, error: findErr } = await supabase.auth.admin.getUserById(params.id);
  if (findErr || !targetData?.user) {
    return NextResponse.json({ error: "user-not-found" }, { status: 404 });
  }

  const updates: {
    ban_duration?: string;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  } = {};
  const logMeta: Record<string, unknown> = {};

  // Ban / unban
  if (typeof body.ban === "boolean") {
    updates.ban_duration = body.ban ? "876600h" : "none"; // 100 years or remove
    logMeta.ban = body.ban;
  }

  // Suspend for a fixed duration (ISO 8601 duration or hours)
  if (typeof body.banDuration === "string") {
    updates.ban_duration = body.banDuration;
    logMeta.banDuration = body.banDuration;
  }

  // Update user_metadata fields
  if (body.userMetadata && typeof body.userMetadata === "object") {
    updates.user_metadata = {
      ...(targetData.user.user_metadata ?? {}),
      ...(body.userMetadata as Record<string, unknown>),
    };
    logMeta.userMetadata = body.userMetadata;
  }

  // Update app_metadata (tier etc.)
  if (body.appMetadata && typeof body.appMetadata === "object") {
    updates.app_metadata = {
      ...(targetData.user.app_metadata ?? {}),
      ...(body.appMetadata as Record<string, unknown>),
    };
    logMeta.appMetadata = body.appMetadata;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await supabase.auth.admin.updateUserById(params.id, updates);
    if (updateErr) {
      return NextResponse.json({ error: "update-failed", detail: updateErr.message }, { status: 500 });
    }
  }

  // Change elevated role
  if (typeof body.role === "string") {
    const validRoles = ["OWNER", "ADMIN", "STAFF", "BETA_TESTER", "USER"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: "invalid-role" }, { status: 400 });
    }
    // Only OWNER can grant OWNER/ADMIN
    if (["OWNER", "ADMIN"].includes(body.role) && callerRole !== "OWNER") {
      return NextResponse.json({ error: "forbidden-role-escalation" }, { status: 403 });
    }
    if (body.role === "USER") {
      // Remove elevated role row
      await supabase.from("user_roles").delete().eq("user_id", params.id);
    } else {
      await supabase.from("user_roles").upsert(
        {
          user_id:    params.id,
          role:       body.role,
          granted_by: caller.id,
          granted_at: new Date().toISOString(),
          expires_at: (body.roleExpiresAt as string | null) ?? null,
          notes:      (body.roleNotes as string | null) ?? null,
        },
        { onConflict: "user_id" }
      );
    }
    logMeta.newRole = body.role;
  }

  await logAction(caller.id, "admin.user.update", params.id, logMeta);

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { user: caller, error } = await requireAdmin(req, ["OWNER"]);
  if (error) return error;

  const supabase = getAdminSupabase();

  const { data: targetData, error: findErr } = await supabase.auth.admin.getUserById(params.id);
  if (findErr || !targetData?.user) {
    return NextResponse.json({ error: "user-not-found" }, { status: 404 });
  }

  // Prevent self-deletion
  if (caller.id === params.id) {
    return NextResponse.json({ error: "cannot-delete-self" }, { status: 400 });
  }

  const { error: delErr } = await supabase.auth.admin.deleteUser(params.id);
  if (delErr) {
    return NextResponse.json({ error: "delete-failed", detail: delErr.message }, { status: 500 });
  }

  await logAction(caller.id, "admin.user.delete", params.id, {
    email: targetData.user.email,
  }, "warning");

  return NextResponse.json({ ok: true });
}
