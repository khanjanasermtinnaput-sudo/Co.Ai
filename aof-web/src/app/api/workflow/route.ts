// ── Adaptive Workflow Engine API (Phase 11) ───────────────────────────────────
// Classifies a user request and returns the optimal workflow decision.

import { classifyWorkflow } from "@/lib/cocode/adaptive-workflow";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { request: string; hasRepoContext?: boolean; fileCount?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { request, hasRepoContext = false, fileCount } = body;
  if (!request?.trim()) {
    return Response.json({ error: "request required" }, { status: 400 });
  }

  const decision = classifyWorkflow(request, hasRepoContext, fileCount);
  return Response.json(decision);
}
