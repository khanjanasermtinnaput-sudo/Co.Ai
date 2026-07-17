// ── /api/conversations/[id]/messages ─────────────────────────────────────────
// GET  → load all saved messages for a conversation the caller owns
// POST → append one or more messages to a conversation

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

interface MessageRow {
  id: string;
  role: string;
  content: string;
  model?: string;
  route_target?: string;
  route_label?: string;
  style?: string;
  created_at?: string;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { id: conversationId } = await params;

  // Ownership check first, separate from the messages query itself, so a
  // conversation id belonging to another user 404s instead of ever reaching
  // (or revealing the existence of) that user's messages.
  const { data: conv, error: convErr } = await getAdminSupabase()
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (convErr) {
    console.error(
      "[/api/conversations/[id]/messages] ownership check failed:",
      convErr.message,
      { conversationId, userId: user.id },
    );
    return NextResponse.json({ error: "load-failed" }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const { data, error: dbErr } = await getAdminSupabase()
    .from("messages")
    .select("id, role, content, model, route_target, route_label, style, created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (dbErr) {
    console.error(
      "[/api/conversations/[id]/messages] load failed:",
      dbErr.message,
      { conversationId, userId: user.id },
    );
    return NextResponse.json({ error: "load-failed" }, { status: 500 });
  }

  return NextResponse.json({ messages: (data ?? []) as MessageRow[] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { id: conversationId } = await params;
  let body: { messages?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const msgs = Array.isArray(body.messages) ? body.messages : [];
  if (!msgs.length) return NextResponse.json({ error: "messages-required" }, { status: 400 });

  const now = new Date().toISOString();
  const rows = (msgs as MessageRow[]).map((m) => ({
    id: m.id,
    conversation_id: conversationId,
    user_id: user.id,
    role: m.role,
    content: m.content ?? "",
    model: m.model ?? null,
    route_target: m.route_target ?? null,
    route_label: m.route_label ?? null,
    style: m.style ?? null,
    created_at: m.created_at ?? now,
  }));

  const { error: dbErr } = await getAdminSupabase()
    .from("messages")
    .upsert(rows, { onConflict: "id" });

  if (dbErr) return NextResponse.json({ error: "save-failed" }, { status: 500 });

  // Bump the conversation's updated_at
  await getAdminSupabase()
    .from("conversations")
    .update({ updated_at: now })
    .eq("id", conversationId)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
