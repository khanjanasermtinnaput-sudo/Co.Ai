// ── /api/admin/announcements ──────────────────────────────────────────────────
// GET  - List announcements.
// POST - Create a new announcement.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function GET(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const activeOnly = searchParams.get("active") !== "false";

  let query = getAdminSupabase()
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false });

  if (activeOnly) query = query.eq("active", true);

  const { data: announcements, error: dbErr } = await query;
  if (dbErr) return formatError("DB_500", { detail: dbErr.message });

  return NextResponse.json({ announcements: announcements ?? [] });
}

export async function POST(req: Request) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON in request body.", detail: "invalid-json" }, 400);
  }

  const { title, content, type, targetTiers, showOn, ctaLabel, ctaUrl, dismissable, startsAt, endsAt } = body as {
    title?: string; content?: string; type?: string; targetTiers?: string[];
    showOn?: string[]; ctaLabel?: string; ctaUrl?: string;
    dismissable?: boolean; startsAt?: string; endsAt?: string;
  };

  if (!title?.trim()) return formatError("SYSTEM_500", { message: "Title is required.", detail: "title-required" }, 400);
  if (!content?.trim()) return formatError("SYSTEM_500", { message: "Content is required.", detail: "content-required" }, 400);

  const VALID_TYPES = ["maintenance", "feature", "beta", "promotion", "info"];
  const annoType = type && VALID_TYPES.includes(type) ? type : "info";

  const supabase = getAdminSupabase();
  const { data: announcement, error: insertErr } = await supabase
    .from("announcements")
    .insert({
      title: title.trim(),
      body: content.trim(),
      type: annoType,
      target_tiers: targetTiers ?? null,
      show_on: showOn ?? ["homepage", "dashboard"],
      cta_label: ctaLabel ?? null,
      cta_url: ctaUrl ?? null,
      dismissable: dismissable !== false,
      starts_at: startsAt ?? new Date().toISOString(),
      ends_at: endsAt ?? null,
      active: true,
      created_by: caller.id,
    })
    .select()
    .single();

  if (insertErr) return formatError("DB_500", { detail: insertErr.message });

  await logAdminAction(caller.id, "admin.announcement_create", announcement.id, "announcement", { title, type: annoType });
  return NextResponse.json({ ok: true, announcement }, { status: 201 });
}
