// ── /api/conversations/[id] ───────────────────────────────────────────────────
// PATCH  → rename (update title)
// DELETE → delete conversation + all its messages (cascade) + purge its memory

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { parseWorkspace } from "@/lib/server/workspace";

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
  let body: { title?: unknown; workspace?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const title = typeof body.title === "string" ? body.title.slice(0, 120) : null;
  if (!title) return NextResponse.json({ error: "title-required" }, { status: 400 });

  // workspace is optional here: id is already unique + owner-scoped, this is just
  // an extra guard so a CoCode surface can never rename a CoChat row or vice versa.
  const workspace = body.workspace === undefined ? null : parseWorkspace(body.workspace);
  if (body.workspace !== undefined && !workspace) {
    return NextResponse.json({ error: "invalid-workspace" }, { status: 400 });
  }

  let query = getAdminSupabase()
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (workspace) query = query.eq("workspace", workspace);

  const { error: dbErr } = await query;

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
  const url = new URL(req.url);
  const workspace = parseWorkspace(url.searchParams.get("workspace"));
  if (url.searchParams.has("workspace") && !workspace) {
    return NextResponse.json({ error: "invalid-workspace" }, { status: 400 });
  }

  let query = getAdminSupabase()
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (workspace) query = query.eq("workspace", workspace);

  const { error: dbErr } = await query;

  if (dbErr) return NextResponse.json({ error: "delete-failed" }, { status: 500 });
  // Messages + their search_vector are removed automatically via the FK cascade
  // (migration 0006). Memory (tmap-v2) is not yet linked to a conversation id —
  // scoping/purging it is Phase 2 (see plan: product-scoped, then conversation-linked).
  return NextResponse.json({ ok: true });
}
