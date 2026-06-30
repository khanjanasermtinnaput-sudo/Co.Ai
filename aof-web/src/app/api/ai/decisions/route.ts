/**
 * POST /api/ai/decisions
 * AI Decision Engine — compares multiple implementation approaches
 * before recommending the most appropriate solution.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { streamChat } from "@/lib/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DecisionSchema = z.object({
  problem: z.string().min(10).max(2000),
  approaches: z.array(z.string().min(1).max(200)).min(2).max(5).optional(),
  criteria: z.array(z.string()).optional().default(["performance", "complexity", "maintainability", "scalability", "risk"]),
  context: z.string().max(1000).optional(),
});

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

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const { problem, approaches, criteria, context } = parsed.data;

  const systemContext = `You are an AI Decision Engine for software engineering.
Compare multiple implementation approaches before recommending the best solution.
Always evaluate each approach on: ${criteria.join(", ")}.
Format your response as:
## Approach A: [name]
- Performance: ...
- Complexity: ...
- Maintainability: ...
- Scalability: ...
- Risk: ...

## Approach B: [name]
[same format]

## Recommendation
[Clear recommendation with reasoning]

Never blindly implement the first idea. Always consider trade-offs.
${context ? `Context: ${context}` : ""}`;

  const message = approaches
    ? `Compare these approaches for: ${problem}\nApproaches to compare: ${approaches.join(", ")}`
    : `Analyze the best approaches for: ${problem}. Identify and compare the top 2-3 implementation strategies.`;

  try {
    const response = await streamChat({
      message,
      agent: "analyze",
      systemContext,
      userId: user.id,
    });
    return NextResponse.json({
      problem,
      criteria,
      approaches: approaches ?? ["auto-detected"],
      analysis: response,
    });
  } catch {
    return NextResponse.json({ error: "Decision engine unavailable" }, { status: 503 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "AI Decision Engine — POST with { problem, approaches?, criteria?, context? }",
    defaultCriteria: ["performance", "complexity", "maintainability", "scalability", "risk"],
  });
}
