// ── AI Learning Engine — Pattern Storage (Phase 46) ──────────────────────────
// Stores successful patterns, architecture decisions, and coding preferences
// so future AI generations become more consistent with the repository.
// POST /api/ai/learning  → store a pattern
// GET  /api/ai/learning  → retrieve stored patterns

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { z } from "zod";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatternSchema = z.object({
  type: z.enum(["architecture", "naming", "component", "testing", "coding", "deployment", "review"]),
  pattern: z.string().min(1).max(5000),
  context: z.string().max(1000).optional(),
  tags: z.array(z.string()).max(10).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!isAdminConfigured()) {
    return formatError("API_500", { detail: "not-configured" }, 503);
  }

  const user = await getUserFromRequest(req).catch(() => null);
  if (!user) return formatError("AUTH_401", { detail: "unauthorized" });

  const rl = await checkRateLimit(user.id, "chat");
  if (!rl.allowed) return formatError("API_429", { detail: "rate-limited" });

  let body: z.infer<typeof PatternSchema>;
  try {
    body = PatternSchema.parse(await req.json());
  } catch {
    return formatError("SYSTEM_500", { message: "Invalid pattern schema", detail: "invalid-pattern-schema" }, 400);
  }

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("ai_learning_patterns")
    .insert({
      user_id: user.id,
      type: body.type,
      pattern: body.pattern,
      context: body.context ?? null,
      tags: body.tags ?? [],
      confidence: body.confidence ?? 0.8,
    })
    .select("id, created_at")
    .single();

  if (error) {
    // Table may not exist yet — return success stub so the engine still works
    return NextResponse.json({ id: "stub", stored: false, reason: error.message });
  }

  return NextResponse.json({ id: data.id, stored: true, createdAt: data.created_at });
}

export async function GET(req: Request): Promise<Response> {
  if (!isAdminConfigured()) {
    return NextResponse.json({ patterns: [], total: 0 });
  }

  const user = await getUserFromRequest(req).catch(() => null);
  if (!user) return formatError("AUTH_401", { detail: "unauthorized" });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);

  const supabase = getAdminSupabase();
  let query = supabase
    .from("ai_learning_patterns")
    .select("id, type, pattern, context, tags, confidence, created_at")
    .eq("user_id", user.id)
    .order("confidence", { ascending: false })
    .limit(limit);

  if (type) query = query.eq("type", type);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ patterns: [], total: 0, note: "patterns table not yet created" });
  }

  return NextResponse.json({ patterns: data ?? [], total: data?.length ?? 0 });
}
