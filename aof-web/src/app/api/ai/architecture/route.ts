/**
 * POST /api/ai/architecture
 * AI Architecture Evolution — continuous analysis and refactoring plans.
 * Phase 68
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { streamChat } from "@/lib/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ArchSchema = z.object({
  repoContext: z.string().max(3000).optional(),
  focusArea: z.enum([
    "large-components", "feature-coupling", "layer-violations",
    "circular-dependencies", "microservice-candidates", "monolith-bottlenecks", "full",
  ]).optional().default("full"),
  generatePlan: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ArchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const { focusArea, repoContext, generatePlan } = parsed.data;

  const systemContext = `You are an AI Architecture Evolution Engine.
Analyze the software architecture and detect: large components (>500 LOC), feature coupling,
layer violations, circular dependencies, microservice candidates, and monolith bottlenecks.
${generatePlan ? "Generate: Architecture Refactoring Plan, Migration Steps, Risk Analysis, Expected Benefits." : ""}
Never recommend unnecessary complexity. Always justify recommendations with evidence.
Focus: ${focusArea}`;

  const message = repoContext
    ? `Analyze this repository architecture:\n\n${repoContext}`
    : `Perform architecture evolution analysis focused on: ${focusArea}. Identify issues and recommend evidence-based improvements.`;

  try {
    const response = await streamChat({
      message,
      agent: "analyze",
      systemContext,
      userId: user.id,
    });

    return NextResponse.json({
      focusArea,
      analysis: response,
      principles: [
        "Never recommend unnecessary complexity",
        "All recommendations are evidence-based",
        "Migration steps are non-destructive",
        "Risk analysis included for every change",
      ],
    });
  } catch {
    return NextResponse.json({ error: "Architecture analysis unavailable" }, { status: 503 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "AI Architecture Evolution — POST with { focusArea?, repoContext?, generatePlan? }",
    focusAreas: [
      "large-components", "feature-coupling", "layer-violations",
      "circular-dependencies", "microservice-candidates", "monolith-bottlenecks", "full",
    ],
  });
}
