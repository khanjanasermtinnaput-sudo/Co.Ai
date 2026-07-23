/**
 * POST /api/vision/screenshot-to-code
 * Accepts a screenshot (base64 or URL) and generates production-ready
 * React/TypeScript components that match the visual layout.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ScreenshotSchema = z.object({
  imageBase64: z.string().optional(),
  imageUrl: z.string().url().optional(),
  framework: z.enum(["nextjs", "react", "vue", "angular"]).optional().default("nextjs"),
  designSystem: z.string().optional().default("tailwind"),
  reuseExisting: z.boolean().optional().default(true),
  description: z.string().max(500).optional(),
}).refine((d) => d.imageBase64 || d.imageUrl, {
  message: "Either imageBase64 or imageUrl is required",
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

  const parsed = ScreenshotSchema.safeParse(body);
  if (!parsed.success) {
    return formatError(
      "SYSTEM_500",
      { message: "Invalid input", detail: JSON.stringify(parsed.error.issues) },
      400,
    );
  }

  // No real vision-model call exists here yet — this used to return a
  // hardcoded detectedComponents/generatedCode pair regardless of the actual
  // image, which is exactly the "fake/placeholder workflow" this repo's own
  // governance doc forbids. Reporting the honest status instead, the same
  // pattern deployment-panel.tsx uses for a deploy target with no real
  // integration ("Not configured") rather than faking success.
  return NextResponse.json(
    {
      status: "not_implemented",
      message: "Screenshot-to-code analysis isn't wired to a vision model yet — no code was generated.",
    },
    { status: 501 },
  );
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "Screenshot → Code Engine — POST with { imageBase64 | imageUrl, framework?, designSystem? }",
    supportedLayouts: ["dashboard", "landing-page", "admin-panel", "mobile-ui", "forms", "tables", "cards", "navigation"],
  });
}
