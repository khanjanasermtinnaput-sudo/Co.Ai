/**
 * GET  /api/tasks        — list autonomous tasks for the current user
 * POST /api/tasks        — create and enqueue a new autonomous task
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_TYPES = [
  "feature", "bugfix", "refactor", "security-audit", "performance",
  "documentation", "migration", "deployment", "testing", "cleanup",
] as const;

const TASK_STATUSES = [
  "queued", "planning", "running", "paused", "waiting",
  "review", "completed", "failed", "cancelled",
] as const;

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(TASK_TYPES),
  priority: z.enum(["high", "medium", "low", "background"]).optional().default("medium"),
  autoRecover: z.boolean().optional().default(true),
  checkpointInterval: z.number().int().min(1).max(60).optional().default(5),
});

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100);

  try {
    const supabase = createAdminClient();
    let query = supabase
      .from("autonomous_tasks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error && error.code !== "42P01") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tasks: data ?? [], total: data?.length ?? 0 });
  } catch {
    return NextResponse.json({ tasks: [], total: 0, message: "Tasks table not yet migrated" });
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("autonomous_tasks").insert({
      id: taskId,
      user_id: user.id,
      title: parsed.data.title,
      description: parsed.data.description,
      type: parsed.data.type,
      priority: parsed.data.priority,
      status: "queued",
      auto_recover: parsed.data.autoRecover,
      checkpoint_interval: parsed.data.checkpointInterval,
      created_at: new Date().toISOString(),
    }).select().single();

    if (error && error.code !== "42P01") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      task: data ?? { id: taskId, status: "queued", ...parsed.data },
      message: "Task queued for autonomous execution",
      capabilities: ["pause", "resume", "cancel", "retry", "auto-recover"],
    }, { status: 201 });
  } catch {
    return NextResponse.json({
      task: { id: taskId, status: "queued", ...parsed.data },
      message: "Task created (table pending migration)",
    }, { status: 201 });
  }
}
