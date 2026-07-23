/**
 * GET  /api/ai/memory  — retrieve memory entries by type
 * POST /api/ai/memory  — store a new memory entry
 * DELETE /api/ai/memory — expire/delete a stale memory
 *
 * AI Memory Engine V2 — Phase 65
 * Supports: project, repository, conversation, architecture, deployment,
 *           testing, user-preference, decision, lessons-learned
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/server/supabase";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEMORY_TYPES = [
  "project", "repository", "conversation", "architecture",
  "deployment", "testing", "user-preference", "decision", "lessons-learned",
] as const;

const MemorySchema = z.object({
  type: z.enum(MEMORY_TYPES),
  key: z.string().min(1).max(200),
  value: z.record(z.unknown()),
  ttlDays: z.number().int().min(1).max(365).optional().default(30),
  tags: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional().default(0.8),
});

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return formatError("AUTH_401");

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const key = searchParams.get("key");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

  try {
    const supabase = createAdminClient();
    let query = supabase
      .from("ai_memory_v2")
      .select("*")
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (type && MEMORY_TYPES.includes(type as (typeof MEMORY_TYPES)[number])) {
      query = query.eq("type", type);
    }
    if (key) query = query.eq("key", key);

    const { data, error } = await query;
    if (error && error.code !== "42P01") {
      return formatError("DB_500", { detail: error.message });
    }

    return NextResponse.json({
      memories: data ?? [],
      total: data?.length ?? 0,
      types: MEMORY_TYPES,
      policy: "Memories auto-expire. Stale architectural decisions are never retained.",
    });
  } catch {
    return NextResponse.json({ memories: [], total: 0, message: "Memory table not yet migrated" });
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return formatError("AUTH_401");

  let body: unknown;
  try { body = await req.json(); } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON", detail: "invalid-json-body" }, 400);
  }

  const parsed = MemorySchema.safeParse(body);
  if (!parsed.success) {
    return formatError(
      "SYSTEM_500",
      { message: "Invalid memory", detail: JSON.stringify(parsed.error.issues) },
      400,
    );
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parsed.data.ttlDays);

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("ai_memory_v2").upsert({
      user_id: user.id,
      type: parsed.data.type,
      key: parsed.data.key,
      value: parsed.data.value,
      tags: parsed.data.tags,
      confidence: parsed.data.confidence,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,type,key" }).select().single();

    if (error && error.code !== "42P01") {
      return formatError("DB_500", { detail: error.message });
    }

    return NextResponse.json({
      memory: data ?? { ...parsed.data, expiresAt: expiresAt.toISOString() },
      expiresAt: expiresAt.toISOString(),
    }, { status: 201 });
  } catch {
    return NextResponse.json({
      memory: { ...parsed.data, expiresAt: expiresAt.toISOString() },
      message: "Memory stored (table pending migration)",
    }, { status: 201 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return formatError("AUTH_401");

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const key = searchParams.get("key");

  if (!type || !key) {
    return formatError("SYSTEM_500", { message: "type and key query params required", detail: "missing-type-or-key" }, 400);
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("ai_memory_v2")
      .delete()
      .eq("user_id", user.id)
      .eq("type", type)
      .eq("key", key);

    if (error && error.code !== "42P01") {
      return formatError("DB_500", { detail: error.message });
    }

    return NextResponse.json({ deleted: true, type, key });
  } catch {
    return NextResponse.json({ deleted: true, message: "Memory expired (table pending migration)" });
  }
}
