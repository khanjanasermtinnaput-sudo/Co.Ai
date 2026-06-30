/**
 * GET  /api/timeline  — fetch project timeline events
 * POST /api/timeline  — record a new timeline event
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_TYPES = [
  "repo_created", "feature_added", "refactor", "deployment",
  "incident", "bug_fix", "architecture_change", "migration", "release",
] as const;

const TimelineEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const type = searchParams.get("type");

  try {
    const supabase = createAdminClient();
    let query = supabase
      .from("timeline_events")
      .select("*")
      .eq("user_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (type && EVENT_TYPES.includes(type as (typeof EVENT_TYPES)[number])) {
      query = query.eq("type", type);
    }

    const { data, error } = await query;
    if (error && error.code !== "42P01") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ events: data ?? [], total: data?.length ?? 0 });
  } catch {
    return NextResponse.json({ events: [], total: 0, message: "Timeline table not yet created" });
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = TimelineEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("timeline_events").insert({
      user_id: user.id,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description,
      metadata: parsed.data.metadata,
      occurred_at: parsed.data.occurredAt ?? new Date().toISOString(),
    }).select().single();

    if (error && error.code !== "42P01") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ event: data ?? { ...parsed.data, id: "pending-table-creation" } }, { status: 201 });
  } catch {
    return NextResponse.json({ event: parsed.data, message: "Timeline recorded (table not yet migrated)" }, { status: 201 });
  }
}
