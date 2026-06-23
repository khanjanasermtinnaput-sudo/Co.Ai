// ── /api/admin/announcements/[id] ────────────────────────────────────────────
// PATCH  - Update or toggle an announcement.
// DELETE - Delete an announcement.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("announcements").select("id").eq("id", params.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "not-found" }, { status: 404 });

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
  if (updateErr) return NextResponse.json({ error: "update-failed", detail: updateErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.announcement_update", params.id, "announcement", { updates });
  return NextResponse.json({ ok: true, announcement: updated });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  const { error: delErr } = await getAdminSupabase().from("announcements").delete().eq("id", params.id);
  if (delErr) return NextResponse.json({ error: "delete-failed", detail: delErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.announcement_delete", params.id, "announcement");
  return NextResponse.json({ ok: true });
}
