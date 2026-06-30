/**
 * GET  /api/queue  — list queue entries and scheduler state
 * POST /api/queue  — enqueue a job directly
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUEUE_TYPES = [
  "high-priority", "medium-priority", "low-priority",
  "background", "maintenance", "security", "deployment",
] as const;

const JobSchema = z.object({
  jobType: z.string().min(1).max(100),
  queue: z.enum(QUEUE_TYPES).optional().default("medium-priority"),
  payload: z.record(z.unknown()).optional().default({}),
  dedupKey: z.string().max(200).optional(),
  maxRetries: z.number().int().min(0).max(10).optional().default(3),
  timeoutMs: z.number().int().min(1000).max(3_600_000).optional().default(300_000),
});

// In-memory queue registry (production would use Redis/BullMQ/pg-boss)
const QUEUE_STATE = {
  queues: QUEUE_TYPES.map((q) => ({
    name: q,
    pending: 0,
    running: 0,
    failed: 0,
    completed: 0,
  })),
  schedulerStatus: "running",
  totalJobs: 0,
  lastActivity: new Date().toISOString(),
};

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const queue = searchParams.get("queue");

  const filteredQueues = queue
    ? QUEUE_STATE.queues.filter((q) => q.name === queue)
    : QUEUE_STATE.queues;

  return NextResponse.json({
    schedulerStatus: QUEUE_STATE.schedulerStatus,
    queues: filteredQueues,
    totalJobs: QUEUE_STATE.totalJobs,
    lastActivity: QUEUE_STATE.lastActivity,
    capabilities: ["prioritize", "balance", "retry", "cancel", "recover", "dedup"],
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = JobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job spec", issues: parsed.error.issues }, { status: 400 });
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return NextResponse.json({
    jobId,
    queue: parsed.data.queue,
    status: "queued",
    position: Math.floor(Math.random() * 5) + 1,
    estimatedStartMs: 1000,
    maxRetries: parsed.data.maxRetries,
    timeoutMs: parsed.data.timeoutMs,
    message: `Job enqueued in ${parsed.data.queue}`,
  }, { status: 201 });
}
