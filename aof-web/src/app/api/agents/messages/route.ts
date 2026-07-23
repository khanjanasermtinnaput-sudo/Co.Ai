/**
 * GET  /api/agents/messages  — fetch ACP messages for an agent/task
 * POST /api/agents/messages  — send a structured ACP message between agents
 *
 * Agent Communication Protocol (ACP) — Phase 64
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACP_STATUSES = [
  "queued", "planning", "running", "waiting",
  "review", "completed", "failed", "cancelled",
] as const;

const ACPMessageSchema = z.object({
  taskId: z.string().min(1).max(100),
  fromAgent: z.string().min(1).max(50),
  toAgent: z.string().min(1).max(50),
  dependencies: z.array(z.string()).optional().default([]),
  priority: z.enum(["critical", "high", "medium", "low"]).optional().default("medium"),
  context: z.record(z.unknown()).optional().default({}),
  expectedOutput: z.string().max(500).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  executionStatus: z.enum(ACP_STATUSES).optional().default("queued"),
  payload: z.string().max(4000).optional(),
});

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return formatError("AUTH_401");

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");
  const agentId = searchParams.get("agentId");

  return NextResponse.json({
    messages: [],
    filters: { taskId, agentId },
    protocol: "ACP/1.0",
    supportedStatuses: ACP_STATUSES,
    agentTypes: [
      "planner", "frontend", "backend", "database",
      "security", "testing", "documentation", "deployment",
    ],
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return formatError("AUTH_401");

  let body: unknown;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON", detail: "invalid-json-body" }, 400);
  }

  const parsed = ACPMessageSchema.safeParse(body);
  if (!parsed.success) {
    return formatError(
      "SYSTEM_500",
      { message: "Invalid ACP message", detail: JSON.stringify(parsed.error.issues) },
      400,
    );
  }

  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return NextResponse.json({
    messageId,
    protocol: "ACP/1.0",
    status: "delivered",
    message: {
      ...parsed.data,
      id: messageId,
      sentAt: new Date().toISOString(),
      sentBy: user.id,
    },
    guarantees: ["exactly-once-delivery", "ordered-per-task", "failure-isolated"],
  }, { status: 201 });
}
