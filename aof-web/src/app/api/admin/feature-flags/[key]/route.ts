// ── /api/admin/feature-flags/[key] ───────────────────────────────────────────
// PATCH  - Toggle or update a feature flag.
// DELETE - Delete a feature flag.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON in request body.", detail: "invalid-json" }, 400);
  }

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("feature_flags").select("*").eq("flag_key", params.key).maybeSingle();
  if (!existing) return formatError("DB_500", { message: "Feature flag not found.", detail: "not-found" }, 404);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: caller.id };
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (typeof body.description === "string") updates.description = body.description;
  if (Array.isArray(body.targetPlans)) updates.target_plans = body.targetPlans;
  if (Array.isArray(body.targetRoles)) updates.target_roles = body.targetRoles;
  if (typeof body.rolloutPct === "number") updates.rollout_pct = body.rolloutPct;

  const { data: flag, error: updateErr } = await supabase
    .from("feature_flags").update(updates).eq("flag_key", params.key).select().single();
  if (updateErr) return formatError("DB_500", { detail: updateErr.message });

  await logAdminAction(caller.id, "admin.feature_flag_update", params.key, "feature_flag", { updates });
  return NextResponse.json({ ok: true, flag });
}

export async function DELETE(req: Request, { params }: { params: { key: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  const supabase = getAdminSupabase();
  const { error: delErr } = await supabase.from("feature_flags").delete().eq("flag_key", params.key);
  if (delErr) return formatError("DB_500", { detail: delErr.message });

  await logAdminAction(caller.id, "admin.feature_flag_update", params.key, "feature_flag", { deleted: true });
  return NextResponse.json({ ok: true });
}
