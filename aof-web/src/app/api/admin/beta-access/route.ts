// ── /api/admin/beta-access ────────────────────────────────────────────────────
// GET    - List all beta access grants.
// POST   - Grant a beta feature to a user.
// DELETE - Remove beta access (?userId=xxx&feature=xxx).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_FEATURES = ["titan-beta", "cli-beta", "aof-code-beta", "experimental-models", "early-access"] as const;



export async function GET(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";

  const supabase = getAdminSupabase();
  let query = supabase.from("beta_access").select("*").order("granted_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);

  const { data: grants, error: dbErr } = await query;
  if (dbErr) return formatError("DB_500", { detail: dbErr.message });

  return NextResponse.json({ grants: grants ?? [] });
}

export async function POST(req: Request) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON in request body.", detail: "invalid-json" }, 400);
  }

  const { userId, feature, expiresAt, notes } = body as {
    userId?: string; feature?: string; expiresAt?: string; notes?: string;
  };

  if (!userId) return formatError("SYSTEM_500", { message: "userId is required.", detail: "userId-required" }, 400);
  if (!feature || !(VALID_FEATURES as readonly string[]).includes(feature)) {
    return formatError("SYSTEM_500", { message: "Invalid feature.", detail: `invalid-feature; valid: ${VALID_FEATURES.join(", ")}` }, 400);
  }

  const supabase = getAdminSupabase();

  // Verify user exists
  const { data: targetUser, error: userErr } = await supabase.auth.admin.getUserById(userId);
  if (userErr || !targetUser?.user) return formatError("DB_500", { message: "User not found.", detail: "user-not-found" }, 404);

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

  if (insertErr) return formatError("DB_500", { detail: insertErr.message });

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
    return formatError("SYSTEM_500", { message: "userId and feature are required.", detail: "userId-and-feature-required" }, 400);
  }

  const { error: delErr } = await getAdminSupabase()
    .from("beta_access").delete().eq("user_id", userId).eq("feature", feature);
  if (delErr) return formatError("DB_500", { detail: delErr.message });

  await logAdminAction(caller.id, "beta.revoke", userId, "user", { feature });
  return NextResponse.json({ ok: true });
}
