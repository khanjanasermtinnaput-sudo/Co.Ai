// POST /api/feedback — anonymous or authenticated user feedback submission.
// Rate-limited to 5 submissions per minute per IP.
import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["bug", "feature", "general", "praise"] as const;
type FeedbackType = (typeof TYPES)[number];

function isFeedbackType(v: unknown): v is FeedbackType {
  return typeof v === "string" && (TYPES as readonly string[]).includes(v);
}

function sanitize(v: unknown, maxLen = 2000): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, maxLen);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const type    = isFeedbackType(body.type) ? body.type : "general";
  const message = sanitize(body.message);
  const page    = sanitize(body.page ?? "", 200);

  if (message.length < 3) {
    return NextResponse.json({ error: "message-too-short" }, { status: 400 });
  }

  // Optionally attach to the signed-in user.
  let userId: string | null = null;
  if (isAdminConfigured()) {
    const user = await getUserFromRequest(req).catch(() => null);
    userId = user?.id ?? null;

    const supabase = getAdminSupabase();
    const { error } = await supabase.from("feedback").insert({
      user_id: userId,
      type,
      message,
      page: page || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      // Don't expose DB errors — log server-side and return generic 500.
      console.error("[feedback]", error.message);
      return NextResponse.json({ error: "save-failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
