/**
 * POST /api/voice
 * Accepts a transcribed voice command and routes it through the
 * same intent-analysis → requirements → planning → code-gen pipeline
 * as text commands.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { streamChat } from "@/lib/server/chat";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VoiceSchema = z.object({
  transcript: z.string().min(1).max(2000),
  language: z.string().optional().default("en"),
  confirmDestructive: z.boolean().optional().default(false),
});

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

  const parsed = VoiceSchema.safeParse(body);
  if (!parsed.success) {
    return formatError(
      "SYSTEM_500",
      { message: "Invalid input", detail: JSON.stringify(parsed.error.issues) },
      400,
    );
  }

  const { transcript, language, confirmDestructive } = parsed.data;

  // Classify intent to enforce confirmation on destructive commands
  const destructivePatterns = /delete|drop|remove all|destroy|wipe|truncate|reset database/i;
  const isDestructive = destructivePatterns.test(transcript);
  if (isDestructive && !confirmDestructive) {
    return NextResponse.json({
      requiresConfirmation: true,
      action: transcript,
      warning: "This voice command may perform a destructive action. Set confirmDestructive=true to proceed.",
    }, { status: 200 });
  }

  // Route voice transcript through the workflow/requirements pipeline
  const systemContext = `You are processing a voice command from a developer.
Language: ${language}.
Always summarize your understanding of the command before proposing any code changes.
Format: [Understanding] → [Plan] → [Code Changes (if any)]`;

  try {
    const response = await streamChat({
      message: transcript,
      agent: "requirements",
      systemContext,
      userId: user.id,
    });

    return NextResponse.json({
      transcript,
      language,
      isDestructive,
      response,
    });
  } catch {
    return formatError(
      "API_500",
      {
        message: "Voice processing failed",
        detail: `transcript="${transcript}"; fallback="I heard: \\"${transcript}\\". Processing as a requirements request."`,
      },
      503,
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "AI Voice Coding Engine — POST with { transcript, language?, confirmDestructive? }",
    supportedIntents: ["feature", "bugfix", "deploy", "rename", "optimize", "connect", "fix"],
  });
}
