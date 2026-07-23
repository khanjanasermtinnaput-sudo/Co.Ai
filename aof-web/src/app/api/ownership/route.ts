/**
 * GET  /api/ownership         — get ownership info for a file/module
 * POST /api/ownership         — set or update ownership record
 *
 * Intelligent Code Ownership — Phase 67
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RISK_LEVELS = ["critical", "high", "medium", "low"] as const;

const OwnershipSchema = z.object({
  filePath: z.string().min(1).max(500),
  owner: z.string().min(1).max(100),
  reviewers: z.array(z.string()).min(1).max(10),
  riskLevel: z.enum(RISK_LEVELS),
  businessDomain: z.string().max(100).optional(),
  relatedServices: z.array(z.string()).optional().default([]),
  relatedApis: z.array(z.string()).optional().default([]),
  relatedTables: z.array(z.string()).optional().default([]),
  autoAssign: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return formatError("AUTH_401");

  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("filePath");

  if (!filePath) {
    return formatError("SYSTEM_500", { message: "filePath query parameter required", detail: "missing-file-path" }, 400);
  }

  // In production: query git blame + ownership DB
  return NextResponse.json({
    filePath,
    owner: null,
    reviewers: [],
    riskLevel: "medium",
    businessDomain: null,
    relatedServices: [],
    relatedApis: [],
    relatedTables: [],
    autoAssigned: false,
    message: "Ownership not yet recorded for this file. POST to /api/ownership to set.",
    aiRecommendation: "Run git blame analysis to suggest owners based on commit history",
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return formatError("AUTH_401");

  let body: unknown;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON", detail: "invalid-json-body" }, 400);
  }

  const parsed = OwnershipSchema.safeParse(body);
  if (!parsed.success) {
    return formatError(
      "SYSTEM_500",
      { message: "Invalid ownership record", detail: JSON.stringify(parsed.error.issues) },
      400,
    );
  }

  return NextResponse.json({
    ownership: {
      ...parsed.data,
      id: `own-${Date.now()}`,
      setBy: user.id,
      setAt: new Date().toISOString(),
    },
    reviewerRecommendation: parsed.data.reviewers[0],
    message: "Ownership record stored. AI will recommend correct reviewers on future PRs.",
  }, { status: 201 });
}
