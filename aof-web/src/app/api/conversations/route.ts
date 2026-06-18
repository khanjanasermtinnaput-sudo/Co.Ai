// ── /api/conversations ────────────────────────────────────────────────────────
// GET  → list the user's conversations (newest first, max 60)
// POST → create a new conversation

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

export async function GET(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { data, error: dbErr } = await getAdminSupabase()
    .from("conversations")
    .select("id, title, model, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(60);

  if (dbErr) return NextResponse.json({ error: "load-failed" }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  let body: { id?: unknown; title?: unknown; model?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const id = typeof body.id === "string" ? body.id : `conv_${Math.random().toString(36).slice(2,9)}`;
  const title = typeof body.title === "string" ? body.title.slice(0, 120) : "New chat";
  const model = typeof body.model === "string" ? body.model : "normal";
  const now = new Date().toISOString();

  const { error: dbErr } = await getAdminSupabase()
    .from("conversations")
    .insert({ id, user_id: user.id, title, model, created_at: now, updated_at: now });

  if (dbErr) return NextResponse.json({ error: "create-failed" }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
