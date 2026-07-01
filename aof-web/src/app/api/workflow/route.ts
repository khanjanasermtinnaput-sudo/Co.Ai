// ── Adaptive Workflow Engine API (Phase 11) ───────────────────────────────────
// Classifies a user request and returns the optimal workflow decision.

import { classifyWorkflow } from "@/lib/cocode/adaptive-workflow";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const { request, hasRepoContext = false, fileCount } = body as { request: string; hasRepoContext?: boolean; fileCount?: number };
  if (!request?.trim()) {
    return Response.json({ error: "request required" }, { status: 400 });
  }

  const decision = classifyWorkflow(request, hasRepoContext, fileCount);
  return Response.json(decision);
}
