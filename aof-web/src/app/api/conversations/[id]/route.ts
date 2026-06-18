// ── /api/conversations/[id] ───────────────────────────────────────────────────
// PATCH  → rename (update title)
// DELETE → delete conversation + all its messages (cascade)

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { user };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { id } = await params;
  let body: { title?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const title = typeof body.title === "string" ? body.title.slice(0, 120) : null;
  if (!title) return NextResponse.json({ error: "title-required" }, { status: 400 });

  const { error: dbErr } = await getAdminSupabase()
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (dbErr) return NextResponse.json({ error: "update-failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { id } = await params;

  const { error: dbErr } = await getAdminSupabase()
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (dbErr) return NextResponse.json({ error: "delete-failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
