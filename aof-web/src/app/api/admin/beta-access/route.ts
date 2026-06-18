// ── /api/admin/beta-access ────────────────────────────────────────────────────
// GET    - List all beta access grants.
// POST   - Grant a beta feature to a user.
// DELETE - Remove beta access (?userId=xxx&feature=xxx).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { logAdminAction } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_FEATURES = ["titan-beta", "cli-beta", "nexora-code-beta", "experimental-models", "early-access"] as const;

async function requireAdmin(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "admin-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const { data } = await getAdminSupabase().from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  const role = data?.role ?? "USER";
  if (!["OWNER", "ADMIN"].includes(role)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user, role };
}

export async function GET(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";

  const supabase = getAdminSupabase();
  let query = supabase.from("beta_access").select("*").order("granted_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);

  const { data: grants, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });

  return NextResponse.json({ grants: grants ?? [] });
}

export async function POST(req: Request) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { userId, feature, expiresAt, notes } = body as {
    userId?: string; feature?: string; expiresAt?: string; notes?: string;
  };

  if (!userId) return NextResponse.json({ error: "userId-required" }, { status: 400 });
  if (!feature || !(VALID_FEATURES as readonly string[]).includes(feature)) {
    return NextResponse.json({ error: "invalid-feature", validFeatures: VALID_FEATURES }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  // Verify user exists
  const { data: targetUser, error: userErr } = await supabase.auth.admin.getUserById(userId);
  if (userErr || !targetUser?.user) return NextResponse.json({ error: "user-not-found" }, { status: 404 });

  const { data: grant, error: insertErr } = await supabase
    .from("beta_access")
    .upsert({
      user_id: userId,
      feature,
      granted_by: caller.id,
      expires_at: expiresAt ?? null,
      notes: notes ?? null,
      granted_at: new Date().toISOString(),
    }, { onConflict: "user_id,feature" })
    .select().single();

  if (insertErr) return NextResponse.json({ error: "grant-failed", detail: insertErr.message }, { status: 500 });

  await logAdminAction(caller.id, "beta.grant", userId, "user", { feature, expiresAt });
  return NextResponse.json({ ok: true, grant }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";
  const feature = searchParams.get("feature") ?? "";

  if (!userId || !feature) {
    return NextResponse.json({ error: "userId-and-feature-required" }, { status: 400 });
  }

  const { error: delErr } = await getAdminSupabase()
    .from("beta_access").delete().eq("user_id", userId).eq("feature", feature);
  if (delErr) return NextResponse.json({ error: "delete-failed", detail: delErr.message }, { status: 500 });

  await logAdminAction(caller.id, "beta.revoke", userId, "user", { feature });
  return NextResponse.json({ ok: true });
}
