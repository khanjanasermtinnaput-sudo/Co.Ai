/**
 * POST /api/ai/mentor
 * AI Mentor Mode — adapts explanations to developer experience level.
 * Levels: beginner | intermediate | advanced | expert
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { streamChat } from "@/lib/server/chat";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MentorSchema = z.object({
  message: z.string().min(1).max(4000),
  level: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional().default("intermediate"),
  topic: z.string().max(100).optional(),
});

const LEVEL_SYSTEM: Record<string, string> = {
  beginner: "Explain concepts from first principles. Use simple language. Define technical terms. Provide analogies. Show step-by-step examples.",
  intermediate: "Explain implementation choices and why this approach was chosen over alternatives. Reference common patterns.",
  advanced: "Discuss architecture trade-offs, performance implications, and edge cases. Assume solid fundamentals.",
  expert: "Provide concise engineering reasoning only. Skip explanations of well-known patterns. Focus on non-obvious insights.",
};

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return formatError("AUTH_401");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON", detail: "invalid-json-body" }, 400);
  }

  const parsed = MentorSchema.safeParse(body);
  if (!parsed.success) {
    return formatError(
      "SYSTEM_500",
      { message: "Invalid input", detail: JSON.stringify(parsed.error.issues) },
      400,
    );
  }

  const { message, level } = parsed.data;
  const systemContext = LEVEL_SYSTEM[level];

  try {
    const response = await streamChat({
      message,
      agent: "chat",
      systemContext,
      userId: user.id,
    });
    return NextResponse.json({ level, response });
  } catch {
    return formatError("API_500", { message: "Mentor service unavailable", detail: "mentor-stream-failed" }, 503);
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "AI Mentor Mode — POST with { message, level: beginner|intermediate|advanced|expert }",
    levels: Object.keys(LEVEL_SYSTEM),
  });
}
