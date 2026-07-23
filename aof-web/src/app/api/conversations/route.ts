// ── /api/conversations ────────────────────────────────────────────────────────
// GET    → list the user's conversations for a workspace (newest first, max 60)
// POST   → create a new conversation in a workspace
// DELETE → bulk delete: { ids: string[] } (selected) or { workspace, all: true }
//          ("Delete All CoChat/CoCode History"). Messages cascade via FK (0006).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { parseWorkspace } from "@/lib/server/workspace";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser(req: Request) {
  if (!isAdminConfigured()) {
    return { error: formatError("API_500", { detail: "not-configured" }, 503) };
  }
  const user = await getUserFromRequest(req);
  if (!user) return { error: formatError("AUTH_401", { detail: "unauthorized" }) };
  return { user };
}

export async function GET(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const url = new URL(req.url);
  const workspace = parseWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return formatError("SYSTEM_500", { message: "invalid-workspace", detail: "invalid-workspace" }, 400);

  const { data, error: dbErr } = await getAdminSupabase()
    .from("conversations")
    .select("id, title, model, created_at, updated_at")
    .eq("user_id", user.id)
    .eq("workspace", workspace)
    .order("updated_at", { ascending: false })
    .limit(60);

  if (dbErr) return formatError("DB_500", { detail: "load-failed: " + dbErr.message });
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  let body: { id?: unknown; title?: unknown; model?: unknown; workspace?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const workspace = body.workspace === undefined ? "cochat" : parseWorkspace(body.workspace);
  if (!workspace) return formatError("SYSTEM_500", { message: "invalid-workspace", detail: "invalid-workspace" }, 400);

  const id = typeof body.id === "string" ? body.id : `conv_${Math.random().toString(36).slice(2,9)}`;
  const title = typeof body.title === "string" ? body.title.slice(0, 120) : "New chat";
  const model = typeof body.model === "string" ? body.model : "normal";
  const now = new Date().toISOString();

  const { error: dbErr } = await getAdminSupabase()
    .from("conversations")
    .insert({ id, user_id: user.id, title, model, workspace, created_at: now, updated_at: now });

  if (dbErr) return formatError("DB_500", { detail: "create-failed: " + dbErr.message });
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  let body: { ids?: unknown; workspace?: unknown; all?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  if (body.all === true) {
    const workspace = parseWorkspace(body.workspace);
    if (!workspace) return formatError("SYSTEM_500", { message: "invalid-workspace", detail: "invalid-workspace" }, 400);

    const { error: dbErr } = await getAdminSupabase()
      .from("conversations")
      .delete()
      .eq("user_id", user.id)
      .eq("workspace", workspace);

    if (dbErr) return formatError("DB_500", { detail: "delete-failed: " + dbErr.message });
    return NextResponse.json({ ok: true });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) return formatError("SYSTEM_500", { message: "ids-or-all-required", detail: "ids-or-all-required" }, 400);

  const { error: dbErr } = await getAdminSupabase()
    .from("conversations")
    .delete()
    .eq("user_id", user.id)
    .in("id", ids);

  if (dbErr) return formatError("DB_500", { detail: "delete-failed: " + dbErr.message });
  return NextResponse.json({ ok: true });
}
