// ── /api/admin/announcements/[id] ────────────────────────────────────────────
// PATCH  - Update or toggle an announcement.
// DELETE - Delete an announcement.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON in request body.", detail: "invalid-json" }, 400);
  }

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("announcements").select("id").eq("id", params.id).maybeSingle();
  if (!existing) return formatError("DB_500", { message: "Announcement not found.", detail: "not-found" }, 404);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string") updates.title = body.title;
  if (typeof body.content === "string") updates.body = body.content;
  if (typeof body.active === "boolean") updates.active = body.active;
  if (typeof body.type === "string") updates.type = body.type;
  if (Array.isArray(body.showOn)) updates.show_on = body.showOn;
  if (Array.isArray(body.targetTiers)) updates.target_tiers = body.targetTiers;
  if (body.endsAt !== undefined) updates.ends_at = body.endsAt;
  if (typeof body.ctaLabel === "string") updates.cta_label = body.ctaLabel;
  if (typeof body.ctaUrl === "string") updates.cta_url = body.ctaUrl;

  const { data: updated, error: updateErr } = await supabase
    .from("announcements").update(updates).eq("id", params.id).select().single();
  if (updateErr) return formatError("DB_500", { detail: updateErr.message });

  await logAdminAction(caller.id, "admin.announcement_update", params.id, "announcement", { updates });
  return NextResponse.json({ ok: true, announcement: updated });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  const { error: delErr } = await getAdminSupabase().from("announcements").delete().eq("id", params.id);
  if (delErr) return formatError("DB_500", { detail: delErr.message });

  await logAdminAction(caller.id, "admin.announcement_delete", params.id, "announcement");
  return NextResponse.json({ ok: true });
}
