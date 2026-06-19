// ── /api/cli/token ────────────────────────────────────────────────────────────
// Manages personal CLI access tokens for Advanced subscribers.
//   GET    → current token info (prefix, created, last_used) — never the raw token
//   POST   → generate a new token (returns raw token ONCE)
//   DELETE → revoke the current token
//   PATCH  → regenerate: revoke + generate in one call (returns new raw token)

import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdvanced(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "backend-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const tier = (user.app_metadata?.tier as string | undefined) ?? "FREE";
  if (tier !== "ADVANCED") {
    return { error: NextResponse.json({ error: "advanced-required" }, { status: 403 }) };
  }
  return { user };
}

function generateToken(): { raw: string; hash: string; prefix: string } {
  const bytes = randomBytes(32).toString("hex");
  const raw = `coai_${bytes}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 16);
  return { raw, hash, prefix };
}

async function revokeExisting(userId: string): Promise<void> {
  await getAdminSupabase()
    .from("cli_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
}

export async function GET(req: Request) {
  const { user, error } = await requireAdvanced(req);
  if (error) return error;

  const { data, error: dbErr } = await getAdminSupabase()
    .from("cli_tokens")
    .select("id, token_prefix, created_at, last_used_at, expires_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dbErr) return NextResponse.json({ error: "load-failed" }, { status: 500 });
  if (!data) return NextResponse.json({ token: null });

  return NextResponse.json({
    token: {
      id: data.id,
      prefix: data.token_prefix,
      createdAt: data.created_at,
      lastUsedAt: data.last_used_at,
      expiresAt: data.expires_at,
    },
  });
}

export async function POST(req: Request) {
  const { user, error } = await requireAdvanced(req);
  if (error) return error;

  // One active token per user — revoke any existing before creating.
  await revokeExisting(user.id);

  const { raw, hash, prefix } = generateToken();

  const { error: dbErr } = await getAdminSupabase()
    .from("cli_tokens")
    .insert({ user_id: user.id, token_hash: hash, token_prefix: prefix });

  if (dbErr) return NextResponse.json({ error: "create-failed" }, { status: 500 });

  // Raw token is returned exactly once — store it now, we never show it again.
  return NextResponse.json({ raw, prefix }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { user, error } = await requireAdvanced(req);
  if (error) return error;

  await revokeExisting(user.id);

  // Also invalidate all CLI sessions for this user.
  await getAdminSupabase().from("cli_sessions").delete().eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const { user, error } = await requireAdvanced(req);
  if (error) return error;

  await revokeExisting(user.id);
  await getAdminSupabase().from("cli_sessions").delete().eq("user_id", user.id);

  const { raw, hash, prefix } = generateToken();

  const { error: dbErr } = await getAdminSupabase()
    .from("cli_tokens")
    .insert({ user_id: user.id, token_hash: hash, token_prefix: prefix });

  if (dbErr) return NextResponse.json({ error: "regenerate-failed" }, { status: 500 });

  return NextResponse.json({ raw, prefix });
}
