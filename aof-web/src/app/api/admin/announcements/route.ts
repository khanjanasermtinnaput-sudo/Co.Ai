// ── /api/admin/announcements ──────────────────────────────────────────────────
// GET  - List announcements.
// POST - Create a new announcement.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { logAdminAction } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const activeOnly = searchParams.get("active") !== "false";

  let query = getAdminSupabase()
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false });

  if (activeOnly) query = query.eq("active", true);

  const { data: announcements, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });

  return NextResponse.json({ announcements: announcements ?? [] });
}

export async function POST(req: Request) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { title, content, type, targetTiers, showOn, ctaLabel, ctaUrl, dismissable, startsAt, endsAt } = body as {
    title?: string; content?: string; type?: string; targetTiers?: string[];
    showOn?: string[]; ctaLabel?: string; ctaUrl?: string;
    dismissable?: boolean; startsAt?: string; endsAt?: string;
  };

  if (!title?.trim()) return NextResponse.json({ error: "title-required" }, { status: 400 });
  if (!content?.trim()) return NextResponse.json({ error: "content-required" }, { status: 400 });

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

  if (insertErr) return NextResponse.json({ error: "insert-failed", detail: insertErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.announcement_create", announcement.id, "announcement", { title, type: annoType });
  return NextResponse.json({ ok: true, announcement }, { status: 201 });
}
