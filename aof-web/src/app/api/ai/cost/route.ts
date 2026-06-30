/**
 * GET  /api/ai/cost  — get cost estimates and optimization recommendations
 * POST /api/ai/cost  — analyze a specific cost scenario
 *
 * AI Cost Optimization — Phase 69
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CostScenarioSchema = z.object({
  monthlyRequests: z.number().int().min(0).optional(),
  avgTokensPerRequest: z.number().int().min(0).optional().default(1000),
  storageGb: z.number().min(0).optional().default(0),
  bandwidthGb: z.number().min(0).optional().default(0),
  buildMinutesPerMonth: z.number().int().min(0).optional().default(0),
  currentModel: z.string().max(100).optional().default("claude-sonnet"),
  enableCaching: z.boolean().optional().default(false),
});

function estimateCosts(data: z.infer<typeof CostScenarioSchema>) {
  const { monthlyRequests = 0, avgTokensPerRequest, storageGb, bandwidthGb, buildMinutesPerMonth, enableCaching } = data;
  const tokenMultiplier = enableCaching ? 0.4 : 1.0; // 60% savings with caching

  const llmCost = (monthlyRequests * avgTokensPerRequest * 0.000003 * tokenMultiplier);
  const storageCost = storageGb * 0.023;
  const bandwidthCost = bandwidthGb * 0.09;
  const buildCost = buildMinutesPerMonth * 0.008;
  const total = llmCost + storageCost + bandwidthCost + buildCost;

  const withCaching = total * 0.4;
  const withModelRouting = total * 0.65;
  const withAllOptimizations = total * 0.3;

  return {
    current: { llm: llmCost, storage: storageCost, bandwidth: bandwidthCost, build: buildCost, total },
    optimized: {
      withCaching: { total: withCaching, savings: total - withCaching, savingsPercent: 60 },
      withModelRouting: { total: withModelRouting, savings: total - withModelRouting, savingsPercent: 35 },
      withAllOptimizations: { total: withAllOptimizations, savings: total - withAllOptimizations, savingsPercent: 70 },
    },
    recommendations: [
      enableCaching ? null : "Enable response caching (5-min TTL) — saves ~60% on LLM costs",
      "Route simple tasks to faster/cheaper models (Haiku vs Sonnet)",
      "Compress API responses with gzip — reduces bandwidth cost",
      "Use ISR for static-heavy pages — reduces compute",
      "Batch database queries — reduces Supabase row-read costs",
    ].filter(Boolean),
  };
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const defaults = { monthlyRequests: 1000, avgTokensPerRequest: 1000, storageGb: 1, bandwidthGb: 10, buildMinutesPerMonth: 60, enableCaching: false };
  const costs = estimateCosts(defaults);

  return NextResponse.json({
    scenario: "default-1k-requests",
    ...costs,
    projectedMonthlySavings: `$${costs.optimized.withAllOptimizations.savings.toFixed(2)}`,
    currency: "USD",
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CostScenarioSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scenario", issues: parsed.error.issues }, { status: 400 });
  }

  const costs = estimateCosts(parsed.data);

  return NextResponse.json({
    scenario: parsed.data,
    ...costs,
    projectedMonthlySavings: `$${costs.optimized.withAllOptimizations.savings.toFixed(2)}`,
    currency: "USD",
  });
}
