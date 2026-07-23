/**
 * POST /api/vision/design-to-code
 * Accepts a design file reference (Figma/Penpot/Sketch/Adobe XD)
 * and generates production-ready, maintainable components.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DesignSchema = z.object({
  source: z.enum(["figma", "penpot", "sketch", "adobexd"]),
  url: z.string().url().optional(),
  fileId: z.string().optional(),
  nodeId: z.string().optional(),
  accessToken: z.string().optional(),
  framework: z.enum(["nextjs", "react", "vue"]).optional().default("nextjs"),
  designSystem: z.string().optional().default("tailwind"),
  generateResponsive: z.boolean().optional().default(true),
}).refine((d) => d.url || d.fileId, {
  message: "Either url or fileId is required",
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

  const parsed = DesignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  // No real Figma/Penpot/Sketch/Adobe XD API integration exists here yet —
  // this used to return hardcoded extractedTokens regardless of the actual
  // design file, exactly the "fake/placeholder workflow" this repo's own
  // governance doc forbids. Reporting the honest status instead, the same
  // pattern deployment-panel.tsx uses for a deploy target with no real
  // integration ("Not configured") rather than faking success.
  return NextResponse.json(
    {
      status: "not_implemented",
      source: parsed.data.source,
      message: `${parsed.data.source} design-file analysis isn't wired to a real design-tool API yet — no components were generated.`,
    },
    { status: 501 },
  );
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "Design → Code Engine — POST with { source, url|fileId, framework?, designSystem? }",
    supportedSources: ["figma", "penpot", "sketch", "adobexd"],
  });
}
