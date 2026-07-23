// ── /api/admin/subscriptions/[id] ────────────────────────────────────────────
// PATCH  - Update subscription (change plan, expiry, status, lifetime toggle).
// DELETE - Revoke subscription (revert user to FREE).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { formatError } from "@/lib/errors/api-error";

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



export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON in request body.", detail: "invalid-json" }, 400);
  }

  const supabase = getAdminSupabase();

  // Fetch existing subscription
  const { data: existing, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("id", params.id)
    .single();

  if (fetchErr || !existing) {
    return formatError("DB_500", { message: "Subscription not found.", detail: "subscription-not-found" }, 404);
  }

  const VALID_PLANS = ["FREE", "LITE", "PRO", "ADVANCED"];
  const updates: Record<string, unknown> = {};

  if (typeof body.plan === "string") {
    if (!VALID_PLANS.includes(body.plan)) {
      return formatError("SYSTEM_500", { message: "Invalid plan.", detail: "invalid-plan" }, 400);
    }
    updates.plan = body.plan;
  }

  if (body.expiresAt !== undefined) {
    updates.expires_at = body.expiresAt === null ? null : new Date(body.expiresAt as string).toISOString();
  }

  if (typeof body.isLifetime === "boolean" && body.isLifetime) {
    updates.expires_at = null;
  }

  if (Object.keys(updates).length === 0) {
    return formatError("SYSTEM_500", { message: "No fields to update.", detail: "no-fields-to-update" }, 400);
  }

  const { data: updated, error: updateErr } = await supabase
    .from("subscriptions")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (updateErr) {
    return formatError("DB_500", { detail: updateErr.message });
  }

  // Sync app_metadata.tier if plan changed
  if (updates.plan) {
    const { data: targetData } = await supabase.auth.admin.getUserById(existing.user_id as string);
    if (targetData?.user) {
      await supabase.auth.admin.updateUserById(existing.user_id as string, {
        app_metadata: {
          ...(targetData.user.app_metadata ?? {}),
          tier: updates.plan,
        },
      });
    }
  }

  await supabase.from("system_logs").insert({
    actor_id:    caller.id,
    action:      "admin.subscription.update",
    target_id:   existing.user_id as string,
    target_type: "subscription",
    metadata:    { subscriptionId: params.id, changes: updates },
    severity:    "info",
  });

  return NextResponse.json({ ok: true, subscription: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  const supabase = getAdminSupabase();

  const { data: existing, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("id", params.id)
    .single();

  if (fetchErr || !existing) {
    return formatError("DB_500", { message: "Subscription not found.", detail: "subscription-not-found" }, 404);
  }

  if (existing.revoked_at) {
    return formatError("SYSTEM_500", { message: "Subscription already revoked.", detail: "already-revoked" }, 400);
  }

  // Soft-revoke the subscription
  const { error: revokeErr } = await supabase
    .from("subscriptions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: caller.id,
    })
    .eq("id", params.id);

  if (revokeErr) {
    return formatError("DB_500", { detail: revokeErr.message });
  }

  // Check if user has another active subscription; if not, revert tier to FREE
  const { data: otherActive } = await supabase
    .from("subscriptions")
    .select("id, plan")
    .eq("user_id", existing.user_id as string)
    .is("revoked_at", null)
    .limit(1);

  const newTier = otherActive?.[0]?.plan ?? "FREE";

  const { data: targetData } = await supabase.auth.admin.getUserById(existing.user_id as string);
  if (targetData?.user) {
    await supabase.auth.admin.updateUserById(existing.user_id as string, {
      app_metadata: {
        ...(targetData.user.app_metadata ?? {}),
        tier: newTier,
      },
    });
  }

  await supabase.from("system_logs").insert({
    actor_id:    caller.id,
    action:      "admin.subscription.revoke",
    target_id:   existing.user_id as string,
    target_type: "subscription",
    metadata: {
      subscriptionId: params.id,
      previousPlan:   existing.plan,
      revertedTo:     newTier,
    },
    severity: "warning",
  });

  return NextResponse.json({ ok: true, revertedTo: newTier });
}
